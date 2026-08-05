// ============================================================================
// Content Studio — porta do provedor de IA (Fase 2B)
// ----------------------------------------------------------------------------
// A mesma ideia do ContentStore: os agentes falam com uma PORTA, nunca com a
// Anthropic diretamente. É o que permite testar o pipeline inteiro com um
// provedor falso — nenhum teste automatizado chama API real — e trocar de
// provedor sem tocar em agente nenhum.
//
// O contrato é deliberadamente estreito:
//   entra  -> instruções de sistema, dados estruturados, validador, perfil
//   sai    -> output JÁ VALIDADO + metadados seguros (modelo, tokens, duração)
//
// O que NUNCA atravessa esta porta para fora do servidor: a API key, o prompt,
// a resposta bruta inválida, stack trace, dados de outro tenant.
// ============================================================================

export interface AICallRequest {
  /** Instruções de sistema — nunca contêm dado do usuário. */
  system: string
  /**
   * Dados do usuário/outputs anteriores, já embrulhados como conteúdo não
   * confiável pelo módulo de prompts. O provedor não remonta nada.
   */
  userContent: string
  /** Valida e converte o JSON devolvido. Lançar erro = resposta inválida. */
  parse: (raw: unknown) => Record<string, unknown>
  maxOutputTokens: number
  temperature: number
  timeoutMs: number
  /**
   * Identificador seguro da execução (produção+step+tentativa). Vai para o
   * log do servidor — nunca contém briefing nem prompt.
   */
  executionId: string
}

export interface AICallResult {
  /** Output validado pelo `parse` — só ele é persistido. */
  output: Record<string, unknown>
  model: string
  inputTokens: number
  outputTokens: number
  durationMs: number
  /** Quantas chamadas HTTP esta execução fez (1, ou 2 com o retry técnico). */
  calls: number
  /** Código de término seguro, para log e teste. */
  finish: 'ok' | 'ok_after_retry'
}

/** Erros com código estável e mensagem SEM conteúdo sensível. */
export class ContentAIError extends Error {
  constructor(
    readonly code:
      | 'missing_key' | 'timeout' | 'rate_limited' | 'provider_error'
      | 'invalid_output' | 'attempts_exhausted',
    detail?: string,
  ) {
    // O detail é técnico e curto (status HTTP, nome do campo inválido) —
    // nunca a resposta bruta, nunca o prompt.
    super(`content_ai:${code}${detail ? `: ${detail}` : ''}`)
  }
}

export interface ContentAIProvider {
  call(req: AICallRequest): Promise<AICallResult>
}

// ─── Resolução do provedor ──────────────────────────────────────────────────

let providerParaTestes: ContentAIProvider | null = null

/**
 * Substituição explícita — exclusiva de teste. Nomeada de forma constrangedora
 * de propósito, como no registry de agentes.
 */
export function __setContentAIProviderForTests(p: ContentAIProvider | null): void {
  providerParaTestes = p
}

let realProviderFactory: (() => ContentAIProvider) | null = null

/** Registrada pela implementação real na carga do módulo dela. */
export function __registerRealProviderFactory(f: () => ContentAIProvider): void {
  realProviderFactory = f
}

/**
 * Resolve o provedor ativo.
 *
 * SEM fallback silencioso: se não há provedor de teste instalado e a
 * implementação real não consegue operar (chave ausente), a chamada FALHA com
 * código claro. Produção real jamais degrada para template sem ninguém saber.
 */
export function getContentAIProvider(): ContentAIProvider {
  if (providerParaTestes) return providerParaTestes
  if (!realProviderFactory) throw new ContentAIError('missing_key', 'provider real não carregado')
  return realProviderFactory()
}
