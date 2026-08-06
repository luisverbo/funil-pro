// ============================================================================
// Testes do Office Preview
// ----------------------------------------------------------------------------
// Sem banco, sem rede, sem process.env real. O orquestrador roda contra um
// store em memória; o isolamento de tenant é testado contra um client Supabase
// falso que REGISTRA cada filtro aplicado — é assim que provamos que toda query
// leva `tenant_id`, sem precisar de um Postgres.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { drainQueue, startProduction } from '../orchestrator'
import { OFFICE_PIPELINE, getPipeline, materializeSteps, validatePipeline } from '../pipeline'
import { createSupabaseContentStore } from '../store'
import { buildOfficeView, emptyOfficeView, OFFICE_AGENT_ORDER } from '../view-model'
import { __registerAgentForTests, getAgent } from '../agents/registry'
import { RESEARCHER_AGENT } from '../agents/office'
import type {
  ContentStore, EmitEventInput, JobRow, ProductionRow, StepRow, StoredEvent,
} from '../types'

// Raiz do projeto: os testes rodam a partir dela (`node ...` com cwd no repo).
// Não derivamos de __dirname porque o teste executa a partir do build em /tmp.
const RAIZ = process.cwd()

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ─── Store em memória (espelha as garantias do Postgres) ────────────────────

class MemoryStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0

  createProduction(tenantId = 'tenant-A'): ProductionRow {
    const p: ProductionRow = {
      id: `prod-${++this.n}`, tenant_id: tenantId, pipeline_key: OFFICE_PIPELINE.key,
      title: 'Demo', brief: { tema: 'lançamento', publico: 'infoprodutores' },
      status: 'draft', next_event_seq: 0, created_by: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }
    this.productions.set(p.id, p)
    return p
  }

  async getProduction(id: string) { return this.productions.get(id) ?? null }
  async updateProductionStatus(id: string, status: ProductionRow['status']) {
    const p = this.productions.get(id); if (p) p.status = status
  }
  async transitionProductionStatus(id: string, expected: readonly ProductionRow['status'][], next: ProductionRow['status']) {
    // Espelha o CAS do Postgres: predicado e escrita no mesmo passo síncrono.
    const p = this.productions.get(id)
    if (!p || !expected.includes(p.status)) return false
    p.status = next
    return true
  }
  async listSteps(pid: string) { return this.steps.filter(s => s.production_id === pid).map(s => ({ ...s })) }
  async insertSteps(rows: Omit<StepRow, 'id'>[]) {
    // Espelha o índice único (production_id, step_index): se já existem, não
    // inserimos de novo e sinalizamos `inserted: false`.
    const jaTem = this.steps.filter(s => s.production_id === rows[0]?.production_id)
    if (jaTem.length > 0) return { rows: jaTem.map(s => ({ ...s })), inserted: false }
    const created = rows.map(r => ({ ...r, id: `step-${++this.n}` }))
    this.steps.push(...created)
    return { rows: created.map(s => ({ ...s })), inserted: true }
  }
  async updateStep(id: string, patch: Partial<StepRow>) {
    const s = this.steps.find(x => x.id === id); if (s) Object.assign(s, patch)
  }
  async transitionStepStatus(id: string, expected: readonly StepRow['status'][], patch: Partial<StepRow> & { status: StepRow['status'] }) {
    // CAS síncrono: espelha o predicado-na-UPDATE do Postgres.
    const st = this.steps.find(x => x.id === id)
    if (!st || !expected.includes(st.status)) return false
    Object.assign(st, patch)
    return true
  }
  async insertJob(job: Omit<JobRow, 'id'>) {
    if (this.jobs.some(j => j.dedupe_key === job.dedupe_key)) return null
    if (this.jobs.some(j => j.step_id === job.step_id && (j.status === 'pending' || j.status === 'running'))) return null
    const created: JobRow = { ...job, id: `job-${++this.n}` }
    this.jobs.push(created)
    return { ...created }
  }
  async claimNextJob(now: Date, lockToken: string, lockSeconds: number) {
    for (const j of this.jobs.filter(j => j.status === 'pending' && new Date(j.scheduled_for) <= now)) {
      if (j.status !== 'pending') continue
      j.status = 'running'; j.lock_token = lockToken
      j.locked_until = new Date(now.getTime() + lockSeconds * 1000).toISOString()
      return { ...j }
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
    if (retryAt) { j.status = 'pending'; j.attempt++; j.scheduled_for = retryAt.toISOString() }
    else j.status = 'failed'
  }
  async recoverStaleJobs() { return 0 }
  async emitEvent(input: EmitEventInput) {
    const p = this.productions.get(input.productionId)
    if (!p) throw new Error('production_not_found')
    p.next_event_seq += 1
    this.events.push({
      id: `evt-${++this.n}`, tenant_id: p.tenant_id, production_id: p.id,
      step_id: input.stepId ?? null, agent_key: input.agentKey ?? null,
      type: input.type, schema_version: 1, seq: p.next_event_seq,
      payload: input.payload ?? {}, ui_hint: input.uiHint ?? null,
      occurred_at: new Date(2026, 0, 1, 0, 0, p.next_event_seq).toISOString(),
    })
    return p.next_event_seq
  }
}

