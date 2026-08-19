// ============================================================================
// Gestor de Tráfego — Fase 1: ROAS real + sincronização recorrente
// ----------------------------------------------------------------------------
// Cada teste aqui trava um defeito concreto do cálculo antigo:
//
//   • reembolso continuava contando como faturamento;
//   • venda sem anúncio identificado sumia da conta e inflava o ROAS;
//   • divisão por gasto zero virava Infinity na tela;
//   • o laço de contas não conferia o orçamento de tempo e morria no meio,
//     deixando `last_sync_at` desatualizado sem explicação.
//
// Nenhum teste toca rede ou banco: as consultas são objetos de mentira.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { agregarRoas, type LinhaInsightRoas, type LinhaVendaRoas } from '../roas'
import {
  SYNC_BUDGET_MS, SYNC_INTERVALO_MS, SYNC_MIN_CONTA_MS, SYNC_ROUTE_MAX_DURATION_MS,
  contasVencidas, sincronizarPendentes,
} from '@/lib/meta/scheduler'
import type { ContaDeAnuncio } from '@/lib/meta/accounts'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

const gasto = (id: string, cents: number, level = 'ad'): LinhaInsightRoas =>
  ({ level, external_id: id, spend_cents: cents, impressions: 100, clicks: 10, link_clicks: 5 })

const venda = (
  status: string, cents: number, adId: string | null,
): LinhaVendaRoas => ({
  status, revenue_cents: cents,
  attr_ad_id: adId, attr_adset_id: adId ? `cj_${adId}` : null,
  attr_campaign_id: adId ? `cp_${adId}` : null,
})

/** Consulta de mentira: encadeia tudo e devolve as linhas no fim. */
function fakeAdmin(linhas: unknown[], capturar?: (f: Record<string, unknown>) => void) {
  const filtros: Record<string, unknown> = {}
  const chain: Record<string, unknown> = {}
  const devolver = () => ({ data: linhas, error: null })
  for (const m of ['select', 'eq', 'or', 'order', 'gte', 'lte', 'range']) {
    chain[m] = (...args: unknown[]) => {
      filtros[m] = args
      capturar?.(filtros)
      return m === 'limit' ? devolver() : chain
    }
  }
  chain.limit = () => { capturar?.(filtros); return devolver() }
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(devolver()).then(res)
  return { from: () => chain } as never
}

// ════════════════════════════════════════════════════════════════════════════

test('1) reembolso SAI do faturamento (o painel inflava para cima)', () => {
  const r = agregarRoas('ad', [gasto('a1', 10_000)], [
    venda('approved', 9_700, 'a1'),
    venda('approved', 9_700, 'a1'),
    venda('refunded', 9_700, 'a1'),
  ])
  const l = r.linhas[0]
  assert.equal(l.receitaCents, 19_400, 'só as aprovadas contam como receita')
  assert.equal(l.estornadoCents, 9_700, 'o estorno precisa ficar visível')
  assert.equal(l.vendas, 2)
})

test('2) venda pendente/cancelada não entra em lugar nenhum', () => {
  const r = agregarRoas('ad', [gasto('a1', 1_000)], [
    venda('pending', 5_000, 'a1'),
    venda('canceled', 5_000, 'a1'),
  ])
  assert.equal(r.totais.receitaCents, 0)
  assert.equal(r.totais.vendas, 0)
})

test('3) venda SEM anúncio de origem vai para um balde visível', () => {
  const r = agregarRoas('ad', [gasto('a1', 10_000)], [
    venda('approved', 10_000, 'a1'),
    venda('approved', 50_000, null),   // sem utm_ad_id
  ])
  assert.equal(r.linhas.length, 1, 'venda sem origem não pode virar linha de anúncio')
  assert.equal(r.linhas[0].receitaCents, 10_000, 'o ROAS do anúncio foi inflado')
  assert.equal(r.semAtribuicao.vendas, 1)
  assert.equal(r.semAtribuicao.receitaCents, 50_000)
  assert.equal(r.totais.receitaCents, 10_000, 'o total não pode incluir o que não foi atribuído')
})

