// ============================================================================
// Content Studio — Criação rápida: execução de UMA chamada (Fase 3 MVP)
// ----------------------------------------------------------------------------
// O caminho curto que a infraestrutura pesada não entregava: uma Server Action
// autenticada → UMA chamada ao ContentAIProvider → resultado persistido →
// awaiting_approval. SEM jobs, SEM fila, SEM retry de orquestrador, SEM loop
// no cliente — o único retry é o técnico interno do provider (máx. 1).
//
// A persistência REAPROVEITA a porta ContentStore da Fase 1 (steps, eventos,
// status), só que sem tocar em insertJob/claimNextJob: o step existe para o
// resultado, a auditoria e o escritório — não para uma fila.
//
// Identidade persistida própria: pipeline_key content_carousel_quick_v1 e
// agent_key cc_quick_carousel. Nenhuma chave das gerações anteriores é
// reutilizada; produções antigas ficam intactas e legíveis.
//
// FALHA em qualquer ponto após a criação: step failed + produção failed +
// agent_failed com payload seguro — nunca uma produção eternamente `running`
// por erro tratável. (Queda abrupta do processo no meio da chamada é o único
// caso fora do alcance de um catch; sem fila, não há reagendamento fantasma.)
// ============================================================================

import { resolveContentAIProvider } from '../ai/bootstrap'
import { AI_PROFILES } from '../ai/config'
import { agentErrorEventPayload } from '../types'
import type { AgentUsage, ContentStore, ProductionRow } from '../types'
import { envelopeQuick, QUICK_PROMPT_VERSION, QUICK_SYSTEM } from './prompt'
import { makeQuickParser, QUICK_AGENT_KEY, type ValidQuickBrief } from './schema'

/** Perfil da chamada única: um pouco mais de teto — a resposta carrega tudo. */
export const QUICK_PROFILE = { maxOutputTokens: 2600, timeoutMs: 90_000 }

export interface QuickRunResult {
  ok: boolean
  /** Código seguro quando falhou (content_ai:*) ou 'unknown'. */
  errorCode?: string
}

/**
 * Executa a geração rápida sobre uma produção JÁ criada (casca draft).
 *
 * Toda a persistência passa pela porta `ContentStore` — em produção, a
 * implementação Supabase presa a (tenant, produção); nos testes, memória.
 */
export async function runQuickCarousel(
  store: ContentStore,
  production: ProductionRow,
  brief: ValidQuickBrief,
): Promise<QuickRunResult> {
  // Step único, materializado à mão (não há pipeline de orquestrador rodando).
  const { rows, inserted } = await store.insertSteps([{
    production_id: production.id,
    tenant_id: production.tenant_id,
    agent_key: QUICK_AGENT_KEY,
    step_index: 0,
    depends_on: [],
    status: 'pending',
    input: null,
    output: null,
    attempt: 0,
    error: null,
    started_at: null,
    completed_at: null,
  }])
  const step = rows[0]

  if (inserted) {
    await store.emitEvent({
      productionId: production.id,
      type: 'production_created',
      payload: { pipeline_key: production.pipeline_key, steps: 1 },
    })
  }

  // Reentrada (duplo clique/retry de rede na MESMA produção): se o step já
  // concluiu, não há o que refazer — e jamais uma segunda chamada de IA.
  if (!inserted && step.status === 'completed') return { ok: true }

  const inicio = new Date().toISOString()
  await store.updateStep(step.id, { status: 'running', started_at: inicio, error: null })
  await store.updateProductionStatus(production.id, 'running')
  await store.emitEvent({
    productionId: production.id,
    type: 'agent_started',
    stepId: step.id,
    agentKey: QUICK_AGENT_KEY,
    payload: { attempt: 0 },
  })

  try {
    // UMA chamada lógica. O provider pode fazer 1 retry técnico interno.
    const r = await resolveContentAIProvider().call({
      system: QUICK_SYSTEM,
      userContent: envelopeQuick(brief),
      parse: makeQuickParser(brief),
      maxOutputTokens: QUICK_PROFILE.maxOutputTokens,
      timeoutMs: QUICK_PROFILE.timeoutMs,
      executionId: `${production.id}:${QUICK_AGENT_KEY}:a0`,
    })

    const usage: AgentUsage = {
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
      promptVersion: QUICK_PROMPT_VERSION,
    }

    await store.updateStep(step.id, {
      status: 'completed',
      output: { data: r.output, artifacts: [], usage },
      completed_at: new Date().toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_completed',
      stepId: step.id,
      agentKey: QUICK_AGENT_KEY,
      payload: { usage },
    })
    await store.updateProductionStatus(production.id, 'awaiting_approval')
    await store.emitEvent({
      productionId: production.id,
      type: 'content_waiting_approval',
      payload: { steps: 1, final_status: 'awaiting_approval' },
    })
    return { ok: true }
  } catch (err) {
    // Depois do retry técnico do provider: FALHA. Sem segunda etapa, sem
    // revisor separado, sem reagendamento — e nunca `running` eterno.
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
      agentKey: QUICK_AGENT_KEY,
      payload: { attempt: 0, ...payloadErro },
    })
    await store.updateProductionStatus(production.id, 'failed')

    const code = (err as { code?: string }).code
    return { ok: false, errorCode: typeof code === 'string' ? code : 'unknown' }
  }
}

// AI_PROFILES é a referência dos demais perfis; o quick declara o seu aqui —
// mas exportamos junto para o teste do teto conferir todos num único lugar.
export const QUICK_PROFILE_REGISTERED = { ...AI_PROFILES, quick: QUICK_PROFILE }
