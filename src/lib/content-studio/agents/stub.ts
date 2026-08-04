// ============================================================================
// Content Studio — agente stub (Fase 1)
// ----------------------------------------------------------------------------
// Existe para validar a ESPINHA DORSAL (fila, lock, retry, eventos, retomada)
// sem envolver nenhum provedor de IA.
//
// Garantias deste agente:
//   • determinístico  -> mesma entrada produz exatamente a mesma saída
//   • custo zero      -> não chama Anthropic, OpenAI ou qualquer API externa
//   • efeito zero     -> não envia mensagem, não publica, não toca no Instagram
//   • sem I/O         -> nenhuma leitura/escrita fora do objeto de retorno
//
// Quando os agentes reais entrarem (pesquisador, estrategista, copywriter...),
// eles substituem este no registry sem alterar uma linha do orquestrador.
// ============================================================================

import type { AgentDefinition, AgentInput, AgentOutput } from '../types'

/**
 * Hash FNV-1a de 32 bits em hexadecimal.
 * Escolhido por ser determinístico, puro e não depender de `crypto` — o mesmo
 * código roda no teste local e no servidor com o mesmo resultado.
 */
export function stableHash(value: unknown): string {
  const text = JSON.stringify(value ?? null)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** Fábrica: os dois passos do pipeline stub compartilham o mesmo comportamento. */
function makeStubAgent(key: string, label: string): AgentDefinition {
  return {
    key,
    version: 1,
    label,

    validateInput(input: AgentInput) {
      if (!input.envelope.productionId) throw new Error('stub_agent: productionId ausente')
      if (!input.envelope.stepId) throw new Error('stub_agent: stepId ausente')
    },

    // `ctx` existe no contrato mas não é usado: este agente não tem progresso
    // mensurável a reportar — e progresso inventado é proibido.
    async run(input: AgentInput): Promise<AgentOutput> {
      // A saída depende SÓ do briefing e das saídas anteriores — nunca de
      // relógio, aleatoriedade ou rede. Reexecutar dá o mesmo resultado.
      const upstreamKeys = Object.keys(input.upstream).sort()

      return {
        data: {
          agent: key,
          echo: stableHash({ brief: input.brief, upstream: input.upstream }),
          upstream: upstreamKeys,
          note: 'saída determinística de validação — nenhum provedor externo foi chamado',
        },
        artifacts: [],
        usage: {
          provider: 'none',
          inputTokens: 0,
          outputTokens: 0,
          imagesGenerated: 0,
          costCents: 0,
        },
      }
    },
  }
}

export const STUB_A: AgentDefinition = makeStubAgent('stub_a', 'Stub A (validação)')
export const STUB_B: AgentDefinition = makeStubAgent('stub_b', 'Stub B (validação)')

/**
 * Agente que sempre falha. Não entra no registry padrão: é injetado pelos
 * testes para exercitar retry, backoff e falha terminal sem nenhum efeito real.
 */
export const STUB_FAILING: AgentDefinition = {
  key: 'stub_failing',
  version: 1,
  label: 'Stub que falha (somente testes)',
  async run(): Promise<AgentOutput> {
    throw new Error('stub_failing: falha proposital')
  },
}
