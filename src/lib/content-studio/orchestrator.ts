// ============================================================================
// Content Studio — orquestrador (Fase 1)
// ----------------------------------------------------------------------------
// O orquestrador é CÓDIGO DETERMINÍSTICO, não um LLM. Ele decide o que roda,
// quando roda e o que fazer quando falha. Os agentes são plugáveis e cegos: um
// agente nunca chama outro — a passagem de bastão é dado (`upstream`) + evento.
//
// Não conhece Supabase: fala com a porta `ContentStore`. É isso que permite
// testar fila, lock, retry e retomada em memória, sem tocar em banco.
//
// Fase 1 não expõe rota HTTP: nada aqui é acionado automaticamente.
// ============================================================================

import { getAgent } from './agents/registry'
import { eligibleSteps, getPipeline, materializeSteps } from './pipeline'
import {
  agentErrorEventPayload,
  buildDedupeKey,
  isFatalAgentError,
  nextRetryDelaySeconds,
  readRevisionCycle,
  DEFAULT_FINAL_EVENT,
  DEFAULT_FINAL_STATUS,
  type AgentContext,
  type AgentInput,
  type AgentOutput,
  type AgentProgress,
  type ContentStore,
  type JobRow,
  type PipelineDef,
  type ProductionRow,
  type StepRow,
} from './types'

export const ORCHESTRATOR_LOCK_SECONDS = 300 // 5 min
export const ORCHESTRATOR_MAX_ATTEMPTS = 3

/** Injeção de relógio/token/UUID — os testes precisam de execução reprodutível. */
export interface OrchestratorDeps {
  now?: () => Date
  newLockToken?: () => string
}

function resolveDeps(deps: OrchestratorDeps = {}) {
  return {
    now: deps.now ?? (() => new Date()),
    newLockToken: deps.newLockToken ?? (() => crypto.randomUUID()),
  }
}

// ─── Início da produção ─────────────────────────────────────────────────────

/**
 * Materializa os steps do pipeline e enfileira o que já pode rodar.
 *
 * Idempotente: chamar duas vezes na mesma produção não duplica steps nem jobs
 * (os steps só são inseridos se ainda não existirem; os jobs são protegidos
 * pelo dedupe_key e pelo índice de "um job ativo por step").
 */
export async function startProduction(
  store: ContentStore,
  productionId: string,
  deps: OrchestratorDeps = {},
): Promise<StepRow[]> {
  const clock = resolveDeps(deps)

  const production = await store.getProduction(productionId)
  if (!production) throw new Error(`production_not_found: ${productionId}`)

  if (production.status === 'canceled' || production.status === 'failed') {
    throw new Error(`production_not_startable: status=${production.status}`)
  }

  const pipeline = getPipeline(production.pipeline_key)

  let steps = await store.listSteps(productionId)
  if (steps.length === 0) {
    const resultado = await store.insertSteps(materializeSteps(pipeline, production))
    steps = resultado.rows
    // Só quem venceu o índice único anuncia a criação. Duas chamadas
    // concorrentes chegam aqui, mas apenas uma inseriu de fato.
    if (resultado.inserted) {
      await store.emitEvent({
        productionId,
        type: 'production_created',
        payload: { pipeline_key: pipeline.key, steps: steps.length },
      })
    }
  }

  if (production.status === 'draft') {
    await store.updateProductionStatus(productionId, 'queued')
  }

  await enqueueEligible(store, production, steps, clock.now())
  return steps
}

// ─── Execução de um job ─────────────────────────────────────────────────────

export type RunOutcome =
  | { status: 'idle' }
  | { status: 'completed'; job: JobRow; stepId: string; agentKey: string }
  | { status: 'retrying'; job: JobRow; stepId: string; agentKey: string; error: string }
  | { status: 'failed'; job: JobRow; stepId: string; agentKey: string; error: string }

