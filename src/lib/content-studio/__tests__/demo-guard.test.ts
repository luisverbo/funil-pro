// ============================================================================
// Testes de endurecimento do Office Preview
// ----------------------------------------------------------------------------
// Cobre a auditoria: admissão da produção, limite server-side, idempotência do
// clique duplo, concorrência no avanço, saneamento de erro e ausência de
// service_role no bundle do navegador.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  admitDemoProduction,
  DEMO_BRIEF_MODE,
  DEMO_MAX_JOBS_PER_CALL,
  DEMO_PIPELINE_KEY,
  isOpenDemo,
  pickWinningDemo,
  safeUserMessage,
  toPublicEvent,
  USER_MESSAGES,
  type ProductionAdmission,
} from '../demo-guard'
import { runNextJob, startProduction } from '../orchestrator'
import { OFFICE_PIPELINE } from '../pipeline'
import type {
  ContentStore, EmitEventInput, JobRow, ProductionRow, StepRow, StoredEvent,
} from '../types'

const RAIZ = process.cwd()
const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

const actions = readFileSync(join(RAIZ, 'src/app/actions/content-studio.ts'), 'utf8')
const ui = readFileSync(join(RAIZ, 'src/components/content-studio/office-preview.tsx'), 'utf8')
const page = readFileSync(join(RAIZ, 'src/app/(dashboard)/content-studio/page.tsx'), 'utf8')

function demo(over: Partial<ProductionAdmission> = {}): ProductionAdmission {
  return {
    id: 'prod-1',
    status: 'queued',
    pipeline_key: DEMO_PIPELINE_KEY,
    brief: { modo: DEMO_BRIEF_MODE },
    ...over,
  }
}

// ─── 1. Admissão ────────────────────────────────────────────────────────────

test('1) produção inexistente (ou de outro tenant) é rejeitada', () => {
  // A consulta filtra por tenant_id; produção alheia volta null e cai aqui.
  const r = admitDemoProduction(null)
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'not_found')
})

test('2) produção do mesmo tenant com outro pipeline é rejeitada', () => {
  const r = admitDemoProduction(demo({ pipeline_key: 'producao_real_v1' }))
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'wrong_pipeline')

  // Nem o pipeline stub da Fase 1 passa: só a demonstração do escritório.
  assert.equal(admitDemoProduction(demo({ pipeline_key: 'stub_v1' })).ok, false)
})

test('3) produção sem a marca de demonstração é rejeitada', () => {
  assert.equal(admitDemoProduction(demo({ brief: {} })).ok, false)
  assert.equal(admitDemoProduction(demo({ brief: null })).ok, false)
  assert.equal(admitDemoProduction(demo({ brief: { modo: 'producao' } })).ok, false)

  const r = admitDemoProduction(demo({ brief: { modo: 'producao' } }))
  assert.equal(r.ok === false && r.reason, 'not_demo')
})

test('1b) produção em estado terminal não avança', () => {
  for (const status of ['published', 'failed', 'canceled', 'review', 'approved'] as const) {
    const r = admitDemoProduction(demo({ status }))
    assert.equal(r.ok, false, `status ${status} não deveria avançar`)
    assert.equal(r.ok === false && r.reason, 'not_advanceable')
  }
  for (const status of ['draft', 'queued', 'running', 'waiting_input'] as const) {
    assert.equal(admitDemoProduction(demo({ status })).ok, true, `status ${status} deveria avançar`)
  }
})

// ─── 4. O cliente não controla a quantidade ─────────────────────────────────

test('4) advanceDemo não aceita parâmetro de quantidade', () => {
  const assinatura = /export async function advanceDemo\(([^)]*)\)/.exec(actions)
  assert.ok(assinatura, 'advanceDemo não encontrada')
  const params = assinatura[1]
  assert.ok(params.includes('productionId'), 'deve receber o id')
  assert.ok(!/max|limit|count|steps|jobs|quantidade/i.test(params), `parâmetro de quantidade exposto: ${params}`)
  assert.ok(!params.includes('='), 'nenhum parâmetro opcional controlável pelo cliente')

  // A quantidade é constante do servidor.
  assert.equal(DEMO_MAX_JOBS_PER_CALL, 1)
  assert.ok(actions.includes('drainQueue(store, DEMO_MAX_JOBS_PER_CALL)'))
})

