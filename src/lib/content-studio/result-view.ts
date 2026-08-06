// ============================================================================
// Content Studio — resultado da produção (leitura da PERSISTÊNCIA)
// ----------------------------------------------------------------------------
// Monta o painel de resultado a partir de `cs_steps.output` — o que os agentes
// realmente gravaram.
//
// O navegador NÃO reconstrói nada. Não roda agente, não recombina briefing, não
// deduz slide a partir de evento. Se o dado não está no banco, ele não aparece.
// A diferença importa: um painel que "remonta" o resultado no cliente mostraria
// algo plausível mesmo quando o backend gravou outra coisa — e a pessoa
// aprovaria (Fase 2B) um material que não é o que existe.
//
// Função PURA: recebe linhas de step, devolve o que a tela mostra.
// ============================================================================

import type { CheckItem } from './agents/carousel'
import type { StepRow } from './types'

/** Vereditos possíveis do revisor — 2A e 2B. */
export type AnyVerdict =
  | 'aprovado_para_revisao' | 'needs_revision' | 'approved_for_human_review'

/** Metadados de IA agregados da produção — só números seguros, nada de prompt. */
export interface AIMeta {
  model: string | null
  totalCalls: number
  inputTokens: number
  outputTokens: number
  promptVersions: string[]
  /** true quando algum step foi gerado por IA real (provider anthropic). */
  usedRealAI: boolean
}

export interface ResultSlide {
  numero: number
  papel: string
  headline: string
  texto: string
}

/** Direção visual de UM slide — saída do Designer (geração Studio). */
export interface ResultVisualSlide {
  numero: number
  estilo: string
  composicao: string
  elementos: string[]
  cores: string
  layout: string
  promptImagem: string
}

/** Direção visual da peça inteira + por slide. Vazia nas gerações anteriores. */
export interface ResultVisual {
  disponivel: boolean
  geral: { estilo: string | null; paleta: string | null; tipografia: string | null; clima: string | null }
  slides: ResultVisualSlide[]
}

/** Estado da ARTE final de um slide (geração Studio, sob demanda). */
export interface ResultSlideImage {
  numero: number
  status: 'nao_gerado' | 'gerando' | 'pronto' | 'falhou'
  url: string | null
  /** Metadados discretos da geração — exibidos no preview. */
  modelo: string | null
  modo: 'quick' | 'premium' | null
  tentativa: number
}

export interface ProductionResult {
  titulo: string | null
  estrategia: {
    angulo: string | null
    promessa: string | null
    tom: string | null
  }
  slides: ResultSlide[]
  legenda: string | null
  cta: string | null
  hashtags: string[]
  revisao: {
    verdict: AnyVerdict | null
    checklist: CheckItem[]
    avisos: string[]
    /** Notas 0-10 do revisor de IA (2B). Vazio na 2A. */
    scores: Record<string, number>
    media: number | null
  }
  /** Quantas vezes o copy foi reescrito por pedido do revisor. */
  revisionCycle: number
  /** Direção visual do Designer. `disponivel: false` nas gerações sem Designer. */
  visual: ResultVisual
  /** Quantidade de slides que o usuário PEDIU (geração Studio). */
  slidesPedidos: number | null
  /** Arte final por slide — um item por slide da copy (geração Studio). */
  imagens: ResultSlideImage[]
  /** true quando há material suficiente para mostrar o painel. */
  disponivel: boolean
  /** Metadados de IA agregados — para o selo "IA real" e contagem de chamadas. */
  ai: AIMeta
}