test('4) gasto zero devolve null, nunca Infinity', () => {
  const r = agregarRoas('ad', [], [venda('approved', 9_700, 'a1')])
  assert.equal(r.linhas[0].roas, null)
  assert.equal(r.linhas[0].gastoCents, 0)
  assert.equal(r.totais.roas, null)
  assert.ok(Number.isFinite(r.totais.receitaCents))
})

test('5) anúncio que gasta e não vende CONTINUA na lista, com ROAS 0', () => {
  const r = agregarRoas('ad', [gasto('queimando', 50_000), gasto('bom', 10_000)], [
    venda('approved', 30_000, 'bom'),
  ])
  const queimando = r.linhas.find(l => l.externalId === 'queimando')
  assert.ok(queimando, 'sumiu justamente o anúncio que precisa ser pausado')
  assert.equal(queimando.roas, 0)
  assert.equal(queimando.cpaCents, null)
  assert.equal(r.linhas[0].externalId, 'queimando', 'a lista deveria começar por quem mais gasta')
})

test('6) ROAS e CPA batem na conta', () => {
  const r = agregarRoas('ad', [gasto('a1', 10_000), gasto('a1', 10_000)], [
    venda('approved', 30_000, 'a1'), venda('approved', 30_000, 'a1'),
  ])
  const l = r.linhas[0]
  assert.equal(l.gastoCents, 20_000, 'os dias do período precisam somar')
  assert.equal(l.roas, 3)
  assert.equal(l.cpaCents, 10_000)
})

test('7) o mesmo dado agrega por campanha e por conjunto', () => {
  const insights = [gasto('cp_a1', 10_000, 'campaign')]
  const vendas = [venda('approved', 40_000, 'a1')]
  const porCampanha = agregarRoas('campaign', insights, vendas)
  assert.equal(porCampanha.linhas[0].externalId, 'cp_a1')
  assert.equal(porCampanha.linhas[0].roas, 4)

  // Insight de outro nível não pode vazar para dentro do nível pedido.
  const porAnuncio = agregarRoas('ad', insights, vendas)
  assert.equal(porAnuncio.linhas[0].gastoCents, 0, 'gasto de campanha entrou no nível de anúncio')
})

test('8) só contas ATIVAS e vencidas entram na rodada', async () => {
  let filtros: Record<string, unknown> = {}
  const admin = fakeAdmin([
    { id: 'c1', tenant_id: 't1', external_id: 'act_9', access_token: 'tok', name: null, currency: null, timezone_name: null, status: 'active' },
    { id: 'c2', tenant_id: 't1', external_id: '10', access_token: null, name: null, currency: null, timezone_name: null, status: 'active' },
  ], f => { filtros = f })

  const contas = await contasVencidas(admin, { agora: new Date('2026-08-19T12:00:00Z') })
  assert.equal(contas.length, 1, 'conta sem token só produziria erro a cada execução')
  assert.equal(contas[0].externalId, '9', 'o prefixo act_ precisa sair')

  const or = String((filtros.or as unknown[])?.[0] ?? '')
  assert.match(or, /last_sync_at\.is\.null/, 'conta nunca sincronizada ficaria de fora para sempre')
  assert.match(or, /2026-08-19T11:00:00/, 'o corte deveria ser de 1 hora atrás')
  const eqs = JSON.stringify(filtros.eq)
  assert.match(eqs, /active/, 'conta com token expirado voltaria a queimar cota')
})

