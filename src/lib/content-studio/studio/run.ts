// ============================================================================
// Content Studio — execução da geração Studio (3 agentes, SEM fila)
// ----------------------------------------------------------------------------
// Estrategista → Copywriter → Designer, em sequência, dentro da Server Action.
// Sem BullMQ, sem cron, sem orquestrador: cada agente é UM step persistido, com
// eventos reais, e o próximo só começa quando o anterior gravou o output.
//
// DUAS garantias, e elas são independentes:
//
// 1. CLAIM ATÔMICO POR STEP — cada step nasce já em `running` e a exclusão é o
//    índice único uq_cs_steps_prod_index (production_id, step_index). Só a
//    execução que recebeu `inserted=true` chama o provider. Perdedoras leem o
//    estado e saem: nunca duas chamadas pagas para o MESMO step.
//
// 2. RETOMABILIDADE POR ORÇAMENTO DE TEMPO — três chamadas de IA não cabem com
//    folga no limite de execução de uma Server Action. Antes de começar cada
//    agente, o runner confere quanto tempo sobrou; se não couber, ele PARA
//    ANTES de inserir o step (portanto sem claim preso) e devolve `partial`.
//    A requisição seguinte retoma exatamente de onde parou, porque o estado
//    está no banco — não na memória do processo.
//
// A alternativa seria uma chamada só, gigante, com os três papéis juntos: é o
// que a Criação rápida v1 faz. Ela cabe no tempo, mas a qualidade da copy é
// justamente o que se perde quando o mesmo fôlego decide a estratégia, escreve
// e dirige a arte.
// ============================================================================

import { resolveContentAIProvider } from '../ai/bootstrap'
import { agentErrorEventPayload } from '../types'
import type { AgentUsage, ContentStore, ProductionRow, StepRow } from '../types'
import {
  copywriterUserContent, designerUserContent, envelopeStudio,
  studioCopywriterSystem, studioDesignerSystem, studioStrategistSystem,
  STUDIO_COPYWRITER_PROMPT_VERSION, STUDIO_DESIGNER_PROMPT_VERSION,
  STUDIO_STRATEGIST_PROMPT_VERSION,
} from './prompt'
import {
  makeCopyParser, makeStrategyParser, makeVisualParser,
  STUDIO_AGENT_ORDER, STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY,
  STUDIO_STRATEGIST_KEY,
  type StudioCopy, type StudioStrategy, type ValidStudioBrief,
} from './schema'

/**
 * Orçamento por agente.
 *
 * `reserveMs` é o tempo que precisa SOBRAR para valer a pena começar o agente.
 * Se sobrar menos, o runner devolve `partial` sem tocar no banco — melhor
 * retomar do que ser morto no meio de uma chamada já paga.
 */
export const STUDIO_PROFILES = {
  [STUDIO_STRATEGIST_KEY]: { maxOutputTokens: 1200, timeoutMs: 40_000, reserveMs: 20_000 },
  [STUDIO_COPYWRITER_KEY]: { maxOutputTokens: 2600, timeoutMs: 55_000, reserveMs: 28_000 },
  [STUDIO_DESIGNER_KEY]: { maxOutputTokens: 2800, timeoutMs: 55_000, reserveMs: 28_000 },
} as const

/** Orçamento padrão de UMA requisição, com folga sobre maxDuration = 60s. */
export const STUDIO_REQUEST_BUDGET_MS = 50_000

export interface StudioRunResult {
  ok: boolean
  /**
   * O que esta EXECUÇÃO fez:
   *   created         -> concluiu a produção inteira (o último agente terminou)
   *   reused          -> já estava tudo pronto (nenhuma chamada)
   *   partial         -> avançou o que coube no tempo; falta agente para rodar
   *   in_progress     -> outra execução está num step AGORA (nenhuma chamada)
   *   failed_existing -> algum step já falhou antes (nenhuma nova tentativa)
   *   failed          -> esta execução ganhou o claim e a IA falhou
   */
  state: 'created' | 'reused' | 'partial' | 'in_progress' | 'failed_existing' | 'failed'
  /** Agentes que ainda não concluíram — vazio quando a produção terminou. */
  pending: string[]
  errorCode?: string
}

interface RunOptions {
  /** Instante (ms epoch) em que a requisição precisa ter devolvido. */
  deadlineAt?: number
  /** Injeção para teste: relógio. Nunca usado em produção. */
  now?: () => number
}

/** Saída já validada de cada agente, na ordem em que são produzidas. */
interface Bagagem {
  strategy?: StudioStrategy
  copy?: StudioCopy
}