function dataDe(steps: StepRow[], agentKey: string): Record<string, unknown> | null {
  const step = steps.find(s => s.agent_key === agentKey && s.status === 'completed')
  const data = step?.output?.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

const AI_META_VAZIO: AIMeta = {
  model: null, totalCalls: 0, inputTokens: 0, outputTokens: 0,
  promptVersions: [], usedRealAI: false,
}

const VISUAL_VAZIO: ResultVisual = {
  disponivel: false,
  geral: { estilo: null, paleta: null, tipografia: null, clima: null },
  slides: [],
}

const RESULTADO_VAZIO: ProductionResult = {
  titulo: null,
  estrategia: { angulo: null, promessa: null, tom: null },
  slides: [],
  legenda: null,
  cta: null,
  hashtags: [],
  revisao: { verdict: null, checklist: [], avisos: [], scores: {}, media: null },
  revisionCycle: 0,
  visual: { ...VISUAL_VAZIO, geral: { ...VISUAL_VAZIO.geral }, slides: [] },
  slidesPedidos: null,
  imagens: [],
  disponivel: false,
  ai: { ...AI_META_VAZIO },
}

/** Soma os metadados de IA gravados em cs_steps.output.usage. */
function aggregateAI(steps: StepRow[]): AIMeta {
  const meta: AIMeta = { ...AI_META_VAZIO, promptVersions: [] }
  for (const step of steps) {
    const u = step.output?.usage
    if (!u) continue
    meta.totalCalls += typeof u.aiCalls === 'number' ? u.aiCalls : 0
    meta.inputTokens += u.inputTokens ?? 0
    meta.outputTokens += u.outputTokens ?? 0
    if (u.promptVersion && !meta.promptVersions.includes(u.promptVersion)) {
      meta.promptVersions.push(u.promptVersion)
    }
    if (u.provider === 'anthropic') {
      meta.usedRealAI = true
      if (u.model) meta.model = u.model
    }
  }
  return meta
}

/**
 * Monta o resultado a partir dos steps concluídos.
 *
 * Só lê steps `completed`: um step que falhou pode ter deixado output parcial,
 * e mostrá-lo como resultado seria apresentar rascunho abandonado como entrega.
 */
/**
 * Resultado da Criação rápida — um único output com copy, estratégia embutida
 * e a auto-verificação (`review.notes` vira os avisos do painel). Nenhum dado
 * de gerações antigas entra aqui.
 */
function buildQuickResult(data: Record<string, unknown>, steps: StepRow[]): ProductionResult {
  const estrategia = (data.strategy && typeof data.strategy === 'object')
    ? (data.strategy as Record<string, unknown>) : {}
  const review = (data.review && typeof data.review === 'object')
    ? (data.review as Record<string, unknown>) : {}
  const slidesBrutos = Array.isArray(data.slides) ? data.slides : []

  const slides: ResultSlide[] = slidesBrutos
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => ({
      numero: typeof s.number === 'number' ? s.number : i + 1,
      papel: '',
      headline: texto(s.headline) ?? '',
      texto: texto(s.body) ?? '',
    }))

  const notes = (Array.isArray(review.notes) ? review.notes : [])
    .filter((n): n is string => typeof n === 'string')

  return {
    titulo: texto(data.title),
    estrategia: {
      angulo: texto(estrategia.bigIdea) ?? texto(estrategia.angle),
      promessa: texto(estrategia.promise),
      tom: null,
    },
    slides,
    legenda: texto(data.caption),
    cta: texto(data.cta),
    hashtags: Array.isArray(data.hashtags)
      ? (data.hashtags as string[]).filter(h => typeof h === 'string') : [],
    revisao: {
      verdict: review.approved === true ? 'approved_for_human_review' : null,
      checklist: [],
      avisos: notes,
      scores: {},
      media: null,
    },
    revisionCycle: 0,
    visual: { ...VISUAL_VAZIO, geral: { ...VISUAL_VAZIO.geral }, slides: [] },
    slidesPedidos: null,
    imagens: [],
    disponivel: slides.length > 0,
    ai: aggregateAI(steps),
  }
}

/**
 * Resultado da geração Studio — três steps distintos:
 *   cst_strategist -> estratégia (tese, ângulo, promessa, tom)
 *   cst_copywriter -> copy final (título, slides, legenda, CTA, hashtags)
 *   cst_designer   -> direção visual + prompt de imagem por slide
 *
 * Cada campo vem do agente que o produziu. O painel mostra a copy assim que o
 * Copywriter termina, mesmo que o Designer ainda não tenha rodado — o que
 * existe aparece, o que não existe não é inventado.
 */
