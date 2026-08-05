// ============================================================================
// Content Studio — implementação Anthropic do ContentAIProvider (Fase 2B)
// ----------------------------------------------------------------------------
// Mesmo padrão do resto do projeto: fetch direto na Messages API, sem SDK e
// sem dependência nova. Server-only — este módulo lê ANTHROPIC_API_KEY e por
// isso jamais pode ser importado por componente de cliente.
//
// Isolado de src/lib/agents/chat.ts DE PROPÓSITO (domínio conversacional).
// `cache_control: ephemeral` + header `anthropic-version: 2023-06-01` é a
// COMBINAÇÃO EXATA que chat.ts usa em produção hoje, com sucesso — não é
// experimento novo desta fase.
//
// Este módulo NÃO se auto-registra: `bootstrap.ts` importa `createAnthropicProvider`
// explicitamente. Import lateral escondido foi o defeito da primeira versão.
//
// DISCIPLINA DE CUSTO E TÉRMINO:
//   • timeout duro por chamada (AbortController)
//   • no máximo UM retry técnico, e só para falha RETENTÁVEL
//   • max_tokens sempre presente — nunca uma chamada sem teto
//   • stop_reason tratado explicitamente: só `end_turn` segue adiante
// ============================================================================

import { AI_MAX_TECH_RETRIES, resolveContentAIModel } from './config'
import {
  ContentAIError,
  type AICallRequest,
  type AICallResult,
  type ContentAIProvider,
} from './provider'

interface AnthropicResponse {
  content?: { type: string; text?: string }[]
  stop_reason?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  error?: { type?: string; message?: string }
}

/**
 * Extrai o JSON da resposta de forma segura e limitada.
 *
 * O modelo é instruído a responder só JSON, mas pode embrulhar em cerca de
 * markdown. Tratamos APENAS esse caso: remover uma cerca externa. Nada de
 * eval, nada de reparo criativo — se depois disso não for JSON.parse válido,
 * é resposta inválida e vira retry/falha. JSON truncado NUNCA é completado.
 */
export function extractJson(texto: string): unknown {
  let corpo = texto.trim()
  const cerca = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(corpo)
  if (cerca) corpo = cerca[1].trim()
  if (!corpo.startsWith('{')) {
    const ini = corpo.indexOf('{')
    const fim = corpo.lastIndexOf('}')
    if (ini >= 0 && fim > ini) corpo = corpo.slice(ini, fim + 1)
  }
  return JSON.parse(corpo)
}

/**
 * Classifica o término da resposta. Nesta integração NÃO há tools nem stop
 * sequences configuradas — qualquer término que não seja `end_turn` significa
 * que a resposta não pode ser persistida.
 */
export function classifyStopReason(stopReason: string | undefined): {
  ok: boolean
  error?: ContentAIError
  retryable?: boolean
} {
  switch (stopReason) {
    case 'end_turn':
      return { ok: true }
    case 'max_tokens':
      // Truncada: nunca persistir; refazer a chamada INTEIRA (mesmo teto) uma
      // vez — a variação de amostragem pode caber no limite na segunda.
      return { ok: false, error: new ContentAIError('truncated_output'), retryable: true }
    case 'refusal':
      // Recusa do modelo: repetir não muda e não deve mudar.
      return { ok: false, error: new ContentAIError('refusal'), retryable: false }
    case 'tool_use':
    case 'pause_turn':
      // Não há ferramenta nesta integração: jamais executar, jamais continuar.
      return { ok: false, error: new ContentAIError('unexpected_stop', stopReason), retryable: false }
    case 'stop_sequence':
      // Nenhuma stop sequence é configurada — então é término inesperado.
      return { ok: false, error: new ContentAIError('unexpected_stop', 'stop_sequence'), retryable: false }
    default:
      // Valor novo/desconhecido da API: falha segura, sem persistir.
      return { ok: false, error: new ContentAIError('unexpected_stop', stopReason ?? 'ausente'), retryable: false }
  }
}

/**
 * Classifica o status HTTP.
 *   retentáveis (1x): 429, 500, 502, 503, 529, timeout, erro de rede
 *   não retentáveis: 400, 401, 403, 404 e demais 4xx — repetir não conserta
 *                    pedido inválido, chave inválida ou modelo inexistente.
 */
export function classifyHttpStatus(status: number): 'ok' | 'retryable' | 'fatal' {
  if (status === 200) return 'ok'
  if (status === 429 || status === 529 || status === 500 || status === 502 || status === 503) {
    return 'retryable'
  }
  return 'fatal'
}

/** Espera do retry: respeita Retry-After com TETO curto — Server Action não pode ficar presa. */
export const RETRY_AFTER_CAP_MS = 3_000
export function retryDelayMs(retryAfterHeader: string | null): number {
  const padrao = 1_000
  if (!retryAfterHeader) return padrao
  const segundos = Number(retryAfterHeader)
  if (!Number.isFinite(segundos) || segundos <= 0) return padrao
  return Math.min(segundos * 1000, RETRY_AFTER_CAP_MS)
}

