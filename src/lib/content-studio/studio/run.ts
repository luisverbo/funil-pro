// ============================================================================
// Content Studio — execução da geração Studio (3 agentes, SEM fila)
// ----------------------------------------------------------------------------
// Estrategista → Copywriter → Designer, UM agente novo por requisição:
//
//   createStudioProduction    -> executa no máximo o Estrategista
//   continueStudioProduction  -> executa no máximo o PRIMEIRO agente faltante
//   (2ª continuação)          -> executa o Designer e FINALIZA
//
// Ainda sem BullMQ, sem cron, sem orquestrador — mas com orçamento PREVISÍVEL:
// cada requisição paga no máximo uma chamada de IA, e o invariante de tempo é
// aritmético, não uma esperança:
//
//   timeoutMs(agente) + STUDIO_PERSISTENCE_MARGIN_MS
//     <= STUDIO_REQUEST_BUDGET_MS
//     <  maxDuration da rota * 1000
//
// TRÊS garantias independentes:
//
// 1. CLAIM ATÔMICO POR STEP — o step nasce `running`; a exclusão é o índice
//    único uq_cs_steps_prod_index (production_id, step_index). Só quem recebeu
//    `inserted=true` chama o provider — e SÓ o vencedor do claim do PRIMEIRO
//    step emite `production_created` e marca a produção `running`. Perdedoras
//    não emitem evento nem alteram status.
//
// 2. PORTÃO DE TEMPO ANTES DO CLAIM — um agente só começa se o timeout
//    INTEIRO dele, mais a margem de persistência, couber no tempo restante.
//    Não cabendo: `partial`, sem step, sem evento, sem provider. Depois do
//    claim, o timeout passado ao provider é re-clampado ao tempo que restar —
//    nunca maior que (restante − margem).
//
// 3. FINALIZAÇÃO IDEMPOTENTE — a transição para `awaiting_approval` é um
//    compare-and-set no banco (WHERE status IN ...): exatamente uma execução
//    transiciona, e só ela emite `content_waiting_approval`. Quem encontra a
//    produção já finalizada devolve `reused`. Isso também RECUPERA a produção
//    interrompida depois do último agente: steps todos `completed` com status
//    `running` finalizam na próxima chamada, sem provider.
// ============================================================================

import { resolveContentAIProvider } from '../ai/bootstrap'
import { agentErrorEventPayload } from '../types'
import type { AgentUsage, ContentStore, ProductionRow, ProductionStatus, StepRow } from '../types'
import {
  copywriterUserContent, designerUserContent, envelopeStudio,
  studioCopywriterSystem, studioDesignerSystem, studioStrategistSystem,
  STUDIO_COPYWRITER_PROMPT_VERSION, STUDIO_DESIGNER_PROMPT_VERSION,
  STUDIO_DESIGNER_VIRAL_PROMPT_VERSION,
  STUDIO_STRATEGIST_PROMPT_VERSION,
} from './prompt'
import {
  makeCopyParser, makeStrategyParser, makeVisualParser,
  STUDIO_AGENT_ORDER, STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY,
  STUDIO_STRATEGIST_KEY,
  type StudioCopy, type StudioStrategy, type ValidStudioBrief,
} from './schema'

// ─── Orçamento de tempo ─────────────────────────────────────────────────────

/**
 * Tempo reservado para TUDO que não é a chamada de IA: gravar o step, os
 * eventos, o usage, o status e devolver a resposta — inclusive no caminho de
 * ERRO (persistir `failed` depois de um timeout do provider).
 */
export const STUDIO_PERSISTENCE_MARGIN_MS = 5_000

/**
 * Folga para o tempo que passa ANTES do provider ser chamado: auth, leitura da
 * produção, listagem dos steps, o próprio claim. Sem ela, um agente cujo
 * timeout preenche o orçamento exato nunca passa no portão — foi EXATAMENTE o
 * defeito visto em produção: `deadline = agora + 45s` na entrada, alguns ms
 * depois o portão media `restante < 45s` e o Copywriter (40s + 5s) jamais
 * começava; toda continuação repetia `partial` e a produção parava no
 * Estrategista.
 */
export const STUDIO_DISPATCH_MARGIN_MS = 2_000