function buildStudioResult(steps: StepRow[]): ProductionResult {
  const plano = dataDe(steps, 'cst_strategist')
  const copy = dataDe(steps, 'cst_copywriter')
  const arte = dataDe(steps, 'cst_designer')

  const slidesBrutos = Array.isArray(copy?.slides) ? copy.slides : []
  const slides: ResultSlide[] = slidesBrutos
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => ({
      numero: typeof s.number === 'number' ? s.number : i + 1,
      papel: '',
      headline: texto(s.headline) ?? '',
      texto: texto(s.body) ?? '',
    }))

  const review = (copy?.review && typeof copy.review === 'object')
    ? (copy.review as Record<string, unknown>) : {}
  const notes = (Array.isArray(review.notes) ? review.notes : [])
    .filter((n): n is string => typeof n === 'string')

  // ── Direção visual ──
  const dirGeral = (arte?.direction && typeof arte.direction === 'object')
    ? (arte.direction as Record<string, unknown>) : {}
  const visualBrutos = Array.isArray(arte?.slides) ? arte.slides : []
  const visualSlides: ResultVisualSlide[] = visualBrutos
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => ({
      numero: typeof s.number === 'number' ? s.number : i + 1,
      estilo: texto(s.style) ?? '',
      composicao: texto(s.composition) ?? '',
      elementos: (Array.isArray(s.elements) ? s.elements : []).filter((e): e is string => typeof e === 'string'),
      cores: texto(s.colors) ?? '',
      layout: texto(s.layout) ?? '',
      promptImagem: texto(s.imagePrompt) ?? '',
    }))

  // ── Arte final por slide: steps cst_image_designer (step_index 100+N). O
  // status vem do STEP persistido — a tela nunca inventa "pronto".
  const imagens: ResultSlideImage[] = slides.map(s => {
    const stepImagem = steps.find(
      st => st.agent_key === 'cst_image_designer' && st.step_index === 100 + s.numero,
    )
    const dados = (stepImagem?.output?.data ?? null) as { url?: string; model?: string; mode?: string } | null
    return {
      numero: s.numero,
      status: !stepImagem ? 'nao_gerado'
        : stepImagem.status === 'completed' ? 'pronto'
        : stepImagem.status === 'failed' ? 'falhou'
        : 'gerando',
      url: stepImagem?.status === 'completed' && typeof dados?.url === 'string' ? dados.url : null,
      modelo: typeof dados?.model === 'string' ? dados.model : null,
      modo: dados?.mode === 'quick' || dados?.mode === 'premium' ? dados.mode : null,
      tentativa: stepImagem?.attempt ?? 0,
    }
  })

  return {
    titulo: texto(copy?.title),
    estrategia: {
      angulo: texto(plano?.bigIdea) ?? texto(plano?.angle),
      promessa: texto(plano?.promise),
      tom: texto(plano?.tone),
    },
    slides,
    legenda: texto(copy?.caption),
    cta: texto(copy?.cta),
    hashtags: Array.isArray(copy?.hashtags)
      ? (copy.hashtags as string[]).filter(h => typeof h === 'string') : [],
    revisao: {
      verdict: review.approved === true ? 'approved_for_human_review' : null,
      checklist: [],
      avisos: notes,
      scores: {},
      media: null,
    },
    revisionCycle: 0,
    visual: {
      disponivel: visualSlides.length > 0,
      geral: {
        estilo: texto(dirGeral.style),
        paleta: texto(dirGeral.palette),
        tipografia: texto(dirGeral.typography),
        clima: texto(dirGeral.mood),
      },
      slides: visualSlides,
    },
    slidesPedidos: slides.length > 0 ? slides.length : null,
    imagens,
    disponivel: slides.length > 0,
    ai: aggregateAI(steps),
  }
}

