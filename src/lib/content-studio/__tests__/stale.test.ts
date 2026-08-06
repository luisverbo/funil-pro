// ============================================================================
// Content Studio — recuperação de step `running` abandonado (Studio)
// ----------------------------------------------------------------------------
// O que se prova: a produção real travada (Estrategista + Copywriter prontos,
// Designer running órfão) fica em in_progress PARA SEMPRE no caminho normal;
// a retomada é EXPLÍCITA, decidida pelo relógio do SERVIDOR, com posse
// atômica via CAS do started_at — cinco cliques pagam UMA chamada, só o
// Designer roda de novo, e a produção finaliza com um único
// content_waiting_approval. Nenhum teste chama API real.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { __setContentAIProviderForTests, type ContentAIProvider } from '../ai/provider'
import {
  isStaleRunningStep, retryStaleStudioStep, runStudioCarousel,
  STUDIO_DISPATCH_MARGIN_MS, STUDIO_PERSISTENCE_MARGIN_MS, STUDIO_PROFILES,
  STUDIO_STALE_RUNNING_MS,
} from '../studio/run'
import {
  STUDIO_AGENT_ORDER, STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY,
  STUDIO_PIPELINE_KEY, STUDIO_STRATEGIST_KEY, validateStudioInput,
} from '../studio/schema'
import type {
  ContentStore, EmitEventInput, JobRow, ProductionRow, ProductionStatus,
  StepRow, StoredEvent,
} from '../types'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ─── Fixtures ───────────────────────────────────────────────────────────────

const N = 6
const T0 = Date.parse('2026-01-01T00:00:00.000Z')

function briefStudio() {
  const v = validateStudioInput({ tema: 'organizar leads', slides: N, idempotencyKey: 'staletest000001' })
  if (!v.ok) throw new Error('brief inválido')
  return v.brief
}

function planoBom() {
  return {
    bigIdea: 'Lead não se perde por falta de resposta, e sim por falta de lugar',
    angle: 'a bagunça dos canais', promise: 'nunca mais perder lead de vista',
    audience: 'donos de pequenas empresas', tone: 'direto',
    beats: Array.from({ length: N }, (_, i) => ({ number: i + 1, purpose: `função ${i + 1}` })),
  }
}
function copyBoa() {
  return {
    title: 'Como organizar o atendimento de leads',
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, headline: `Headline concreta do slide ${i + 1}`,
      body: `Texto de apoio do slide ${i + 1}, curto e direto.`,
    })),
    caption: 'Legenda que complementa o carrossel.',
    cta: 'Organize seus leads', hashtags: ['#leads'],
    review: { approved: true, notes: [] },
  }
}
function arteBoa() {
  return {
    direction: { style: 'editorial limpo', palette: 'grafite e laranja', typography: 'sem serifa', mood: 'organização' },
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, style: 'contraste', composition: `composição ${i + 1}`,
      elements: ['ícone'], colors: 'grafite', layout: 'headline no topo',
      imagePrompt: `cena ${i + 1}, luz suave`,
    })),
  }
}

function providerDesigner(contador: { calls: number; execIds: string[] }): ContentAIProvider {
  return {
    async call(req) {
      contador.calls++
      contador.execIds.push(req.executionId ?? '')
      const exec = req.executionId ?? ''
      const bruto = exec.includes(STUDIO_STRATEGIST_KEY) ? planoBom()
        : exec.includes(STUDIO_COPYWRITER_KEY) ? copyBoa() : arteBoa()
      return {
        output: req.parse(bruto), model: 'fake', inputTokens: 1,
        outputTokens: 1, durationMs: 1, calls: 1, finish: 'ok',
      }
    },
  }
}

// ─── Store em memória: índice único + CAS COM predicado de started_at ───────

class MemStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0

  /** Produção presa NO DESIGNER: o cenário real de produção. */
  travadaNoDesigner(designerStartedAt: string | null = new Date(T0).toISOString()): ProductionRow {
    const p: ProductionRow = {
      id: 'prod-stale', tenant_id: 'tenant-A', pipeline_key: STUDIO_PIPELINE_KEY,
      title: 'Travada', brief: briefStudio(), status: 'running', next_event_seq: 0,
      created_by: null, created_at: 'z', updated_at: 'z',
    }
    this.productions.set(p.id, p)
    const dados: Record<string, Record<string, unknown>> = {
      [STUDIO_STRATEGIST_KEY]: planoBom(),
      [STUDIO_COPYWRITER_KEY]: copyBoa(),
    }
    ;[STUDIO_STRATEGIST_KEY, STUDIO_COPYWRITER_KEY].forEach((k, i) => {
      this.steps.push({
        id: `step-${k}`, production_id: p.id, tenant_id: p.tenant_id, agent_key: k,
        step_index: i, depends_on: [], status: 'completed', input: null,
        output: { data: dados[k], artifacts: [], usage: undefined },
        attempt: 0, error: null, started_at: 'x', completed_at: 'x',
      })
    })
    // Designer com agent_started e NADA depois — o órfão.
    this.steps.push({
      id: 'step-designer', production_id: p.id, tenant_id: p.tenant_id,
      agent_key: STUDIO_DESIGNER_KEY, step_index: 2, depends_on: [STUDIO_COPYWRITER_KEY],
      status: 'running', input: null, output: null, attempt: 0, error: null,
      started_at: designerStartedAt, completed_at: null,
    })
    this.events.push({
      id: 'ev-1', tenant_id: p.tenant_id, production_id: p.id, step_id: 'step-designer',
      agent_key: STUDIO_DESIGNER_KEY, type: 'agent_started', schema_version: 1,
      seq: 1, payload: { attempt: 0 }, ui_hint: null, occurred_at: 'z',
    })
    p.next_event_seq = 1
    return p
  }

  async getProduction(id: string) { return this.productions.get(id) ?? null }
  async updateProductionStatus(id: string, st: ProductionStatus) {
    const p = this.productions.get(id); if (p) p.status = st
  }
  async transitionProductionStatus(id: string, expected: readonly ProductionStatus[], next: ProductionStatus) {
    const p = this.productions.get(id)
    if (!p || !expected.includes(p.status)) return false
    p.status = next
    return true
  }
  async listSteps(id: string) { return this.steps.filter(s => s.production_id === id).map(s => ({ ...s })) }
  async insertSteps(rows: Omit<StepRow, 'id'>[]) {
    const conflito = rows.some(r =>
      this.steps.some(s => s.production_id === r.production_id && s.step_index === r.step_index))
    if (conflito) {
      const existentes = this.steps.filter(s => rows.some(r => r.step_index === s.step_index))
      return { rows: existentes.map(s => ({ ...s })), inserted: false }
    }
    const criados = rows.map(r => ({ ...r, id: `step-novo-${++this.n}` }))
    this.steps.push(...criados)
    return { rows: criados.map(s => ({ ...s })), inserted: true }
  }
  async updateStep(id: string, patch: Partial<StepRow>) {
    const st = this.steps.find(x => x.id === id); if (st) Object.assign(st, patch)
  }
  async transitionStepStatus(
    id: string, expected: readonly StepRow['status'][],
    patch: Partial<StepRow> & { status: StepRow['status'] },
    expectedStartedAt?: string | null,
  ) {
    // Espelha a UPDATE com predicado do Postgres, INCLUINDO a posse.
    const st = this.steps.find(x => x.id === id)
    if (!st || !expected.includes(st.status)) return false
    if (expectedStartedAt === null && st.started_at !== null) return false
    if (typeof expectedStartedAt === 'string' && st.started_at !== expectedStartedAt) return false
    Object.assign(st, patch)
    return true
  }
  async insertJob() { return null }
  async claimNextJob() { return null }
  async completeJob() { return false }
  async failJob() { /* noop */ }
  async recoverStaleJobs() { return 0 }
  async emitEvent(i: EmitEventInput) {
    const p = this.productions.get(i.productionId)!
    p.next_event_seq += 1
    this.events.push({
      id: `ev-${p.next_event_seq}`, tenant_id: p.tenant_id, production_id: p.id,
      step_id: i.stepId ?? null, agent_key: i.agentKey ?? null, type: i.type,
      schema_version: 1, seq: p.next_event_seq, payload: i.payload ?? {},
      ui_hint: i.uiHint ?? null, occurred_at: 'z',
    })
    return p.next_event_seq
  }
}

const DEPOIS_DO_LIMITE = T0 + STUDIO_STALE_RUNNING_MS + 1_000

// ════════════════════════════════════════════════════════════════════════════
// 1. Definição de stale
// ════════════════════════════════════════════════════════════════════════════

test('1) o limite é maior que qualquer execução legítima', () => {
  const maiorTimeout = Math.max(...Object.values(STUDIO_PROFILES).map(p => p.timeoutMs))
  assert.ok(STUDIO_STALE_RUNNING_MS > maiorTimeout + STUDIO_PERSISTENCE_MARGIN_MS + STUDIO_DISPATCH_MARGIN_MS)
  assert.ok(STUDIO_STALE_RUNNING_MS > 60_000, 'menor que o maxDuration da rota')
  assert.equal(STUDIO_STALE_RUNNING_MS, 120_000)
})

