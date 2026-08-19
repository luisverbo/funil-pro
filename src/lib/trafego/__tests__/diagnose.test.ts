// ============================================================================
// Gestor de Tráfego — Fase 1: agente analista (item 1.14)
// ----------------------------------------------------------------------------
// Toda a suíte roda com DADOS DE MENTIRA: nenhuma chamada de rede, de banco ou
// de IA. É possível justamente porque o analista é determinístico — quem
// decide "isto é um problema" é regra com limite explícito, não um modelo.
//
// O que cada teste protege:
//   • número inventado — todo achado carrega os valores que o geraram;
//   • palpite com cara de análise — gasto pequeno não vira diagnóstico;
//   • silêncio perigoso — anúncio queimando dinheiro TEM que aparecer;
//   • alerta empilhado — o cron não pode acumular o mesmo achado toda hora.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { agregarRoas, type LinhaInsightRoas, type LinhaVendaRoas } from '../roas'
import { LIMITES_PADRAO, diagnosticar, salvarDiagnosticos } from '../diagnose'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ─── Dados de mentira ───────────────────────────────────────────────────────

interface FakeGasto {
  id: string; cents: number; impressoes?: number; cliques?: number
  ctr?: number; freq?: number
}

const gasto = (g: FakeGasto): LinhaInsightRoas => ({
  level: 'campaign', external_id: g.id, spend_cents: g.cents,
  impressions: g.impressoes ?? 10_000, clicks: g.cliques ?? 200,
  link_clicks: g.cliques ?? 200, ctr: g.ctr ?? 2, frequency: g.freq ?? 1.4,
})

const venda = (cents: number, campanha: string | null, status = 'approved'): LinhaVendaRoas => ({
  status, revenue_cents: cents,
  attr_ad_id: campanha ? `ad_${campanha}` : null,
  attr_adset_id: campanha ? `cj_${campanha}` : null,
  attr_campaign_id: campanha,
})

const resumoDe = (gastos: LinhaInsightRoas[], vendas: LinhaVendaRoas[], nomes?: Map<string, string>) =>
  agregarRoas('campaign', gastos, vendas, nomes)

const achar = (ds: ReturnType<typeof diagnosticar>, regra: string) => ds.filter(d => d.regra === regra)

// ════════════════════════════════════════════════════════════════════════════

test('1) anúncio queimando dinheiro sem venda NÃO passa em silêncio', () => {
  const d = diagnosticar(resumoDe(
    [gasto({ id: 'c1', cents: 80_000 })],
    [],
  ))
  const achado = achar(d, 'gasto_sem_venda')[0]
  assert.ok(achado, 'gasto alto sem venda precisa virar alerta')
  assert.equal(achado.severidade, 'critico')
  assert.equal(achado.escopoId, 'c1')
  assert.equal(achado.numeros.gastoCents, 80_000, 'o achado precisa carregar o número que o gerou')
  assert.equal(achado.sugestao.acao, 'pausar')
})

test('2) gasto pequeno NÃO vira diagnóstico — seria palpite', () => {
  const d = diagnosticar(resumoDe([gasto({ id: 'c1', cents: 900 })], []))
  assert.equal(achar(d, 'gasto_sem_venda').length, 0,
    'R$ 9 sem venda não sustenta conclusão nenhuma')
  assert.ok(LIMITES_PADRAO.gastoMinimoCents >= 1_000, 'o piso está baixo demais para significar algo')
})

test('3) ROAS abaixo de 1 é crítico; acima de 3 é convite a escalar', () => {
  const ruim = diagnosticar(resumoDe([gasto({ id: 'ruim', cents: 100_000 })], [venda(40_000, 'ruim')]))
  const a = achar(ruim, 'roas_abaixo_de_um')[0]
  assert.ok(a, 'ROAS 0,4x precisa ser sinalizado')
  assert.equal(a.severidade, 'critico')
  assert.equal(a.numeros.roas, 0.4)

  const bom = diagnosticar(resumoDe([gasto({ id: 'bom', cents: 100_000 })], [venda(500_000, 'bom')]))
  const b = achar(bom, 'candidato_a_escalar')[0]
  assert.ok(b, 'ROAS 5x precisa aparecer como oportunidade')
  assert.equal(b.severidade, 'info')
  assert.equal(b.sugestao.passoPct, 20, 'aumento brusco reinicia o aprendizado da Meta')

  // Um anúncio não pode ser "pausar" e "escalar" ao mesmo tempo.
  assert.equal(achar(bom, 'roas_abaixo_de_um').length, 0)
  assert.equal(achar(ruim, 'candidato_a_escalar').length, 0)
})

test('4) rastreamento furado é diagnosticado como CAUSA, não como pouca venda', () => {
  const d = diagnosticar(resumoDe(
    [gasto({ id: 'c1', cents: 100_000 })],
    [venda(20_000, 'c1'), venda(300_000, null), venda(200_000, null)],
  ))
  const a = achar(d, 'rastreamento_furado')[0]
  assert.ok(a, 'metade do faturamento sem origem precisa ser o alerta principal')
  assert.equal(a.severidade, 'critico')
  assert.equal(a.numeros.vendasSemOrigem, 2)
  assert.equal(a.sugestao.acao, 'regerar_links_utm')
  assert.match(a.corpo, /utm_ad_id/, 'o texto precisa dizer O QUE consertar')
})

