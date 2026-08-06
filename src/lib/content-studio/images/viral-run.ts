// ============================================================================
// Content Studio — geração do modo VIRAL: 1 foto (capa) + N−1 slides de texto
// ----------------------------------------------------------------------------
// Custo visual de UM carrossel inteiro (5–8 slides): UMA chamada de imagem.
// A capa usa gpt-image-1 vertical 1024×1536 em qualidade ALTA e é composta
// para 1080×1350 (foto limpa em cima, painel preto embaixo). Os slides 2..N
// são renderizados DETERMINISTICAMENTE pelo FunilPro — zero OpenAI.
//
// Mesmo claim atômico do slot da capa (agent cst_image_designer, step_index
// 101): cinco cliques pagam UMA chamada; replay reutiliza; regenerar é só por
// clique explícito (CAS) e muda o path por attempt — arquivos anteriores
// permanecem no Storage.
// ============================================================================

import { agentErrorEventPayload } from '../types'
import type { ContentStore, ProductionRow } from '../types'
import { imageStepIndex, STUDIO_IMAGE_AGENT_KEY, type StudioImageStorage } from './run'
import { resolveStudioImageProvider } from './provider'
import type { ImageMode } from './modes'
import {
  buildViralCoverPrompt, coerceDesignerCover, deriveViralCoverDirection,
  isValidViralIntensity, VIRAL_COVER_PROMPT_VERSION, VIRAL_INTENSITY_DEFAULT,
  type ViralIntensity,
} from './viral-prompt'
import {
  composeViralCover, initialsOf, parseAccentColor, renderViralTextSlide,
  VIRAL_VISUAL_MODE,
} from './viral'
import { buildProductionResult } from '../result-view'
import { STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY } from '../studio/schema'

export interface ViralRunResult {
  ok: boolean
  state: 'created' | 'reused' | 'in_progress' | 'failed_existing' | 'failed' | 'invalid'
  errorCode?: string
}

interface ViralRunOptions {
  retry?: boolean
  intensity?: ViralIntensity
  /**
   * Qualidade da foto. `premium` (padrão) = `high`; `quick` = `medium`.
   *
   * Existe porque `high` em 1024×1536 às vezes passa do tempo da requisição e
   * a capa nunca sai. NÃO é fallback silencioso: o servidor jamais troca
   * sozinho — quem escolhe é a pessoa, no botão, depois de ler o motivo.
   */
  mode?: ImageMode
}

/**
 * Gera a CAPA (única chamada paga) e renderiza os slides internos. Toda a
 * validação acontece contra o estado persistido; o cliente só mandou o id e
 * o enum de intensidade.
 */