/** Roda a demonstração inteira em memória e devolve os eventos. */
async function rodarDemo(tenantId = 'tenant-A') {
  const store = new MemoryStore()
  const prod = store.createProduction(tenantId)
  await startProduction(store, prod.id)
  await drainQueue(store, 30)
  return { store, prod }
}

// ─── 5. Ordem Pesquisador -> Estrategista -> Copywriter ─────────────────────

test('5) o pipeline encadeia pesquisador -> estrategista -> copywriter', () => {
  validatePipeline(OFFICE_PIPELINE)
  const rows = materializeSteps(OFFICE_PIPELINE, { id: 'p', tenant_id: 't' })
  assert.deepEqual(rows.map(r => r.agent_key), ['researcher', 'strategist', 'copywriter'])
  assert.deepEqual(rows.map(r => r.step_index), [0, 1, 2])
  assert.deepEqual(rows[1].depends_on, ['researcher'])
  assert.deepEqual(rows[2].depends_on, ['strategist'])
  assert.equal(getPipeline('office_demo_v1').key, OFFICE_PIPELINE.key)
})

test('5b) a execução respeita a ordem e cada agente recebe o anterior', async () => {
  const { store, prod } = await rodarDemo()

  const iniciados = store.events
    .filter(e => e.type === 'agent_started')
    .map(e => e.agent_key)
  assert.deepEqual(iniciados, ['researcher', 'strategist', 'copywriter'])

  const steps = await store.listSteps(prod.id)
  assert.ok(steps.every(s => s.status === 'completed'), 'todos os passos concluem')

  const copy = steps.find(s => s.agent_key === 'copywriter')!
  assert.ok(Array.isArray(copy.output!.data.blocos), 'o copywriter produziu blocos')
  assert.equal(store.productions.get(prod.id)!.status, 'review')
})

// ─── 4. Eventos -> estados visuais ──────────────────────────────────────────

test('4) os eventos viram os estados visuais corretos', async () => {
  const { store } = await rodarDemo()
  const view = buildOfficeView(store.events)

  assert.deepEqual(view.agents.map(a => a.key), [...OFFICE_AGENT_ORDER])
  assert.ok(view.agents.every(a => a.state === 'done'), 'ao final, todos concluídos')
  assert.equal(view.finished, true)
  assert.equal(view.failed, false)
  assert.ok(view.timeline.length > 0)
  assert.equal(view.lastSeq, store.events.length)
})

test('4b) estados intermediários aparecem conforme os eventos são revelados', async () => {
  const { store } = await rodarDemo()
  const ev = store.events

  const ate = (tipo: string, agente?: string) => {
    const i = ev.findIndex(e => e.type === tipo && (!agente || e.agent_key === agente))
    assert.notEqual(i, -1, `evento ${tipo} não existe`)
    return buildOfficeView(ev.slice(0, i + 1))
  }

  assert.equal(emptyOfficeView().agents[0].state, 'idle', 'sem eventos, todos parados')
  assert.equal(ate('agent_queued', 'researcher').agents[0].state, 'queued')
  assert.equal(ate('agent_started', 'researcher').agents[0].state, 'working')

  const trabalhando = ate('agent_progress', 'researcher')
  assert.ok(trabalhando.agents[0].progress, 'progresso real vira barra')
  assert.equal(trabalhando.agents[0].progress!.total, 3)

  assert.equal(ate('agent_completed', 'researcher').agents[0].state, 'done')
})

// ─── 6. Handoff gera transição visual ───────────────────────────────────────