test('5) público saturado e criativo fraco saem separados', () => {
  const saturado = diagnosticar(resumoDe(
    [gasto({ id: 'c1', cents: 100_000, freq: 4.2 })], [venda(200_000, 'c1')],
  ))
  assert.equal(achar(saturado, 'publico_saturado')[0]?.numeros.frequencia, 4.2)

  const fraco = diagnosticar(resumoDe(
    [gasto({ id: 'c2', cents: 100_000, ctr: 0.4, impressoes: 50_000 })], [venda(200_000, 'c2')],
  ))
  const f = achar(fraco, 'criativo_fraco')[0]
  assert.ok(f, 'CTR de 0,4% com 50 mil impressões é criativo que não segura atenção')
  assert.equal(f.severidade, 'atencao')
})

test('6) CTR baixo com POUCA impressão não vira alerta', () => {
  const d = diagnosticar(resumoDe(
    [gasto({ id: 'c1', cents: 100_000, ctr: 0.3, impressoes: 300 })], [venda(200_000, 'c1')],
  ))
  assert.equal(achar(d, 'criativo_fraco').length, 0, '300 impressões não provam nada sobre o criativo')
})

test('7) a média de CTR e frequência é ponderada por impressão', () => {
  // Um dia minúsculo com CTR ótimo não pode salvar a média de um dia enorme.
  const r = resumoDe([
    gasto({ id: 'c1', cents: 50_000, ctr: 10, impressoes: 100, freq: 1 }),
    gasto({ id: 'c1', cents: 50_000, ctr: 0.5, impressoes: 99_900, freq: 5 }),
  ], [venda(200_000, 'c1')])
  const l = r.linhas[0]
  assert.ok(l.ctrMedio! < 1, `média simples daria 5,25%; ponderada deu ${l.ctrMedio}`)
  assert.ok(l.frequenciaMedia! > 4.9, 'a frequência do dia grande é que manda')
})

test('8) período sem gasto NENHUM diz o que é, e não "não vendeu"', () => {
  const d = diagnosticar(resumoDe([], []))
  assert.equal(d.length, 1)
  assert.equal(d[0].regra, 'sem_gasto')
  assert.match(d[0].corpo, /NÃO significa que não houve venda/)
})

test('9) estorno alto vira diagnóstico de oferta, não de mídia', () => {
  const d = diagnosticar(resumoDe(
    [gasto({ id: 'c1', cents: 100_000 })],
    [venda(300_000, 'c1'), venda(100_000, 'c1', 'refunded')],
  ))
  const a = achar(d, 'estorno_alto')[0]
  assert.ok(a, '25% de estorno precisa aparecer')
  assert.match(a.corpo, /promessa/, 'o texto deveria apontar a causa provável')
})

test('10) o mais grave vem primeiro, e o nome real é usado', () => {
  const nomes = new Map([['c1', 'Campanha Black Friday']])
  const d = diagnosticar(resumoDe(
    [gasto({ id: 'c1', cents: 100_000 }), gasto({ id: 'c2', cents: 100_000 })],
    [venda(500_000, 'c2')],
    nomes,
  ))
  assert.equal(d[0].severidade, 'critico', 'o crítico não pode ficar embaixo do informativo')
  assert.match(d[0].titulo, /Campanha Black Friday/, 'mostrar só o ID obrigaria a caçar o anúncio')
})

test('11) o cron NÃO empilha o mesmo achado a cada hora', async () => {
  const chamadas: string[] = []
  const chain: Record<string, unknown> = {}
  for (const m of ['delete', 'eq']) {
    chain[m] = (...a: unknown[]) => { chamadas.push(`${m}:${a.join(',')}`); return chain }
  }
  chain.insert = (linhas: unknown[]) => {
    chamadas.push(`insert:${(linhas as unknown[]).length}`)
    return Promise.resolve({ error: null })
  }
  chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r)

  const r = await salvarDiagnosticos({ from: () => chain } as never, {
    tenantId: 't1', adAccountId: null,
    periodo: { desde: '2026-08-12', ate: '2026-08-19' },
    diagnosticos: diagnosticar(resumoDe([gasto({ id: 'c1', cents: 80_000 })], [])),
  })

  assert.equal(r.gravados, 1)
  assert.ok(chamadas.some(c => c.startsWith('delete')),
    'sem apagar o período, cada rodada repetiria o mesmo alerta')
  assert.ok(chamadas.some(c => c.includes('period_start')), 'a limpeza precisa ser DO período')
})

test('12) o analista não chama IA — nem custo, nem número inventado', () => {
  const d = ler('src/lib/trafego/diagnose.ts')
  assert.ok(!/anthropic|openai|fetch\(/i.test(d.replace(/\/\/.*$/gm, '')),
    'chamada externa aqui traria custo por rodada e risco de número inventado')

  // O cron só analisa quem ACABOU de sincronizar: alertar sobre dado velho é
  // pior que não alertar.
  const rota = ler('src/app/api/trafego/sync/route.ts')
  assert.ok(rota.includes('filter(d => d.ok)'), 'analisaria conta que falhou ao sincronizar')

  const painel = ler('src/app/(dashboard)/trafego/page.tsx')
  assert.ok(painel.includes('diagnosticar(resumo)'),
    'o painel precisa analisar o MESMO resumo que exibe, senão texto e tabela discordam')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (e) { results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) }) }
  }
  let passed = 0
  for (const r of results) {
    if (r.ok) { passed++; console.log(`  ok   ${r.name}`) }
    else console.log(` FALHA ${r.name}\n        → ${r.error}`)
  }
  console.log(`\n${passed}/${results.length} testes passaram`)
  if (passed !== results.length) process.exit(1)
}

void main()
