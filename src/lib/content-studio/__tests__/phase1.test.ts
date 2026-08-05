// ============================================================================
// Content Studio — testes da Fase 1
// ----------------------------------------------------------------------------
// NÃO TOCA EM BANCO. Nenhuma conexão, nenhuma variável de ambiente, nenhuma
// chamada de rede. Toda a persistência é um ContentStore em memória que espelha
// as garantias implementadas em jobs.ts / events.ts / cs_emit_event:
//
//   claim   -> só vence quem encontrar o job ainda 'pending'
//   complete-> exige o mesmo lock_token
//   retry   -> incrementa attempt e reagenda com backoff
//   recover -> lock vencido volta para a fila
//   seq     -> incremento atômico por produção, sem lacuna e sem repetição
//
// Como rodar (sem instalar nada):
//   node_modules/.bin/tsc src/lib/content-studio/__tests__/phase1.test.ts \
//     --outDir .tmp-cs-test --module commonjs --moduleResolution node \
//     --target es2022 --skipLibCheck
//   node .tmp-cs-test/src/lib/content-studio/__tests__/phase1.test.js
// ============================================================================

import assert from 'node:assert/strict'

import { __registerAgentForTests } from '../agents/registry'
import { STUB_A, STUB_FAILING } from '../agents/stub'
import {
  eligibleSteps,
  materializeSteps,
  STUB_PIPELINE,
  validatePipeline,
} from '../pipeline'
import { drainQueue, runNextJob, startProduction } from '../orchestrator'
import {
  buildDedupeKey,
  nextRetryDelaySeconds,
  type ContentStore,
  type EmitEventInput,
  type JobRow,
  type PipelineDef,
  type ProductionRow,
  type StepRow,
  type StoredEvent,
} from '../types'

// ─── Runner mínimo ──────────────────────────────────────────────────────────

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []

/** Registra um caso; a execução é sequencial em `main()`. */
function test(name: string, fn: () => void | Promise<void>) {
  suite.push({ name, fn })
}