export interface AnthropicProviderDeps {
  /** Injetável para os testes não dormirem de verdade. */
  wait?: (ms: number) => Promise<void>
  /** Injetável para teste; default: fetch global. */
  fetchFn?: typeof fetch
}

/**
 * Cria o provedor concreto. Lança na CRIAÇÃO se a configuração não sustenta
 * uma chamada: chave ausente (`missing_key`) ou modelo vazio (`invalid_config`).
 */
export function createAnthropicProvider(deps: AnthropicProviderDeps = {}): ContentAIProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new ContentAIError('missing_key')
  const model = resolveContentAIModel() // lança invalid_config se vazio

  const wait = deps.wait ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const fetchFn = deps.fetchFn ?? fetch

  return {
    async call(req: AICallRequest): Promise<AICallResult> {
      const inicio = Date.now()
      let chamadas = 0
      let ultimoErro: ContentAIError = new ContentAIError('provider_error')

      // 1 tentativa + AI_MAX_TECH_RETRIES retries. NENHUM caminho excede isso.
      for (let tentativa = 0; tentativa <= AI_MAX_TECH_RETRIES; tentativa++) {
        chamadas++
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), req.timeoutMs)

        try {
          let res: Response
          try {
            res = await fetchFn('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model,
                max_tokens: req.maxOutputTokens,
                temperature: req.temperature,
                // System separado do conteúdo do usuário — primeira camada da
                // defesa contra prompt injection.
                system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
                messages: [{ role: 'user', content: req.userContent }],
              }),
            })
          } catch (err) {
            if ((err as Error).name === 'AbortError') {
              ultimoErro = new ContentAIError('timeout', `${req.timeoutMs}ms`)
            } else {
              // Erro de REDE (DNS, conexão): retentável uma vez.
              ultimoErro = new ContentAIError('network_error')
            }
            continue
          }

          const disposicao = classifyHttpStatus(res.status)
          if (disposicao === 'fatal') {
            // 400/401/403/404...: pedido inválido, chave inválida, modelo
            // inexistente. Repetir não conserta — e o corpo NÃO é propagado.
            throw new ContentAIError('provider_error', `status=${res.status}`)
          }
          if (disposicao === 'retryable') {
            ultimoErro = res.status === 429
              ? new ContentAIError('rate_limited', `status=${res.status}`)
              : new ContentAIError('provider_error', `status=${res.status}`)
            // Só espera se AINDA HAVERÁ outra tentativa: esperar depois da
            // última chamada falhar seria segurar a Server Action à toa.
            if (tentativa < AI_MAX_TECH_RETRIES) {
              await wait(retryDelayMs(res.headers?.get?.('retry-after') ?? null))
            }
            continue
          }

          let json: AnthropicResponse
          try {
            json = (await res.json()) as AnthropicResponse
          } catch {
            // 200 com corpo que não é JSON: falha segura, retentável.
            ultimoErro = new ContentAIError('invalid_output', 'corpo não-JSON')
            continue
          }

          if (json.error) throw new ContentAIError('provider_error', `type=${json.error.type ?? '?'}`)

          // TÉRMINO explícito antes de olhar o conteúdo.
          const parada = classifyStopReason(json.stop_reason)
          if (!parada.ok) {
            if (parada.retryable) { ultimoErro = parada.error!; continue }
            throw parada.error!
          }

          const texto = (json.content ?? [])
            .filter(b => b.type === 'text' && typeof b.text === 'string')
            .map(b => b.text as string)
            .join('')
          if (!texto) {
            ultimoErro = new ContentAIError('invalid_output', 'resposta vazia')
            continue
          }

          let bruto: unknown
          try {
            bruto = extractJson(texto)
          } catch {
            ultimoErro = new ContentAIError('invalid_output', 'JSON não parseável')
            continue
          }

          let output: Record<string, unknown>
          try {
            output = req.parse(bruto)
          } catch (err) {
            ultimoErro = new ContentAIError(
              'invalid_output', err instanceof Error ? err.message.slice(0, 160) : 'schema inválido')
            continue
          }

          // Contabilização SEM dupla contagem: a API devolve input_tokens
          // (não cacheados), cache_creation e cache_read SEPARADOS. O total é
          // a soma dos três — inputTokens nunca subestima o consumo.
          const uncached = json.usage?.input_tokens ?? 0
          const cacheCreation = json.usage?.cache_creation_input_tokens ?? 0
          const cacheRead = json.usage?.cache_read_input_tokens ?? 0

          return {
            output,
            model,
            inputTokens: uncached + cacheCreation + cacheRead,
            uncachedInputTokens: uncached,
            cacheCreationInputTokens: cacheCreation,
            cacheReadInputTokens: cacheRead,
            outputTokens: json.usage?.output_tokens ?? 0,
            durationMs: Date.now() - inicio,
            calls: chamadas,
            finish: tentativa === 0 ? 'ok' : 'ok_after_retry',
          }
        } finally {
          clearTimeout(timer)
        }
      }

      // Log seguro: id da execução e código — nunca prompt, resposta ou chave.
      console.error(`[content-studio:ai] ${req.executionId} esgotou retries: ${ultimoErro.code}`)
      throw ultimoErro
    },
  }
}
