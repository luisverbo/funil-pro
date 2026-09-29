// ============================================================================
// Mesa de estrategistas + conexão sem digitar ID
// ----------------------------------------------------------------------------
// Pedido do dono (29/09): a aba Tráfego como "um time de gestores de tráfego"
// — onde perco dinheiro, onde colocar mais, o que pausar, alertas de risco.
// Causa raiz de a aba nunca ter mostrado número: o ID da conta foi salvo como
// o e-mail do dono. Agora a conta é escolhida da lista que a Meta devolve.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { montarMesa, contarResultados, mediana, type LinhaMesa, type EntradaMesa } from '@/lib/trafego/mesa'
import { agregarInsights, serieDiaria } from '@/lib/trafego/mesa-loader'
import { montarBriefing, gerarParecer, SISTEMA_CHEFE } from '@/lib/trafego/mesa-parecer'
import { idDeContaValido, paraContasDisponiveis, permissoesFaltando } from '@/lib/meta/conectar'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

function linha(p: Partial<LinhaMesa> & { id: string }): LinhaMesa {
  return {
    nivel: 'campaign', nome: p.id, campanhaId: p.id, status: 'ACTIVE', orcamentoDiarioCents: 5000,
    gastoCents: 0, impressoes: 10_000, cliques: 150, ctr: 1.5, cpmCents: 2000, frequencia: 1.5,
    resultados: { compra: 0, lead: 0, conversa: 0, cadastro: 0 }, vendasReais: 0, receitaRealCents: 0,
    recente: { gastoCents: 0, resultados: 0 }, anterior: { gastoCents: 0, resultados: 0 }, diasSemGastoNoFim: 0,
    ...p,
  }
}
const leads = (n: number) => ({ compra: 0, lead: n, conversa: 0, cadastro: 0 })
const entrada = (linhas: LinhaMesa[], extra: Partial<EntradaMesa> = {}): EntradaMesa => ({
  dias: 7, linhas, contas: [{ nome: 'Conta', status: 'active', erro: null, tokenExpiraEm: null }],
  semAtribuicao: { vendas: 0, receitaCents: 0 }, receitaAtribuidaCents: 0, agora: new Date('2026-09-29T12:00:00Z'), ...extra,
})

// Conta típica: A e B normais (R$ 10/lead), C barato (R$ 4), D caro (R$ 40), E sem nada.
const conta = [
  linha({ id: 'A', gastoCents: 20_000, resultados: leads(20) }),
  linha({ id: 'B', gastoCents: 30_000, resultados: leads(30) }),
  linha({ id: 'C', gastoCents: 20_000, resultados: leads(50) }),
  linha({ id: 'D', gastoCents: 40_000, resultados: leads(10) }),
  linha({ id: 'E', gastoCents: 30_000 }),
]