async function main() {
  for (const { name, fn } of suite) {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (err) {
      results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FALHA'} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
  if (failed.length > 0) process.exitCode = 1
}

// ─── Relógio falso ──────────────────────────────────────────────────────────

class FakeClock {
  constructor(private t = new Date('2026-01-01T00:00:00.000Z').getTime()) {}
  now = () => new Date(this.t)
  advanceSeconds(s: number) { this.t += s * 1000 }
}

// ─── Store em memória ───────────────────────────────────────────────────────

class MemoryStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private seqId = 0

  createProduction(overrides: Partial<ProductionRow> = {}): ProductionRow {
    const p: ProductionRow = {
      id: `prod-${++this.seqId}`,
      tenant_id: 'tenant-1',
      pipeline_key: 'stub_v1',
      title: 'Teste',
      brief: { tema: 'lançamento' },
      status: 'draft',
      next_event_seq: 0,
      created_by: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...overrides,
    }
    this.productions.set(p.id, p)
    return p
  }

  async getProduction(id: string) { return this.productions.get(id) ?? null }

  async updateProductionStatus(id: string, status: ProductionRow['status']) {
    const p = this.productions.get(id)
    if (p) p.status = status
  }
  async transitionProductionStatus(id: string, expected: readonly ProductionRow['status'][], next: ProductionRow['status']) {
    // Espelha o CAS do Postgres: predicado e escrita no mesmo passo síncrono.
    const p = this.productions.get(id)
    if (!p || !expected.includes(p.status)) return false
    p.status = next
    return true
  }

  async listSteps(productionId: string) {
    return this.steps.filter(s => s.production_id === productionId).map(s => ({ ...s }))
  }

  async insertSteps(rows: Omit<StepRow, 'id'>[]) {
    const jaTem = this.steps.filter(s => s.production_id === rows[0]?.production_id)
    if (jaTem.length > 0) return { rows: jaTem.map(s => ({ ...s })), inserted: false }
    const created = rows.map(r => ({ ...r, id: `step-${++this.seqId}` }))
    this.steps.push(...created)
    return { rows: created.map(s => ({ ...s })), inserted: true }
  }

  async updateStep(stepId: string, patch: Partial<StepRow>) {
    const s = this.steps.find(x => x.id === stepId)
    if (s) Object.assign(s, patch)
  }

  async insertJob(job: Omit<JobRow, 'id'>) {
    // Espelha uq_cs_jobs_dedupe e uq_cs_jobs_active: colisão = no-op idempotente.
    if (this.jobs.some(j => j.dedupe_key === job.dedupe_key)) return null
    if (this.jobs.some(j => j.step_id === job.step_id && (j.status === 'pending' || j.status === 'running'))) {
      return null
    }
    const created: JobRow = { ...job, id: `job-${++this.seqId}` }
    this.jobs.push(created)
    return { ...created }
  }

  async claimNextJob(now: Date, lockToken: string, lockSeconds: number) {
    const candidates = this.jobs
      .filter(j => j.status === 'pending' && new Date(j.scheduled_for) <= now)
      .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))

    for (const c of candidates) {
      // Ponto de interleaving REAL: sob Promise.all, o segundo chamador chega
      // aqui depois que o primeiro já mudou o status. A guarda abaixo é o
      // equivalente em memória do `.eq('status','pending')` no UPDATE.
      await Promise.resolve()
      if (c.status !== 'pending') continue
      c.status = 'running'
      c.lock_token = lockToken
      c.locked_until = new Date(now.getTime() + lockSeconds * 1000).toISOString()
      return { ...c }
    }
    return null
  }

  async completeJob(jobId: string, lockToken: string) {
    const j = this.jobs.find(x => x.id === jobId)
    if (!j || j.status !== 'running' || j.lock_token !== lockToken) return false
    j.status = 'done'
    j.lock_token = null
    j.locked_until = null
    return true
  }

  async failJob(jobId: string, lockToken: string, error: string, retryAt: Date | null) {
    const j = this.jobs.find(x => x.id === jobId)
    if (!j || j.lock_token !== lockToken) return
    j.error = error
    j.lock_token = null
    j.locked_until = null
    if (retryAt) {
      j.status = 'pending'
      j.attempt = j.attempt + 1
      j.scheduled_for = retryAt.toISOString()
    } else {
      j.status = 'failed'
    }
  }

  async recoverStaleJobs(now: Date) {
    let n = 0
    for (const j of this.jobs) {
      if (j.status === 'running' && j.locked_until && new Date(j.locked_until) < now) {
        j.status = 'pending'
        j.lock_token = null
        j.locked_until = null
        j.error = 'lock expirado — job recuperado'
        n++
      }
    }
    return n
  }

  async emitEvent(input: EmitEventInput) {
    const p = this.productions.get(input.productionId)
    if (!p) throw new Error(`production_not_found: ${input.productionId}`)
    // Sem await entre ler e escrever: reproduz a atomicidade do
    // UPDATE ... RETURNING dentro de cs_emit_event.
    p.next_event_seq += 1
    const seq = p.next_event_seq
    this.events.push({
      id: `evt-${++this.seqId}`,
      tenant_id: p.tenant_id,
      production_id: p.id,
      step_id: input.stepId ?? null,
      agent_key: input.agentKey ?? null,
      type: input.type,
      schema_version: 1,
      seq,
      payload: input.payload ?? {},
      ui_hint: input.uiHint ?? null,
      occurred_at: new Date().toISOString(),
    })
    return seq
  }

  eventsOf(productionId: string) {
    return this.events.filter(e => e.production_id === productionId)
  }
}

let tokenCounter = 0
const deps = (clock: FakeClock) => ({
  now: clock.now,
  newLockToken: () => `lock-${++tokenCounter}`,
})

// ─── 1. Pipeline: validação ─────────────────────────────────────────────────

test('validatePipeline aceita o pipeline stub', () => {
  validatePipeline(STUB_PIPELINE)
})

test('validatePipeline rejeita agente duplicado', () => {
  const bad: PipelineDef = {
    key: 'x', label: 'x',
    steps: [{ agentKey: 'a', dependsOn: [] }, { agentKey: 'a', dependsOn: [] }],
  }
  assert.throws(() => validatePipeline(bad), /pipeline_duplicate_agent/)
})