/**
 * Reivindica e executa UM job.
 *
 * Ordem importa: recuperar locks vencidos ANTES de reivindicar é o que torna a
 * execução retomável — um worker que morreu no meio deixa o job 'running' com
 * lock vencido, e ele volta para a fila em vez de ficar preso para sempre.
 */
export async function runNextJob(
  store: ContentStore,
  deps: OrchestratorDeps = {},
): Promise<RunOutcome> {
  const clock = resolveDeps(deps)
  const now = clock.now()

  await store.recoverStaleJobs(now)

  const lockToken = clock.newLockToken()
  const job = await store.claimNextJob(now, lockToken, ORCHESTRATOR_LOCK_SECONDS)
  if (!job) return { status: 'idle' }

  const production = await store.getProduction(job.production_id)
  if (!production) {
    await store.failJob(job.id, lockToken, 'produção inexistente', null)
    return {
      status: 'failed', job, stepId: job.step_id, agentKey: '',
      error: 'produção inexistente',
    }
  }

  const steps = await store.listSteps(job.production_id)
  const step = steps.find(s => s.id === job.step_id)
  if (!step) {
    await store.failJob(job.id, lockToken, 'step inexistente', null)
    return {
      status: 'failed', job, stepId: job.step_id, agentKey: '',
      error: 'step inexistente',
    }
  }

  // Produção pausada/cancelada não executa: o job é encerrado sem efeito.
  if (production.status === 'canceled') {
    await store.failJob(job.id, lockToken, 'produção cancelada', null)
    return {
      status: 'failed', job, stepId: step.id, agentKey: step.agent_key,
      error: 'produção cancelada',
    }
  }

  await store.updateStep(step.id, {
    status: 'running',
    attempt: job.attempt,
    started_at: now.toISOString(),
    error: null,
  })
  if (production.status !== 'running') {
    await store.updateProductionStatus(production.id, 'running')
  }
  await store.emitEvent({
    productionId: production.id,
    type: 'agent_started',
    stepId: step.id,
    agentKey: step.agent_key,
    payload: { attempt: job.attempt },
  })

  try {
    const agent = getAgent(step.agent_key)
    const input = buildAgentInput(production, step, steps, job)
    agent.validateInput?.(input)

    const output = await agent.run(input, makeContext(store, production, step))

    await store.updateStep(step.id, {
      status: 'completed',
      output,
      error: null,
      completed_at: clock.now().toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_completed',
      stepId: step.id,
      agentKey: step.agent_key,
      payload: { usage: output.usage ?? null, artifacts: output.artifacts?.length ?? 0 },
    })
    await store.completeJob(job.id, lockToken)

    await advanceProduction(store, production, step.agent_key, clock.now())
    return { status: 'completed', job, stepId: step.id, agentKey: step.agent_key }
  } catch (err) {
    // O ERRO ORIGINAL segue inteiro até a decisão de retry — convertê-lo em
    // string aqui foi o que fez o canário reagendar um HTTP 400 fatal.
    return await handleFailure(store, production, step, job, lockToken, err, clock.now())
  }
}

/** Drena a fila até esvaziar (ou até `max` jobs). Usado pelo tick e pelos testes. */
export async function drainQueue(
  store: ContentStore,
  max = 50,
  deps: OrchestratorDeps = {},
): Promise<RunOutcome[]> {
  const out: RunOutcome[] = []
  for (let i = 0; i < max; i++) {
    const result = await runNextJob(store, deps)
    if (result.status === 'idle') break
    out.push(result)
  }
  return out
}

// ─── Internos ───────────────────────────────────────────────────────────────

