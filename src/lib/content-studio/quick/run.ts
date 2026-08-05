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
  /**
   * O que esta EXECUÇÃO fez:
   *   created         -> ganhou o claim, chamou a IA e concluiu
   *   reused          -> o step já estava concluído (nenhuma chamada)
   *   in_progress     -> outra execução está gerando AGORA (nenhuma chamada)
   *   failed_existing -> o step já falhou antes (nenhuma nova tentativa)
   *   failed          -> esta execução ganhou o claim e a IA falhou
   */
  state: 'created' | 'reused' | 'in_progress' | 'failed_existing' | 'failed'
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
  // CLAIM ATÔMICO PELA INSERÇÃO DO STEP. A eleição das cascas converge para
  // uma production_id, mas VÁRIAS requisições podem materializar a vencedora.
  // A primitiva de exclusão é o índice único uq_cs_steps_prod_index
  // (production_id, step_index): o step nasce JÁ em `running`, com started_at,
  // e só a execução que recebeu `inserted=true` conquistou o trabalho.
  // Perdedoras leem o estado e saem — sem provider, sem evento, sem escrita.
  const agora = new Date().toISOString()
  const { rows, inserted } = await store.insertSteps([{
    production_id: production.id,
    tenant_id: production.tenant_id,
    agent_key: QUICK_AGENT_KEY,
    step_index: 0,
    depends_on: [],
    status: 'running',
    input: null,
    output: null,
    attempt: 0,
    error: null,
    started_at: agora,
    completed_at: null,
  }])
  const step = rows[0]

  if (!inserted) {
    // Outra execução é (ou foi) a dona do trabalho. NENHUM caminho daqui toca
    // o provider, emite evento ou sobrescreve started_at/output.
    switch (step.status) {
      case 'completed':
        return { ok: true, state: 'reused' }
      case 'failed':
        // A falha já aconteceu e foi persistida — repetir automaticamente
        // seria uma segunda chamada paga sem decisão humana.
        return { ok: false, state: 'failed_existing', errorCode: 'already_failed' }
      case 'running':
        return { ok: true, state: 'in_progress' }
      default:
        // 'pending' é INALCANÇÁVEL para o quick (o step nasce running). Se um
        // estado legado/inesperado aparecer, a decisão segura é NÃO chamar o
        // provider sem um claim conquistado — tratamos como em andamento.
        return { ok: true, state: 'in_progress' }
    }
  }

  // Só o VENCEDOR do claim passa deste ponto.
  await store.emitEvent({
    productionId: production.id,
    type: 'production_created',
    payload: { pipeline_key: production.pipeline_key, steps: 1 },
  })
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
    return { ok: true, state: 'created' }
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
    return { ok: false, state: 'failed', errorCode: typeof code === 'string' ? code : 'unknown' }
  }
}

// AI_PROFILES é a referência dos demais perfis; o quick declara o seu aqui —
// mas exportamos junto para o teste do teto conferir todos num único lugar.
export const QUICK_PROFILE_REGISTERED = { ...AI_PROFILES, quick: QUICK_PROFILE }