test('validatePipeline rejeita dependência inexistente', () => {
  const bad: PipelineDef = { key: 'x', label: 'x', steps: [{ agentKey: 'a', dependsOn: ['z'] }] }
  assert.throws(() => validatePipeline(bad), /pipeline_unknown_dependency/)
})

test('validatePipeline detecta ciclo', () => {
  const bad: PipelineDef = {
    key: 'x', label: 'x',
    steps: [{ agentKey: 'a', dependsOn: ['b'] }, { agentKey: 'b', dependsOn: ['a'] }],
  }
  assert.throws(() => validatePipeline(bad), /pipeline_cycle/)
})

// ─── 2. Materialização e ordem ──────────────────────────────────────────────

test('materializeSteps gera os steps na ordem do pipeline', () => {
  const rows = materializeSteps(STUB_PIPELINE, { id: 'p1', tenant_id: 't1' })
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.agent_key), ['stub_a', 'stub_b'])
  assert.deepEqual(rows.map(r => r.step_index), [0, 1])
  assert.deepEqual(rows[1].depends_on, ['stub_a'])
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].tenant_id, 't1')
})

test('eligibleSteps só libera o passo cuja dependência concluiu', () => {
  const rows = materializeSteps(STUB_PIPELINE, { id: 'p1', tenant_id: 't1' })
    .map((r, i) => ({ ...r, id: `s${i}` })) as StepRow[]

  assert.deepEqual(eligibleSteps(rows).map(s => s.agent_key), ['stub_a'])

  rows[0].status = 'completed'
  assert.deepEqual(eligibleSteps(rows).map(s => s.agent_key), ['stub_b'])
})

// ─── 3. Início da produção ──────────────────────────────────────────────────

test('startProduction materializa steps e enfileira só o primeiro', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()

  await startProduction(store, p.id, deps(clock))

  assert.equal((await store.listSteps(p.id)).length, 2)
  assert.equal(store.jobs.length, 1, 'apenas stub_a deve estar na fila')
  assert.equal(store.productions.get(p.id)!.status, 'queued')

  const types = store.eventsOf(p.id).map(e => e.type)
  assert.deepEqual(types, ['production_created', 'agent_queued'])
})

test('startProduction é idempotente (não duplica steps nem jobs)', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()

  await startProduction(store, p.id, deps(clock))
  await startProduction(store, p.id, deps(clock))
  await startProduction(store, p.id, deps(clock))

  assert.equal((await store.listSteps(p.id)).length, 2)
  assert.equal(store.jobs.length, 1)
})

// ─── 4. Execução completa ───────────────────────────────────────────────────

test('drainQueue executa os dois passos na ordem e encerra em review', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()

  await startProduction(store, p.id, deps(clock))
  const outcomes = await drainQueue(store, 20, deps(clock))

  assert.deepEqual(outcomes.map(o => o.status), ['completed', 'completed'])
  assert.deepEqual(
    outcomes.map(o => (o.status === 'completed' ? o.agentKey : null)),
    ['stub_a', 'stub_b'],
  )

  const steps = await store.listSteps(p.id)
  assert.ok(steps.every(s => s.status === 'completed'))
  assert.equal(store.productions.get(p.id)!.status, 'review')
  assert.ok(store.jobs.every(j => j.status === 'done'))
})

test('o agente stub é determinístico e não consome nada', async () => {
  const run = async () => {
    const clock = new FakeClock()
    const store = new MemoryStore()
    const p = store.createProduction()
    await startProduction(store, p.id, deps(clock))
    await drainQueue(store, 20, deps(clock))
    return (await store.listSteps(p.id)).map(s => s.output)
  }

  const a = await run()
  const b = await run()
  assert.deepEqual(a, b, 'mesma entrada deve produzir exatamente a mesma saída')
  assert.equal(a[0]!.usage!.costCents, 0)
  assert.equal(a[0]!.usage!.inputTokens, 0)
  assert.equal(a[0]!.usage!.provider, 'none')
})

test('o segundo agente recebe a saída do primeiro como upstream', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()
  await startProduction(store, p.id, deps(clock))
  await drainQueue(store, 20, deps(clock))

  const stepB = (await store.listSteps(p.id)).find(s => s.agent_key === 'stub_b')!
  assert.deepEqual(stepB.output!.data.upstream, ['stub_a'])
})

