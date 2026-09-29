// ============================================================================
// Período livre + ações na Meta (pausar/ativar/orçamento)
// ----------------------------------------------------------------------------
// Pedido do dono (29/09): "gráfico de hoje, de ontem, personalizado — na
// minha mão" e "tomar ação dali mesmo, sem abrir o Gerenciador".
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolverPeriodo, hojeBrasilia, somarDias, diasEntre, queryDoPeriodo, MAX_DIAS_PERIODO } from '@/lib/trafego/periodo'
import { alterarStatus, alterarOrcamentoDiario, validarOrcamento, orcamentoEscalado } from '@/lib/meta/acoes'
import { MetaApiError } from '@/lib/meta/client'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
// 29/09/2026 23:30 UTC = 20:30 em Brasília → ainda dia 29.
const agora = new Date('2026-09-29T23:30:00Z')
// 30/09 01:00 UTC = 29/09 22:00 em Brasília → ainda dia 29.
const madrugadaUtc = new Date('2026-09-30T01:00:00Z')

function fetchFalso(status: number, corpo: unknown) {
  const chamadas: { url: string; body: string; method?: string }[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    chamadas.push({ url, body: String(init?.body), method: init?.method })
    return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fn, chamadas }
}

const tests: Record<string, () => void | Promise<void>> = {
  'hoje é o dia de Brasília, não o UTC': () => {
    assert.equal(hojeBrasilia(agora), '2026-09-29')
    assert.equal(hojeBrasilia(madrugadaUtc), '2026-09-29')
  },
  'presets: hoje, ontem, 7/14/30, este mês': () => {
    assert.deepEqual([resolverPeriodo({ p: 'hoje' }, agora).desde, resolverPeriodo({ p: 'hoje' }, agora).ate], ['2026-09-29', '2026-09-29'])
    const o = resolverPeriodo({ p: 'ontem' }, agora); assert.equal(o.desde, '2026-09-28'); assert.equal(o.dias, 1)
    const s = resolverPeriodo({ p: '7' }, agora); assert.equal(s.desde, '2026-09-23'); assert.equal(s.dias, 7)
    const m = resolverPeriodo({ p: 'mes' }, agora); assert.equal(m.desde, '2026-09-01'); assert.equal(m.ate, '2026-09-29')
    assert.equal(resolverPeriodo({ p: 'qualquer' }, agora).preset, '7', 'inválido cai no padrão')
    assert.equal(resolverPeriodo({ p: '30' }, agora).rotulo, 'Últimos 30 dias · 31/08/2026 – 29/09/2026')
  },
  'personalizado: ordena datas, corta futuro e limita a 92 dias': () => {
    const c = resolverPeriodo({ p: 'custom', de: '2026-09-20', ate: '2026-09-10' }, agora)
    assert.equal(c.desde, '2026-09-10'); assert.equal(c.ate, '2026-09-20'); assert.equal(c.dias, 11)
    assert.equal(resolverPeriodo({ p: 'custom', de: '2026-09-01', ate: '2026-12-31' }, agora).ate, '2026-09-29')
    const longo = resolverPeriodo({ p: 'custom', de: '2025-01-01', ate: '2026-09-29' }, agora)
    assert.equal(longo.dias, MAX_DIAS_PERIODO)
    assert.equal(resolverPeriodo({ p: 'custom', de: 'lixo', ate: '' }, agora).dias, 7, 'data inválida vira 7 dias')
    assert.deepEqual(queryDoPeriodo(c), { p: 'custom', de: '2026-09-10', ate: '2026-09-20' })
    assert.deepEqual(queryDoPeriodo(resolverPeriodo({ p: 'ontem' }, agora)), { p: 'ontem' })
  },
  'utilitários de data': () => {
    assert.equal(somarDias('2026-03-01', -1), '2026-02-28'); assert.equal(diasEntre('2026-09-23', '2026-09-29'), 7)
  },
  'orçamento: piso R$ 1, teto 10× o atual, escala arredonda no real': () => {
    assert.equal(validarOrcamento(50, 1000).ok, false)
    assert.equal(validarOrcamento(20_000, 1000).ok, false, '20× o atual')
    assert.equal(validarOrcamento(9_000, 1000).ok, true)
    assert.equal(validarOrcamento(5_000, null).ok, true, 'sem atual conhecido só vale o piso')
    assert.equal(orcamentoEscalado(24_444, 20), 29_300)
  },
  'alterarStatus: POST em /{id} com status e token no corpo; só ACTIVE/PAUSED': async () => {
    const { fn, chamadas } = fetchFalso(200, { success: true })
    await alterarStatus('120250288033480001', 'PAUSED', 'TOKEN', { fetchFn: fn })
    assert.equal(chamadas.length, 1); assert.equal(chamadas[0].method, 'POST')
    assert.ok(chamadas[0].url.endsWith('/120250288033480001'))
    assert.ok(chamadas[0].body.includes('status=PAUSED') && chamadas[0].body.includes('access_token=TOKEN'))
    assert.ok(!chamadas[0].url.includes('TOKEN'), 'token nunca na URL')
    await assert.rejects(alterarStatus('1', 'DELETED' as never, 'T', { fetchFn: fn }), /inválido/)
  },
  'alterarOrcamento: anúncio não tem orçamento; valida antes de chamar; erro da Meta vira MetaApiError': async () => {
    const { fn, chamadas } = fetchFalso(200, { success: true })
    await assert.rejects(alterarOrcamentoDiario('1', 'ad', 5000, 1000, 'T', { fetchFn: fn }), /Anúncio/)
    await assert.rejects(alterarOrcamentoDiario('1', 'campaign', 50, 1000, 'T', { fetchFn: fn }), /mínimo/)
    assert.equal(chamadas.length, 0, 'não pode ter chamado a Meta')
    await alterarOrcamentoDiario('1', 'campaign', 29_300, 24_444, 'T', { fetchFn: fn })
    assert.ok(chamadas[0].body.includes('daily_budget=29300'))
    const ruim = fetchFalso(400, { error: { code: 190 } })
    await assert.rejects(alterarStatus('1', 'ACTIVE', 'T', { fetchFn: ruim.fn }), (e: unknown) => e instanceof MetaApiError && e.kind === 'token_expirado')
    const semSucesso = fetchFalso(200, { success: false })
    await assert.rejects(alterarStatus('1', 'ACTIVE', 'T', { fetchFn: semSucesso.fn }))
  },
  'servidor: resolve a conta pelo item (cliente não manda token), exige ads_management, espelha no banco': () => {
    const a = ler('src/app/actions/trafego-conexao.ts')
    assert.ok(a.includes("if (!/^\\d{5,30}$/.test(externalId)) return { ok: false, error: 'ID inválido.' }"))
    assert.ok(a.includes(".eq('tenant_id', tenantId).eq('level', nivel).eq('external_id', externalId).maybeSingle()"))
    assert.ok(a.includes(".eq('id', ent.ad_account_id).eq('tenant_id', tenantId).maybeSingle()"), 'conta do MESMO tenant')
    assert.ok(a.includes("if (!concedidas.includes(PERMISSAO_ACOES)) {"))
    assert.ok(a.includes("update({ status: acao.status, effective_status: acao.status, synced_at: agora })"))
    assert.ok(a.includes("update({ daily_budget_cents: acao.novoCents, synced_at: agora })"))
    assert.ok(ler('src/app/api/trafego/route.ts').includes('executarAcao'))
  },
  'período no servidor: painel e parecer usam resolverPeriodo; sincronizar amplia a janela para o período pedido': () => {
    const a = ler('src/app/actions/trafego-conexao.ts')
    assert.ok(a.includes("const periodo = resolverPeriodo(typeof q === 'number' ? { p: String(q) } : (q ?? {}))"))
    assert.ok(a.includes("desde: pedido.desde < padrao.desde ? pedido.desde : padrao.desde"))
    const l = ler('src/lib/trafego/mesa-loader.ts')
    assert.ok(l.includes("const periodo = typeof periodoOuDias === 'number' ? intervaloPadrao(periodoOuDias) : periodoOuDias"))
  },
  'tela: seletor com hoje/ontem/personalizado, ações com confirmação, orçamento com validação': () => {
    const c = ler('src/app/(dashboard)/trafego/painel-client.tsx')
    assert.ok(c.includes("PRESETS.map(p => ("))
    assert.ok(c.includes('type="date"'))
    assert.ok(c.includes("onChange({ p: 'custom', de, ate })"))
    assert.ok(c.includes('setConfirmar({ l, acao: { tipo: \'status\', status: \'PAUSED\' }'), 'pausar pede confirmação')
    assert.ok(c.includes("if (ativa(l) && !confirm("), 'switch pede confirmação ao pausar')
    assert.ok(c.includes('validarOrcamento(novo, atual)'))
    assert.ok(c.includes('ads_management'), 'instrução da permissão no modal de conectar')
    const pg = ler('src/app/(dashboard)/trafego/page.tsx')
    assert.ok(pg.includes("p: sp.p ?? (sp.dias ? String(sp.dias) : undefined)"), 'link antigo ?dias= continua funcionando')
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