test('9) REPRODUÇÃO: o laço para antes de estourar o tempo da requisição', async () => {
  const linhas = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i}`, tenant_id: 't1', external_id: String(i), access_token: 'tok',
    name: null, currency: null, timezone_name: null, status: 'active',
  }))
  let agora = 0
  const rodadas: string[] = []

  const r = await sincronizarPendentes(fakeAdmin(linhas), {
    relogio: () => agora,
    budgetMs: 200_000,
    sincronizar: async (c: ContaDeAnuncio) => {
      rodadas.push(c.externalId)
      agora += 50_000                     // cada conta come 50s
      return { ok: true, entidades: 2, insights: 3, truncado: false }
    },
  })

  assert.equal(rodadas.length, 4, 'entrou numa conta sem tempo para terminá-la')
  assert.equal(r.incompleto, true, 'o que sobrou precisa ser reportado, não escondido')
  assert.equal(r.ok, 4)
  assert.equal(r.insights, 12)
})

test('10) conta que falha é contada com o motivo — nada é engolido', async () => {
  const linhas = [1, 2].map(i => ({
    id: `c${i}`, tenant_id: 't1', external_id: String(i), access_token: 'tok',
    name: null, currency: null, timezone_name: null, status: 'active',
  }))
  const r = await sincronizarPendentes(fakeAdmin(linhas), {
    relogio: () => 0,
    sincronizar: async (c: ContaDeAnuncio) => c.externalId === '1'
      ? { ok: true, entidades: 1, insights: 1, truncado: false }
      : { ok: false, entidades: 0, insights: 0, truncado: false, erro: 'token', tipoErro: 'token_expirado' },
  })
  assert.equal(r.ok, 1)
  assert.equal(r.falhas, 1)
  assert.equal(r.detalhes[1].tipoErro, 'token_expirado')
  assert.equal(r.incompleto, false)
})

test('11) INVARIANTE: o orçamento cabe no teto da rota', () => {
  assert.ok(SYNC_BUDGET_MS + SYNC_MIN_CONTA_MS <= SYNC_ROUTE_MAX_DURATION_MS,
    'a execução voltaria a morrer no meio')
  assert.equal(SYNC_INTERVALO_MS, 60 * 60 * 1000)

  const rota = ler('src/app/api/trafego/sync/route.ts')
  const m = /export const maxDuration = (\d+)/.exec(rota)
  assert.ok(m, 'a rota não declara maxDuration')
  assert.equal(Number(m[1]) * 1000, SYNC_ROUTE_MAX_DURATION_MS,
    'o teto da rota e o do agendador precisam ser o mesmo número')
})

test('12) a rota é autenticada e o cron chama de hora em hora', () => {
  const rota = ler('src/app/api/trafego/sync/route.ts')
  assert.ok(rota.includes('evaluateCronAuth'), 'endpoint de cron sem autenticação')
  assert.ok(rota.includes('CRON_UNAUTHORIZED_BODY'), 'a recusa daria pista do segredo')

  // Sem a liberação no proxy, a chamada sem sessão seria redirecionada ao login
  // e o cron falharia em silêncio — foi o que já aconteceu com /api/quiz.
  assert.ok(ler('src/proxy.ts').includes("'/api/trafego/sync'"), 'rota não liberada no proxy')

  const wf = ler('.github/workflows/trafego-sync.yml')
  assert.match(wf, /cron: '17 \* \* \* \*'/, 'a sincronização não roda de hora em hora')
  // Sem comentários: o cabeçalho do arquivo EXPLICA por que não há `uses:`,
  // e essa menção não pode ser confundida com uma action de verdade.
  const semComentarios = wf.split('\n').filter(l => !l.trim().startsWith('#')).join('\n')
  assert.ok(!/^\s*(-\s*)?uses:/m.test(semComentarios),
    'action externa é justamente o que derrubava os jobs')
  assert.ok(wf.includes('Bearer ${CRON_SECRET}'), 'o cron não apresenta o segredo')
  assert.ok(wf.includes('concurrency:'), 'duas rodadas simultâneas queimariam cota da Meta')
})

test('13) o painel nunca mostra zero como resposta', () => {
  const p = ler('src/app/(dashboard)/trafego/page.tsx')
  // Cada estado que produziria uma tela zerada precisa ter texto próprio.
  assert.ok(p.includes('migrationPendente'), 'banco sem as tabelas viraria painel zerado')
  assert.ok(p.includes('nuncaSincronizou'), 'antes da 1ª leitura, zero pareceria "não vendeu"')
  assert.ok(p.includes('contas.length === 0'), 'sem conta conectada não é o mesmo que sem venda')
  assert.ok(/token_expired/.test(p), 'token caído congelaria o painel em silêncio')
  assert.ok(p.includes('semAtr'), 'venda sem origem sumiria e inflaria o ROAS do resto')
  // ROAS sem gasto não pode virar 0.00x nem Infinity na tela.
  assert.ok(p.includes("=== null ? '—'"), 'ROAS indefinido apareceria como número')
})

test('14) o painel entra na navegação', () => {
  const s = ler('src/components/layout/sidebar.tsx')
  assert.ok(s.includes("href: '/trafego'"), 'a tela existiria sem caminho até ela')
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