// ─── 5. Eventos ─────────────────────────────────────────────────────────────

test('sequência de eventos é densa, única e crescente', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()
  await startProduction(store, p.id, deps(clock))
  await drainQueue(store, 20, deps(clock))

  const seqs = store.eventsOf(p.id).map(e => e.seq)
  assert.deepEqual(seqs, seqs.slice().sort((a, b) => a - b), 'deve ser crescente')
  assert.equal(new Set(seqs).size, seqs.length, 'não pode repetir')
  assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1), 'sem lacunas')
  assert.equal(store.productions.get(p.id)!.next_event_seq, seqs.length)
})

test('emissão concorrente não gera seq repetido', async () => {
  const store = new MemoryStore()
  const p = store.createProduction()

  await Promise.all(
    Array.from({ length: 200 }, () =>
      store.emitEvent({ productionId: p.id, type: 'agent_progress' }),
    ),
  )

  const seqs = store.eventsOf(p.id).map(e => e.seq)
  assert.equal(new Set(seqs).size, 200)
  assert.equal(Math.max(...seqs), 200)
})

test('a timeline registra o handoff entre os agentes', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()
  await startProduction(store, p.id, deps(clock))
  await drainQueue(store, 20, deps(clock))

  const types = store.eventsOf(p.id).map(e => e.type)
  assert.ok(types.includes('task_handoff_started'))
  assert.ok(types.includes('task_handoff_completed'))
  assert.ok(types.includes('content_waiting_approval'))

  const handoff = store.eventsOf(p.id).find(e => e.type === 'task_handoff_started')!
  assert.deepEqual(handoff.ui_hint, { from: 'stub_a', to: 'stub_b', artifact: 'folder' })
})

test('agent_progress só é emitido com progresso real e mensurável', async () => {
  const store = new MemoryStore()
  const p = store.createProduction()
  const before = store.eventsOf(p.id).length

  // Espelha a guarda do orquestrador: total <= 0 ou não-finito é descartado.
  const guard = async (completed: number, total: number) => {
    if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return
    await store.emitEvent({ productionId: p.id, type: 'agent_progress' })
  }

  await guard(1, 0)
  await guard(1, Number.NaN)
  assert.equal(store.eventsOf(p.id).length, before, 'progresso inventado não vira evento')

  await guard(2, 5)
  assert.equal(store.eventsOf(p.id).length, before + 1)
})

// ─── 6. Fila: idempotência e lock ───────────────────────────────────────────

test('dedupe_key é determinística', () => {
  assert.equal(buildDedupeKey('p', 's', 0), 'prod:p:step:s:cycle:0')
  assert.equal(buildDedupeKey('p', 's', 0), buildDedupeKey('p', 's', 0))
  assert.notEqual(buildDedupeKey('p', 's', 0), buildDedupeKey('p', 's', 1))
})

test('insertJob com dedupe_key repetida é no-op idempotente', async () => {
  const store = new MemoryStore()
  const p = store.createProduction()
  const { rows: [step] } = await store.insertSteps(materializeSteps(STUB_PIPELINE, p).slice(0, 1))

  const base = {
    tenant_id: p.tenant_id, production_id: p.id, step_id: step.id,
    dedupe_key: buildDedupeKey(p.id, step.id, 0),
    status: 'pending' as const, scheduled_for: new Date().toISOString(),
    attempt: 0, max_attempts: 3, lock_token: null, locked_until: null, error: null,
  }

  assert.ok(await store.insertJob(base))
  assert.equal(await store.insertJob(base), null)
  assert.equal(store.jobs.length, 1)
})

test('dois workers concorrentes: só um reivindica o job', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()
  await startProduction(store, p.id, deps(clock))

  const [a, b] = await Promise.all([
    store.claimNextJob(clock.now(), 'lock-A', 300),
    store.claimNextJob(clock.now(), 'lock-B', 300),
  ])

  const claimed = [a, b].filter(Boolean)
  assert.equal(claimed.length, 1, 'exatamente um worker deve vencer')
  assert.equal(store.jobs[0].status, 'running')
})

