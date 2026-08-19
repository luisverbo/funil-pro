// ============================================================================
// Gestor de Tráfego — Fase 1: fundação de rastreamento
// ----------------------------------------------------------------------------
// Três defeitos da auditoria travados aqui:
//
//   1. O LINK gerado pelo próprio sistema colocava `{{ad.id}}` em
//      `utm_content`, enquanto a atribuição consulta `utm_ad_id`. Nenhuma
//      venda fechava com nenhum anúncio.
//   2. `fbclid` não era capturado em lugar nenhum do codebase.
//   3. A origem morria na primeira página, e o quiz não gravava origem alguma.
//
// Nenhum teste toca rede, banco ou DOM real.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  capturarOrigem, lerParametros, mesclarOrigem, montarFbc, temOrigem,
  TRACKING_KEYS, TRACKING_MAX_AGE_DAYS, TRACKING_STORAGE_KEY,
} from '../params'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

/** Navegador de mentira: só o que o módulo usa. */
function comNavegador(url: string, guardado?: string) {
  const store = new Map<string, string>()
  if (guardado) store.set(TRACKING_STORAGE_KEY, guardado)
  let cookie = ''
  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    location: { search: new URL(url).search, href: url },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
    },
  }
  g.document = {
    referrer: 'https://www.instagram.com/',
    get cookie() { return cookie },
    set cookie(v: string) { cookie = v },
  }
  return {
    lido: () => store.get(TRACKING_STORAGE_KEY),
    cookie: () => cookie,
    limpar: () => { delete g.window; delete g.document },
  }
}

// ════════════════════════════════════════════════════════════════════════════

test('1) REPRODUÇÃO: o link do sistema agora preenche utm_ad_id', () => {
  const drawer = ler('src/components/builder/links-drawer.tsx')
  // Era isto que quebrava a atribuição inteira.
  assert.ok(drawer.includes('utm_ad_id={{ad.id}}'), 'o link não preenche utm_ad_id')
  assert.ok(drawer.includes('utm_adset_id={{adset.id}}'), 'sem id do conjunto')
  assert.ok(drawer.includes('utm_campaign_id={{campaign.id}}'), 'sem id da campanha')
  assert.ok(drawer.includes('utm_medium='), 'sem utm_medium')

  // E o campo que a sincronização consulta é justamente esse.
  const sync = ler('src/lib/meta/sync.ts')
  assert.ok(sync.includes(".eq('utm_ad_id', ad.ad_id)"), 'a sincronização mudou de campo')
})

test('2) fbclid é capturado — e vira o _fbc no formato da Meta', () => {
  assert.ok((TRACKING_KEYS as readonly string[]).includes('fbclid'), 'fbclid fora da lista branca')

  const p = lerParametros(new URLSearchParams('?utm_source=meta&fbclid=IwAR123&utm_ad_id=999'))
  assert.equal(p.fbclid, 'IwAR123')
  assert.equal(p.utm_ad_id, '999')

  // Formato oficial: fb.1.<timestamp>.<fbclid>
  assert.equal(montarFbc('IwAR123', 1700000000000), 'fb.1.1700000000000.IwAR123')
  assert.equal(montarFbc(undefined), undefined)
  assert.equal(montarFbc('   '), undefined)
})

test('3) só a lista branca entra; valor gigante é aparado', () => {
  const p = lerParametros(new URLSearchParams(
    `?utm_source=meta&senha=segredo&script=<x>&utm_term=${'a'.repeat(999)}`,
  ))
  assert.equal(p.utm_source, 'meta')
  assert.ok(!('senha' in p) && !('script' in p), 'parâmetro fora da lista branca entrou')
  assert.ok((p.utm_term ?? '').length <= 300, 'valor sem limite de tamanho')
})

test('4) PRIMEIRO TOQUE vence: visita direta não apaga o crédito do anúncio', () => {
  // Entrada pelo anúncio.
  const n1 = comNavegador('https://x.com/pg/a?utm_source=meta&utm_ad_id=42&fbclid=abc')
  const primeira = capturarOrigem(() => '2026-01-01T00:00:00.000Z')
  assert.equal(primeira.utm_ad_id, '42')
  assert.equal(primeira.first_touch_at, '2026-01-01T00:00:00.000Z')
  assert.ok(primeira.landing_url?.includes('/pg/a'), 'sem landing_url')
  assert.equal(primeira.referrer_url, 'https://www.instagram.com/')
  const guardado = n1.lido()
  assert.ok(guardado, 'a origem não foi guardada')
  // Cookie de primeira parte, com validade longa e SameSite.
  assert.ok(n1.cookie().includes(TRACKING_STORAGE_KEY), 'sem cookie de origem')
  assert.ok(n1.cookie().includes(`max-age=${TRACKING_MAX_AGE_DAYS * 24 * 60 * 60}`), 'validade errada')
  assert.ok(n1.cookie().includes('SameSite=Lax'), 'cookie sem SameSite')
  n1.limpar()

  // Volta depois, direto, sem parâmetro nenhum: a origem NÃO pode mudar.
  const n2 = comNavegador('https://x.com/pg/a', guardado)
  const segunda = capturarOrigem()
  assert.equal(segunda.utm_ad_id, '42', 'o retorno direto roubou o crédito do anúncio')
  assert.equal(segunda.fbclid, 'abc')
  n2.limpar()
})