test('2) running por 30s NÃO é stale; no limite exato, é', () => {
  const step = { status: 'running' as const, started_at: new Date(T0).toISOString() }
  assert.equal(isStaleRunningStep(step, T0 + 30_000), false)
  assert.equal(isStaleRunningStep(step, T0 + STUDIO_STALE_RUNNING_MS - 1), false)
  assert.equal(isStaleRunningStep(step, T0 + STUDIO_STALE_RUNNING_MS), true)
  // Só running conta.
  assert.equal(isStaleRunningStep({ status: 'completed', started_at: step.started_at }, T0 + 999_999), false)
})

test('3) started_at ausente/ilegível é inconsistência recuperável', () => {
  assert.equal(isStaleRunningStep({ status: 'running', started_at: null }, T0), true)
  assert.equal(isStaleRunningStep({ status: 'running', started_at: 'não-é-data' }, T0), true)
})

// ════════════════════════════════════════════════════════════════════════════
// 2. REPRODUÇÃO: a produção real travada
// ════════════════════════════════════════════════════════════════════════════

test('4) HEAD atual: runStudioCarousel devolve in_progress PARA SEMPRE, sem chamada', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerDesigner(contador))
  const store = new MemStore()
  const p = store.travadaNoDesigner()

  // Mesmo MUITO depois do limite, o caminho normal nunca avança nem paga:
  for (let i = 0; i < 5; i++) {
    const r = await runStudioCarousel(store, p, briefStudio(), { now: () => DEPOIS_DO_LIMITE + i * 60_000 })
    assert.equal(r.state, 'in_progress', 'o caminho normal pagou/avançou sozinho')
  }
  assert.equal(contador.calls, 0)
  assert.equal(store.productions.get(p.id)!.status, 'running')
  // É este o travamento: sem a action explícita, ninguém fecha o step órfão.
})

test('5) retomada explícita: SÓ o Designer roda, com attempt=1 e a1 no executionId', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerDesigner(contador))
  const store = new MemStore()
  const p = store.travadaNoDesigner()

  const r = await retryStaleStudioStep(store, p, briefStudio(), { now: () => DEPOIS_DO_LIMITE })
  assert.equal(r.state, 'created')

  // UMA chamada, do DESIGNER, na tentativa a1 — nunca a0 de novo.
  assert.equal(contador.calls, 1)
  assert.ok(contador.execIds[0].includes(`${STUDIO_DESIGNER_KEY}:a1`), `executionId: ${contador.execIds[0]}`)

  // Estrategista e Copywriter NÃO foram tocados.
  for (const k of [STUDIO_STRATEGIST_KEY, STUDIO_COPYWRITER_KEY]) {
    const st = store.steps.find(x => x.agent_key === k)!
    assert.equal(st.status, 'completed')
    assert.equal(st.attempt, 0, `${k} foi repetido`)
  }
  const designer = store.steps.find(x => x.agent_key === STUDIO_DESIGNER_KEY)!
  assert.equal(designer.status, 'completed')
  assert.equal(designer.attempt, 1)

  // Eventos: 1 agent_retrying (com motivo), 1 novo agent_started (attempt 1),
  // 1 agent_completed, 1 content_waiting_approval, ZERO production_created.
  const tipos = store.events.map(e => e.type)
  assert.equal(tipos.filter(t => t === 'agent_retrying').length, 1)
  const retrying = store.events.find(e => e.type === 'agent_retrying')!
  assert.deepEqual(retrying.payload, { attempt: 1, reason_code: 'stale_running_recovery' })
  assert.equal(store.events.filter(e => e.type === 'agent_started' && (e.payload as { attempt?: number }).attempt === 1).length, 1)
  assert.equal(tipos.filter(t => t === 'agent_completed').length, 1)
  assert.equal(tipos.filter(t => t === 'content_waiting_approval').length, 1)
  assert.equal(tipos.filter(t => t === 'production_created').length, 0)

  // Finalizada: awaiting_approval, direção visual persistida.
  assert.equal(store.productions.get(p.id)!.status, 'awaiting_approval')
  assert.ok(designer.output?.data, 'direção visual ausente')
})

test('6) running RECENTE não pode ser retomado — not_stale, zero chamadas', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerDesigner(contador))
  const store = new MemStore()
  const p = store.travadaNoDesigner()

  const r = await retryStaleStudioStep(store, p, briefStudio(), { now: () => T0 + 30_000 })
  assert.equal(r.state, 'not_stale')
  assert.equal(contador.calls, 0)
  assert.equal(store.steps.find(x => x.agent_key === STUDIO_DESIGNER_KEY)!.attempt, 0)
  assert.equal(store.events.filter(e => e.type === 'agent_retrying').length, 0)
})

