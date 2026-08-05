// ============================================================================
// Content Studio — implementação Anthropic do ContentAIProvider (Fase 2B)
// ----------------------------------------------------------------------------
// Mesmo padrão do resto do projeto: fetch direto na Messages API, sem SDK e
// sem dependência nova. Server-only — este módulo lê ANTHROPIC_API_KEY e por
// isso jamais pode ser importado por componente de cliente.
//
// Isolado de src/lib/agents/chat.ts DE PROPÓSITO: aquele módulo é do domínio
// conversacional (leads, WhatsApp, janelas de atendimento). Compartilhar o
// cliente acoplaria o Content Studio a mudanças feitas para outro produto.
//
// Disciplina de custo nesta camada:
//   • timeout duro por chamada (AbortController)
//   • no máximo UM retry técnico (429/529/timeout/JSON inválido)
//   • max_tokens sempre presente — nunca uma chamada sem teto
//   • temperatura e modelo vêm da configuração do servidor
// ============================================================================

import { AI_MAX_TECH_RETRIES, CONTENT_AI_MODEL } from './config'
import {
  ContentAIError,
  __registerRealProviderFactory,
  type AICallRequest,
  type AICallResult,
  type ContentAIProvider,
} from './provider'

interface AnthropicResponse {
  content?: { type: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { type?: string; message?: string }
}

/**
 * Extrai o JSON da resposta de forma segura e limitada.
 *
 * O modelo é instruído a responder só JSON, mas pode embrulhar em cerca de
 * markdown. Tratamos APENAS esse caso: remover uma cerca externa. Nada de
 * eval, nada de reparo criativo — se depois disso não for JSON.parse válido,
 * é resposta inválida e vira retry/falha.
 */
export function extractJson(texto: string): unknown {
  let corpo = texto.trim()
  const cerca = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(corpo)
  if (cerca) corpo = cerca[1].trim()
  // Alguns modelos antepõem uma frase à cerca. Última tentativa contida:
  // recortar do primeiro '{' ao último '}'. Continua sendo só JSON.parse.
  if (!corpo.startsWith('{')) {
    const ini = corpo.indexOf('{')
    const fim = corpo.lastIndexOf('}')
    if (ini >= 0 && fim > ini) corpo = corpo.slice(ini, fim + 1)
  }
  return JSON.parse(corpo)
}

function criarProvider(): ContentAIProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new ContentAIError('missing_key')

  return {
    async call(req: AICallRequest): Promise<AICallResult> {
      const inicio = Date.now()
      let chamadas = 0
      let ultimoErro: ContentAIError = new ContentAIError('provider_error')

      // 1 tentativa + AI_MAX_TECH_RETRIES retries. Nunca mais que isso.
      for (let tentativa = 0; tentativa <= AI_MAX_TECH_RETRIES; tentativa++) {
        chamadas++
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), req.timeoutMs)

        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: CONTENT_AI_MODEL,
              max_tokens: req.maxOutputTokens,
              temperature: req.temperature,
              // System separado do conteúdo do usuário — a separação é o
              // primeiro nível da defesa contra prompt injection.
              system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
              messages: [{ role: 'user', content: req.userContent }],
            }),
          })

          const json = (await res.json()) as AnthropicResponse

          if (res.status === 429 || res.status === 529) {
            ultimoErro = new ContentAIError('rate_limited', `status=${res.status}`)
            await esperar(2000)
            continue
          }
          if (res.status !== 200 || json.error) {
            // Mensagem da API pode citar o prompt — NÃO a propagamos. Só o tipo.
            throw new ContentAIError('provider_error', `status=${res.status} type=${json.error?.type ?? '?'}`)
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
            // A resposta bruta NÃO entra no erro nem no log.
            ultimoErro = new ContentAIError('invalid_output', 'JSON não parseável')
            continue
          }

          // Validação de schema. Falha aqui também conta como retry técnico:
          // o modelo pode ter devolvido estrutura errada uma vez.
          let output: Record<string, unknown>
          try {
            output = req.parse(bruto)
          } catch (err) {
            ultimoErro = new ContentAIError(
              'invalid_output', err instanceof Error ? err.message.slice(0, 160) : 'schema inválido')
            continue
          }

          return {
            output,
            model: CONTENT_AI_MODEL,
            inputTokens: json.usage?.input_tokens ?? 0,
            outputTokens: json.usage?.output_tokens ?? 0,
            durationMs: Date.now() - inicio,
            calls: chamadas,
            finish: tentativa === 0 ? 'ok' : 'ok_after_retry',
          }
        } catch (err) {
          if (err instanceof ContentAIError && err.code === 'provider_error') throw err
          if ((err as Error).name === 'AbortError') {
            ultimoErro = new ContentAIError('timeout', `${req.timeoutMs}ms`)
            continue
          }
          if (err instanceof ContentAIError) { ultimoErro = err; continue }
          ultimoErro = new ContentAIError('provider_error', 'falha de rede')
          continue
        } finally {
          clearTimeout(timer)
        }
      }

      // Log seguro: id da execução e código — nunca prompt, nunca resposta.
      console.error(`[content-studio:ai] ${req.executionId} esgotou retries: ${ultimoErro.code}`)
      throw ultimoErro
    },
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// A fábrica só roda quando alguém pedir o provedor — a ausência da chave não
// derruba o build nem os testes (que instalam o provedor falso).
__registerRealProviderFactory(criarProvider)