test('6) o handoff coloca o agente caminhando para o destinatário certo', async () => {
  const { store } = await rodarDemo()

  const i = store.events.findIndex(e => e.type === 'task_handoff_started')
  assert.notEqual(i, -1, 'deve existir handoff')

  const view = buildOfficeView(store.events.slice(0, i + 1))
  const pesquisador = view.agents.find(a => a.key === 'researcher')!
  assert.equal(pesquisador.state, 'walking')
  assert.equal(pesquisador.handoffTo, 'strategist')
  assert.ok(pesquisador.bubble?.includes('Estrategista'))

  // O destino vem do payload gravado, não de suposição da interface.
  const evento = store.events[i]
  assert.equal((evento.payload as { from?: string }).from, 'researcher')
  assert.equal((evento.payload as { to?: string }).to, 'strategist')
  assert.deepEqual(evento.ui_hint, { from: 'researcher', to: 'strategist', artifact: 'folder' })
})

// ─── 7. Erro gera estado visual de erro ─────────────────────────────────────

test('7) falha de agente produz estado de erro na tela', async () => {
  const original = getAgent('researcher')
  __registerAgentForTests({
    key: 'researcher', version: 1, label: 'Pesquisador',
    run: async () => { throw new Error('falha proposital de teste') },
  })

  try {
    const store = new MemoryStore()
    const prod = store.createProduction()

    // Relógio controlado: entre as tentativas há backoff (1min, 5min). Sem
    // avançar o tempo, a fila fica vazia e o agente para em "retrying" — que
    // é o comportamento correto, mas não é o estado de erro que queremos ver.
    let agora = new Date('2026-01-01T00:00:00Z').getTime()
    const deps = { now: () => new Date(agora), newLockToken: () => `lock-${agora}` }

    await startProduction(store, prod.id, deps)
    for (let i = 0; i < 5; i++) {
      await drainQueue(store, 5, deps)
      agora += 20 * 60 * 1000   // passa do maior backoff
    }

    const view = buildOfficeView(store.events)
    const pesquisador = view.agents.find(a => a.key === 'researcher')!
    assert.equal(pesquisador.state, 'error')
    assert.equal(view.failed, true)
    assert.equal(view.finished, false)
    assert.ok(view.timeline.some(t => t.tone === 'bad'))

    // Os agentes seguintes nunca chegaram a trabalhar.
    assert.equal(view.agents.find(a => a.key === 'strategist')!.state, 'idle')
    assert.equal(store.productions.get(prod.id)!.status, 'failed')
  } finally {
    __registerAgentForTests(original)
  }
})

test('7b) o agente reclama se a entrega anterior não chegou', () => {
  assert.throws(
    () => getAgent('strategist').validateInput?.({
      envelope: { productionId: 'p', stepId: 's', agentKey: 'strategist', tenantId: 't', attempt: 0, idempotencyKey: 'k' },
      brief: {}, upstream: {},
    }),
    /Pesquisador não chegou/,
  )
})

// ─── 8. Reiniciar não duplica produção ──────────────────────────────────────

test('8) reconstruir a visualização não cria nada novo', async () => {
  const { store, prod } = await rodarDemo()

  const antes = {
    producoes: store.productions.size,
    steps: store.steps.length,
    jobs: store.jobs.length,
    eventos: store.events.length,
  }

  // "Reiniciar visualização" só relê e reconstrói — várias vezes.
  const v1 = buildOfficeView(store.events)
  const v2 = buildOfficeView(store.events)
  assert.deepEqual(v1, v2, 'reconstruir é determinístico')

  // E reexecutar o start na mesma produção é idempotente.
  await startProduction(store, prod.id)
  assert.deepEqual(
    { producoes: store.productions.size, steps: store.steps.length, jobs: store.jobs.length, eventos: store.events.length },
    antes,
    'nada foi duplicado',
  )
})

// ─── 1, 2, 3. Isolamento: toda query leva tenant_id ─────────────────────────

/** Client Supabase falso que grava os filtros aplicados em cada query. */
function fakeDb() {
  const chamadas: { tabela: string; filtros: Record<string, unknown>; op: string }[] = []
  const make = (tabela: string, op: string) => {
    const filtros: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    const ret = () => chain
    chamadas.push({ tabela, filtros, op })
    Object.assign(chain, {
      select: ret, order: ret, limit: ret, lte: ret, lt: ret, in: ret, single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      eq: (col: string, val: unknown) => { filtros[col] = val; return chain },
      then: (r: (v: { data: never[]; error: null }) => void) => r({ data: [], error: null }),
    })
    return chain
  }
  return {
    chamadas,
    db: {
      from: (tabela: string) => ({
        select: () => make(tabela, 'select') as never,
        insert: (rows: unknown) => {
          const c = make(tabela, 'insert') as Record<string, unknown>
          ;(c as { _rows?: unknown })._rows = rows
          chamadas[chamadas.length - 1].filtros._rows = rows
          return c as never
        },
        update: (patch: unknown) => {
          const c = make(tabela, 'update') as Record<string, unknown>
          chamadas[chamadas.length - 1].filtros._patch = patch
          return c as never
        },
      }),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        chamadas.push({ tabela: `rpc:${fn}`, filtros: args, op: 'rpc' })
        return { data: 1, error: null }
      },
    },
  }
}