function buildAgentInput(
  production: ProductionRow,
  step: StepRow,
  steps: StepRow[],
  job: JobRow,
): AgentInput {
  // O agente enxerga SÓ as saídas dos steps de que ele depende. Restringir o
  // contexto é o que impede acoplamento acidental entre agentes.
  const upstream: Record<string, AgentOutput> = {}
  for (const dep of step.depends_on) {
    const source = steps.find(s => s.agent_key === dep)
    if (source?.output) upstream[dep] = source.output
  }

  return {
    envelope: {
      productionId: production.id,
      stepId: step.id,
      agentKey: step.agent_key,
      tenantId: production.tenant_id,
      attempt: job.attempt,
      // Determinística: reexecutar a mesma tentativa produz a mesma chave, o
      // que permite ao agente deduplicar efeitos externos no futuro.
      idempotencyKey: buildDedupeKey(production.id, step.id, job.attempt),
    },
    brief: production.brief,
    upstream,
    // Só o que o ORQUESTRADOR gravou. O cliente nunca escreve em cs_steps.
    stepInput: step.input ?? null,
  }
}

function makeContext(
  store: ContentStore,
  production: ProductionRow,
  step: StepRow,
): AgentContext {
  return {
    // Só emite se houver progresso REAL e mensurável. O orquestrador não
    // fabrica percentual: se o agente não souber o total, não há evento.
    reportProgress: async (p: AgentProgress) => {
      if (!Number.isFinite(p.completed) || !Number.isFinite(p.total) || p.total <= 0) return
      await store.emitEvent({
        productionId: production.id,
        type: 'agent_progress',
        stepId: step.id,
        agentKey: step.agent_key,
        payload: { completed: p.completed, total: p.total, label: p.label ?? null },
      })
    },
  }
}

async function handleFailure(
  store: ContentStore,
  production: ProductionRow,
  step: StepRow,
  job: JobRow,
  lockToken: string,
  err: unknown,
  now: Date,
): Promise<RunOutcome> {
  const message = err instanceof Error ? err.message : String(err)
  // Campos SEGUROS para os eventos (error_code, http_status, error.type) —
  // nunca a mensagem bruta do provedor.
  const extras = agentErrorEventPayload(err)
  // Erro de IA ESTRUTURADO (tem error_code): o evento carrega SÓ os campos
  // seguros, sem `error` textual. Erro genérico (validação de agente, bug):
  // mantém a mensagem interna — ela nasce no nosso código, não no provedor.
  const payloadErro = 'error_code' in extras ? extras : { error: message, ...extras }

  const nextAttempt = job.attempt + 1
  // FATAL não reagenda: 400/401/403/404, modelo/config inválidos, refusal e
  // término inesperado não mudam com o tempo — reagendar só repetiria a
  // chamada (e o custo) para falhar igual. Foi o defeito do canário: o job
  // criou agent_retrying para um 400 que o provider já sabia ser fatal.
  const willRetry = nextAttempt < job.max_attempts && !isFatalAgentError(err)

  if (willRetry) {
    const retryAt = new Date(now.getTime() + nextRetryDelaySeconds(nextAttempt) * 1000)
    await store.failJob(job.id, lockToken, message, retryAt)
    await store.updateStep(step.id, { status: 'retrying', error: message })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_retrying',
      stepId: step.id,
      agentKey: step.agent_key,
      payload: { attempt: nextAttempt, retry_at: retryAt.toISOString(), ...payloadErro },
    })
    return { status: 'retrying', job, stepId: step.id, agentKey: step.agent_key, error: message }
  }

  await store.failJob(job.id, lockToken, message, null)
  await store.updateStep(step.id, { status: 'failed', error: message, completed_at: now.toISOString() })
  await store.emitEvent({
    productionId: production.id,
    type: 'agent_failed',
    stepId: step.id,
    agentKey: step.agent_key,
    payload: { attempt: job.attempt, ...payloadErro },
  })
  // Um step esgotado trava o pipeline: a produção falha por inteiro em vez de
  // ficar "rodando" para sempre sem nenhum job na fila.
  await store.updateProductionStatus(production.id, 'failed')
  return { status: 'failed', job, stepId: step.id, agentKey: step.agent_key, error: message }
}

