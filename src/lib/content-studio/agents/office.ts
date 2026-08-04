// ============================================================================
// Content Studio — agentes do Office Preview (pesquisador, estrategista, copy)
// ----------------------------------------------------------------------------
// São STUBS: existem para validar a espinha dorsal e a interface antes de
// qualquer provedor de IA entrar.
//
//   • determinísticos -> mesma entrada, mesma saída, sempre
//   • custo zero      -> nenhuma chamada a Anthropic, OpenAI ou qualquer API
//   • sem rede        -> não há fetch neste arquivo, nem indireto
//   • sem efeito      -> não enviam mensagem, não publicam, não tocam Instagram
//
// Cada um reporta progresso REAL (unidades concluídas de um total conhecido),
// nunca percentual inventado para a animação parecer mais bonita.
// ============================================================================

import type { AgentContext, AgentDefinition, AgentInput, AgentOutput } from '../types'
import { stableHash } from './stub'

/** Rótulos exibidos na interface. Ficam aqui para agente e UI não divergirem. */
export const OFFICE_AGENT_LABELS: Record<string, string> = {
  researcher: 'Pesquisador',
  strategist: 'Estrategista',
  copywriter: 'Copywriter',
}

function brief(input: AgentInput, key: string, fallback: string): string {
  const value = input.brief?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

/** Reporta cada unidade concluída. `total` é conhecido de antemão — é real. */
async function reportSteps(ctx: AgentContext, etapas: string[]): Promise<void> {
  for (let i = 0; i < etapas.length; i++) {
    await ctx.reportProgress?.({ completed: i + 1, total: etapas.length, label: etapas[i] })
  }
}

// ─── Pesquisador ────────────────────────────────────────────────────────────

export const RESEARCHER_AGENT: AgentDefinition = {
  key: 'researcher',
  version: 1,
  label: OFFICE_AGENT_LABELS.researcher,

  validateInput(input) {
    if (!input.envelope.productionId) throw new Error('researcher: productionId ausente')
  },

  async run(input, ctx): Promise<AgentOutput> {
    const tema = brief(input, 'tema', 'tema não informado')
    const publico = brief(input, 'publico', 'público geral')

    await reportSteps(ctx, ['Lendo o briefing', 'Levantando referências', 'Resumindo achados'])

    return {
      data: {
        agent: 'researcher',
        tema,
        publico,
        // Determinístico: derivado do briefing, sem relógio nem aleatoriedade.
        achados: [
          `Dor principal do público "${publico}" em torno de ${tema}`,
          `Objeção mais comum ao falar de ${tema}`,
          `Formato de conteúdo com melhor tração para ${publico}`,
        ],
        assinatura: stableHash({ tema, publico }),
      },
      artifacts: [],
      usage: { provider: 'none', inputTokens: 0, outputTokens: 0, imagesGenerated: 0, costCents: 0 },
    }
  },
}

// ─── Estrategista ───────────────────────────────────────────────────────────

export const STRATEGIST_AGENT: AgentDefinition = {
  key: 'strategist',
  version: 1,
  label: OFFICE_AGENT_LABELS.strategist,

  validateInput(input) {
    if (!input.upstream.researcher) {
      throw new Error('strategist: a pesquisa do Pesquisador não chegou')
    }
  },

  async run(input, ctx): Promise<AgentOutput> {
    const pesquisa = input.upstream.researcher.data
    const achados = Array.isArray(pesquisa.achados) ? (pesquisa.achados as string[]) : []

    await reportSteps(ctx, ['Analisando a pesquisa', 'Definindo o ângulo', 'Montando a estrutura'])

    return {
      data: {
        agent: 'strategist',
        angulo: `Abrir pela dor, quebrar a objeção, fechar com prova`,
        estrutura: ['Gancho', 'Contexto', 'Virada', 'Prova', 'Chamada'],
        baseado_em: achados.length,
        assinatura: stableHash(pesquisa),
      },
      artifacts: [],
      usage: { provider: 'none', inputTokens: 0, outputTokens: 0, imagesGenerated: 0, costCents: 0 },
    }
  },
}

// ─── Copywriter ─────────────────────────────────────────────────────────────

export const COPYWRITER_AGENT: AgentDefinition = {
  key: 'copywriter',
  version: 1,
  label: OFFICE_AGENT_LABELS.copywriter,

  validateInput(input) {
    if (!input.upstream.strategist) {
      throw new Error('copywriter: a estratégia do Estrategista não chegou')
    }
  },

  async run(input, ctx): Promise<AgentOutput> {
    const estrategia = input.upstream.strategist.data
    const estrutura = Array.isArray(estrategia.estrutura) ? (estrategia.estrutura as string[]) : []

    await reportSteps(ctx, ['Escrevendo o gancho', 'Desenvolvendo o corpo', 'Fechando com a chamada'])

    return {
      data: {
        agent: 'copywriter',
        titulo: 'Rascunho de demonstração — gerado sem IA',
        blocos: estrutura.map(secao => ({ secao, texto: `[${secao}] texto de demonstração` })),
        aviso: 'Conteúdo determinístico de validação. Nenhum provedor externo foi chamado.',
        assinatura: stableHash(estrategia),
      },
      artifacts: [{ kind: 'document', meta: { formato: 'rascunho', origem: 'stub' } }],
      usage: { provider: 'none', inputTokens: 0, outputTokens: 0, imagesGenerated: 0, costCents: 0 },
    }
  },
}

export const OFFICE_AGENTS: AgentDefinition[] = [
  RESEARCHER_AGENT,
  STRATEGIST_AGENT,
  COPYWRITER_AGENT,
]