function readData(step: StepRow | undefined): Record<string, unknown> | null {
  const data = step?.output?.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

/**
 * Executa a geração Studio sobre uma produção JÁ criada (casca draft).
 *
 * Idempotente por construção: chamada de novo, ela pula os steps concluídos
 * (lendo o output persistido) e continua do primeiro que falta.
 */
export async function runStudioCarousel(
  store: ContentStore,
  production: ProductionRow,
  brief: ValidStudioBrief,
  options: RunOptions = {},
): Promise<StudioRunResult> {
  const agora = options.now ?? (() => Date.now())
  const deadline = options.deadlineAt ?? (agora() + STUDIO_REQUEST_BUDGET_MS)

  const jaExistentes = await store.listSteps(production.id)
  const porAgente = new Map(jaExistentes.map(s => [s.agent_key, s]))

  // Primeira entrada nesta produção: registra a criação uma única vez.
  if (jaExistentes.length === 0) {
    await store.emitEvent({
      productionId: production.id,
      type: 'production_created',
      payload: { pipeline_key: production.pipeline_key, steps: STUDIO_AGENT_ORDER.length },
    })
    await store.updateProductionStatus(production.id, 'running')
  }

  const bagagem: Bagagem = {}
  let executouAlgum = false

  for (let indice = 0; indice < STUDIO_AGENT_ORDER.length; indice++) {
    const agentKey = STUDIO_AGENT_ORDER[indice]
    const existente = porAgente.get(agentKey)

    // ── Já resolvido antes? Aproveita o output persistido e segue. ──────────
    if (existente?.status === 'completed') {
      absorver(bagagem, agentKey, readData(existente))
      continue
    }
    if (existente?.status === 'failed') {
      // Repetir automaticamente seria uma segunda chamada paga sem decisão
      // humana. A produção já está `failed`; quem decide retomar é a pessoa.
      return { ok: false, state: 'failed_existing', pending: faltantes(indice), errorCode: 'already_failed' }
    }
    if (existente?.status === 'running') {
      return { ok: true, state: 'in_progress', pending: faltantes(indice) }
    }

    // ── Cabe no tempo restante? ─────────────────────────────────────────────
    const perfil = STUDIO_PROFILES[agentKey]
    if (deadline - agora() < perfil.reserveMs) {
      // PARA ANTES de inserir o step: nenhum claim fica preso, nada a limpar.
      return { ok: true, state: 'partial', pending: faltantes(indice) }
    }

    // ── Claim atômico: o step nasce `running`. ──────────────────────────────
    const inicio = new Date().toISOString()
    const { rows, inserted } = await store.insertSteps([{
      production_id: production.id,
      tenant_id: production.tenant_id,
      agent_key: agentKey,
      step_index: indice,
      depends_on: indice === 0 ? [] : [STUDIO_AGENT_ORDER[indice - 1]],
      status: 'running',
      input: null,
      output: null,
      attempt: 0,
      error: null,
      started_at: inicio,
      completed_at: null,
    }])
    const step = rows.find(r => r.agent_key === agentKey) ?? rows[0]

    if (!inserted) {
      // Outra execução chegou primeiro neste step. Nenhum caminho daqui toca o
      // provider, emite evento ou sobrescreve output.
      if (step.status === 'completed') {
        absorver(bagagem, agentKey, readData(step))
        continue
      }
      if (step.status === 'failed') {
        return { ok: false, state: 'failed_existing', pending: faltantes(indice), errorCode: 'already_failed' }
      }
      return { ok: true, state: 'in_progress', pending: faltantes(indice) }
    }

    // ── Só o VENCEDOR do claim passa daqui. ─────────────────────────────────
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_started',
      stepId: step.id,
      agentKey,
      payload: { attempt: 0 },
    })

    try {
      const saida = await chamarAgente(agentKey, brief, bagagem, production.id, perfil)
      absorver(bagagem, agentKey, saida.data)

      await store.updateStep(step.id, {
        status: 'completed',
        output: { data: saida.data, artifacts: [], usage: saida.usage },
        completed_at: new Date().toISOString(),
      })
      await store.emitEvent({
        productionId: production.id,
        type: 'agent_completed',
        stepId: step.id,
        agentKey,
        payload: { usage: saida.usage },
      })
      executouAlgum = true

      // Entrega para o próximo: é isto que faz o personagem CAMINHAR na cena.
      // Evento real, gravado — a interface não inventa a caminhada.
      const proximo = STUDIO_AGENT_ORDER[indice + 1]
      if (proximo) {
        await store.emitEvent({
          productionId: production.id,
          type: 'task_handoff_started',
          stepId: step.id,
          agentKey,
          payload: { from: agentKey, to: proximo },
        })
        await store.emitEvent({
          productionId: production.id,
          type: 'task_handoff_completed',
          stepId: step.id,
          agentKey,
          payload: { from: agentKey, to: proximo },
        })
      }
    } catch (err) {
      const extras = agentErrorEventPayload(err)
      const message = err instanceof Error ? err.message : String(err)
      const payloadErro = 'error_code' in extras ? extras : { error: message.slice(0, 300), ...extras }

      await store.updateStep(step.id, {
        status: 'failed',
        error: message.slice(0, 300),
        completed_at: new Date().toISOString(),
      })
      await store.emitEvent({
        productionId: production.id,
        type: 'agent_failed',
        stepId: step.id,
        agentKey,
        payload: { attempt: 0, ...payloadErro },
      })
      await store.updateProductionStatus(production.id, 'failed')

      const code = (err as { code?: string }).code
      return {
        ok: false,
        state: 'failed',
        pending: faltantes(indice),
        errorCode: typeof code === 'string' ? code : 'unknown',
      }
    }
  }

  // Todos os agentes concluíram — fecha no portão humano.
  await store.updateProductionStatus(production.id, 'awaiting_approval')
  await store.emitEvent({
    productionId: production.id,
    type: 'content_waiting_approval',
    payload: { steps: STUDIO_AGENT_ORDER.length, final_status: 'awaiting_approval' },
  })

  return { ok: true, state: executouAlgum ? 'created' : 'reused', pending: [] }
}