test('completeJob exige o lock_token correto (anti-zumbi)', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()
  await startProduction(store, p.id, deps(clock))

  const job = (await store.claimNextJob(clock.now(), 'lock-real', 300))!
  assert.equal(await store.completeJob(job.id, 'lock-falso'), false)
  assert.equal(store.jobs[0].status, 'running', 'lock errado não pode concluir')
  assert.equal(await store.completeJob(job.id, 'lock-real'), true)
  assert.equal(store.jobs[0].status, 'done')
})

// ─── 7. Retomada após crash ─────────────────────────────────────────────────

test('job com lock vencido volta para a fila e a produção conclui', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()
  await startProduction(store, p.id, deps(clock))

  // Simula o worker que morreu: reivindicou e nunca concluiu.
  const orphan = (await store.claimNextJob(clock.now(), 'lock-morto', 300))!
  assert.equal(store.jobs[0].status, 'running')

  // Antes do lock vencer, ninguém mais pega o job — o trabalho fica reservado.
  clock.advanceSeconds(60)
  assert.equal((await runNextJob(store, deps(clock))).status, 'idle')
  assert.equal(store.jobs.find(j => j.id === orphan.id)!.status, 'running')

  // Depois do lock vencer, o job volta para a fila.
  clock.advanceSeconds(300)
  assert.equal(await store.recoverStaleJobs(clock.now()), 1, 'lock vencido deve ser recuperado')
  assert.equal(store.jobs.find(j => j.id === orphan.id)!.status, 'pending')

  const outcomes = await drainQueue(store, 20, deps(clock))
  assert.deepEqual(outcomes.map(o => o.status), ['completed', 'completed'])
  assert.equal(store.productions.get(p.id)!.status, 'review')
})

// ─── 8. Retry e falha terminal ──────────────────────────────────────────────

test('backoff avança 1min → 5min → 15min', () => {
  assert.equal(nextRetryDelaySeconds(1), 60)
  assert.equal(nextRetryDelaySeconds(2), 300)
  assert.equal(nextRetryDelaySeconds(3), 900)
  assert.equal(nextRetryDelaySeconds(99), 900, 'satura no maior intervalo')
})

test('agente que falha: 3 tentativas com backoff e produção falha', async () => {
  let calls = 0
  __registerAgentForTests({
    ...STUB_FAILING,
    key: 'stub_a',
    run: async () => { calls++; throw new Error('falha proposital') },
  })

  try {
    const clock = new FakeClock()
    const store = new MemoryStore()
    const p = store.createProduction()
    await startProduction(store, p.id, deps(clock))

    const r1 = await runNextJob(store, deps(clock))
    assert.equal(r1.status, 'retrying')
    assert.equal(store.jobs[0].attempt, 1)

    // Não pode rodar antes da hora marcada pelo backoff.
    assert.equal((await runNextJob(store, deps(clock))).status, 'idle')

    clock.advanceSeconds(60)
    const r2 = await runNextJob(store, deps(clock))
    assert.equal(r2.status, 'retrying')
    assert.equal(store.jobs[0].attempt, 2)

    clock.advanceSeconds(300)
    const r3 = await runNextJob(store, deps(clock))
    assert.equal(r3.status, 'failed')

    assert.equal(calls, 3, 'exatamente max_attempts execuções')
    assert.equal(store.jobs[0].status, 'failed')
    assert.equal((await store.listSteps(p.id))[0].status, 'failed')
    assert.equal(store.productions.get(p.id)!.status, 'failed')

    const types = store.eventsOf(p.id).map(e => e.type)
    assert.equal(types.filter(t => t === 'agent_retrying').length, 2)
    assert.equal(types.filter(t => t === 'agent_failed').length, 1)

    // O passo seguinte nunca foi enfileirado.
    assert.equal(store.jobs.length, 1)
  } finally {
    __registerAgentForTests(STUB_A) // restaura o registry
  }
})

test('produção cancelada não executa o job', async () => {
  const clock = new FakeClock()
  const store = new MemoryStore()
  const p = store.createProduction()
  await startProduction(store, p.id, deps(clock))

  await store.updateProductionStatus(p.id, 'canceled')
  const r = await runNextJob(store, deps(clock))

  assert.equal(r.status, 'failed')
  assert.equal(store.jobs[0].status, 'failed')
})

// ─── Execução ───────────────────────────────────────────────────────────────

void main()
