// ============================================================================
// Content Studio — camada de eventos (Fase 1)
// ----------------------------------------------------------------------------
// Toda escrita passa pela função SQL cs_emit_event(), que incrementa
// next_event_seq e insere o evento na MESMA transação. Isso garante:
//   • seq único por produção (row lock na produção serializa concorrentes)
//   • tenant_id derivado do recurso persistido, nunca de parâmetro
//   • step_id validado como pertencente à produção
//
// Nada aqui conhece a interface. O `ui_hint` é opcional e ignorável.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmitEventInput, EventType, StoredEvent } from './types'

/**
 * Emite um evento e devolve o `seq` atribuído.
 * Requer client com service_role: a função é EXECUTE-restrita ao backend.
 */
export async function emitEvent(
  db: SupabaseClient,
  input: EmitEventInput,
): Promise<number> {
  const { data, error } = await db.rpc('cs_emit_event', {
    p_production_id: input.productionId,
    p_type: input.type,
    p_step_id: input.stepId ?? null,
    p_agent_key: input.agentKey ?? null,
    p_payload: input.payload ?? {},
    p_ui_hint: input.uiHint ?? null,
  })

  if (error) throw new Error(`cs_emit_event failed: ${error.message}`)
  return Number(data)
}

/**
 * Emissão que nunca derruba o fluxo principal.
 *
 * Um evento é telemetria: perder um evento é ruim, mas abortar uma produção
 * já concluída porque o log falhou é pior. Falhas são registradas no console.
 */
export async function emitEventSafe(
  db: SupabaseClient,
  input: EmitEventInput,
): Promise<number | null> {
  try {
    return await emitEvent(db, input)
  } catch (err) {
    console.error('[content-studio] falha ao emitir evento', input.type, String(err))
    return null
  }
}

/** Eventos de uma produção a partir de um `seq` (paginação da timeline/UI). */
export async function listEventsAfter(
  db: SupabaseClient,
  productionId: string,
  afterSeq = 0,
  limit = 200,
): Promise<StoredEvent[]> {
  const { data, error } = await db
    .from('cs_events')
    .select('*')
    .eq('production_id', productionId)
    .gt('seq', afterSeq)
    .order('seq', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`listEventsAfter failed: ${error.message}`)
  return (data ?? []) as StoredEvent[]
}

/** Último `seq` conhecido — ponto de retomada para clientes reconectando. */
export async function latestSeq(db: SupabaseClient, productionId: string): Promise<number> {
  const { data, error } = await db
    .from('cs_events')
    .select('seq')
    .eq('production_id', productionId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`latestSeq failed: ${error.message}`)
  return data ? Number(data.seq) : 0
}

/** Rótulos legíveis — conveniência para timeline/auditoria. */
export const EVENT_LABELS: Record<EventType, string> = {
  production_created: 'Produção criada',
  agent_queued: 'Agente na fila',
  agent_started: 'Agente iniciou',
  agent_progress: 'Progresso',
  agent_completed: 'Agente concluiu',
  agent_failed: 'Agente falhou',
  agent_waiting: 'Aguardando',
  agent_retrying: 'Tentando novamente',
  agent_reprocessed: 'Reprocessado',
  task_handoff_started: 'Entrega iniciada',
  task_handoff_completed: 'Entrega concluída',
  content_waiting_approval: 'Aguardando aprovação',
  content_approved: 'Conteúdo aprovado',
  content_rejected: 'Conteúdo rejeitado',
  publication_scheduled: 'Publicação agendada',
  publication_started: 'Publicação iniciada',
  publication_completed: 'Publicado',
  publication_failed: 'Falha na publicação',
}
