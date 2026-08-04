// ============================================================================
// Content Studio — regras de admissão da demonstração
// ----------------------------------------------------------------------------
// Funções PURAS, sem banco e sem rede. Ficam separadas das Server Actions por
// um motivo prático: são a parte que decide "isto pode ser executado?", e essa
// decisão precisa ser testável sem Postgres.
//
// A pergunta que este arquivo responde: uma Server Action de DEMONSTRAÇÃO
// jamais pode ser usada para tocar uma produção REAL do Content Studio — nem
// do próprio tenant. Quando os agentes de verdade entrarem (e gastarem tokens),
// `advanceDemo` não pode virar um gatilho barato para executá-los.
// ============================================================================

import { OFFICE_PIPELINE } from './pipeline'
import type { ProductionStatus, StoredEvent } from './types'

/** Único pipeline que a demonstração aceita. */
export const DEMO_PIPELINE_KEY = OFFICE_PIPELINE.key

/**
 * Marca de demonstração.
 *
 * Fica em `brief.modo`, coluna jsonb que já existe — nenhuma migration é
 * necessária, e `brief` é gravado só pelo servidor.
 */
export const DEMO_BRIEF_MODE = 'demonstracao'

/** Um job por chamada. Fixo no servidor: o cliente não escolhe quanto executar. */
export const DEMO_MAX_JOBS_PER_CALL = 1

/** Estados a partir dos quais ainda faz sentido avançar. */
const ADVANCEABLE: readonly ProductionStatus[] = [
  'draft', 'queued', 'running', 'waiting_input',
]

/** Estados terminais: avançar não faria nada e não deve ser tentado. */
export const TERMINAL: readonly ProductionStatus[] = [
  'published', 'failed', 'canceled', 'review', 'approved',
]

export interface ProductionAdmission {
  id: string
  status: ProductionStatus
  pipeline_key: string
  brief: Record<string, unknown> | null
}

export type AdmissionResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'wrong_pipeline' | 'not_demo' | 'not_advanceable' }

/**
 * Decide se uma produção pode ser avançada pela action de demonstração.
 *
 * As três primeiras checagens são de AUTORIZAÇÃO (é mesmo uma demo?); a última
 * é de ESTADO (ainda há o que avançar?). O chamador já garantiu o tenant — aqui
 * tratamos apenas do que a posse não cobre.
 */
export function admitDemoProduction(row: ProductionAdmission | null): AdmissionResult {
  if (!row) return { ok: false, reason: 'not_found' }

  if (row.pipeline_key !== DEMO_PIPELINE_KEY) {
    return { ok: false, reason: 'wrong_pipeline' }
  }

  if (row.brief?.modo !== DEMO_BRIEF_MODE) {
    return { ok: false, reason: 'not_demo' }
  }

  if (!ADVANCEABLE.includes(row.status)) {
    return { ok: false, reason: 'not_advanceable' }
  }

  return { ok: true }
}

/** Se a produção ainda está aberta (reaproveitável em vez de criar outra). */
export function isOpenDemo(row: ProductionAdmission): boolean {
  return (
    row.pipeline_key === DEMO_PIPELINE_KEY &&
    row.brief?.modo === DEMO_BRIEF_MODE &&
    !TERMINAL.includes(row.status)
  )
}

/**
 * Eleição determinística entre demonstrações abertas concorrentes.
 *
 * Dois cliques quase simultâneos podem vencer a checagem "já existe demo
 * aberta?" ao mesmo tempo e inserir duas produções — nenhuma checagem prévia
 * resolve isso sem índice único, e não vamos criar migration aqui.
 *
 * A saída: depois de inserir, as duas chamadas releem e aplicam ESTA função.
 * Ambas chegam à mesma vencedora (mais antiga; empate desempatado pelo id), e
 * quem não venceu cancela a própria e devolve a vencedora. Convergem sem lock.
 */
export function pickWinningDemo<T extends { id: string; created_at: string }>(
  rows: T[],
): T | null {
  if (rows.length === 0) return null
  return [...rows].sort((a, b) =>
    a.created_at === b.created_at
      ? a.id.localeCompare(b.id)
      : a.created_at.localeCompare(b.created_at),
  )[0]
}

// ─── Saneamento ─────────────────────────────────────────────────────────────

/** Mensagens que o navegador pode ver. Nenhuma delas revela nada do banco. */
export const USER_MESSAGES = {
  unauthenticated: 'Sessão expirada. Entre novamente para continuar.',
  not_found: 'Demonstração não encontrada.',
  wrong_pipeline: 'Esta ação só funciona com a demonstração do Content Studio.',
  not_demo: 'Esta ação só funciona com a demonstração do Content Studio.',
  not_advanceable: 'Esta demonstração já foi concluída.',
  start_failed: 'Não foi possível iniciar a demonstração. Tente novamente.',
  read_failed: 'Não foi possível carregar a demonstração. Tente novamente.',
} as const

export type UserMessageKey = keyof typeof USER_MESSAGES

/**
 * Converte qualquer erro em texto seguro para o navegador.
 *
 * Erros do Postgres trazem nome de tabela, de constraint e trecho da query; o
 * `message` do supabase-js repassa isso inteiro. Devolver ao cliente entregaria
 * um mapa do schema a quem estiver sondando. O detalhe fica no log do servidor.
 */
export function safeUserMessage(key: UserMessageKey): string {
  return USER_MESSAGES[key]
}

/** Evento sem `tenant_id`: o navegador não precisa dele para desenhar a cena. */
export type PublicEvent = Omit<StoredEvent, 'tenant_id'>

export function toPublicEvent(event: StoredEvent): PublicEvent {
  // Desestruturação nomeando o descartado deixa explícito o que foi removido.
  const { tenant_id: _omitido, ...publico } = event
  void _omitido
  return publico
}