/** Enfileira todos os steps elegíveis. `fromAgentKey` só enriquece o evento de handoff. */
async function enqueueEligible(
  store: ContentStore,
  production: ProductionRow,
  steps: StepRow[],
  now: Date,
  fromAgentKey?: string,
): Promise<number> {
  let enqueued = 0

  for (const step of eligibleSteps(steps)) {
    // O ciclo entra na chave: depois de uma revisão, o step precisa de um job
    // NOVO. Com a chave fixa em 0, o dedupe da primeira execução barraria o
    // reenfileiramento e o pipeline pararia sem ninguém na fila.
    const ciclo = readRevisionCycle(step.input)
    const job = await store.insertJob({
      tenant_id: production.tenant_id,
      production_id: production.id,
      step_id: step.id,
      dedupe_key: buildDedupeKey(production.id, step.id, ciclo),
      status: 'pending',
      scheduled_for: now.toISOString(),
      attempt: 0,
      max_attempts: ORCHESTRATOR_MAX_ATTEMPTS,
      lock_token: null,
      locked_until: null,
      error: null,
    })

    // null = já havia job para este step (dedupe). Idempotente: segue adiante.
    if (!job) continue
    enqueued++

    await store.updateStep(step.id, { status: 'queued' })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_queued',
      stepId: step.id,
      agentKey: step.agent_key,
      payload: { step_index: step.step_index },
    })

    if (fromAgentKey) {
      await store.emitEvent({
        productionId: production.id,
        type: 'task_handoff_started',
        stepId: step.id,
        agentKey: step.agent_key,
        payload: { from: fromAgentKey, to: step.agent_key },
        uiHint: { from: fromAgentKey, to: step.agent_key, artifact: 'folder' },
      })
    }
  }

  return enqueued
}

/**
 * Revisão automática — no máximo `maxAutoRevisions` por step.
 *
 * O revisor pede a reescrita devolvendo `nextHint.suggestRevise`. Quem decide
 * se ela acontece é ESTA função, não ele: um agente que pudesse se auto-agendar
 * seria um laço infinito com passos extras.
 *
 * O contador vive em `cs_steps.input.revision_cycle`, do próprio step revisado.
 * Ler dos eventos exigiria que o orquestrador dependesse da timeline para
 * decidir — e a timeline é saída, não entrada.
 *
 * Estourado o teto, a produção FALHA com mensagem segura em vez de girar.
 */
