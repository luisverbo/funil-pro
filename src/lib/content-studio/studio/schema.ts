// ============================================================================
// Content Studio — geração "Studio" (Estrategista → Copywriter → Designer)
// ----------------------------------------------------------------------------
// Entrada e saídas VALIDADAS, tudo puro (sem banco, sem rede).
//
// Identidade persistida PRÓPRIA: content_carousel_studio_v1 + agentes cst_*.
// Nenhuma chave das gerações anteriores é reutilizada — produções antigas
// (v1 determinística, ai_v1, quick_v1) continuam intactas e legíveis.
//
// A diferença de produto para a Criação rápida v1:
//   • o usuário ESCOLHE a quantidade de slides (5–8, padrão 8) e o resultado
//     respeita EXATAMENTE o número escolhido — não uma faixa;
//   • a copy passa por um Estrategista antes do Copywriter;
//   • um Designer produz a direção visual e o prompt de imagem por slide.
// ============================================================================

import {
  findMetaLeak,
  findUnsupportedClaims,
  HASHTAG_MAX,
} from '../ai/schemas'
import { QUICK_OBJETIVOS, type QuickObjetivo } from '../quick/schema'
import { parseAccentColor } from '../images/accent'

export const STUDIO_PIPELINE_KEY = 'content_carousel_studio_v1'

export const STUDIO_STRATEGIST_KEY = 'cst_strategist'
export const STUDIO_COPYWRITER_KEY = 'cst_copywriter'
export const STUDIO_DESIGNER_KEY = 'cst_designer'

/** Ordem de execução — é também a ordem dos step_index. */
export const STUDIO_AGENT_ORDER = [
  STUDIO_STRATEGIST_KEY,
  STUDIO_COPYWRITER_KEY,
  STUDIO_DESIGNER_KEY,
] as const

export type StudioAgentKey = (typeof STUDIO_AGENT_ORDER)[number]

export const STUDIO_AGENT_LABELS: Record<string, string> = {
  [STUDIO_STRATEGIST_KEY]: 'Estrategista',
  [STUDIO_COPYWRITER_KEY]: 'Copywriter',
  [STUDIO_DESIGNER_KEY]: 'Designer',
}

// ─── Quantidade de slides ───────────────────────────────────────────────────

/** As únicas quantidades aceitas. Lista branca — não é um intervalo livre. */
export const STUDIO_SLIDE_CHOICES = [5, 6, 7, 8] as const
export type StudioSlideCount = (typeof STUDIO_SLIDE_CHOICES)[number]
export const STUDIO_SLIDES_DEFAULT: StudioSlideCount = 8

function normalizarSlides(v: unknown): StudioSlideCount {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return (STUDIO_SLIDE_CHOICES as readonly number[]).includes(n)
    ? (n as StudioSlideCount)
    : STUDIO_SLIDES_DEFAULT
}

// ─── Entrada ────────────────────────────────────────────────────────────────

export interface StudioInput {
  tema?: unknown
  objetivo?: unknown
  oferta?: unknown
  cta?: unknown
  slides?: unknown
  marca?: unknown
  idempotencyKey?: unknown
  /** Cor de destaque: nome da lista branca ou hex #RRGGBB. */
  accentColor?: unknown
  /** Modo visual: viral_cover_text_v1 (padrão) ou per_slide_v1. */
  visualMode?: unknown
}

export interface ValidStudioBrief extends Record<string, unknown> {
  tema: string
  objetivo: QuickObjetivo
  oferta: string
  cta: string
  /** Quantidade EXATA de slides pedida — persistida no brief. */
  slides: StudioSlideCount
  marca_publico: string
  marca_tom: string
  marca_negocio: string
  marca_cta: string
  marca_descricao: string
  idempotency_key: string
  modo: 'studio_v1'
  /** Hex VALIDADO da cor de destaque (persistido; padrão roxo). */
  accent_color: string
  /** Modo visual persistido — nunca reinterpretado depois. */
  visual_mode: 'viral_cover_text_v1' | 'per_slide_v1'
}

/**
 * Campos que definem EQUIVALÊNCIA de conteúdo entre submissões com a mesma
 * chave de idempotência. `slides` entra: pedir 5 slides não é o mesmo pedido
 * que pedir 8, mesmo com o resto idêntico.
 */
