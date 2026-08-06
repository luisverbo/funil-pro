// ============================================================================
// Content Studio — regras de admissão da PRODUÇÃO REAL (Fase 2A)
// ----------------------------------------------------------------------------
// Espelha `demo-guard`, e o espelhamento é o ponto: são dois portões separados,
// não um portão com um `if`.
//
// A demonstração é barata e descartável; a produção real consome o briefing do
// usuário e, na Fase 2B, vai consumir IA paga. Se a mesma action servisse às
// duas, um cliente poderia chamar "avançar demonstração" apontando para uma
// produção real e disparar trabalho de verdade por um caminho que foi projetado
// para ser gratuito.
//
// Aqui a checagem é a inversa da demo: `pipeline_key` PRECISA ser de produção e
// o `brief.modo` de demonstração é motivo de RECUSA.
//
// Puro: sem banco, sem rede. A decisão "isto pode ser executado?" é testável
// sem Postgres.
// ============================================================================

import { CAROUSEL_AI_PIPELINE, CAROUSEL_PIPELINE, QUICK_PIPELINE, STUDIO_PIPELINE } from './pipeline'
import { DEMO_BRIEF_MODE } from './demo-guard'
import type { ProductionStatus } from './types'

/**
 * Pipelines aceitos pela produção real. Lista branca, nunca "tudo menos demo".
 *
 * As DUAS gerações são produções válidas do tenant: a determinística (2A) e a
 * de IA (2B). A identidade persistida diz sozinha o que cada uma é:
 *   content_carousel_v1    = geração determinística da Fase 2A (agentes cc_*)
 *   content_carousel_ai_v1 = geração com IA da Fase 2B (agentes cc_ai_*)
 */
export const PRODUCTION_PIPELINE_KEYS: readonly string[] = [
  CAROUSEL_PIPELINE.key,
  CAROUSEL_AI_PIPELINE.key,
  QUICK_PIPELINE.key,
  STUDIO_PIPELINE.key,
]

/**
 * Este pipeline executa agentes de IA?
 *
 * Decide se `advanceProduction` exige o preflight de IA. O pipeline antigo NÃO
 * exige: uma produção determinística incompleta conclui normalmente mesmo com
 * CONTENT_AI_ENABLED desligado e sem ANTHROPIC_API_KEY.
 */
export function pipelineRequiresAI(pipelineKey: string): boolean {
  return (
    pipelineKey === CAROUSEL_AI_PIPELINE.key ||
    pipelineKey === QUICK_PIPELINE.key ||
    pipelineKey === STUDIO_PIPELINE.key
  )
}

/** Um job por chamada. Fixo no servidor: o cliente não escolhe quanto executar. */
export const PRODUCTION_MAX_JOBS_PER_CALL = 1

/** Teto de produções abertas por tenant — trava simples contra enxurrada. */
export const MAX_OPEN_PRODUCTIONS = 3

/** Estados a partir dos quais ainda faz sentido avançar. */
const ADVANCEABLE: readonly ProductionStatus[] = [
  'draft', 'queued', 'running', 'waiting_input',
]

/**
 * Estados em que a produção não anda mais sozinha.
 *
 * `awaiting_approval` está aqui: o pipeline terminou e a bola é de uma pessoa.
 * Continuar chamando "avançar" a partir dele não faria nada — e o cliente
 * precisa saber disso para parar de pedir.
 */
export const PRODUCTION_TERMINAL: readonly ProductionStatus[] = [
  'awaiting_approval', 'approved', 'review', 'published', 'failed', 'canceled',
]

export interface ProductionAdmissionRow {
  id: string
  status: ProductionStatus
  pipeline_key: string
  brief: Record<string, unknown> | null
}

export type ProductionAdmissionResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'wrong_pipeline' | 'is_demo' | 'not_advanceable' }

/** Uma produção real e ainda avançável? */
export function admitProduction(row: ProductionAdmissionRow | null): ProductionAdmissionResult {
  if (!row) return { ok: false, reason: 'not_found' }

  if (!PRODUCTION_PIPELINE_KEYS.includes(row.pipeline_key)) {
    return { ok: false, reason: 'wrong_pipeline' }
  }

  // Uma produção marcada como demonstração NUNCA é avançada por aqui, mesmo
  // que alguém consiga gravar o pipeline_key certo nela.
  if (row.brief?.modo === DEMO_BRIEF_MODE) {
    return { ok: false, reason: 'is_demo' }
  }

  if (!ADVANCEABLE.includes(row.status)) {
    return { ok: false, reason: 'not_advanceable' }
  }

  return { ok: true }
}

/** Produção real do tenant (para leitura), independente de estar avançável. */
export function isRealProduction(row: ProductionAdmissionRow | null): boolean {
  if (!row) return false
  return (
    PRODUCTION_PIPELINE_KEYS.includes(row.pipeline_key) &&
    row.brief?.modo !== DEMO_BRIEF_MODE
  )
}

/** Ainda aberta: conta para o limite e pode ser retomada. */
export function isOpenProduction(row: ProductionAdmissionRow): boolean {
  return isRealProduction(row) && !PRODUCTION_TERMINAL.includes(row.status)
}

/**
 * Eleição determinística entre produções que compartilham a MESMA chave de
 * idempotência.
 *
 * Dois cliques (ou um retry de rede) podem passar juntos pela checagem "já
 * existe?" e inserir duas linhas. Sem índice único — e não há migration nesta
 * fase — o desempate é este: ambas releem, ordenam por (created_at, id) e
 * chegam à mesma vencedora. A perdedora é cancelada logicamente.
 *
 * É o mesmo padrão já usado e testado na demonstração.
 */
export function pickWinningProduction<T extends { id: string; created_at: string }>(
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

/**
 * Mensagens que o navegador pode ver.
 *
 * Nenhuma cita tabela, constraint, coluna, tenant_id ou trecho de SQL. O erro
 * do Postgres traz tudo isso no `message`, e o supabase-js repassa inteiro —
 * devolver ao cliente entregaria um mapa do schema a quem estiver sondando.
 */
export const PRODUCTION_MESSAGES = {
  unauthenticated: 'Sessão expirada. Entre novamente para continuar.',
  not_found: 'Produção não encontrada.',
  wrong_pipeline: 'Esta ação não se aplica a esta produção.',
  is_demo: 'Esta é a demonstração. Use os controles da demonstração.',
  not_advanceable: 'Esta produção já foi concluída.',
  invalid_brief: 'Revise o briefing e tente novamente.',
  too_many_open: 'Você já tem 3 produções em andamento. Remova ou conclua uma para criar outra.',
  remove_failed: 'Não foi possível remover a produção. Tente novamente.',
  idempotency_conflict: 'Este envio entrou em conflito com outro. Recarregue a página e tente novamente.',
  ai_disabled: 'A geração com IA está temporariamente indisponível.',
  images_unavailable: 'A geração de imagens não está configurada neste ambiente (chave da OpenAI ausente).',
  approve_failed: 'Não foi possível concluir a ação. Recarregue a página e tente novamente.',
  create_failed: 'Não foi possível iniciar a produção. Tente novamente.',
  read_failed: 'Não foi possível carregar a produção. Tente novamente.',
} as const

export type ProductionMessageKey = keyof typeof PRODUCTION_MESSAGES

export function safeProductionMessage(key: ProductionMessageKey): string {
  return PRODUCTION_MESSAGES[key]
}