export async function runViralCover(
  store: ContentStore,
  storage: StudioImageStorage,
  production: ProductionRow,
  options: ViralRunOptions = {},
): Promise<ViralRunResult> {
  const brief = (production.brief ?? {}) as Record<string, unknown>
  if (brief.visual_mode !== VIRAL_VISUAL_MODE) {
    return { ok: false, state: 'invalid', errorCode: 'wrong_visual_mode' }
  }

  const steps = await store.listSteps(production.id)
  const copyOk = steps.some(s => s.agent_key === STUDIO_COPYWRITER_KEY && s.status === 'completed')
  const designer = steps.find(s => s.agent_key === STUDIO_DESIGNER_KEY && s.status === 'completed')
  if (!copyOk || !designer) return { ok: false, state: 'invalid', errorCode: 'text_not_ready' }

  const resultado = buildProductionResult(steps)
  const total = resultado.slides.length
  if (total < 2) return { ok: false, state: 'invalid', errorCode: 'invalid_slide' }

  // ── Claim atômico no SLOT DA CAPA (step_index 101). ─────────────────────
  const stepIndex = imageStepIndex(1)
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
      input: { kind: 'viral_cover' },
      output: null,
      attempt: 0,
      error: null,
      started_at: agora,
      completed_at: null,
    }])
    const step = rows.find(r => r.step_index === stepIndex) ?? rows[0]
    if (!inserted) {
      if (step.status === 'completed') return { ok: true, state: 'reused' }
      if (step.status === 'failed') return { ok: false, state: 'failed_existing', errorCode: 'already_failed' }
      return { ok: true, state: 'in_progress' }
    }
    stepId = step.id
  } else if (existente.status === 'running') {
    return { ok: true, state: 'in_progress' }
  } else if (existente.status === 'completed' && !options.retry) {
    return { ok: true, state: 'reused' }
  } else if (existente.status === 'failed' && !options.retry) {
    return { ok: false, state: 'failed_existing', errorCode: 'already_failed' }
  } else {
    const venceu = await store.transitionStepStatus(existente.id, ['failed', 'completed'], {
      status: 'running', attempt: existente.attempt + 1, error: null,
      started_at: agora, completed_at: null,
    })
    if (!venceu) return { ok: true, state: 'in_progress' }
    stepId = existente.id
    attempt = existente.attempt + 1
  }

  // ── Só o vencedor do claim: UMA chamada paga por capa. ──────────────────
  await store.emitEvent({
    productionId: production.id,
    type: 'agent_started',
    stepId,
    agentKey: STUDIO_IMAGE_AGENT_KEY,
    payload: { attempt, kind: 'viral_cover' },
  })

  try {
    const intensity = isValidViralIntensity(options.intensity) ? options.intensity : VIRAL_INTENSITY_DEFAULT
    const accentHex = parseAccentColor(brief.accent_color)
    const marca = typeof brief.marca_negocio === 'string' && brief.marca_negocio ? brief.marca_negocio : 'FunilPro'
    const iniciais = initialsOf(marca)

    // Direção da capa: bloco `cover` do Designer (v3) quando existir; senão
    // derivada DETERMINISTICAMENTE — nunca uma segunda chamada de IA.
    const designerData = (designer.output?.data ?? {}) as Record<string, unknown>
    const direction = coerceDesignerCover(designerData.cover)
      ?? deriveViralCoverDirection({
        tema: typeof brief.tema === 'string' ? brief.tema : resultado.titulo ?? '',
        headline: resultado.slides[0]?.headline ?? '',
        bigIdea: resultado.estrategia.angulo,
        publico: typeof brief.marca_publico === 'string' ? brief.marca_publico : null,
      })

    const prompt = buildViralCoverPrompt(direction, intensity)
    const provider = resolveStudioImageProvider()
    // Enum de lista branca -> qualidade REAL, decidida aqui no servidor.
    const quality = options.mode === 'quick' ? 'medium' : 'high'
    const foto = await provider.generate({
      prompt,
      quality,
      size: '1024x1536',          // vertical; composta para 1080x1350
      executionId: `${production.id}:${STUDIO_IMAGE_AGENT_KEY}:cover:a${attempt}`,
    })

    // ── Composição FunilPro: capa + TODOS os slides internos (sem OpenAI). ──
    const capaCopy = resultado.slides[0]
    const capaHighlights = (resultado.highlights[0] ?? []).slice(0, 2)
    const capa = await composeViralCover(foto.bytes, {
      headline: capaCopy?.headline ?? resultado.titulo ?? '',
      highlights: capaHighlights,
      marca, iniciais, totalSlides: total, accentHex,
    })

    const base = `content-studio/${production.tenant_id}/${production.id}/viral`
    const capaSalva = await storage.upload(`${base}/slide-1-a${attempt}.jpg`, capa.bytes, capa.contentType)

    const internos: { slide: number; path: string; url: string }[] = []
    for (let n = 2; n <= total; n++) {
      const s = resultado.slides[n - 1]
      const arte = await renderViralTextSlide({
        headline: s?.headline ?? '', body: s?.texto ?? '',
        highlights: (resultado.highlights[n - 1] ?? []).slice(0, 2),
        marca, iniciais, slideNumber: n, totalSlides: total, accentHex,
        cta: n === total ? (resultado.cta ?? undefined) : undefined,
      })
      const salvo = await storage.upload(`${base}/slide-${n}-a${attempt}.jpg`, arte.bytes, arte.contentType)
      internos.push({ slide: n, path: salvo.path, url: salvo.url })
    }

    // Persistência: SÓ metadados/URLs — bytes e base64 jamais.
    await store.updateStep(stepId, {
      status: 'completed',
      output: {
        data: {
          kind: 'viral_cover',
          slide: 1,
          path: capaSalva.path,
          url: capaSalva.url,
          model: foto.model,
          size: foto.size,
          quality: foto.quality,
          mode: options.mode === 'quick' ? 'quick' : 'premium',
          intensity,
          accentHex,
          attempt,
          width: capa.width,
          height: capa.height,
          textSlides: internos,
          coverDirection: direction,
        },
        artifacts: [],
        usage: {
          provider: 'openai', model: foto.model, inputTokens: 0, outputTokens: 0,
          imagesGenerated: 1, durationMs: foto.durationMs, aiCalls: 1,
          promptVersion: VIRAL_COVER_PROMPT_VERSION,
        },
      },
      completed_at: new Date().toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_completed',
      stepId,
      agentKey: STUDIO_IMAGE_AGENT_KEY,
      payload: { kind: 'viral_cover', slides: total },
    })
    return { ok: true, state: 'created' }
  } catch (err) {
    const extras = agentErrorEventPayload(err)
    const message = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string }).code
    const payloadErro = 'error_code' in extras
      ? extras : { error_code: typeof code === 'string' ? code : 'unknown' }

    await store.updateStep(stepId, {
      status: 'failed', error: message.slice(0, 300), completed_at: new Date().toISOString(),
    })
    await store.emitEvent({
      productionId: production.id,
      type: 'agent_failed',
      stepId,
      agentKey: STUDIO_IMAGE_AGENT_KEY,
      payload: { attempt, kind: 'viral_cover', ...payloadErro },
    })
    return { ok: false, state: 'failed', errorCode: typeof code === 'string' ? code : 'unknown' }
  }
}
