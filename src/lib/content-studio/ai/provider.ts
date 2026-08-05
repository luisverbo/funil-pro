// ============================================================================
// Content Studio — porta do provedor de IA (Fase 2B)
// ----------------------------------------------------------------------------
// A mesma ideia do ContentStore: os agentes falam com uma PORTA, nunca com a
// Anthropic diretamente. É o que permite testar o pipeline inteiro com um
// provedor falso — nenhum teste automatizado chama API real — e trocar de
// provedor sem tocar em agente nenhum.
//
// Este arquivo define APENAS o contrato e o override de teste. Quem liga a
// porta à implementação concreta é `bootstrap.ts`, com import EXPLÍCITO — a
// primeira versão registrava a fábrica por efeito colateral de import, e o
// grafo de produção nunca importava o arquivo: o provedor real simplesmente
// não carregava. O teste de grafo em phase2b-provider.test.ts protege isso.
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
  /**
   * TOTAL de tokens de entrada = não cacheados + criação de cache + leitura
   * de cache. É o número que nunca pode subestimar o consumo.
   */
  inputTokens: number
  /** Tokens de entrada processados sem cache (usage.input_tokens da API). */
  uncachedInputTokens?: number
  /** Tokens gravados no cache nesta chamada (cobrados com acréscimo). */
  cacheCreationInputTokens?: number
  /** Tokens lidos do cache nesta chamada (cobrados com desconto). */
  cacheReadInputTokens?: number
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
      | 'missing_key' | 'invalid_config' | 'disabled'
      | 'timeout' | 'rate_limited' | 'provider_error' | 'network_error'
      | 'invalid_output' | 'truncated_output' | 'refusal' | 'unexpected_stop'
      | 'attempts_exhausted',
    detail?: string,
  ) {
    // O detail é técnico e curto (status HTTP, nome do campo inválido) —
    // nunca a resposta bruta, nunca o prompt, nunca a chave.
    super(`content_ai:${code}${detail ? `: ${detail}` : ''}`)
  }
}

export interface ContentAIProvider {
  call(req: AICallRequest): Promise<AICallResult>
}

// ─── Override de teste ──────────────────────────────────────────────────────

let providerParaTestes: ContentAIProvider | null = null

/**
 * Substituição explícita — exclusiva de teste. Nomeada de forma constrangedora
 * de propósito, como no registry de agentes.
 */
export function __setContentAIProviderForTests(p: ContentAIProvider | null): void {
  providerParaTestes = p
}

/** Consultado pelo bootstrap: teste instalado tem prioridade sobre o real. */
export function __getTestProvider(): ContentAIProvider | null {
  return providerParaTestes
}