/**
 * Orçamento de UMA requisição.
 *
 * HISTÓRICO IMPORTANTE: era 45s porque a rota declarava maxDuration = 60s.
 * Quando a rota subiu para 300s (Fluid Compute), este número ficou para trás —
 * e foi exatamente ele que produziu `content_ai:timeout: 35000ms` no Designer
 * em produção: o agente tinha 35s para uma resposta que leva mais. O teto da
 * rota não é o orçamento; o orçamento é este, e ele agora tem folga real.
 *
 * Continua UM AGENTE POR REQUISIÇÃO de propósito: é o que faz a cena do
 * escritório mostrar progresso a cada etapa em vez de congelar por minutos.
 */
export const STUDIO_REQUEST_BUDGET_MS = 120_000

/**
 * Perfil de cada agente. O invariante — conferido por teste e reafirmado em
 * runtime no carregamento — é:
 *
 *   timeoutMs + STUDIO_PERSISTENCE_MARGIN_MS + STUDIO_DISPATCH_MARGIN_MS
 *     <= STUDIO_REQUEST_BUDGET_MS
 *
 * E o portão exige as DUAS margens além do timeout, então a folga real de
 * overhead de cada agente é `orçamento − (timeout + margens)` — no pior caso
 * (90s), ainda sobram 23s de tolerância além da folga de despacho.
 */
export const STUDIO_PROFILES = {
  [STUDIO_STRATEGIST_KEY]: { maxOutputTokens: 1200, timeoutMs: 70_000 },
  [STUDIO_COPYWRITER_KEY]: { maxOutputTokens: 2600, timeoutMs: 90_000 },
  [STUDIO_DESIGNER_KEY]: { maxOutputTokens: 2800, timeoutMs: 90_000 },
} as const

for (const [k, p] of Object.entries(STUDIO_PROFILES)) {
  const necessario = p.timeoutMs + STUDIO_PERSISTENCE_MARGIN_MS + STUDIO_DISPATCH_MARGIN_MS
  if (necessario > STUDIO_REQUEST_BUDGET_MS) {
    // Configuração impossível não deve nem carregar — falha no import, não
    // no meio de uma produção paga.
    throw new Error(`studio: perfil de ${k} não cabe no orçamento da requisição`)
  }
}

// ─── Step running abandonado ────────────────────────────────────────────────

/**
 * Idade mínima para considerar um step `running` ABANDONADO.
 *
 * Precisa ser MAIOR que tudo o que uma execução legítima pode durar: o maior
 * timeout de agente (90s) + margem de persistência (5s) + margem de despacho
 * (2s). Declarar stale cedo demais é pior que esperar: ofereceria o botão de
 * retomada para um agente que ainda está trabalhando, e o clique pagaria uma
 * segunda chamada à toa. 180s dá o dobro do pior caso legítimo.
 */
export const STUDIO_STALE_RUNNING_MS = 180_000

{
  const maiorTimeout = Math.max(...Object.values(STUDIO_PROFILES).map(p => p.timeoutMs))
  const teto = maiorTimeout + STUDIO_PERSISTENCE_MARGIN_MS + STUDIO_DISPATCH_MARGIN_MS
  if (STUDIO_STALE_RUNNING_MS <= teto) {
    throw new Error('studio: limite de stale menor que uma execução legítima')
  }
}

/**
 * Um step running está ABANDONADO? Decisão do RELÓGIO DO SERVIDOR, nunca do
 * cliente. started_at ausente/ilegível é estado inconsistente: recuperável
 * pelo clique explícito, mas jamais dispara provider sozinho.
 */
export function isStaleRunningStep(
  step: Pick<StepRow, 'status' | 'started_at'>,
  nowMs: number,
): boolean {
  if (step.status !== 'running') return false
  if (!step.started_at) return true  // inconsistente: sem início registrado
  const inicio = Date.parse(step.started_at)
  if (Number.isNaN(inicio)) return true
  return nowMs - inicio >= STUDIO_STALE_RUNNING_MS
}

/** Estados a partir dos quais a finalização pode transicionar. */
const FINALIZABLE: readonly ProductionStatus[] = ['draft', 'queued', 'running']