export const STUDIO_COMPARE_FIELDS = [
  'tema', 'objetivo', 'oferta', 'cta', 'slides',
  'marca_publico', 'marca_tom', 'marca_negocio', 'marca_cta', 'marca_descricao',
  'accent_color', 'visual_mode',
] as const

const LIMITES: Record<string, number> = {
  tema: 300, oferta: 300, cta: 160,
  marca_publico: 200, marca_tom: 120, marca_negocio: 120,
  marca_cta: 160, marca_descricao: 400,
}

function texto(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

export type StudioValidation =
  | { ok: true; brief: ValidStudioBrief }
  | { ok: false; message: string }

const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/

/**
 * Lista branca: campo que não está aqui não existe. Tenant, pipeline, modelo,
 * prompt ou status enviados pelo cliente morrem na validação.
 */
export function validateStudioInput(input: StudioInput): StudioValidation {
  const tema = texto(input?.tema, LIMITES.tema)
  if (tema.length < 3) {
    return { ok: false, message: 'Conte em algumas palavras sobre o que você quer criar.' }
  }

  const chave = texto(input?.idempotencyKey, 64)
  if (!IDEMPOTENCY_RE.test(chave)) {
    return { ok: false, message: 'Não foi possível identificar este envio. Recarregue a página e tente novamente.' }
  }

  const objetivo = QUICK_OBJETIVOS.includes(input?.objetivo as QuickObjetivo)
    ? (input.objetivo as QuickObjetivo)
    : 'educar'

  const marca = (input?.marca && typeof input.marca === 'object' && !Array.isArray(input.marca))
    ? (input.marca as Record<string, unknown>)
    : {}

  return {
    ok: true,
    brief: {
      tema,
      objetivo,
      oferta: texto(input?.oferta, LIMITES.oferta),
      cta: texto(input?.cta, LIMITES.cta),
      slides: normalizarSlides(input?.slides),
      marca_publico: texto(marca.publico, LIMITES.marca_publico),
      marca_tom: texto(marca.tom, LIMITES.marca_tom),
      marca_negocio: texto(marca.negocio, LIMITES.marca_negocio),
      marca_cta: texto(marca.ctaPadrao, LIMITES.marca_cta),
      marca_descricao: texto(marca.descricao, LIMITES.marca_descricao),
      idempotency_key: chave,
      modo: 'studio_v1',
      // Validados por lista branca — CSS livre e modos desconhecidos morrem
      // aqui; o hex é revalidado de novo na hora de desenhar.
      accent_color: parseAccentColor(input?.accentColor ?? (marca as { accentColor?: unknown }).accentColor),
      visual_mode: input?.visualMode === 'per_slide_v1' ? 'per_slide_v1' : 'viral_cover_text_v1',
    },
  }
}

// ─── Saídas ─────────────────────────────────────────────────────────────────

function str(v: unknown, campo: string, max: number, min = 1): string {
  if (typeof v !== 'string') throw new Error(`${campo}: esperado texto`)
  const limpo = v.replace(/\s+/g, ' ').trim()
  if (limpo.length < min) throw new Error(`${campo}: vazio`)
  // Texto LONGO demais é defeito de ESTILO, não de estrutura: derrubar a
  // resposta paga inteira por alguns caracteres a mais custou uma produção
  // real ("slides[0].headline: excede 90 caracteres" — e o retry repetia o
  // estilo). Apara em fronteira de palavra com reticências; falha dura fica
  // reservada para o que é estrutural (campo ausente, tipo errado, contagem
  // de slides).
  if (limpo.length > max) return cortar(limpo, max)
  return limpo
}

/** Corta em fronteira de palavra (quando possível) e fecha com reticências. */
function cortar(texto: string, max: number): string {
  const bruto = texto.slice(0, max - 1)
  const ultimoEspaco = bruto.lastIndexOf(' ')
  // Só recua até o espaço se ele não sacrificar mais que ~1/4 do limite.
  const base = ultimoEspaco > (max * 3) / 4 ? bruto.slice(0, ultimoEspaco) : bruto
  return `${base.replace(/[.,;:!?…\s]+$/, '')}…`
}

function lista(v: unknown, campo: string, maxItens: number, maxCada: number): string[] {
  if (!Array.isArray(v)) throw new Error(`${campo}: esperado lista`)
  return v
    .filter((x): x is string => typeof x === 'string')
    .map(x => x.replace(/\s+/g, ' ').trim())
    .filter(x => x.length > 0)
    .slice(0, maxItens)
    .map(x => x.slice(0, maxCada))
}

// ── 1. Estrategista ──

export interface StudioStrategy extends Record<string, unknown> {
  bigIdea: string
  angle: string
  promise: string
  audience: string
  tone: string
  /** Um beat por slide — o esqueleto que o Copywriter vai escrever. */
  beats: { number: number; purpose: string }[]
}

/** O Estrategista precisa devolver EXATAMENTE um beat por slide pedido. */
export function makeStrategyParser(brief: ValidStudioBrief) {
  return function parse(raw: unknown): StudioStrategy {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('strategy: esperado objeto')
    }
    const o = raw as Record<string, unknown>

    const beatsBrutos = o.beats
    if (!Array.isArray(beatsBrutos) || beatsBrutos.length !== brief.slides) {
      throw new Error(`beats: esperado exatamente ${brief.slides} beats`)
    }

    const out: StudioStrategy = {
      bigIdea: str(o.bigIdea, 'strategy.bigIdea', 300),
      angle: str(o.angle, 'strategy.angle', 300),
      promise: str(o.promise, 'strategy.promise', 300),
      audience: str(o.audience, 'strategy.audience', 220),
      tone: str(o.tone, 'strategy.tone', 160),
      beats: beatsBrutos.map((b, i) => {
        const item = (b && typeof b === 'object') ? (b as Record<string, unknown>) : {}
        return { number: i + 1, purpose: str(item.purpose, `beats[${i}].purpose`, 220) }
      }),
    }

    // O plano é interno, mas não pode conter dado inventado: o que sai daqui
    // alimenta a copy, e uma estatística fabricada aqui viraria copy publicada.
    const inventados = findUnsupportedClaims(
      [out.bigIdea, out.angle, out.promise, ...out.beats.map(b => b.purpose)],
      brief,
    )
    if (inventados.length > 0) {
      throw new Error(`strategy contém dado não sustentado (${inventados.join(', ')})`)
    }
    return out
  }
}