const tests: Record<string, () => void | Promise<void>> = {
  'resultados: não soma o mesmo evento com dois nomes': () => {
    const r = contarResultados([
      { action_type: 'lead', value: '7' }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '7' },
      { action_type: 'omni_purchase', value: 2 }, { action_type: 'purchase', value: 2 },
    ])
    assert.equal(r.lead, 7); assert.equal(r.compra, 2)
    assert.deepEqual(contarResultados(null), { compra: 0, lead: 0, conversa: 0, cadastro: 0 })
  },
  'mediana': () => { assert.equal(mediana([1, 3, 2]), 2); assert.equal(mediana([1, 2, 3, 4]), 2.5); assert.equal(mediana([]), null) },
  'performance: manda pausar quem gastou sem resultado nenhum': () => {
    const p = montarMesa(entrada(conta))
    const e = p.recomendacoes.find(r => r.alvo.id === 'E')!
    assert.equal(e.acao, 'pausar'); assert.equal(e.especialista, 'performance'); assert.equal(e.urgencia, 'alta')
  },
  'performance: custo por resultado 4× o típico vira pausar; C não é acusado': () => {
    const p = montarMesa(entrada(conta))
    const d = p.recomendacoes.find(r => r.alvo.id === 'D' && r.especialista === 'performance')!
    assert.equal(d.acao, 'pausar')
    assert.ok(d.porque.includes('R$ 40,00'), d.porque)
    assert.ok(!p.porEspecialista.performance.some(r => r.alvo.id === 'C'))
  },
  'escala: o mais barato com volume ganha "escalar" com passo de 20%': () => {
    const p = montarMesa(entrada(conta))
    const c = p.porEspecialista.escala.find(r => r.alvo.id === 'C')!
    assert.ok(c, 'C deveria escalar')
    assert.equal(c.numeros.novoPorDiaCents, 6000)
    assert.ok(!p.porEspecialista.escala.some(r => r.alvo.id === 'D' || r.alvo.id === 'E'))
  },
  'orçamento: move a verba dos perdedores para o vencedor, com estimativa marcada': () => {
    const p = montarMesa(entrada(conta))
    const m = p.porEspecialista.orcamento[0]
    assert.equal(m.acao, 'mover_verba'); assert.equal(m.alvo.id, 'C')
    assert.equal(m.numeros.verbaDiaCents, 10_000)
    assert.ok(m.impacto!.includes('estimativa'))
  },
  'resumo: dinheiro em risco = gasto de D + E; saúde proporcional': () => {
    const p = montarMesa(entrada(conta))
    assert.equal(p.resumo.gastoCents, 140_000)
    assert.equal(p.resumo.dinheiroEmRiscoCents, 70_000)
    assert.equal(p.resumo.saude, 50)
    assert.equal(p.resumo.resultados.lead, 110)
  },
  'ROAS real abaixo de 1 é prejuízo; acima de 3 com 2+ vendas escala': () => {
    const p = montarMesa(entrada([
      linha({ id: 'P', gastoCents: 50_000, vendasReais: 2, receitaRealCents: 30_000, resultados: { compra: 2, lead: 0, conversa: 0, cadastro: 0 } }),
      linha({ id: 'G', gastoCents: 50_000, vendasReais: 5, receitaRealCents: 200_000, resultados: { compra: 5, lead: 0, conversa: 0, cadastro: 0 } }),
    ]))
    assert.equal(p.recomendacoes.find(r => r.alvo.id === 'P')!.acao, 'reduzir')
    assert.ok(p.porEspecialista.escala.some(r => r.alvo.id === 'G'))
  },
  'abaixo de R$ 50 é ruído: ninguém é julgado': () => {
    const p = montarMesa(entrada([linha({ id: 'X', gastoCents: 4000 })]))
    assert.equal(p.recomendacoes.length, 0)
  },
  'criativo: CTR baixo, frequência alta e CPM caro': () => {
    const base = [1, 2, 3, 4].map(i => linha({ id: `n${i}`, gastoCents: 20_000, resultados: leads(20) }))
    const p = montarMesa(entrada([...base, linha({ id: 'F', gastoCents: 20_000, resultados: leads(20), ctr: 0.5, frequencia: 4.2, cpmCents: 5000 })]))
    const regras = p.porEspecialista.criativo.filter(r => r.alvo.id === 'F').map(r => r.chave.split(':')[0]).sort()
    assert.deepEqual(regras, ['cpm_caro', 'ctr_baixo', 'frequencia_alta'])
  },
  'risco: token vencido, vencendo, rastreamento furado, reprovado, entrega parada': () => {
    const p = montarMesa(entrada([
      linha({ id: 'R', nivel: 'ad', status: 'DISAPPROVED', gastoCents: 100 }),
      linha({ id: 'S', status: 'ACTIVE', gastoCents: 10_000, diasSemGastoNoFim: 3 }),
    ], {
      contas: [
        { nome: 'Velha', status: 'token_expired', erro: null, tokenExpiraEm: null },
        { nome: 'Nova', status: 'active', erro: null, tokenExpiraEm: '2026-10-02T00:00:00Z' },
      ],
      semAtribuicao: { vendas: 3, receitaCents: 60_000 }, receitaAtribuidaCents: 40_000,
    }))
    const regras = new Set(p.porEspecialista.risco.map(r => r.chave.split(':')[0]))
    for (const r of ['token_vencido', 'token_vencendo', 'rastreamento', 'reprovado', 'entrega_parou']) assert.ok(regras.has(r), r)
  },
  'risco: custo subindo e gasto acelerando pela janela recente': () => {
    const base = [1, 2].map(i => linha({ id: `n${i}`, gastoCents: 20_000, resultados: leads(20) }))
    const p = montarMesa(entrada([...base, linha({
      id: 'T', gastoCents: 20_000, resultados: leads(20),
      anterior: { gastoCents: 6000, resultados: 6 }, recente: { gastoCents: 12_000, resultados: 5 },
    })]))
    const regras = p.porEspecialista.risco.filter(r => r.alvo.id === 'T').map(r => r.chave.split(':')[0]).sort()
    assert.deepEqual(regras, ['custo_subindo', 'gasto_acelerando'])
  },
  'urgência alta vem primeiro e as chaves são únicas': () => {
    const p = montarMesa(entrada(conta))
    const ordem = { alta: 0, media: 1, baixa: 2 }
    for (let i = 1; i < p.recomendacoes.length; i++) assert.ok(ordem[p.recomendacoes[i - 1].urgencia] <= ordem[p.recomendacoes[i].urgencia])
    assert.equal(new Set(p.recomendacoes.map(r => r.chave)).size, p.recomendacoes.length)
  },
  'agregação: soma dias, calcula CTR/CPM, janelas 3+3 e entrega parada': () => {
    const d = (date: string, spend: number, lead = 0) => ({ level: 'ad' as const, external_id: '9', date, spend_cents: spend, impressions: 1000, clicks: 10, frequency: 1.2, actions: lead ? [{ action_type: 'lead', value: String(lead) }] : [] })
    const [l] = agregarInsights(
      [d('2026-09-22', 1000, 1), d('2026-09-24', 2000, 2), d('2026-09-26', 3000, 3), d('2026-09-27', 500), d('2026-09-28', 0), d('2026-09-29', 0)],
      [{ level: 'ad', external_id: '9', parent_external_id: '8', name: 'Anúncio 9', effective_status: 'ACTIVE', daily_budget_cents: null },
        { level: 'adset', external_id: '8', parent_external_id: '7', name: 'C', effective_status: 'ACTIVE', daily_budget_cents: 1000 }],
      '2026-09-29', new Map([['ad:9', { vendas: 1, receitaCents: 9900 }]]),
    )
    assert.equal(l.nome, 'Anúncio 9'); assert.equal(l.campanhaId, '7')
    assert.equal(l.gastoCents, 6500); assert.equal(l.resultados.lead, 6)
    assert.equal(l.ctr, 1); assert.equal(l.cpmCents, 1083)
    assert.deepEqual(l.recente, { gastoCents: 500, resultados: 0 })
    assert.deepEqual(l.anterior, { gastoCents: 5000, resultados: 5 })
    assert.equal(l.diasSemGastoNoFim, 2)
    assert.equal(l.receitaRealCents, 9900)
  },
  'painel por conta: loader recorta ad_account_id e pagina as entidades (nomes de conta grande)': () => {
    const l = ler('src/lib/trafego/mesa-loader.ts')
    assert.ok(l.includes("if (adAccountId) q = q.eq('ad_account_id', adAccountId)"))
    assert.ok(!l.includes('.limit(5000)'), 'PostgREST corta em 1000: nomes sumiam')
    assert.ok(l.includes("const { data } = await q.order('id').range(de, de + 999)"))
    const c = ler('src/app/(dashboard)/trafego/painel-client.tsx')
    assert.ok(c.includes('painelTrafego(conta, dias)'))
    assert.ok(c.includes("if (c) q.set('conta', c)"), 'conta escolhida fica na URL')
  },
  'texto com artigo certo: "A campanha", não "O campanha"': () => {
    const p = montarMesa(entrada(conta))
    assert.ok(p.recomendacoes.every(r => !r.porque.includes('O campanha') && !r.porque.includes('No campanha') && !r.porque.includes('do campanha')))
    assert.ok(p.recomendacoes.some(r => r.porque.startsWith('A campanha')))
  },
  'série diária: um ponto por dia do período, só nível campanha': () => {
    const s = serieDiaria([
      { level: 'campaign', external_id: '1', date: '2026-09-28', spend_cents: 500, impressions: 1, clicks: 0, frequency: null, actions: [{ action_type: 'lead', value: 2 }] },
      { level: 'ad', external_id: '9', date: '2026-09-28', spend_cents: 500, impressions: 1, clicks: 0, frequency: null, actions: [] },
    ], { desde: '2026-09-27', ate: '2026-09-29' })
    assert.deepEqual(s.map(x => x.gastoCents), [0, 500, 0]); assert.equal(s[1].resultados, 2)
  },
  'parecer: IA recebe só os números do time e é proibida de inventar': async () => {
    const p = montarMesa(entrada(conta))
    const b = montarBriefing(p, 7)
    assert.ok(b.includes('R$ 1.400,00')); assert.ok(b.includes('110 leads'))
    assert.ok(SISTEMA_CHEFE.includes('Nunca invente'))
    let recebido = ''
    const texto = await gerarParecer(p, 7, async (_s, m) => { recebido = m[0].content; return '  - Pausar E  ' })
    assert.equal(texto, '- Pausar E'); assert.equal(recebido, b)
  },
  'conexão: ID só número (o e-mail no lugar do ID é recusado)': () => {
    assert.ok(idDeContaValido('1234567890'))
    assert.ok(!idDeContaValido('luisverbo@gmail.com'))
    assert.ok(!idDeContaValido('act_123456'))
    const c = paraContasDisponiveis([
      { id: 'act_111111', name: 'Parada', account_status: 2, amount_spent: '999999' },
      { account_id: '222222', name: 'Ativa', account_status: 1, amount_spent: '100', currency: 'BRL' },
      { id: 'act_x', name: 'lixo' },
    ])
    assert.deepEqual(c.map(x => x.id), ['222222', '111111'])
    assert.deepEqual(permissoesFaltando(['public_profile']), ['ads_read'])
    assert.deepEqual(permissoesFaltando(['ads_read']), [])
  },
  'conexão: só conecta conta que o próprio token enxerga; apaga a do e-mail': () => {
    const a = ler('src/app/actions/trafego-conexao.ts')
    assert.ok(a.includes('const validas = escolhidos.filter(id => porId.has(id))'))
    assert.ok(a.includes("!idDeContaValido(String(a.external_id).replace(/^act_/, ''))"))
    assert.ok(!/^export type \{/m.test(a))
    assert.ok(ler('src/app/actions/meta.ts').includes('!idDeContaValido(meta_ad_account_id)'))
  },
  'despachante: lista fechada e nunca loga o corpo (tem token)': () => {
    const r = ler('src/app/api/trafego/route.ts')
    assert.ok(r.includes("return NextResponse.json({ error: 'operação desconhecida' }, { status: 404 })"))
    assert.ok(r.includes('console.error(`[trafego] ${corpo.op} falhou`)'))
    assert.ok(!/console\.\w+\([^)]*(args|token)/.test(r), 'não pode logar args')
  },
  'tela: mesa no topo, modal no body, parecer só no botão': () => {
    const pg = ler('src/app/(dashboard)/trafego/page.tsx')
    assert.ok(pg.includes('<PainelTrafego contaInicial={conta} dias={dias} nivel={nivel} />'))
    const c = ler('src/app/(dashboard)/trafego/painel-client.tsx')
    assert.ok(c.includes('document.body'))
    assert.ok(c.includes('onClick={pedirParecer}'))
    assert.ok(!/useEffect\([^]*?parecerDoChefe/.test(c.split('async function pedirParecer')[0]), 'parecer não pode rodar ao abrir')
  },
}

;(async () => {
  let passed = 0
  const nomes = Object.keys(tests)
  for (const nome of nomes) {
    try { await tests[nome](); passed++; console.log(`  ok   ${nome}`) }
    catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
  }
  console.log(`\n${passed}/${nomes.length} testes passaram`)
  if (passed !== nomes.length) process.exit(1)
})()
