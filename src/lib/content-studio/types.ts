// ============================================================================
// Content Studio — tipos e contratos (Fase 1)
// ----------------------------------------------------------------------------
// Sem dependências de runtime: este arquivo é importável por qualquer camada
// (backend, testes, futura UI) sem puxar Supabase junto.
// ============================================================================

// ─── Estados ────────────────────────────────────────────────────────────────

/** Estado de uma produção de conteúdo (espelha o CHECK de cs_productions). */
export type ProductionStatus =
  | 'draft' | 'queued' | 'running' | 'waiting_input' | 'review'
  | 'awaiting_approval' | 'approved' | 'scheduled' | 'publishing'
  | 'published' | 'failed' | 'canceled'

/** Estado de um passo (espelha o CHECK de cs_steps). */
export type StepStatus =
  | 'pending' | 'queued' | 'running' | 'waiting'
  | 'completed' | 'failed' | 'skipped' | 'stale' | 'retrying'

/** Estado de um job na fila (espelha o CHECK de cs_jobs). */
export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'canceled'

/** Estados terminais: produção não avança mais sozinha. */
export const TERMINAL_PRODUCTION_STATUS: readonly ProductionStatus[] =
  ['published', 'failed', 'canceled'] as const

// ─── Eventos ────────────────────────────────────────────────────────────────

/**
 * Tipos de evento. Contrato estável e versionado — qualquer interface (painel,
 * timeline, AI Operations Center) lê daqui. O backend NUNCA depende da UI.
 */
export type EventType =
  | 'production_created'
  | 'agent_queued' | 'agent_started' | 'agent_progress' | 'agent_completed'
  | 'agent_failed' | 'agent_waiting' | 'agent_retrying' | 'agent_reprocessed'
  | 'task_handoff_started' | 'task_handoff_completed'
  | 'content_waiting_approval' | 'content_approved' | 'content_rejected'
  | 'publication_scheduled' | 'publication_started'
  | 'publication_completed' | 'publication_failed'

export const EVENT_SCHEMA_VERSION = 1

/**
 * Dica opcional para interfaces animadas. É *hint*: ignorar por completo não
 * pode alterar o comportamento do backend nem a leitura da timeline.
 */
export interface EventUiHint {
  from?: string
  to?: string
  artifact?: 'folder' | 'image' | 'document' | 'link'
}

export interface EmitEventInput {
  productionId: string
  type: EventType
  stepId?: string | null
  agentKey?: string | null
  payload?: Record<string, unknown>
  uiHint?: EventUiHint | null
}

export interface StoredEvent {
  id: string
  tenant_id: string
  production_id: string
  step_id: string | null
  agent_key: string | null
  type: EventType
  schema_version: number
  seq: number
  payload: Record<string, unknown>
  ui_hint: EventUiHint | null
  occurred_at: string
}

// ─── Registros persistidos ──────────────────────────────────────────────────