test('2) o store filtra por tenant_id em toda leitura e escrita', async () => {
  const { db, chamadas } = fakeDb()
  const store = createSupabaseContentStore(db as never, { tenantId: 'tenant-A', productionId: 'prod-1' })

  await store.getProduction('prod-1')
  await store.listSteps('prod-1')
  await store.updateStep('step-1', { status: 'running' })
  await store.claimNextJob(new Date(), 'lock', 300)
  await store.completeJob('job-1', 'lock')
  await store.recoverStaleJobs(new Date())

  const emTabelas = chamadas.filter(c => c.tabela.startsWith('cs_'))
  assert.ok(emTabelas.length >= 6, 'houve consultas')
  for (const c of emTabelas) {
    assert.equal(c.filtros.tenant_id, 'tenant-A', `query em ${c.tabela} (${c.op}) sem filtro de tenant`)
  }
})

test('2b) o store recusa produção fora do escopo', async () => {
  const { db } = fakeDb()
  const store = createSupabaseContentStore(db as never, { tenantId: 'tenant-A', productionId: 'prod-1' })

  assert.equal(await store.getProduction('prod-DE-OUTRO'), null)
  assert.deepEqual(await store.listSteps('prod-DE-OUTRO'), [])
  await assert.rejects(
    () => store.updateProductionStatus('prod-DE-OUTRO', 'running'),
    /production_out_of_scope/,
  )
  await assert.rejects(
    () => store.emitEvent({ productionId: 'prod-DE-OUTRO', type: 'agent_started' }),
    /production_out_of_scope/,
  )
})

test('2c) insertSteps/insertJob recarimbam tenant e produção do escopo', async () => {
  const { db, chamadas } = fakeDb()
  const store = createSupabaseContentStore(db as never, { tenantId: 'tenant-A', productionId: 'prod-1' })

  // Mesmo recebendo outro tenant, o que vai ao banco é o do escopo.
  await store.insertSteps([{
    production_id: 'prod-INVASOR', tenant_id: 'tenant-B', agent_key: 'researcher',
    step_index: 0, depends_on: [], status: 'pending', input: null, output: null,
    attempt: 0, error: null, started_at: null, completed_at: null,
  }])

  const insercao = chamadas.find(c => c.tabela === 'cs_steps' && c.op === 'insert')!
  const rows = insercao.filtros._rows as { tenant_id: string; production_id: string }[]
  assert.equal(rows[0].tenant_id, 'tenant-A')
  assert.equal(rows[0].production_id, 'prod-1')
})

test('2d) emitEvent nunca envia tenant_id — a função SQL o deriva', async () => {
  const { db, chamadas } = fakeDb()
  const store = createSupabaseContentStore(db as never, { tenantId: 'tenant-A', productionId: 'prod-1' })
  await store.emitEvent({ productionId: 'prod-1', type: 'agent_started', agentKey: 'researcher' })

  const rpc = chamadas.find(c => c.tabela === 'rpc:cs_emit_event')!
  assert.equal(rpc.filtros.p_production_id, 'prod-1')
  assert.ok(!('p_tenant_id' in rpc.filtros), 'tenant_id não pode ser parâmetro')
  assert.ok(!JSON.stringify(rpc.filtros).includes('tenant-A'))
})

// ─── Inspeção estática do código ────────────────────────────────────────────

const actions = readFileSync(join(RAIZ, 'src/app/actions/content-studio.ts'), 'utf8')
const store = readFileSync(join(RAIZ, 'src/lib/content-studio/store.ts'), 'utf8')
const office = readFileSync(join(RAIZ, 'src/lib/content-studio/agents/office.ts'), 'utf8')
const ui = readFileSync(join(RAIZ, 'src/components/content-studio/office-preview.tsx'), 'utf8')