async function maybeAutoRevise(
  store: ContentStore,
  production: ProductionRow,
  pipeline: PipelineDef,
  steps: StepRow[],
  completedAgentKey: string,
  now: Date,
): Promise<boolean> {
  const teto = pipeline.maxAutoRevisions ?? 0
  if (teto <= 0) return false

  const revisor = steps.find(s => s.agent_key === completedAgentKey)
  const pedidos = revisor?.output?.nextHint?.suggestRevise ?? []
  if (pedidos.length === 0) return false

  let algumReenfileirado = false

  for (const alvoKey of pedidos) {
    const alvo = steps.find(s => s.agent_key === alvoKey)
    if (!alvo || alvo.status !== 'completed') continue

    const ciclo = readRevisionCycle(alvo.input)
    if (ciclo >= teto) {
      // Teto estourado: parar é o comportamento correto. Continuar seria
      // reprocessar para sempre com o mesmo resultado.
      await store.updateStep(revisor!.id, {
        status: 'failed',
        error: 'revisao_nao_aprovada',
      })
      await store.emitEvent({
        productionId: production.id,
        type: 'agent_failed',
        stepId: revisor!.id,
        agentKey: completedAgentKey,
        payload: {
          error: 'revisao_nao_aprovada',
          revision_cycle: ciclo,
          max_auto_revisions: teto,
        },
      })
      await store.updateProductionStatus(production.id, 'failed')
      return true
    }

    const proximo = ciclo + 1
    // Instruções ESTRUTURADAS do revisor (2B) com fallback nos avisos (2A), e
    // a versão anterior do texto — o copywriter corrige, não reescreve do zero.
    const dadosRevisor = revisor?.output?.data as Record<string, unknown> | undefined
    const instrucoes = Array.isArray(dadosRevisor?.revision_instructions)
      ? (dadosRevisor.revision_instructions as string[])
      : Array.isArray(dadosRevisor?.avisos) ? (dadosRevisor.avisos as string[]) : []
    const anterior = alvo.output?.data ?? null
    await store.updateStep(alvo.id, {
      status: 'pending',
      output: null,
      error: null,
      completed_at: null,
      input: {
        revision_cycle: proximo,
        revision_notes: instrucoes.slice(0, 10),
        previous_copy: anterior,
      },
    })

    // Ciclo > 0 na dedupe_key: job NOVO, sem colidir com o histórico. É para
    // isto que `cycle` existia desde a Fase 1.
    const job = await store.insertJob({
      tenant_id: production.tenant_id,
      production_id: production.id,
      step_id: alvo.id,
      dedupe_key: buildDedupeKey(production.id, alvo.id, proximo),
      status: 'pending',
      scheduled_for: now.toISOString(),
      attempt: 0,
      max_attempts: ORCHESTRATOR_MAX_ATTEMPTS,
      lock_token: null,
      locked_until: null,
      error: null,
    })
    if (!job) continue

    algumReenfileirado = true
    await store.updateStep(alvo.id, { status: 'queued' })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_reprocessed',
      stepId: alvo.id,
      agentKey: alvo.agent_key,
      payload: { revision_cycle: proximo, requested_by: completedAgentKey },
    })

    // O revisor volta a pendente: ele precisa reavaliar o texto reescrito.
    // O revisor volta a pendente para reavaliar o texto reescrito — e leva o
    // MESMO ciclo, senão o dedupe da primeira avaliação barraria a segunda.
    const revisorStep = steps.find(s => s.agent_key === completedAgentKey)
    if (revisorStep) {
      await store.updateStep(revisorStep.id, {
        status: 'pending', output: null, error: null, completed_at: null,
        input: { revision_cycle: proximo },
      })
    }
  }

  return algumReenfileirado
}

/**
 * Decide o que acontece depois que um step conclui.
 *
 * Três desfechos possíveis, e nenhum outro:
 *   • há step elegível         -> enfileira (handoff)
 *   • todos concluídos         -> produção vai para 'review'
 *   • nada elegível e faltando -> 'waiting_input' (só ocorre com human gate)
 */
async function advanceProduction(
  store: ContentStore,
  production: ProductionRow,
  completedAgentKey: string,
  now: Date,
): Promise<void> {
  const pipeline = getPipeline(production.pipeline_key)
  let steps = await store.listSteps(production.id)

  // Revisão automática pedida pelo agente que acabou de concluir.
  const revisou = await maybeAutoRevise(store, production, pipeline, steps, completedAgentKey, now)
  if (revisou) return

  const enqueued = await enqueueEligible(store, production, steps, now, completedAgentKey)
  if (enqueued > 0) {
    await store.emitEvent({
      productionId: production.id,
      type: 'task_handoff_completed',
      agentKey: completedAgentKey,
      payload: { handed_to: enqueued },
    })
    return
  }

  steps = await store.listSteps(production.id)
  const pending = steps.filter(
    s => s.status !== 'completed' && s.status !== 'skipped' && s.status !== 'failed',
  )

  if (pending.length === 0) {
    // Encerramento declarado pelo pipeline. Sem declaração, 'review' — que é
    // exatamente o que a Fase 1 fazia, e continua fazendo.
    const finalStatus = pipeline.finalStatus ?? DEFAULT_FINAL_STATUS
    await store.updateProductionStatus(production.id, finalStatus)
    await store.emitEvent({
      productionId: production.id,
      type: pipeline.finalEvent ?? DEFAULT_FINAL_EVENT,
      payload: { steps: steps.length, final_status: finalStatus },
    })
    return
  }

  await store.updateProductionStatus(production.id, 'waiting_input')
  await store.emitEvent({
    productionId: production.id,
    type: 'agent_waiting',
    payload: { blocked: pending.map(s => s.agent_key) },
  })
}