export function buildProductionResult(steps: StepRow[]): ProductionResult {
  // A GERAÇÃO é determinada pelas chaves realmente presentes nos steps:
  // qualquer step cc_ai_* => geração de IA (2B); senão, determinística (2A).
  // Todos os campos vêm da MESMA geração — nunca estratégia de uma com copy
  // de outra, nunca revisor de uma geração avaliando copy da outra.
  // Criação rápida: UM step com tudo dentro (copy + estratégia + review).
  // Geração Studio (cst_*): reconhecida PRIMEIRO e nunca misturada com outra.
  // Basta o Copywriter ter concluído — a direção visual entra quando existir.
  if (steps.some(s => s.agent_key.startsWith('cst_'))) {
    return buildStudioResult(steps)
  }

  const quick = dataDe(steps, 'cc_quick_carousel')
  if (quick) return buildQuickResult(quick, steps)

  const geracaoAI = steps.some(s => s.agent_key.startsWith('cc_ai_'))
  const K = geracaoAI
    ? { strategist: 'cc_ai_strategist', copywriter: 'cc_ai_copywriter', reviewer: 'cc_ai_reviewer' }
    : { strategist: 'cc_strategist', copywriter: 'cc_copywriter', reviewer: 'cc_reviewer' }

  const copy = dataDe(steps, K.copywriter)
  const estrategia = dataDe(steps, K.strategist)
  const revisao = dataDe(steps, K.reviewer)

  if (!copy) return { ...RESULTADO_VAZIO, ai: aggregateAI(steps) }

  // Formato 2B (IA: title/headline/body/caption) com fallback 2A (titulo/
  // texto/legenda) — produções antigas persistidas continuam legíveis.
  const slidesBrutos = Array.isArray(copy.slides) ? copy.slides : []
  const slides: ResultSlide[] = slidesBrutos
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => ({
      numero: typeof s.number === 'number' ? s.number
        : typeof s.numero === 'number' ? s.numero : i + 1,
      papel: texto(s.role) ?? texto(s.papel) ?? '',
      headline: texto(s.headline) ?? '',
      texto: texto(s.body) ?? texto(s.texto) ?? '',
    }))

  const checklist = Array.isArray(revisao?.checklist) ? (revisao.checklist as CheckItem[]) : []
  const avisos = Array.isArray(revisao?.avisos) ? (revisao.avisos as string[]) : []
  const verdict = texto(revisao?.verdict) as AnyVerdict | null
  const scoresBrutos = revisao?.scores
  const scores: Record<string, number> = {}
  if (scoresBrutos && typeof scoresBrutos === 'object' && !Array.isArray(scoresBrutos)) {
    for (const [k, v] of Object.entries(scoresBrutos as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) scores[k] = v
    }
  }

  return {
    titulo: texto(copy.title) ?? texto(copy.titulo),
    estrategia: {
      angulo: texto(estrategia?.big_idea) ?? texto(estrategia?.angulo),
      promessa: texto(estrategia?.promessa_editorial) ?? texto(estrategia?.promessa),
      tom: texto(estrategia?.tom) ?? texto(estrategia?.orientacao_de_tom),
    },
    slides,
    legenda: texto(copy.caption) ?? texto(copy.legenda),
    cta: texto(copy.cta),
    hashtags: Array.isArray(copy.hashtags) ? (copy.hashtags as string[]).filter(h => typeof h === 'string') : [],
    revisao: {
      verdict, checklist, avisos, scores,
      media: typeof revisao?.media === 'number' ? revisao.media : null,
    },
    revisionCycle: typeof copy.revision_cycle === 'number' ? copy.revision_cycle : 0,
    // Gerações anteriores não têm Designer: a direção visual fica vazia, e o
    // painel simplesmente não mostra o bloco — nada é inventado para elas.
    visual: { ...VISUAL_VAZIO, geral: { ...VISUAL_VAZIO.geral }, slides: [] },
    slidesPedidos: null,
    imagens: [],
    disponivel: slides.length > 0,
    ai: aggregateAI(steps),
  }
}

export function emptyProductionResult(): ProductionResult {
  return { ...RESULTADO_VAZIO }
}
