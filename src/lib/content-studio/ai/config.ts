// ============================================================================
// Content Studio — configuração central de IA (Fase 2B)
// ----------------------------------------------------------------------------
// TODOS os valores que governam custo e comportamento vivem aqui, no servidor.
// O navegador não escolhe provedor, modelo, tokens, temperatura nem prompt —
// nenhuma dessas constantes é exportada para componente de cliente, e as
// Server Actions não as aceitam como parâmetro.
//
// Sem dependência nova e sem variável obrigatória nova: a chave é a
// ANTHROPIC_API_KEY que os agentes conversacionais já usam em produção; o
// modelo tem default próprio do Content Studio, com override OPCIONAL por env.
// ============================================================================

export const CONTENT_AI_PROVIDER = 'anthropic' as const

/**
 * Modelo padrão do Content Studio.
 *
 * Independente do AGENT_MODEL dos agentes conversacionais de propósito: os dois
 * domínios têm perfis de custo diferentes e não devem mudar juntos por engano.
 */
export const CONTENT_AI_MODEL = process.env.CONTENT_AI_MODEL ?? 'claude-sonnet-5'

/** Perfil de chamada por papel. Teto de saída conservador: carrossel é curto. */
export interface AICallProfile {
  maxOutputTokens: number
  temperature: number
  timeoutMs: number
}

export const AI_PROFILES: Record<string, AICallProfile> = {
  researcher: { maxOutputTokens: 1800, temperature: 0.3, timeoutMs: 60_000 },
  strategist: { maxOutputTokens: 1800, temperature: 0.6, timeoutMs: 60_000 },
  copywriter: { maxOutputTokens: 2200, temperature: 0.8, timeoutMs: 90_000 },
  reviewer:   { maxOutputTokens: 1400, temperature: 0.2, timeoutMs: 60_000 },
}

/** No máximo UM retry técnico por chamada (timeout, 429/529, JSON inválido). */
export const AI_MAX_TECH_RETRIES = 1

/**
 * Tentativas de JOB que ainda podem chamar IA.
 *
 * O motor da Fase 1 dá até 3 tentativas por job (backoff 1/5/15min). Sem esta
 * trava, cada tentativa refaria as chamadas e o teto declarado viraria ficção.
 * A partir da tentativa 2 o agente falha ANTES de tocar a rede.
 */
export const AI_MAX_ATTEMPTS_WITH_CALLS = 2

/**
 * TETO ESTRUTURAL de chamadas por produção — derivado, não configurado:
 *
 *   execuções de step com IA: 4 (pesq/estr/copy/rev) + 2 (revisão: copy+rev) = 6
 *   × tentativas com rede (2) × chamadas por tentativa (1 + 1 retry = 2) = 24
 *
 * O teto de tokens decorre dele: 24 × maxOutputTokens(≤2200) de saída, com
 * entrada limitada pelo briefing (≤2000 chars) e pelos schemas dos outputs.
 * O cliente não tem como aumentar nenhum destes números.
 */
export const AI_MAX_CALLS_PER_PRODUCTION = 24

// ─── Régua de qualidade do revisor (servidor decide, não o modelo) ──────────

/** Média mínima das seis notas para aprovar. */
export const REVIEW_MIN_AVG = 7
/** Nenhuma destas dimensões pode ficar abaixo do piso. */
export const REVIEW_FLOORS: Record<string, number> = {
  hook: 6,
  clarity: 6,
  naturalness: 6,
}

/** Versões de prompt — auditáveis: gravadas no usage de cada output. */
export const PROMPT_VERSIONS = {
  researcher: 'researcher_v1',
  strategist: 'strategist_v1',
  copywriter: 'copywriter_v1',
  reviewer: 'reviewer_v1',
} as const