test('4b) nem pipeline, agente, tenant ou status vêm do cliente', () => {
  const inicio = actions.slice(actions.indexOf('export async function startDemoProduction'))
  const corpo = inicio.slice(0, inicio.indexOf('\n}\n'))
  assert.ok(corpo.includes('tenant_id: tenantId'), 'tenant vem da sessão')
  assert.ok(corpo.includes('pipeline_key: DEMO_PIPELINE_KEY'), 'pipeline é constante')
  assert.ok(corpo.includes('modo: DEMO_BRIEF_MODE'), 'a marca de demo é constante')

  // Nenhuma action recebe nada além do id da produção.
  const assinaturas = [...actions.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
  for (const [, nome, params] of assinaturas) {
    assert.ok(
      params === '' || /^productionId: string$/.test(params.trim()),
      `${nome} aceita parâmetros demais: "${params}"`,
    )
  }
  // status nunca é escrito a partir de entrada do cliente
  assert.ok(!/status:\s*(input|params|arg)/.test(actions))
})

// ─── 5. Clique duplo / criação concorrente ──────────────────────────────────

test('5) demos abertas concorrentes convergem para a mesma vencedora', () => {
  const a = { id: 'b', created_at: '2026-01-01T00:00:00.000Z' }
  const b = { id: 'a', created_at: '2026-01-01T00:00:00.000Z' }  // mesmo instante
  const c = { id: 'c', created_at: '2026-01-01T00:00:01.000Z' }

  // Qualquer ordem de chegada elege a MESMA — é isso que faz as duas chamadas
  // convergirem sem lock.
  assert.equal(pickWinningDemo([a, b, c])!.id, 'a')
  assert.equal(pickWinningDemo([c, b, a])!.id, 'a')
  assert.equal(pickWinningDemo([b, c, a])!.id, 'a')
  assert.equal(pickWinningDemo([]), null)

  // Mais antiga vence quando os instantes diferem.
  assert.equal(pickWinningDemo([c, { id: 'z', created_at: '2025-12-31T00:00:00.000Z' }])!.id, 'z')
})

test('5b) só demonstrações abertas são reaproveitadas', () => {
  assert.equal(isOpenDemo(demo({ status: 'running' })), true)
  assert.equal(isOpenDemo(demo({ status: 'review' })), false, 'concluída não é reaproveitada')
  assert.equal(isOpenDemo(demo({ status: 'canceled' })), false)
  assert.equal(isOpenDemo(demo({ pipeline_key: 'outro' })), false)
  assert.equal(isOpenDemo(demo({ brief: { modo: 'producao' } })), false)
})

test('5c) o servidor reaproveita antes de inserir, e resolve empate depois', () => {
  const corpo = actions.slice(actions.indexOf('export async function startDemoProduction'))
  const ordem = ['findOpenDemo', '.insert(', 'resolveDuplicateDemos', 'startProduction']
  let pos = -1
  for (const marca of ordem) {
    const i = corpo.indexOf(marca)
    assert.ok(i > pos, `"${marca}" fora de ordem no fluxo de criação`)
    pos = i
  }
  // A perdedora é cancelada logicamente, nunca apagada.
  assert.ok(actions.includes("status: 'canceled'"))
  assert.ok(!/\.delete\(/.test(actions), 'nada é apagado')
})

test('5d) o botão fica bloqueado enquanto inicia', () => {
  assert.ok(ui.includes('disabled={running}'), 'botão precisa desabilitar')
  assert.ok(/if \(running\) return/.test(ui), 'guarda de reentrada no handler')
})

// ─── 6. Concorrência no avanço ──────────────────────────────────────────────

class ConcurrentStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  execucoes: string[] = []
  private n = 0

  createProduction(): ProductionRow {
    const p: ProductionRow = {
      id: 'prod-1', tenant_id: 'tenant-A', pipeline_key: OFFICE_PIPELINE.key,
      title: 'Demo', brief: { modo: DEMO_BRIEF_MODE }, status: 'draft',
      next_event_seq: 0, created_by: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }
    this.productions.set(p.id, p)
    return p
  }

  async getProduction(id: string) { return this.productions.get(id) ?? null }
  async updateProductionStatus(id: string, status: ProductionRow['status']) {
    const p = this.productions.get(id); if (p) p.status = status
  }
  async listSteps(pid: string) { return this.steps.filter(s => s.production_id === pid).map(s => ({ ...s })) }
  async insertSteps(rows: Omit<StepRow, 'id'>[]) {
    const created = rows.map(r => ({ ...r, id: `step-${++this.n}` }))
    this.steps.push(...created); return created.map(s => ({ ...s }))
  }
  async updateStep(id: string, patch: Partial<StepRow>) {
    const s = this.steps.find(x => x.id === id)
    if (s) {
      if (patch.status === 'running') this.execucoes.push(s.agent_key)
      Object.assign(s, patch)
    }
  }
  async insertJob(job: Omit<JobRow, 'id'>) {
    if (this.jobs.some(j => j.dedupe_key === job.dedupe_key)) return null
    if (this.jobs.some(j => j.step_id === job.step_id && (j.status === 'pending' || j.status === 'running'))) return null
    const created: JobRow = { ...job, id: `job-${++this.n}` }
    this.jobs.push(created); return { ...created }
  }

  async claimNextJob(now: Date, lockToken: string, lockSeconds: number) {
    const candidatos = this.jobs.filter(j => j.status === 'pending' && new Date(j.scheduled_for) <= now)
    for (const c of candidatos) {
      // Interleaving REAL: sob Promise.all, o segundo chamador chega aqui
      // depois de o primeiro já ter mudado o status. A guarda abaixo é o
      // equivalente do `.eq('status','pending')` no UPDATE do Postgres.
      await new Promise(r => setTimeout(r, 0))
      if (c.status !== 'pending') continue
      c.status = 'running'; c.lock_token = lockToken
      c.locked_until = new Date(now.getTime() + lockSeconds * 1000).toISOString()
      return { ...c }
    }
    return null
  }

  async completeJob(id: string, token: string) {
    const j = this.jobs.find(x => x.id === id)
    if (!j || j.status !== 'running' || j.lock_token !== token) return false
    j.status = 'done'; return true
  }
  async failJob(id: string, token: string, err: string, retryAt: Date | null) {
    const j = this.jobs.find(x => x.id === id)
    if (!j || j.lock_token !== token) return
    j.error = err; j.lock_token = null
    if (retryAt) { j.status = 'pending'; j.attempt++ } else j.status = 'failed'
  }
  async recoverStaleJobs() { return 0 }
  async emitEvent(input: EmitEventInput) {
    const p = this.productions.get(input.productionId)!
    p.next_event_seq += 1
    this.events.push({
      id: `evt-${++this.n}`, tenant_id: p.tenant_id, production_id: p.id,
      step_id: input.stepId ?? null, agent_key: input.agentKey ?? null,
      type: input.type, schema_version: 1, seq: p.next_event_seq,
      payload: input.payload ?? {}, ui_hint: input.uiHint ?? null,
      occurred_at: '2026-01-01T00:00:00.000Z',
    })
    return p.next_event_seq
  }
}

test('6) duas chamadas simultâneas não executam o mesmo job duas vezes', async () => {
  const store = new ConcurrentStore()
  const prod = store.createProduction()
  await startProduction(store, prod.id)

  assert.equal(store.jobs.filter(j => j.status === 'pending').length, 1, 'só o primeiro passo na fila')

  // Duas requisições disparadas juntas, como dois cliques ou duas abas.
  const [a, b] = await Promise.all([
    runNextJob(store, { newLockToken: () => 'lock-A' }),
    runNextJob(store, { newLockToken: () => 'lock-B' }),
  ])

  const executaram = [a, b].filter(r => r.status !== 'idle')
  assert.equal(executaram.length, 1, 'exatamente uma chamada executou o job')
  assert.equal(store.execucoes.filter(k => k === 'researcher').length, 1, 'o agente rodou uma única vez')

  const doPesquisador = store.events.filter(e => e.agent_key === 'researcher' && e.type === 'agent_started')
  assert.equal(doPesquisador.length, 1, 'um único agent_started')
})

test('6b) chamadas concorrentes repetidas não duplicam nenhum passo', async () => {
  const store = new ConcurrentStore()
  const prod = store.createProduction()
  await startProduction(store, prod.id)

  for (let rodada = 0; rodada < 6; rodada++) {
    await Promise.all([
      runNextJob(store, { newLockToken: () => `A-${rodada}` }),
      runNextJob(store, { newLockToken: () => `B-${rodada}` }),
      runNextJob(store, { newLockToken: () => `C-${rodada}` }),
    ])
  }

  for (const agente of ['researcher', 'strategist', 'copywriter']) {
    assert.equal(store.execucoes.filter(k => k === agente).length, 1, `${agente} executou mais de uma vez`)
  }
  assert.equal(store.productions.get(prod.id)!.status, 'review')
  assert.ok(store.jobs.every(j => j.status === 'done'))
})

// ─── 7. Loop do navegador ───────────────────────────────────────────────────

test('7) o laço tem teto de chamadas, de tempo e detecção de estagnação', () => {
  assert.ok(/MAX_TICKS\s*=\s*\d+/.test(ui), 'teto de chamadas')
  assert.ok(/MAX_TOTAL_MS\s*=\s*[\d_]+/.test(ui), 'teto de tempo')
  assert.ok(/MAX_SEM_PROGRESSO\s*=\s*\d+/.test(ui), 'detecção de estagnação')

  assert.ok(ui.includes('if (!res.data.pending) break'), 'para assim que não há pendência')
  assert.ok(ui.includes('if (!res.ok) { setError(res.error); break }'), 'para em erro')
  assert.ok(ui.includes('Date.now() > limite'), 'respeita o deadline')
  assert.ok(ui.includes('semProgresso >= MAX_SEM_PROGRESSO'), 'desiste sem progresso')

  // Cancelamento no desmonte, checado depois de cada await.
  assert.ok(ui.includes('cancelled.current = true'))
  assert.ok((ui.match(/if \(cancelled\.current\) return/g) ?? []).length >= 3)
  assert.ok(!/while\s*\(\s*true\s*\)/.test(ui), 'nenhum laço infinito')
})

// ─── 8. Saneamento de erros ─────────────────────────────────────────────────

test('8) o erro que chega ao navegador é genérico', () => {
  for (const msg of Object.values(USER_MESSAGES)) {
    assert.ok(!/cs_|supabase|postgres|constraint|violates|column|relation|schema/i.test(msg), `mensagem vaza interno: ${msg}`)
    assert.ok(msg.length < 120)
  }
  assert.equal(safeUserMessage('not_found'), USER_MESSAGES.not_found)
  // Ausente e de outro tenant devolvem o MESMO texto: não dá para sondar ids.
  assert.equal(safeUserMessage('not_found'), 'Demonstração não encontrada.')
  // Pipeline errado e não-demo também são indistinguíveis entre si.
  assert.equal(safeUserMessage('wrong_pipeline'), safeUserMessage('not_demo'))
})

test('8b) nenhum detalhe do banco é devolvido ao cliente', () => {
  // O único lugar que preenche `error:` na resposta é fail(), e ele só emite
  // texto vindo de USER_MESSAGES.
  const camposError = [...actions.matchAll(/\berror:\s*([^,\n}]+)/g)]
    .map(m => m[1].trim())
    .filter(v => v !== 'string')   // `error: string` é a declaração de ActionResult
  assert.ok(camposError.length > 0, 'nenhum retorno de erro encontrado — regex quebrada?')
  for (const valor of camposError) {
    assert.equal(valor, 'safeUserMessage(key)', `resposta com erro não saneado: ${valor}`)
  }
  assert.ok(!/error:\s*`[^`]*\$\{[^}]*(error|err)[^}]*\}/.test(actions), 'interpola erro cru na resposta')
  assert.ok(!actions.includes('error.message}`'), 'message do Postgres na resposta')
  assert.ok(!actions.includes('${err}'), 'exceção interpolada na resposta')

  // O detalhe existe — mas só no log do servidor.
  assert.ok(actions.includes('console.error'))
  assert.ok(actions.includes("console.error('[content-studio] falha ao carregar produção:', error.message)"))
})

