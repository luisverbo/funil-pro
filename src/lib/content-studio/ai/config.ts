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

import { ContentAIError } from './provider'

export const CONTENT_AI_PROVIDER = 'anthropic' as const

/**
 * KILL SWITCH do rollout. Default DESLIGADO: só a string exata "true" habilita.
 *
 * SEMÂNTICA NA VERCEL: a variável é lida em runtime PELO DEPLOYMENT — mudar o
 * valor no painel NÃO afeta deployments já publicados; é preciso um novo
 * deployment/redeploy para o valor novo valer. Rollout:
 *   1. deploy com CONTENT_AI_ENABLED ausente/false (IA desligada);
 *   2. verificar que produções antigas continuam legíveis;
 *   3. configurar CONTENT_AI_ENABLED=true em Production;
 *   4. configurar/conferir CONTENT_AI_MODEL;
 *   5. redeploy;
 *   6. o usuário cria manualmente uma produção canário.
 *
 * O navegador não alcança isto — nenhuma action aceita o valor como parâmetro.
 */
export function isContentAIEnabled(): boolean {
  return process.env.CONTENT_AI_ENABLED === 'true'
}

/**
 * Modelo do Content Studio — EXPLÍCITO, sem fallback.
 *
 * O canário provou que a alegação "o default de chat.ts está validado em
 * produção" era frágil: chat.ts usa `AGENT_MODEL ?? 'claude-sonnet-5'`, e a
 * Vercel pode definir AGENT_MODEL (o motor conversacional rodou em Haiku,
 * segundo o CLAUDE.md) — o literal default pode nunca ter sido exercido.
 *
 * Regra desta versão: com a IA habilitada, CONTENT_AI_MODEL precisa estar
 * DEFINIDO e não vazio no ambiente. Ausência = invalid_config, barrada pelo
 * preflight ANTES de qualquer persistência. Nada de fallback silencioso: um
 * modelo errado deve falhar na configuração, não na primeira chamada paga.
 * O valor vem somente do servidor — nenhuma action o aceita do cliente.
 */
export function resolveContentAIModel(): string {
  const env = process.env.CONTENT_AI_MODEL
  if (env === undefined) {
    throw new ContentAIError('invalid_config', 'CONTENT_AI_MODEL ausente — obrigatório com a IA habilitada')
  }
  const limpo = env.trim()
  if (!limpo) throw new ContentAIError('invalid_config', 'CONTENT_AI_MODEL vazio')
  return limpo
}

/**
 * Perfil de chamada por papel. Teto de saída conservador: carrossel é curto.
 *
 * SEM sampling parameters — e não é omissão: o Claude Sonnet 5 rejeita com
 * HTTP 400 qualquer request com temperature/top_p/top_k fora do padrão, e foi
 * exatamente isso que derrubou o primeiro canário (perfis 0.2–0.8). O caráter
 * de cada agente (criativo vs. rigoroso) é responsabilidade dos PROMPTS.
 */
export interface AICallProfile {
  maxOutputTokens: number
  timeoutMs: number
}

export const AI_PROFILES: Record<string, AICallProfile> = {
  researcher: { maxOutputTokens: 1800, timeoutMs: 60_000 },
  strategist: { maxOutputTokens: 1800, timeoutMs: 60_000 },
  copywriter: { maxOutputTokens: 2200, timeoutMs: 90_000 },
  reviewer:   { maxOutputTokens: 1400, timeoutMs: 60_000 },
}

/** No máximo UM retry técnico por chamada (timeout, 429/529, JSON inválido). */
export const AI_MAX_TECH_RETRIES = 1

/**
 * Tempo MÍNIMO útil para valer a pena abrir mais uma tentativa. O timeoutMs
 * de cada call() é orçamento TOTAL (retries inclusos): com menos que isto
 * sobrando, retentar só produziria outro abort — o erro anterior é lançado.
 */
export const AI_MIN_ATTEMPT_MS = 2_000

/**
 * Tentativas de JOB que ainda podem chamar IA.
 *
 * O motor da Fase 1 dá até 3 tentativas por job (backoff 1/5/15min). Sem esta
 * trava, cada tentativa refaria as chamadas e o teto declarado viraria ficção.
 * A partir da tentativa 2 o agente falha ANTES de tocar a rede.
 */
export const AI_MAX_ATTEMPTS_WITH_CALLS = 2

/**
 * TETO ESTRUTURAL (teórico) de chamadas por produção.
 *
 * HONESTIDADE SOBRE O QUE ISTO É: não existe medidor cumulativo persistido
 * entre invocações serverless — este número NÃO é um orçamento de runtime.
 * É o pior caso derivado das travas que EXISTEM de fato:
 *
 *   execuções de step com IA: 4 (pesq/estr/copy/rev) + 2 (revisão: copy+rev) = 6
 *   × tentativas de job com rede (AI_MAX_ATTEMPTS_WITH_CALLS = 2)
 *   × chamadas HTTP por tentativa (1 + AI_MAX_TECH_RETRIES = 2)  = 24
 *
 * O teste da Fase 2B deriva este valor da estrutura real do pipeline: quem
 * acrescentar um agente ou ciclo quebra o teste até rever o teto.
 */
export const AI_STRUCTURAL_MAX_CALLS_PER_PRODUCTION = 24

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