export interface ProductionRow {
  id: string
  tenant_id: string
  pipeline_key: string
  title: string | null
  brief: Record<string, unknown>
  status: ProductionStatus
  next_event_seq: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface StepRow {
  id: string
  production_id: string
  tenant_id: string
  agent_key: string
  step_index: number
  depends_on: string[]
  status: StepStatus
  input: Record<string, unknown> | null
  output: AgentOutput | null
  attempt: number
  error: string | null
  started_at: string | null
  completed_at: string | null
}

export interface JobRow {
  id: string
  tenant_id: string
  production_id: string
  step_id: string
  dedupe_key: string
  status: JobStatus
  scheduled_for: string
  attempt: number
  max_attempts: number
  lock_token: string | null
  locked_until: string | null
  error: string | null
}

// ─── Contrato dos agentes ───────────────────────────────────────────────────

export interface AgentEnvelope {
  productionId: string
  stepId: string
  agentKey: string
  tenantId: string
  attempt: number
  idempotencyKey: string
}

export interface AgentInput {
  envelope: AgentEnvelope
  /** Briefing original da produção. */
  brief: Record<string, unknown>
  /** Saídas dos steps dos quais este depende, indexadas por agent_key. */
  upstream: Record<string, AgentOutput>
}

export interface AgentUsage {
  provider?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  imagesGenerated?: number
  costCents?: number
}

export interface AgentArtifact {
  kind: 'image' | 'document' | 'link'
  storagePath?: string
  url?: string
  meta?: Record<string, unknown>
}

export interface AgentOutput {
  /** Dados produzidos pelo agente — formato específico de cada um. */
  data: Record<string, unknown>
  artifacts?: AgentArtifact[]
  usage?: AgentUsage
  /** Sugestão de reprocessamento (ex.: revisor pedindo refazer o copy). */
  nextHint?: { suggestRevise?: string[] }
}

/** Progresso REAL e mensurável. Nunca inventar percentual para animação. */
export interface AgentProgress {
  /** Unidades concluídas de um total conhecido (ex.: 2 de 5 imagens). */
  completed: number
  total: number
  label?: string
}

export interface AgentContext {
  /** Só deve ser chamado quando houver progresso real e mensurável. */
  reportProgress?: (p: AgentProgress) => Promise<void>
  signal?: AbortSignal
}

export interface AgentDefinition {
  key: string
  version: number
  label: string
  /** Valida a entrada; lançar erro aborta o step com falha explícita. */
  validateInput?: (input: AgentInput) => void
  run: (input: AgentInput, ctx: AgentContext) => Promise<AgentOutput>
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

export interface PipelineStepDef {
  agentKey: string
  /** agent_keys dos quais este passo depende. */
  dependsOn: string[]
  /** Passo de aprovação humana: não executa agente, aguarda decisão. */
  humanGate?: boolean
}

export interface PipelineDef {
  key: string
  label: string
  steps: PipelineStepDef[]
}

// ─── Porta de persistência ──────────────────────────────────────────────────

/**
 * Abstração mínima de armazenamento usada pelo orquestrador.
 *
 * Existe para que a lógica de orquestração seja testável sem banco: em produção
 * a implementação fala com Supabase (service_role); nos testes, um store em
 * memória. O orquestrador não conhece Supabase.
 */
export interface ContentStore {
  getProduction(productionId: string): Promise<ProductionRow | null>
  updateProductionStatus(productionId: string, status: ProductionStatus): Promise<void>

  listSteps(productionId: string): Promise<StepRow[]>
  insertSteps(steps: Omit<StepRow, 'id'>[]): Promise<StepRow[]>
  updateStep(stepId: string, patch: Partial<StepRow>): Promise<void>

  insertJob(job: Omit<JobRow, 'id'>): Promise<JobRow | null>
  /** Reivindica UM job vencido de forma atômica (nenhum outro worker o pega). */
  claimNextJob(now: Date, lockToken: string, lockSeconds: number): Promise<JobRow | null>
  completeJob(jobId: string, lockToken: string): Promise<boolean>
  /**
   * Falha um job. Com `retryAt`, a implementação DEVE reagendar a MESMA linha
   * incrementando `attempt` — é o incremento que faz o backoff avançar e o
   * retry terminar. Sem `retryAt`, o job é marcado como 'failed' (terminal).
   */
  failJob(jobId: string, lockToken: string, error: string, retryAt: Date | null): Promise<void>
  /** Devolve à fila os jobs cujo lock venceu (recuperação de crash). */
  recoverStaleJobs(now: Date): Promise<number>

  emitEvent(input: EmitEventInput): Promise<number>
}

// ─── Utilidades de contrato ─────────────────────────────────────────────────

/**
 * Chave de idempotência de um job, determinística por (produção, step, ciclo).
 *
 * `cycle` é 0 no enfileiramento normal — as retentativas reaproveitam a MESMA
 * linha (incrementando `attempt`), então não geram chave nova. Valores > 0
 * ficam reservados para reprocessamento explícito de um step já concluído,
 * que precisa de um job novo sem colidir com o histórico.
 */
export function buildDedupeKey(productionId: string, stepId: string, cycle: number): string {
  return `prod:${productionId}:step:${stepId}:cycle:${cycle}`
}

/** Backoff: 1min → 5min → 15min. */
export const RETRY_BACKOFF_SECONDS = [60, 300, 900] as const

/** Espera antes da tentativa `attempt` (1 = primeira retentativa). */
export function nextRetryDelaySeconds(attempt: number): number {
  const i = Math.max(0, Math.min(attempt - 1, RETRY_BACKOFF_SECONDS.length - 1))
  return RETRY_BACKOFF_SECONDS[i]
}
