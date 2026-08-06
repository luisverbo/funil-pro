// ============================================================================
// Content Studio — geração da imagem de UM slide (Studio, sob demanda)
// ----------------------------------------------------------------------------
// A imagem NUNCA é gerada junto com a copy: só depois de Estrategista,
// Copywriter e Designer concluírem, e sempre por clique. O fluxo por slide:
//
//   claim atômico (step de imagem) → OpenAI gera o FUNDO → sharp compõe a
//   ARTE FINAL (headline/body/CTA/marca desenhados pelo FunilPro) → upload no
//   Storage → step completed com METADADOS (nunca base64) → eventos reais.
//
// IDENTIDADE persistida por slide, sem colisão com os steps de texto (0..2):
//   agent_key  = cst_image_designer   (o MESMO personagem Designer na cena)
//   step_index = 100 + slideNumber    (índice único (production_id, step_index)
//                                      é o claim — como nos steps de texto)
//
// Regeneração: SÓ explícita. Step `failed` nunca é refeito sozinho; o botão
// "Tentar novamente" disputa um CAS failed→running (transitionStepStatus) e
// exatamente um clique vence. Step `completed` é reutilizado — regenerar de
// propósito também passa pelo CAS (completed→running), então dois cliques de
// "Regenerar" também pagam UMA vez.
//
// A geração de imagem NÃO altera o status principal da produção: uma produção
// em awaiting_approval continua em awaiting_approval com as artes anexadas.
// ============================================================================

import { agentErrorEventPayload } from '../types'
import type { ContentStore, ProductionRow, StepRow } from '../types'
import { buildImagePrompt, STUDIO_IMAGE_PROMPT_VERSION } from './prompt'
import { composeSlideImage } from './compose'
import { resolveStudioImageProvider } from './provider'
import { buildProductionResult } from '../result-view'
import {
  STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY,
} from '../studio/schema'

export const STUDIO_IMAGE_AGENT_KEY = 'cst_image_designer'

/** step_index do slide N — fora do alcance dos steps de texto (0..2). */
export const STUDIO_IMAGE_STEP_BASE = 100
export function imageStepIndex(slideNumber: number): number {
  return STUDIO_IMAGE_STEP_BASE + slideNumber
}
export function slideOfImageStep(step: Pick<StepRow, 'agent_key' | 'step_index'>): number | null {
  if (step.agent_key !== STUDIO_IMAGE_AGENT_KEY) return null
  const n = step.step_index - STUDIO_IMAGE_STEP_BASE
  return n >= 1 && n <= 20 ? n : null
}

export interface StudioImageStorage {
  /** Recebe BYTES (nunca base64) e devolve o path/url públicos. */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<{ path: string; url: string }>
}

export interface ImageRunResult {
  ok: boolean
  state: 'created' | 'reused' | 'in_progress' | 'failed_existing' | 'failed' | 'invalid'
  errorCode?: string
  /** URL pública quando pronto. */
  url?: string
}

interface RunImageOptions {
  /**
   * Regeneração EXPLÍCITA: permite disputar o CAS de um step failed (Tentar
   * novamente) ou completed (Regenerar). Só a UI define — nunca automática.
   */
  retry?: boolean
}

/**
 * Gera (ou reutiliza) a imagem final do slide `slideNumber` de uma produção
 * Studio. Toda validação de negócio acontece AQUI, contra o que está no banco.
 */