// ── 2. Copywriter ──

export interface StudioSlide extends Record<string, unknown> {
  number: number
  headline: string
  body: string
  /** Trechos EXATOS para marca-texto (modo viral). Opcional, máx. 2. */
  highlights?: string[]
}

export interface StudioCopy extends Record<string, unknown> {
  title: string
  slides: StudioSlide[]
  caption: string
  cta: string
  hashtags: string[]
  review: { approved: boolean; notes: string[] }
}

/**
 * Frases-clichê que reprovam a copy quando aparecem SOZINHAS numa headline —
 * exatamente o defeito que o pedido chama de "genérico". Não basta conter a
 * expressão: ela precisa dominar a headline (headline curta e quase só isso).
 */
const CLICHES = [
  'descubra agora', 'saiba mais', 'confira agora', 'veja como',
  'você sabia', 'clique no link', 'não perca', 'imperdível',
  'a verdade que ninguém conta', 'o segredo que ninguém te conta',
]

export function findWeakHeadline(headlines: string[]): string | null {
  for (const h of headlines) {
    const normal = h.toLowerCase().replace(/[!?.,:;]/g, '').trim()
    for (const c of CLICHES) {
      // Genérica = a headline é praticamente só o clichê (sem assunto próprio).
      if (normal === c || (normal.startsWith(c) && normal.length <= c.length + 8)) {
        return h
      }
    }
  }
  return null
}