export interface StudioRunResult {
  ok: boolean
  /**
   * O que esta EXECUÇÃO fez:
   *   created         -> FINALIZOU a produção (rodou o último agente, ou
   *                      recuperou uma interrompida cujo trabalho já existia)
   *   partial         -> executou no máximo UM agente; ainda falta trabalho
   *   reused          -> já estava tudo pronto (nenhuma chamada, nenhum evento)
   *   in_progress     -> outra execução está num step AGORA (nenhuma chamada)
   *   failed_existing -> algum step já falhou antes (nenhuma nova tentativa)
   *   failed          -> esta execução ganhou o claim e a IA falhou
   */
  state: 'created' | 'partial' | 'reused' | 'in_progress' | 'failed_existing' | 'failed'
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

/** Saída já validada dos agentes anteriores, lida da persistência. */
interface Bagagem {
  strategy?: StudioStrategy
  copy?: StudioCopy
}

function readData(step: StepRow | undefined): Record<string, unknown> | null {
  const data = step?.output?.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

/**
 * Executa (uma fatia da) geração Studio sobre uma produção JÁ criada.
 *
 * Idempotente por construção: reentrada pula steps concluídos lendo o output
 * persistido e executa somente o PRIMEIRO faltante — nunca refaz, nunca paga
 * duas vezes pelo mesmo step.
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

  const bagagem: Bagagem = {}
  let executouAgente = false

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

    // ── Um agente NOVO por requisição. Já rodou um? O resto fica para a
    //    próxima chamada — orçamento previsível vale mais que latência. ──────
    if (executouAgente) {
      return { ok: true, state: 'partial', pending: faltantes(indice) }
    }

    // ── Portão de tempo ANTES do claim: o agente INTEIRO precisa caber —
    //    timeout MAIS as duas margens (despacho + persistência). O overhead
    //    normal da requisição (auth, leituras, claim) é coberto pela folga
    //    entre `necessário` e o orçamento, garantida pelo invariante. ────────
    const perfil = STUDIO_PROFILES[agentKey]
    const necessarioMs = perfil.timeoutMs + STUDIO_PERSISTENCE_MARGIN_MS + STUDIO_DISPATCH_MARGIN_MS
    if (deadline - agora() < necessarioMs) {
      // Nenhum step, nenhum evento, nenhum provider — nada a limpar depois.
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
    // `production_created` pertence ao vencedor do PRIMEIRO step — não a quem
    // leu a lista vazia. Duas materializações concorrentes leem zero steps,
    // mas só uma insere o step 0, e só ela anuncia a produção.
    if (indice === 0) {
      await store.emitEvent({
        productionId: production.id,
        type: 'production_created',
        payload: { pipeline_key: production.pipeline_key, steps: STUDIO_AGENT_ORDER.length },
      })
      await store.updateProductionStatus(production.id, 'running')
    }

    await store.emitEvent({
      productionId: production.id,
      type: 'agent_started',
      stepId: step.id,
      agentKey,
      payload: { attempt: 0 },
    })

    try {
      // Defesa em profundidade: mesmo tendo passado no portão, o timeout
      // entregue ao provider é re-clampado ao tempo que RESTA agora — o relógio
      // andou entre o portão e este ponto.
      const restanteMs = Math.max(deadline - agora() - STUDIO_PERSISTENCE_MARGIN_MS, 1)
      const timeoutMs = Math.min(perfil.timeoutMs, restanteMs)

      const saida = await chamarAgente(agentKey, brief, bagagem, production.id, {
        maxOutputTokens: perfil.maxOutputTokens,
        timeoutMs,
      })
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
      executouAgente = true

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

  // ── Todos os steps concluídos: FINALIZAÇÃO IDEMPOTENTE por CAS. ───────────
  // Exatamente UMA execução realiza a transição para awaiting_approval — e só
  // ela emite content_waiting_approval. Também cobre a recuperação: produção
  // interrompida depois do último agente (steps completos, status `running`)
  // finaliza aqui na próxima chamada, sem tocar no provider.
  const transicionou = await store.transitionProductionStatus(
    production.id, FINALIZABLE, 'awaiting_approval',
  )
  if (transicionou) {
    await store.emitEvent({
      productionId: production.id,
      type: 'content_waiting_approval',
      payload: { steps: STUDIO_AGENT_ORDER.length, final_status: 'awaiting_approval' },
    })
  }

  if (transicionou || executouAgente) return { ok: true, state: 'created', pending: [] }
  return { ok: true, state: 'reused', pending: [] }
}

export interface StaleRetryResult {
  ok: boolean
  /**
   * created      -> recuperou o step E (se era o último) finalizou a produção
   * partial      -> recuperou o step; ainda falta agente depois dele
   * in_progress  -> outra execução venceu a posse AGORA (nenhuma chamada)
   * not_stale    -> o step running ainda é recente — nada foi feito
   * invalid      -> não há step recuperável neste estado
   * failed       -> a nova tentativa chamou a IA e falhou (persistido)
   */
  state: 'created' | 'partial' | 'in_progress' | 'not_stale' | 'invalid' | 'failed'
  errorCode?: string
}

/**
 * RECUPERAÇÃO EXPLÍCITA de um step `running` abandonado.
 *
 * A causa do órfão: a Server Action morre depois do claim (step nasce
 * `running`) e antes de persistir completed/failed — sem fila, ninguém volta
 * para fechá-lo, e `runStudioCarousel` devolve `in_progress` para sempre.
 *
 * Esta função NUNCA roda sozinha: é o backend do botão "Tentar novamente o
 * {agente}" — a chamada anterior pode ter consumido tokens mesmo sem ter sido
 * persistida, então repetir exige um clique consciente.
 *
 * POSSE ATÔMICA: CAS running→running com predicado do started_at ANTIGO na
 * própria UPDATE (transitionStepStatus + expectedStartedAt). Dois cliques
 * leem o mesmo started_at; o vencedor o substitui; o perdedor não casa o
 * predicado e recebe `in_progress`. Nada é deletado nem reinserido; steps
 * concluídos (Estrategista, Copywriter) jamais são tocados.
 */
export async function retryStaleStudioStep(
  store: ContentStore,
  production: ProductionRow,
  brief: ValidStudioBrief,
  options: { now?: () => number } = {},
): Promise<StaleRetryResult> {
  const agora = options.now ?? (() => Date.now())

  const steps = await store.listSteps(production.id)
  const porAgente = new Map(steps.map(st => [st.agent_key, st]))

  // O step recuperável é o PRIMEIRO da ordem que está `running` — e todos os
  // anteriores precisam estar completed (senão o estado é outro problema).
  let alvoIndice = -1
  for (let i = 0; i < STUDIO_AGENT_ORDER.length; i++) {
    const st = porAgente.get(STUDIO_AGENT_ORDER[i])
    if (st?.status === 'completed') continue
    if (st?.status === 'running') { alvoIndice = i; break }
    return { ok: false, state: 'invalid', errorCode: 'no_running_step' }
  }
  if (alvoIndice < 0) return { ok: false, state: 'invalid', errorCode: 'no_running_step' }

  const agentKey = STUDIO_AGENT_ORDER[alvoIndice]
  const alvo = porAgente.get(agentKey)!

  // Stale é decisão do RELÓGIO DO SERVIDOR. Recente: nada de provider.
  if (!isStaleRunningStep(alvo, agora())) {
    return { ok: true, state: 'not_stale' }
  }

  // ── Posse atômica: só quem trocar o started_at ANTIGO pelo novo executa. ──
  const novoAttempt = alvo.attempt + 1
  const novoInicio = new Date(agora()).toISOString()
  const venceu = await store.transitionStepStatus(
    alvo.id,
    ['running'],
    { status: 'running', attempt: novoAttempt, started_at: novoInicio, error: null, completed_at: null },
    alvo.started_at ?? null,
  )
  if (!venceu) return { ok: true, state: 'in_progress' }

  // Auditoria da retomada — attempt e motivo, nada de erro bruto/prompt.
  await store.emitEvent({
    productionId: production.id,
    type: 'agent_retrying',
    stepId: alvo.id,
    agentKey,
    payload: { attempt: novoAttempt, reason_code: 'stale_running_recovery' },
  })
  await store.emitEvent({
    productionId: production.id,
    type: 'agent_started',
    stepId: alvo.id,
    agentKey,
    payload: { attempt: novoAttempt },
  })

  // A bagagem vem SÓ dos steps concluídos persistidos — nada é refeito.
  const bagagem: Bagagem = {}
  for (const k of STUDIO_AGENT_ORDER.slice(0, alvoIndice)) {
    absorver(bagagem, k, readData(porAgente.get(k)))
  }

  try {
    const perfil = STUDIO_PROFILES[agentKey]
    const saida = await chamarAgente(agentKey, brief, bagagem, production.id, perfil, novoAttempt)

    await store.updateStep(alvo.id, {
      status: 'completed',
      output: { data: saida.data, artifacts: [], usage: saida.usage },
      completed_at: new Date(agora()).toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_completed',
      stepId: alvo.id,
      agentKey,
      payload: { usage: saida.usage, attempt: novoAttempt },
    })

    // Era o último? FINALIZA pelo MESMO CAS idempotente do runner normal —
    // um único content_waiting_approval, nenhum production_created novo.
    if (alvoIndice === STUDIO_AGENT_ORDER.length - 1) {
      const transicionou = await store.transitionProductionStatus(
        production.id, FINALIZABLE, 'awaiting_approval',
      )
      if (transicionou) {
        await store.emitEvent({
          productionId: production.id,
          type: 'content_waiting_approval',
          payload: { steps: STUDIO_AGENT_ORDER.length, final_status: 'awaiting_approval' },
        })
      }
      return { ok: true, state: 'created' }
    }
    return { ok: true, state: 'partial' }
  } catch (err) {
    const extras = agentErrorEventPayload(err)
    const message = err instanceof Error ? err.message : String(err)
    const payloadErro = 'error_code' in extras ? extras : { error: message.slice(0, 300), ...extras }

    await store.updateStep(alvo.id, {
      status: 'failed',
      error: message.slice(0, 300),
      completed_at: new Date(agora()).toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_failed',
      stepId: alvo.id,
      agentKey,
      payload: { attempt: novoAttempt, ...payloadErro },
    })
    await store.updateProductionStatus(production.id, 'failed')

    const code = (err as { code?: string }).code
    return { ok: false, state: 'failed', errorCode: typeof code === 'string' ? code : 'unknown' }
  }
}

/**
 * RETOMADA EXPLÍCITA de um step `failed` — o backend do botão "Tentar
 * novamente o {agente}" quando a produção inteira está `failed`.
 *
 * Diferente do caso stale, aqui a falha FOI persistida (timeout do provider,
 * erro HTTP, resposta que não parseou). Repetir é uma nova chamada PAGA e por
 * isso nunca acontece sozinha: `runStudioCarousel` devolve `already_failed` de
 * propósito — quem decide pagar de novo é a pessoa, com um clique.
 *
 * POSSE ATÔMICA: CAS failed→running na própria UPDATE. Dois cliques
 * simultâneos leem o mesmo step `failed`; só um casa o predicado e chama a IA
 * — o outro recebe `in_progress`. Steps concluídos jamais são tocados, e a
 * produção volta de `failed` para `running` pelo MESMO CAS de status.
 */
export async function retryFailedStudioStep(
  store: ContentStore,
  production: ProductionRow,
  brief: ValidStudioBrief,
  options: { now?: () => number } = {},
): Promise<StaleRetryResult> {
  const agora = options.now ?? (() => Date.now())

  const steps = await store.listSteps(production.id)
  const porAgente = new Map(steps.map(st => [st.agent_key, st]))

  // O step retomável é o PRIMEIRO da ordem que está `failed` — e todos os
  // anteriores precisam estar completed (o que já foi pago não se repete).
  let alvoIndice = -1
  for (let i = 0; i < STUDIO_AGENT_ORDER.length; i++) {
    const st = porAgente.get(STUDIO_AGENT_ORDER[i])
    if (st?.status === 'completed') continue
    if (st?.status === 'failed') { alvoIndice = i; break }
    return { ok: false, state: 'invalid', errorCode: 'no_failed_step' }
  }
  if (alvoIndice < 0) return { ok: false, state: 'invalid', errorCode: 'no_failed_step' }

  const agentKey = STUDIO_AGENT_ORDER[alvoIndice]
  const alvo = porAgente.get(agentKey)!

  // ── Posse atômica: só quem transicionar failed→running executa. ───────────
  const novoAttempt = alvo.attempt + 1
  const novoInicio = new Date(agora()).toISOString()
  const venceu = await store.transitionStepStatus(
    alvo.id,
    ['failed'],
    { status: 'running', attempt: novoAttempt, started_at: novoInicio, error: null, completed_at: null },
  )
  if (!venceu) return { ok: true, state: 'in_progress' }

  // A produção sai de `failed` pelo mesmo CAS idempotente — se outra execução
  // já a moveu, tudo bem: o dono do step é quem manda daqui em diante.
  await store.transitionProductionStatus(production.id, ['failed'], 'running')

  await store.emitEvent({
    productionId: production.id,
    type: 'agent_retrying',
    stepId: alvo.id,
    agentKey,
    payload: { attempt: novoAttempt, reason_code: 'failed_step_recovery' },
  })
  await store.emitEvent({
    productionId: production.id,
    type: 'agent_started',
    stepId: alvo.id,
    agentKey,
    payload: { attempt: novoAttempt },
  })

  // A bagagem vem SÓ dos steps concluídos persistidos — nada é refeito.
  const bagagem: Bagagem = {}
  for (const k of STUDIO_AGENT_ORDER.slice(0, alvoIndice)) {
    absorver(bagagem, k, readData(porAgente.get(k)))
  }

  try {
    const perfil = STUDIO_PROFILES[agentKey]
    const saida = await chamarAgente(agentKey, brief, bagagem, production.id, perfil, novoAttempt)

    await store.updateStep(alvo.id, {
      status: 'completed',
      output: { data: saida.data, artifacts: [], usage: saida.usage },
      completed_at: new Date(agora()).toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_completed',
      stepId: alvo.id,
      agentKey,
      payload: { usage: saida.usage, attempt: novoAttempt },
    })

    if (alvoIndice === STUDIO_AGENT_ORDER.length - 1) {
      const transicionou = await store.transitionProductionStatus(
        production.id, FINALIZABLE, 'awaiting_approval',
      )
      if (transicionou) {
        await store.emitEvent({
          productionId: production.id,
          type: 'content_waiting_approval',
          payload: { steps: STUDIO_AGENT_ORDER.length, final_status: 'awaiting_approval' },
        })
      }
      return { ok: true, state: 'created' }
    }
    return { ok: true, state: 'partial' }
  } catch (err) {
    const extras = agentErrorEventPayload(err)
    const message = err instanceof Error ? err.message : String(err)
    const payloadErro = 'error_code' in extras ? extras : { error: message.slice(0, 300), ...extras }

    await store.updateStep(alvo.id, {
      status: 'failed',
      error: message.slice(0, 300),
      completed_at: new Date(agora()).toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_failed',
      stepId: alvo.id,
      agentKey,
      payload: { attempt: novoAttempt, ...payloadErro },
    })
    await store.updateProductionStatus(production.id, 'failed')

    const code = (err as { code?: string }).code
    return { ok: false, state: 'failed', errorCode: typeof code === 'string' ? code : 'unknown' }
  }
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
  attempt = 0,
): Promise<SaidaAgente> {
  const provider = resolveContentAIProvider()
  const executionId = `${productionId}:${agentKey}:a${attempt}`

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
    promptVersion = brief.visual_mode === 'viral_cover_text_v1'
      ? STUDIO_DESIGNER_VIRAL_PROMPT_VERSION
      : STUDIO_DESIGNER_PROMPT_VERSION
  } else {
    throw new Error(`studio: agente desconhecido ${agentKey}`)
  }

  // No modo viral o Designer entrega SÓ a direção da capa + notas de layout:
  // saída ~3x menor. Teto reduzido = resposta mais rápida (o Designer era o
  // agente que mais estourava o tempo) e mais barata — decisão do SERVIDOR.
  const maxOutputTokens =
    agentKey === STUDIO_DESIGNER_KEY && brief.visual_mode === 'viral_cover_text_v1'
      ? Math.min(perfil.maxOutputTokens, 1_600)
      : perfil.maxOutputTokens

  const r = await provider.call({
    system,
    userContent,
    parse,
    maxOutputTokens,
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