test('7) started_at inválido: recuperável pelo CLIQUE, nunca sozinho', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerDesigner(contador))
  const store = new MemStore()
  const p = store.travadaNoDesigner(null)  // órfão SEM started_at

  // O caminho normal continua sem pagar:
  const normal = await runStudioCarousel(store, p, briefStudio())
  assert.equal(normal.state, 'in_progress')
  assert.equal(contador.calls, 0)

  // O clique explícito recupera (posse via predicado IS NULL).
  const r = await retryStaleStudioStep(store, p, briefStudio(), { now: () => T0 })
  assert.equal(r.state, 'created')
  assert.equal(contador.calls, 1)
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Posse atômica sob concorrência
// ════════════════════════════════════════════════════════════════════════════

test('8) CINCO cliques simultâneos no retry → UMA chamada, um retrying, um started', async () => {
  let liberar!: () => void
  const barreira = new Promise<void>(res => { liberar = res })
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests({
    async call(req) {
      contador.calls++
      contador.execIds.push(req.executionId ?? '')
      await barreira
      return {
        output: req.parse(arteBoa()), model: 'fake', inputTokens: 1,
        outputTokens: 1, durationMs: 1, calls: 1, finish: 'ok',
      }
    },
  })
  const store = new MemStore()
  const p = store.travadaNoDesigner()

  const cliques = Array.from({ length: 5 }, () =>
    retryStaleStudioStep(store, p, briefStudio(), { now: () => DEPOIS_DO_LIMITE }))
  await new Promise(res => setTimeout(res, 10))

  assert.equal(contador.calls, 1, `${contador.calls} chamadas — a posse não é atômica`)
  liberar()
  const finais = await Promise.all(cliques)

  assert.equal(contador.calls, 1)
  assert.equal(finais.filter(f => f.state === 'created').length, 1)
  assert.ok(finais.filter(f => f.state === 'in_progress').length >= 1)
  assert.equal(store.events.filter(e => e.type === 'agent_retrying').length, 1)
  assert.equal(store.events.filter(e => e.type === 'agent_started' && (e.payload as { attempt?: number }).attempt === 1).length, 1)
  assert.equal(store.events.filter(e => e.type === 'content_waiting_approval').length, 1)
})

test('9) falha no retry persiste failed — e NÃO repete sozinha', async () => {
  const contador = { calls: 0 }
  __setContentAIProviderForTests({
    async call() {
      contador.calls++
      const err = new Error('content_ai:provider_error: status=500')
      ;(err as { code?: string }).code = 'content_ai:provider_error'
      throw err
    },
  })
  const store = new MemStore()
  const p = store.travadaNoDesigner()

  const r = await retryStaleStudioStep(store, p, briefStudio(), { now: () => DEPOIS_DO_LIMITE })
  assert.equal(r.state, 'failed')
  const designer = store.steps.find(x => x.agent_key === STUDIO_DESIGNER_KEY)!
  assert.equal(designer.status, 'failed')
  assert.equal(store.productions.get(p.id)!.status, 'failed')
  assert.ok(store.events.some(e => e.type === 'agent_failed'))

  // Nova retomada automática? NUNCA: agora o step é failed, não running.
  const r2 = await retryStaleStudioStep(store, p, briefStudio(), { now: () => DEPOIS_DO_LIMITE })
  assert.equal(r2.state, 'invalid')
  assert.equal(contador.calls, 1)
})

test('10) estados sem step running são invalid — nada é criado', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerDesigner(contador))
  const store = new MemStore()
  const p = store.travadaNoDesigner()
  // Designer concluído: nada a recuperar.
  const designer = store.steps.find(x => x.agent_key === STUDIO_DESIGNER_KEY)!
  designer.status = 'completed'
  designer.output = { data: arteBoa() as unknown as Record<string, unknown>, artifacts: [], usage: undefined }

  const r = await retryStaleStudioStep(store, p, briefStudio(), { now: () => DEPOIS_DO_LIMITE })
  assert.equal(r.state, 'invalid')
  assert.equal(contador.calls, 0)
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Action, readState e UI
// ════════════════════════════════════════════════════════════════════════════