export function makeCopyParser(brief: ValidStudioBrief) {
  return function parse(raw: unknown): StudioCopy {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('copy: esperado objeto')
    }
    const o = raw as Record<string, unknown>

    const slidesBrutos = o.slides
    // EXATAMENTE a quantidade pedida — é uma escolha do usuário, não uma faixa.
    if (!Array.isArray(slidesBrutos) || slidesBrutos.length !== brief.slides) {
      throw new Error(`slides: esperado exatamente ${brief.slides} slides`)
    }

    const reviewBruto = (o.review && typeof o.review === 'object' && !Array.isArray(o.review))
      ? (o.review as Record<string, unknown>) : {}

    const out: StudioCopy = {
      title: str(o.title, 'title', 120),
      slides: slidesBrutos.map((s, i) => {
        const item = (s && typeof s === 'object') ? (s as Record<string, unknown>) : {}
        return {
          number: i + 1,
          headline: str(item.headline, `slides[${i}].headline`, 90),
          body: str(item.body, `slides[${i}].body`, 320),
          // Marca-texto: opcional, máx. 2 trechos curtos — ausente é válido.
          highlights: lista(item.highlights ?? [], `slides[${i}].highlights`, 2, 60),
        }
      }),
      caption: str(o.caption, 'caption', 900),
      cta: str(o.cta, 'cta', 160),
      hashtags: lista(o.hashtags, 'hashtags', HASHTAG_MAX, 40)
        .map(h => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '')),
      review: {
        approved: reviewBruto.approved === true,
        notes: (Array.isArray(reviewBruto.notes) ? reviewBruto.notes : [])
          .filter((n): n is string => typeof n === 'string')
          .slice(0, 10)
          .map(n => n.slice(0, 300)),
      },
    }

    const textos = [out.title, out.caption, ...out.slides.flatMap(s => [s.headline, s.body])]

    const vazamento = findMetaLeak(textos)
    if (vazamento) throw new Error(`copy contém instrução interna (padrão: ${vazamento})`)

    const inventados = findUnsupportedClaims(textos, brief)
    if (inventados.length > 0) {
      throw new Error(`copy contém dado não sustentado (${inventados.join(', ')})`)
    }

    const fraca = findWeakHeadline(out.slides.map(s => s.headline))
    if (fraca) throw new Error(`copy contém headline genérica ("${fraca}")`)

    return out
  }
}

// ── 3. Designer ──

export interface StudioVisualSlide extends Record<string, unknown> {
  number: number
  /** Estilo visual do slide. */
  style: string
  /** Ideia de composição / enquadramento. */
  composition: string
  /** Elementos principais que aparecem. */
  elements: string[]
  /** Direção de cores DESTE slide. */
  colors: string
  /** Sugestão de layout (onde entra headline, texto, imagem). */
  layout: string
  /** Prompt de imagem pronto para um gerador — texto, não imagem. */
  imagePrompt: string
}

export interface StudioVisual extends Record<string, unknown> {
  /** Direção geral do carrossel. */
  direction: {
    style: string
    palette: string
    typography: string
    mood: string
  }
  slides: StudioVisualSlide[]
}

export function makeVisualParser(brief: ValidStudioBrief) {
  return function parse(raw: unknown): StudioVisual {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('visual: esperado objeto')
    }
    const o = raw as Record<string, unknown>

    const dirBruta = (o.direction && typeof o.direction === 'object' && !Array.isArray(o.direction))
      ? (o.direction as Record<string, unknown>) : {}

    const slidesBrutos = o.slides
    // A direção visual cobre TODOS os slides da copy — nem mais, nem menos.
    if (!Array.isArray(slidesBrutos) || slidesBrutos.length !== brief.slides) {
      throw new Error(`visual.slides: esperado exatamente ${brief.slides} slides`)
    }

    const out: StudioVisual = {
      direction: {
        style: str(dirBruta.style, 'direction.style', 240),
        palette: str(dirBruta.palette, 'direction.palette', 240),
        typography: str(dirBruta.typography, 'direction.typography', 200),
        mood: str(dirBruta.mood, 'direction.mood', 200),
      },
      slides: slidesBrutos.map((s, i) => {
        const item = (s && typeof s === 'object') ? (s as Record<string, unknown>) : {}
        return {
          number: i + 1,
          style: str(item.style, `visual.slides[${i}].style`, 200),
          composition: str(item.composition, `visual.slides[${i}].composition`, 480),
          elements: lista(item.elements, `visual.slides[${i}].elements`, 6, 80),
          colors: str(item.colors, `visual.slides[${i}].colors`, 160),
          layout: str(item.layout, `visual.slides[${i}].layout`, 200),
          imagePrompt: str(item.imagePrompt, `visual.slides[${i}].imagePrompt`, 1000),
        }
      }),
    }

    // O Designer descreve imagem — mas continua proibido de AFIRMAR número,
    // resultado ou fonte que o pedido não sustenta (isso vira texto no slide).
    const textos = [
      out.direction.style, out.direction.palette, out.direction.mood,
      ...out.slides.flatMap(s => [s.composition, s.imagePrompt, ...s.elements]),
    ]
    const inventados = findUnsupportedClaims(textos, brief)
    if (inventados.length > 0) {
      throw new Error(`direção visual contém dado não sustentado (${inventados.join(', ')})`)
    }

    return out
  }
}
