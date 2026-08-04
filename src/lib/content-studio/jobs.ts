// ============================================================================
// Content Studio — fila própria (cs_jobs)
// ----------------------------------------------------------------------------
// Fila SEPARADA de queue_jobs, de propósito: o processador dos funis
// (/api/queue/process) varre todos os jobs 'pending' sem filtro de tipo e
// marcaria um job de conteúdo como 'done' sem executá-lo — perda silenciosa.
//
// Garantias:
//   • idempotência  -> dedupe_key único por (produção, step, tentativa)
//   • exclusividade -> índice parcial: um job ativo por step
//   • lock          -> lock_token + locked_until; conclusão exige o mesmo token
//   • recuperação   -> jobs com lock vencido voltam para 'pending'
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildDedupeKey, nextRetryDelaySeconds, type JobRow } from './types'

export const DEFAULT_LOCK_SECONDS = 300 // 5 min
export const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Enfileira um step.
 *
 * Colisão de dedupe_key (23505) significa "já enfileirado" — retorna null e
 * segue. Enfileirar duas vezes o mesmo trabalho nunca gera execução dupla.
 */
export async function enqueueStep(
  db: SupabaseClient,
  params: {
    tenantId: string
    productionId: string
    stepId: string
    /** 0 no fluxo normal; > 0 apenas em reprocessamento explícito. */
    cycle: number
    scheduledFor?: Date
    maxAttempts?: number
  },
): Promise<JobRow | null> {
  const dedupeKey = buildDedupeKey(params.productionId, params.stepId, params.cycle)

  const { data, error } = await db
    .from('cs_jobs')
    .insert({
      tenant_id: params.tenantId,
      production_id: params.productionId,
      step_id: params.stepId,
      dedupe_key: dedupeKey,
      status: 'pending',
      scheduled_for: (params.scheduledFor ?? new Date()).toISOString(),
      attempt: 0,
      max_attempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    })
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') return null // já existe: idempotente
    throw new Error(`enqueueStep failed: ${error.message}`)
  }
  return data as JobRow
}

/**
 * Reivindica um job vencido de forma atômica.
 *
 * A condição `.eq('status','pending')` no UPDATE é o que garante exclusão mútua:
 * dois workers competindo pelo mesmo id — só um encontra a linha ainda
 * 'pending', o outro recebe 0 linhas e tenta o próximo.
 */
export async function claimNextJob(
  db: SupabaseClient,
  lockToken: string,
  opts: { now?: Date; lockSeconds?: number; maxScan?: number } = {},
): Promise<JobRow | null> {
  const now = opts.now ?? new Date()
  const lockSeconds = opts.lockSeconds ?? DEFAULT_LOCK_SECONDS
  const maxScan = opts.maxScan ?? 5

  const { data: candidates, error } = await db
    .from('cs_jobs')
    .select('id')
    .eq('status', 'pending')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(maxScan)

  if (error) throw new Error(`claimNextJob (scan) failed: ${error.message}`)
  if (!candidates || candidates.length === 0) return null

  for (const c of candidates) {
    const { data: claimed, error: claimErr } = await db
      .from('cs_jobs')
      .update({
        status: 'running',
        lock_token: lockToken,
        locked_until: new Date(now.getTime() + lockSeconds * 1000).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', c.id)
      .eq('status', 'pending')   // <- só vence quem chegar primeiro
      .select('*')
      .maybeSingle()

    if (claimErr) throw new Error(`claimNextJob (claim) failed: ${claimErr.message}`)
    if (claimed) return claimed as JobRow
  }
  return null // todos foram tomados por outro worker
}

/** Conclui um job. Só tem efeito se o lock ainda for nosso (anti-zumbi). */
export async function completeJob(
  db: SupabaseClient,
  jobId: string,
  lockToken: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('cs_jobs')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('lock_token', lockToken)
    .eq('status', 'running')
    .select('id')
    .maybeSingle()

  if (error) throw new Error(`completeJob failed: ${error.message}`)
  return !!data
}

/**
 * Falha um job. Havendo tentativas restantes, reagenda com backoff
 * (1min → 5min → 15min); caso contrário marca como 'failed'.
 * Retorna se ainda haverá nova tentativa.
 */
export async function failJob(
  db: SupabaseClient,
  job: JobRow,
  lockToken: string,
  errorMessage: string,
  now = new Date(),
): Promise<{ willRetry: boolean }> {
  // attempt é 0-based: com max_attempts=3 executamos as tentativas 0, 1 e 2.
  const willRetry = job.attempt + 1 < job.max_attempts

  if (!willRetry) {
    const { error } = await db
      .from('cs_jobs')
      .update({
        status: 'failed',
        error: errorMessage.slice(0, 2000),
        lock_token: null,
        locked_until: null,
        updated_at: now.toISOString(),
      })
      .eq('id', job.id)
      .eq('lock_token', lockToken)
    if (error) throw new Error(`failJob failed: ${error.message}`)
    return { willRetry: false }
  }

  // attempt PRECISA subir aqui: é ele que faz o backoff avançar e o retry
  // terminar. Reagendar sem incrementar geraria tentativas infinitas.
  const nextAttempt = job.attempt + 1
  const delay = nextRetryDelaySeconds(nextAttempt)
  const { error } = await db
    .from('cs_jobs')
    .update({
      status: 'pending',
      attempt: nextAttempt,
      error: errorMessage.slice(0, 2000),
      lock_token: null,
      locked_until: null,
      scheduled_for: new Date(now.getTime() + delay * 1000).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', job.id)
    .eq('lock_token', lockToken)

  if (error) throw new Error(`failJob (retry) failed: ${error.message}`)
  return { willRetry: true }
}

/**
 * Recupera jobs órfãos: 'running' com lock vencido (processo morreu no meio).
 * É o que torna a execução retomável após crash/timeout.
 */
export async function recoverStaleJobs(db: SupabaseClient, now = new Date()): Promise<number> {
  const { data, error } = await db
    .from('cs_jobs')
    .update({
      status: 'pending',
      lock_token: null,
      locked_until: null,
      error: 'lock expirado — job recuperado',
      updated_at: now.toISOString(),
    })
    .eq('status', 'running')
    .lt('locked_until', now.toISOString())
    .select('id')

  if (error) throw new Error(`recoverStaleJobs failed: ${error.message}`)
  return data?.length ?? 0
}

/** Cancela jobs abertos de uma produção (usado no cancelamento lógico). */
export async function cancelJobsForProduction(
  db: SupabaseClient,
  productionId: string,
): Promise<number> {
  const { data, error } = await db
    .from('cs_jobs')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('production_id', productionId)
    .in('status', ['pending', 'running'])
    .select('id')

  if (error) throw new Error(`cancelJobsForProduction failed: ${error.message}`)
  return data?.length ?? 0
}