export async function runStudioSlideImage(
  store: ContentStore,
  storage: StudioImageStorage,
  production: ProductionRow,
  slideNumber: number,
  options: RunImageOptions = {},
): Promise<ImageRunResult> {
  // ── Validações contra o ESTADO PERSISTIDO ────────────────────────────────
  const steps = await store.listSteps(production.id)
  const copyStep = steps.find(s => s.agent_key === STUDIO_COPYWRITER_KEY && s.status === 'completed')
  const designerStep = steps.find(s => s.agent_key === STUDIO_DESIGNER_KEY && s.status === 'completed')
  if (!copyStep || !designerStep) {
    return { ok: false, state: 'invalid', errorCode: 'text_not_ready' }
  }

  const resultado = buildProductionResult(steps)
  const total = resultado.slides.length
  if (!Number.isInteger(slideNumber) || slideNumber < 1 || slideNumber > total) {
    return { ok: false, state: 'invalid', errorCode: 'invalid_slide' }
  }
  const copySlide = resultado.slides.find(s => s.numero === slideNumber)
  const visualSlide = resultado.visual.slides.find(s => s.numero === slideNumber)
  if (!copySlide || !visualSlide) {
    return { ok: false, state: 'invalid', errorCode: 'invalid_slide' }
  }

  // ── Claim atômico do step de imagem ──────────────────────────────────────
  const stepIndex = imageStepIndex(slideNumber)
  const existente = steps.find(s => s.step_index === stepIndex)
  const agora = new Date().toISOString()

  let stepId: string
  let attempt = 0

  if (!existente) {
    const { rows, inserted } = await store.insertSteps([{
      production_id: production.id,
      tenant_id: production.tenant_id,
      agent_key: STUDIO_IMAGE_AGENT_KEY,
      step_index: stepIndex,
      depends_on: [STUDIO_DESIGNER_KEY],
      status: 'running',
      input: { slide: slideNumber },
      output: null,
      attempt: 0,
      error: null,
      started_at: agora,
      completed_at: null,
    }])
    const step = rows.find(r => r.step_index === stepIndex) ?? rows[0]
    if (!inserted) {
      // Outra execução chegou primeiro. Nenhum caminho daqui chama a OpenAI.
      if (step.status === 'completed') return reusar(step)
      if (step.status === 'failed') return { ok: false, state: 'failed_existing', errorCode: 'already_failed' }
      return { ok: true, state: 'in_progress' }
    }
    stepId = step.id
  } else if (existente.status === 'running') {
    return { ok: true, state: 'in_progress' }
  } else if (existente.status === 'completed' && !options.retry) {
    // Replay barato: a arte já existe, nenhuma chamada nova.
    return reusar(existente)
  } else if (existente.status === 'failed' && !options.retry) {
    // Falha paga NUNCA é repetida sozinha — só pelo botão explícito.
    return { ok: false, state: 'failed_existing', errorCode: 'already_failed' }
  } else {
    // Regeneração explícita (failed -> Tentar novamente | completed ->
    // Regenerar): CAS no step. Dois cliques simultâneos: UM vence.
    const venceu = await store.transitionStepStatus(existente.id, ['failed', 'completed'], {
      status: 'running',
      attempt: existente.attempt + 1,
      error: null,
      started_at: agora,
      completed_at: null,
    })
    if (!venceu) return { ok: true, state: 'in_progress' }
    stepId = existente.id
    attempt = existente.attempt + 1
  }

  // ── Só o VENCEDOR do claim passa daqui: UMA chamada paga. ────────────────
  await store.emitEvent({
    productionId: production.id,
    type: 'agent_started',
    stepId,
    agentKey: STUDIO_IMAGE_AGENT_KEY,
    payload: { attempt, slide: slideNumber, of: total },
  })

  try {
    const prompt = buildImagePrompt(resultado.visual.geral, visualSlide)
    const provider = resolveStudioImageProvider()
    const gerada = await provider.generate({
      prompt,
      executionId: `${production.id}:${STUDIO_IMAGE_AGENT_KEY}:s${slideNumber}:a${attempt}`,
    })

    // COMPOSIÇÃO FunilPro: o texto NUNCA vem na imagem da OpenAI.
    const brief = (production.brief ?? {}) as { marca_negocio?: string; cta?: string }
    const arte = await composeSlideImage(gerada.bytes, {
      headline: copySlide.headline,
      body: copySlide.texto,
      cta: slideNumber === total ? (resultado.cta ?? brief.cta ?? undefined) : undefined,
      marca: typeof brief.marca_negocio === 'string' ? brief.marca_negocio : undefined,
      slideNumber,
      totalSlides: total,
    })

    // Path com tenant e produção — nunca escolhido pelo cliente.
    const path = `content-studio/${production.tenant_id}/${production.id}/slide-${slideNumber}-a${attempt}.jpg`
    const salvo = await storage.upload(path, arte.bytes, arte.contentType)

    // Persistência: SÓ metadados. Base64/bytes jamais entram no banco.
    await store.updateStep(stepId, {
      status: 'completed',
      output: {
        data: {
          slide: slideNumber,
          path: salvo.path,
          url: salvo.url,
          model: gerada.model,
          size: gerada.size,
          quality: gerada.quality,
          width: arte.width,
          height: arte.height,
        },
        artifacts: [],
        usage: {
          provider: 'openai',
          model: gerada.model,
          inputTokens: 0,
          outputTokens: 0,
          imagesGenerated: 1,
          durationMs: gerada.durationMs,
          aiCalls: 1,
          promptVersion: STUDIO_IMAGE_PROMPT_VERSION,
        },
      },
      completed_at: new Date().toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_completed',
      stepId,
      agentKey: STUDIO_IMAGE_AGENT_KEY,
      payload: { slide: slideNumber, of: total },
    })
    // O status principal da produção NÃO muda: a arte é artefato anexado.
    return { ok: true, state: 'created', url: salvo.url }
  } catch (err) {
    const extras = agentErrorEventPayload(err)
    const message = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code
    const payloadErro = 'error_code' in extras
      ? extras
      : { error_code: typeof code === 'string' ? code : 'unknown' }

    await store.updateStep(stepId, {
      status: 'failed',
      error: message.slice(0, 300),
      completed_at: new Date().toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_failed',
      stepId,
      agentKey: STUDIO_IMAGE_AGENT_KEY,
      payload: { attempt, slide: slideNumber, ...payloadErro },
    })
    return { ok: false, state: 'failed', errorCode: typeof code === 'string' ? code : 'unknown' }
  }
}

function reusar(step: StepRow): ImageRunResult {
  const data = step.output?.data as { url?: string } | undefined
  return { ok: true, state: 'reused', url: typeof data?.url === 'string' ? data.url : undefined }
}