test('8c) a tela não exibe exceção crua', () => {
  assert.ok(!/setError\(err instanceof Error \? err\.message/.test(ui), 'mensagem crua na tela')
  assert.ok(!/setError\(String\(err\)\)/.test(ui))
})

// ─── 9. Refresh não duplica ─────────────────────────────────────────────────

test('9) abrir/recarregar a página apenas lê', () => {
  const corpo = actions.slice(actions.indexOf('export async function getLatestDemo'))
  const ate = corpo.slice(0, corpo.length)
  assert.ok(!ate.includes('.insert('), 'getLatestDemo não pode inserir')
  assert.ok(!ate.includes('startProduction('), 'getLatestDemo não pode iniciar produção')
  assert.ok(!ate.includes('drainQueue'), 'getLatestDemo não pode avançar')

  // Ao montar, a tela só chama a leitura.
  const efeito = ui.slice(ui.indexOf('getLatestDemo()'), ui.indexOf('getLatestDemo()') + 400)
  assert.ok(!efeito.includes('startDemoProduction'), 'montar a tela não pode criar produção')
  assert.ok(!efeito.includes('advanceDemo'), 'montar a tela não pode avançar')

  // "Reiniciar visualização" apenas relê.
  const reiniciar = ui.slice(ui.indexOf('const reiniciar'), ui.indexOf('const reiniciar') + 500)
  assert.ok(reiniciar.includes('getDemoState'), 'reiniciar deve reler')
  assert.ok(!reiniciar.includes('startDemoProduction'), 'reiniciar não pode criar produção')
  assert.ok(!reiniciar.includes('advanceDemo'), 'reiniciar não pode avançar')
})

// ─── 10. Service role fora do navegador ─────────────────────────────────────

test('10) service role nunca entra no bundle do cliente', () => {
  assert.ok(ui.startsWith("'use client'"))
  for (const proibido of ['createAdminClient', 'SERVICE_ROLE', 'service_role', '@/lib/supabase/admin', '@/lib/content-studio/store']) {
    assert.ok(!ui.includes(proibido), `componente de cliente referencia ${proibido}`)
  }
  // A página é server component e só monta o componente.
  assert.ok(!page.includes("'use client'"))
  assert.ok(!page.includes('createAdminClient'))

  // O arquivo que usa service_role é server-only.
  assert.ok(actions.startsWith("'use server'"))
})

test('10b) nenhuma variável privada usa o prefixo NEXT_PUBLIC_', () => {
  const publicas = [...actions.matchAll(/process\.env\.(\w+)/g)].map(m => m[1])
  for (const v of publicas) {
    if (v.startsWith('NEXT_PUBLIC_')) {
      assert.ok(
        v === 'NEXT_PUBLIC_SUPABASE_URL' || v === 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        `variável pública inesperada: ${v}`,
      )
    }
  }
  assert.ok(!/NEXT_PUBLIC_\w*SERVICE/.test(actions))
  assert.ok(!/NEXT_PUBLIC_\w*SECRET/.test(actions))
  assert.ok(!ui.includes('process.env'), 'o componente de cliente não lê env')
})

test('10c) a resposta não devolve tenant_id', () => {
  assert.ok(actions.includes('.map(toPublicEvent)'), 'eventos precisam ser saneados')
  const evento: StoredEvent = {
    id: 'e1', tenant_id: 'tenant-A', production_id: 'p1', step_id: null,
    agent_key: 'researcher', type: 'agent_started', schema_version: 1, seq: 1,
    payload: {}, ui_hint: null, occurred_at: '2026-01-01T00:00:00.000Z',
  }
  const publico = toPublicEvent(evento)
  assert.ok(!('tenant_id' in publico), 'tenant_id vazou no evento')
  assert.ok(!JSON.stringify(publico).includes('tenant-A'))
  assert.equal(publico.seq, 1, 'o resto do evento é preservado')

  // O tipo DemoState não expõe tenant. Comentários fora: o que o código diz
  // sobre si mesmo não conta como evidência.
  const estado = actions
    .slice(actions.indexOf('export interface DemoState'), actions.indexOf('export type ActionResult'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.ok(!estado.includes('tenant_id'), 'DemoState expõe tenant_id')
})

test('a página continua protegida por login', () => {
  const proxy = readFileSync(join(RAIZ, 'src/proxy.ts'), 'utf8')
  const lista = proxy.slice(proxy.indexOf('PUBLIC_PREFIXES'), proxy.indexOf(']', proxy.indexOf('PUBLIC_PREFIXES')))
  assert.ok(!lista.includes('content-studio'), 'a rota não pode ser pública')
  assert.ok(!proxy.includes("PUBLIC_ROUTES = new Set(['/login', '/register', '/onboarding', '/content-studio'"))
})

// ─── 11. R1 intocado ────────────────────────────────────────────────────────

test('11) os arquivos do R1 continuam intocados', () => {
  const cronAuth = readFileSync(join(RAIZ, 'src/lib/security/cron-auth.ts'), 'utf8')
  const route = readFileSync(join(RAIZ, 'src/app/api/queue/process/route.ts'), 'utf8')

  assert.ok(cronAuth.includes('timingSafeEqual'), 'a comparação segura continua lá')
  assert.ok(route.includes('evaluateCronAuth'), 'o guard continua no endpoint')
  assert.ok(!cronAuth.includes('content-studio'), 'R1 não pode conhecer o Content Studio')
  assert.ok(!route.includes('content-studio'))

  for (const [nome, src] of [['actions', actions], ['ui', ui]] as const) {
    for (const alvo of ['cron-auth', 'queue/process', 'CRON_SECRET', 'CRON_AUTH_ENFORCE']) {
      assert.ok(!src.includes(alvo), `${nome} referencia ${alvo}`)
    }
  }
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (err) { results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) }) }
  }
  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FALHA'} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
  if (failed.length > 0) process.exitCode = 1
}

void main()