test('11) a action valida tenant/pipeline/status e nunca aceita agentKey', () => {
  const actions = semComentarios(ler('src/app/actions/content-production.ts'))
  const fn = actions.slice(actions.indexOf('export async function retryStaleStudioProduction')).split('\nexport ')[0]
  assert.ok(fn.includes('retryStaleStudioProduction(productionId: string)'), 'assinatura recebe mais que o id')
  assert.ok(fn.includes('await currentTenantId()') && fn.includes("fail('unauthenticated')"))
  assert.ok(fn.includes(".eq('tenant_id', tenantId)"), 'tenant fora da sessão')
  assert.ok(fn.includes('STUDIO_PIPELINE.key'), 'pipeline antigo aceito')
  assert.ok(fn.includes('PRODUCTION_TERMINAL.includes'), 'canceled/approved recuperariam')
  assert.ok(fn.includes('preflightContentAI()'), 'chamada paga sem preflight')
  assert.ok(!/agentKey/.test(fn), 'agentKey vindo do cliente')

  // readState informa a situação com rótulo amigável, sem timestamp cru.
  const recovery = actions.slice(actions.indexOf('function studioRecovery')).split('\nasync function')[0]
  assert.ok(recovery.includes('isStaleRunningStep'), 'decisão fora do relógio do servidor')
  assert.ok(recovery.includes('STUDIO_AGENT_LABELS'), 'sem rótulo amigável')
  assert.ok(!recovery.includes('started_at:'), 'timestamp interno exposto')
})

test('12) UI: banners distintos e retomada consciente — Continue não finge avanço', () => {
  const preview = ler('src/components/content-studio/office-preview.tsx')
  // Stale: banner próprio + botão explícito + aviso de custo.
  assert.ok(preview.includes('foi interrompido antes de terminar'), 'sem banner de stale')
  assert.ok(preview.includes('Tentar novamente o ${recuperacao.agentLabel'), 'sem botão de retomada')
  assert.ok(preview.includes('Uma nova chamada de IA será feita'), 'custo não avisado')
  // Running recente: só mensagem, nenhum botão pagante.
  assert.ok(preview.includes('ainda está trabalhando'), 'sem banner de execução recente')
  // O banner de Continuar só aparece quando NÃO há running/stale.
  assert.ok(preview.includes('recuperacao.available ?'), 'Continuar cobre o caso stale')
  // Os laços de continuação PARAM ao ver running/stale.
  const codigo = semComentarios(preview)
  const ocorrencias = (codigo.match(/recovery\.running \|\| r\.data\.recovery\.available\) break/g) ?? []).length
  assert.ok(ocorrencias >= 2, 'os laços não param no in_progress')
  // A decisão vem do servidor: nenhum Date.now no componente julga o stale.
  assert.ok(!codigo.includes('STUDIO_STALE_RUNNING_MS'), 'o cliente julga o stale')
})

test('13) o CAS de posse usa o started_at NA PRÓPRIA UPDATE (Supabase)', () => {
  const store = semComentarios(ler('src/lib/content-studio/store.ts'))
  const cas = store.slice(store.indexOf('async transitionStepStatus'))
    .split('\n    async ')[0]
  assert.ok(cas.includes('expectedStartedAt'), 'sem predicado de posse')
  assert.ok(cas.includes(".eq('started_at', expectedStartedAt)"), 'posse fora da query')
  assert.ok(cas.includes(".is('started_at', null)"), 'caso null sem predicado')
  // E o runner passa o started_at ANTIGO como posse esperada.
  const run = semComentarios(ler('src/lib/content-studio/studio/run.ts'))
  assert.ok(run.includes('alvo.started_at ?? null'), 'o runner não exige a posse antiga')
  // Nada de delete/reinserção do step.
  const retry = run.slice(run.indexOf('export async function retryStaleStudioStep'))
  assert.ok(!retry.includes('insertSteps'), 'reinserção de step')
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Regressões
// ════════════════════════════════════════════════════════════════════════════

test('14) R1 intacto; nenhuma migration; ordem dos agentes preservada', () => {
  assert.ok(ler('src/lib/security/cron-auth.ts').includes('timingSafeEqual'))
  assert.ok(ler('src/app/api/queue/process/route.ts').includes('evaluateCronAuth'))
  const run = ler('src/lib/content-studio/studio/run.ts')
  assert.ok(!/CREATE TABLE|ALTER TABLE|exec_sql/i.test(run))
  assert.deepEqual([...STUDIO_AGENT_ORDER], [STUDIO_STRATEGIST_KEY, STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY])
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (err) { results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) }) }
    finally { __setContentAIProviderForTests(null) }
  }
  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FALHA'} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
  if (failed.length > 0) process.exitCode = 1
}

void main()