test('5) sem origem guardada e sem parâmetro, não inventa nada', () => {
  const n = comNavegador('https://x.com/pg/a')
  assert.deepEqual(capturarOrigem(), {})
  assert.equal(n.lido(), undefined, 'gravou registro vazio')
  n.limpar()

  assert.equal(temOrigem({}), false)
  assert.equal(temOrigem({ referrer_url: 'x' }), false, 'referrer sozinho não é origem')
  assert.equal(temOrigem({ utm_ad_id: '1' }), true)
})

test('6) mesclar respeita o primeiro toque', () => {
  const guardada = { utm_ad_id: '1' }
  const nova = { utm_ad_id: '2' }
  assert.equal(mesclarOrigem(guardada, nova).utm_ad_id, '1', 'a origem antiga foi sobrescrita')
  assert.equal(mesclarOrigem({}, nova).utm_ad_id, '2', 'sem origem antiga, a nova deveria valer')
})

test('7) gravação: ponto único, imutável e à prova de migration pendente', () => {
  const w = ler('src/lib/tracking/save-source.ts')
  // Origem é do primeiro toque: nunca sobrescreve.
  assert.ok(w.includes("if (existente) return { gravado: false, motivo: 'origem já registrada' }"),
    'a origem poderia ser sobrescrita')
  // Coluna nova ainda não aplicada não pode derrubar a captura do lead.
  assert.ok(w.includes('function ehColunaDesconhecida'), 'sem tratamento de coluna ausente')
  assert.ok(w.includes("erro.code === '42703' || erro.code === 'PGRST204'"),
    'os códigos de coluna inexistente mudaram')
  assert.ok(w.includes('const reduzido'), 'sem gravação reduzida quando a migration falta')
  // Nunca lança: rastreamento não derruba captura.
  assert.ok(w.includes('} catch (err) {'), 'a gravação pode explodir e derrubar o lead')
  // IP vem do cabeçalho do proxy, não do corpo.
  assert.ok(w.includes("headers.get('x-forwarded-for')"), 'IP não vem do cabeçalho')
})

test('8) todas as entradas gravam origem — inclusive o quiz', () => {
  const capture = ler('src/app/api/pages/[pageId]/capture/route.ts')
  assert.ok(capture.includes('salvarOrigemDoLead'), 'captura de página não usa o gravador único')
  assert.ok(capture.includes('ipDaRequisicao(req.headers)'), 'captura sem IP')

  const quiz = ler('src/app/api/quiz/[pageId]/submit/route.ts')
  assert.ok(quiz.includes('salvarOrigemDoLead'), 'QUIZ continua sem gravar origem')
  assert.ok(quiz.includes('lerParametros(tracking ?? {})'), 'quiz não lê a origem enviada')
  // O tenant continua vindo da página, nunca do corpo.
  assert.ok(quiz.includes('NUNCA do body'), 'a regra de tenant do quiz sumiu')

  const renderer = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')
  assert.ok(renderer.includes('tracking: capturarOrigem()'), 'o quiz não envia a origem capturada')

  const form = ler('src/components/page-builder/sections/capture-form.tsx')
  assert.ok(form.includes('capturarOrigem()'), 'formulário de página não usa a captura nova')
  assert.ok(form.includes('legadoUtm()'), 'quem já navegava perderia a origem antiga')
})

test('9) a migration da Fase 1 está descrita e é idempotente', () => {
  const m = ler('supabase/migrations/20260818000000_trafego_fase1.sql')
  for (const coluna of ['utm_medium', 'utm_term', 'fbclid', 'fbp', 'ip', 'user_agent', 'first_touch_at']) {
    assert.ok(m.includes(`ADD COLUMN IF NOT EXISTS ${coluna}`), `migration sem ${coluna}`)
  }
  // Várias contas de anúncio por tenant — pedido explícito.
  assert.ok(m.includes('CREATE TABLE IF NOT EXISTS ad_accounts'), 'sem tabela de contas de anúncio')
  assert.ok(m.includes('UNIQUE (tenant_id, provider, external_id)'), 'conta sem chave única por tenant')
  // Venda com id da transação: webhook repetido não duplica receita.
  assert.ok(m.includes('UNIQUE (tenant_id, platform, external_id)'), 'venda sem dedupe por transação')
  // Nada destrutivo.
  assert.ok(!/DROP TABLE|DELETE FROM|TRUNCATE/i.test(m), 'a migration tem comando destrutivo')
  // Isolamento por tenant em todas as tabelas novas.
  assert.ok(m.includes('ENABLE ROW LEVEL SECURITY'), 'tabelas novas sem RLS')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (e) {
      results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
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