test('1) toda action deriva o tenant da sessão e nenhuma o aceita do cliente', () => {
  for (const fn of ['startDemoProduction', 'advanceDemo', 'getDemoState', 'getLatestDemo']) {
    const corpo = actions.slice(actions.indexOf(`export async function ${fn}`))
    const ate = corpo.slice(0, corpo.indexOf('\n}\n') + 3)
    assert.ok(ate.includes('await currentTenantId()'), `${fn} não resolve o tenant`)
    // Sem sessão a action para aqui — `fail('unauthenticated')` devolve o texto
    // genérico de USER_MESSAGES, nunca um detalhe interno.
    assert.ok(ate.includes("fail('unauthenticated')"), `${fn} não bloqueia usuário sem sessão`)
  }
  // Nenhuma assinatura de action recebe tenantId
  assert.ok(!/export async function \w+\([^)]*tenantId/.test(actions), 'action aceita tenantId do cliente')
  assert.ok(actions.includes("'use server'"), 'o arquivo precisa ser server-only')
  assert.ok(actions.includes('.eq(\'tenant_id\', tenantId)'), 'leitura sem escopo de tenant')
})

test('3) a demonstração só escreve em tabelas cs_*', () => {
  const tabelas = [...actions.matchAll(/\.from\('([^']+)'\)/g)].map(m => m[1])
  const store_tabelas = [...store.matchAll(/\.from\('([^']+)'\)/g)].map(m => m[1])
  const permitidas = new Set(['cs_productions', 'cs_steps', 'cs_jobs', 'cs_events', 'users_tenants'])

  for (const t of [...tabelas, ...store_tabelas]) {
    assert.ok(permitidas.has(t), `tabela fora do escopo: ${t}`)
  }
  // users_tenants é lido apenas para resolver o tenant, e só nas actions
  assert.ok(!store_tabelas.includes('users_tenants'))
  assert.ok(!/queue_jobs|leads|funnels|ai_agents|ig_/.test(actions + store))
})

/**
 * Remove comentários antes da inspeção.
 *
 * Sem isso, um comentário que PROMETE não chamar a Anthropic marca falso
 * positivo — o que dizemos sobre o código não é o código.
 */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // blocos
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // linha (preservando "https://")
}

test('9) nenhuma chamada externa nos agentes nem na tela', () => {
  for (const [nome, bruto] of [['agentes', office], ['store', store], ['actions', actions], ['ui', ui]] as const) {
    const src = semComentarios(bruto)
    assert.ok(!/\bfetch\s*\(/.test(src), `${nome} faz fetch`)
    assert.ok(!/XMLHttpRequest|WebSocket|EventSource/.test(src), `${nome} abre conexão externa`)
    assert.ok(!/anthropic|openai|api\.instagram|graph\.instagram|resend/i.test(src), `${nome} referencia provedor externo`)
    assert.ok(!/https?:\/\//.test(src), `${nome} tem URL externa`)
  }
  // O custo declarado pelos agentes é zero, explicitamente.
  assert.ok(office.includes('costCents: 0'))
  assert.ok(!office.includes('process.env'), 'agente stub não deve ler credencial')
})

test('service role nunca é importado pelo componente de cliente', () => {
  assert.ok(ui.startsWith("'use client'"))
  assert.ok(!ui.includes('createAdminClient'), 'admin client no navegador')
  assert.ok(!ui.includes('SERVICE_ROLE'), 'service role no navegador')
  assert.ok(!ui.includes('@/lib/content-studio/store'), 'store server-only importado no cliente')
})

test('10) nenhum arquivo do R1 é tocado por este módulo', () => {
  const alvos = ['cron-auth', 'queue/process', 'CRON_SECRET', 'CRON_AUTH_ENFORCE']
  for (const [nome, src] of [['actions', actions], ['store', store], ['agentes', office], ['ui', ui]] as const) {
    for (const alvo of alvos) {
      assert.ok(!src.includes(alvo), `${nome} referencia ${alvo}`)
    }
  }
})

test('a página só entra no menu sob autorização do servidor', () => {
  // A partir do Quick Create: o item existe, mas SOMENTE atrás da prop
  // showContentStudio decidida no servidor (nav.test.ts cobre o helper).
  const sidebar = readFileSync(join(RAIZ, 'src/components/layout/sidebar.tsx'), 'utf8')
  assert.ok(sidebar.includes('showContentStudio ? [...NAV, CONTENT_STUDIO_ITEM] : NAV'),
    'o item deve ser condicional à prop do servidor')
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

// Referência usada só para garantir que o import do agente real não é removido
void RESEARCHER_AGENT