function faltantes(aPartirDe: number): string[] {
  return STUDIO_AGENT_ORDER.slice(aPartirDe)
}

/** Guarda a saída de um agente para alimentar o próximo. */
function absorver(bagagem: Bagagem, agentKey: string, data: Record<string, unknown> | null): void {
  if (!data) return
  if (agentKey === STUDIO_STRATEGIST_KEY) bagagem.strategy = data as unknown as StudioStrategy
  if (agentKey === STUDIO_COPYWRITER_KEY) bagagem.copy = data as unknown as StudioCopy
}

interface SaidaAgente {
  data: Record<string, unknown>
  usage: AgentUsage
}

/**
 * UMA chamada lógica por agente (o provider ainda pode fazer 1 retry técnico).
 *
 * O contexto de cada agente é o pedido do usuário mais o material já produzido
 * NESTA produção, lido do banco — nunca reconstruído de memória do processo.
 */
async function chamarAgente(
  agentKey: string,
  brief: ValidStudioBrief,
  bagagem: Bagagem,
  productionId: string,
  perfil: { maxOutputTokens: number; timeoutMs: number },
): Promise<SaidaAgente> {
  const provider = resolveContentAIProvider()
  const executionId = `${productionId}:${agentKey}:a0`

  let system: string
  let userContent: string
  let parse: (raw: unknown) => Record<string, unknown>
  let promptVersion: string

  if (agentKey === STUDIO_STRATEGIST_KEY) {
    system = studioStrategistSystem(brief)
    userContent = envelopeStudio(brief)
    parse = makeStrategyParser(brief) as (raw: unknown) => Record<string, unknown>
    promptVersion = STUDIO_STRATEGIST_PROMPT_VERSION
  } else if (agentKey === STUDIO_COPYWRITER_KEY) {
    if (!bagagem.strategy) throw new Error('studio: copy sem plano do estrategista')
    system = studioCopywriterSystem(brief)
    userContent = copywriterUserContent(brief, bagagem.strategy)
    parse = makeCopyParser(brief) as (raw: unknown) => Record<string, unknown>
    promptVersion = STUDIO_COPYWRITER_PROMPT_VERSION
  } else if (agentKey === STUDIO_DESIGNER_KEY) {
    if (!bagagem.copy) throw new Error('studio: direção visual sem copy')
    system = studioDesignerSystem(brief)
    userContent = designerUserContent(brief, bagagem.copy)
    parse = makeVisualParser(brief) as (raw: unknown) => Record<string, unknown>
    promptVersion = STUDIO_DESIGNER_PROMPT_VERSION
  } else {
    throw new Error(`studio: agente desconhecido ${agentKey}`)
  }

  const r = await provider.call({
    system,
    userContent,
    parse,
    maxOutputTokens: perfil.maxOutputTokens,
    timeoutMs: perfil.timeoutMs,
    executionId,
  })

  return {
    data: r.output,
    usage: {
      provider: 'anthropic',
      model: r.model,
      inputTokens: r.inputTokens,
      uncachedInputTokens: r.uncachedInputTokens,
      cacheCreationInputTokens: r.cacheCreationInputTokens,
      cacheReadInputTokens: r.cacheReadInputTokens,
      outputTokens: r.outputTokens,
      imagesGenerated: 0,
      durationMs: r.durationMs,
      aiCalls: r.calls,
      promptVersion,
    },
  }
}
