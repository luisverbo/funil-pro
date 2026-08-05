// ============================================================================
// Content Studio — Criação rápida: entrada e saída (validação PURA)
// ----------------------------------------------------------------------------
// Um único agente, uma única chamada, um único schema de saída. Reaproveita as
// travas já provadas da camada de IA: detector de metalinguagem, detector de
// estatística não sustentada e limites de tamanho.
//
// A ENTRADA é mínima de propósito — tema obrigatório, objetivo por enum, o
// resto opcional. O perfil de marca (público/tom/negócio/descrição) chega do
// navegador como PREFERÊNCIA LOCAL (localStorage): cs_settings não tem coluna
// de configuração JSON e migration não está autorizada. Tudo passa pela mesma
// lista branca com limites — preferência não é privilégio.
// ============================================================================

import {
  findMetaLeak,
  findUnsupportedClaims,
  HASHTAG_MAX,
  SLIDES_AI_MAX,
  SLIDES_AI_MIN,
} from '../ai/schemas'

export const QUICK_PIPELINE_KEY = 'content_carousel_quick_v1'
export const QUICK_AGENT_KEY = 'cc_quick_carousel'

export const QUICK_OBJETIVOS = ['educar', 'gerar_leads', 'vender', 'autoridade'] as const
export type QuickObjetivo = (typeof QUICK_OBJETIVOS)[number]

export const QUICK_OBJETIVO_LABELS: Record<QuickObjetivo, string> = {
  educar: 'Educar',
  gerar_leads: 'Gerar leads',
  vender: 'Vender',
  autoridade: 'Autoridade',
}

// ─── Entrada ────────────────────────────────────────────────────────────────

export interface QuickInput {
  tema?: unknown
  objetivo?: unknown
  oferta?: unknown
  cta?: unknown
  /** Preferências de marca do NAVEGADOR (localStorage) — opcionais. */
  marca?: unknown
  /** Chave por SUBMISSÃO (replay usa a mesma; intenção nova ganha outra). */
  idempotencyKey?: unknown
}

export interface ValidQuickBrief extends Record<string, unknown> {
  tema: string
  objetivo: QuickObjetivo
  oferta: string
  cta: string
  marca_publico: string
  marca_tom: string
  marca_negocio: string
  marca_cta: string
  marca_descricao: string
  /** Chave de idempotência da submissão — mesma semântica da Fase 2A. */
  idempotency_key: string
  /** Marca da geração — auditável junto do pipeline_key. */
  modo: 'quick_v1'
}

/**
 * Campos que definem EQUIVALÊNCIA de conteúdo entre submissões com a mesma
 * chave. Independente da ordem das propriedades: a comparação é campo a campo
 * sobre valores já normalizados.
 */
export const QUICK_COMPARE_FIELDS = [
  'tema', 'objetivo', 'oferta', 'cta',
  'marca_publico', 'marca_tom', 'marca_negocio', 'marca_cta', 'marca_descricao',
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

export type QuickValidation =
  | { ok: true; brief: ValidQuickBrief }
  | { ok: false; message: string }

/**
 * Valida a entrada mínima. Lista branca: campo que não está aqui não existe —
 * tenant, pipeline, modelo, prompt ou status enviados pelo cliente morrem na
 * validação, não em checagem posterior.
 */
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/

export function validateQuickInput(input: QuickInput): QuickValidation {
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
      marca_publico: texto(marca.publico, LIMITES.marca_publico),
      marca_tom: texto(marca.tom, LIMITES.marca_tom),
      marca_negocio: texto(marca.negocio, LIMITES.marca_negocio),
      marca_cta: texto(marca.ctaPadrao, LIMITES.marca_cta),
      marca_descricao: texto(marca.descricao, LIMITES.marca_descricao),
      idempotency_key: chave,
      modo: 'quick_v1',
    },
  }
}

// ─── Saída ──────────────────────────────────────────────────────────────────

export interface QuickSlide extends Record<string, unknown> {
  number: number
  headline: string
  body: string
}

export interface QuickCarouselOutput extends Record<string, unknown> {
  title: string
  strategy: { bigIdea: string; angle: string; promise: string }
  slides: QuickSlide[]
  caption: string
  cta: string
  hashtags: string[]
  review: { approved: boolean; notes: string[] }
}

function str(v: unknown, campo: string, max: number, min = 1): string {
  if (typeof v !== 'string') throw new Error(`${campo}: esperado texto`)
  const limpo = v.replace(/\s+/g, ' ').trim()
  if (limpo.length < min) throw new Error(`${campo}: vazio`)
  if (limpo.length > max) throw new Error(`${campo}: excede ${max} caracteres`)
  return limpo
}

/**
 * Valida a resposta da IA. Copiado por lista (campo extra do modelo morre),
 * limites em tudo, metalinguagem e estatística não sustentada REPROVAM aqui —
 * não existe revisor separado neste fluxo.
 */
export function makeQuickParser(brief: Record<string, unknown>) {
  return function parse(raw: unknown): QuickCarouselOutput {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('carousel: esperado objeto')
    const o = raw as Record<string, unknown>

    const slidesBrutos = o.slides
    if (!Array.isArray(slidesBrutos) ||
        slidesBrutos.length < SLIDES_AI_MIN || slidesBrutos.length > SLIDES_AI_MAX) {
      throw new Error(`slides: esperado ${SLIDES_AI_MIN}-${SLIDES_AI_MAX} slides`)
    }

    const estrategiaBruta = (o.strategy && typeof o.strategy === 'object' && !Array.isArray(o.strategy))
      ? (o.strategy as Record<string, unknown>) : {}
    const reviewBruto = (o.review && typeof o.review === 'object' && !Array.isArray(o.review))
      ? (o.review as Record<string, unknown>) : {}

    const out: QuickCarouselOutput = {
      title: str(o.title, 'title', 120),
      strategy: {
        bigIdea: str(estrategiaBruta.bigIdea, 'strategy.bigIdea', 300),
        angle: str(estrategiaBruta.angle, 'strategy.angle', 300),
        promise: str(estrategiaBruta.promise, 'strategy.promise', 300),
      },
      slides: slidesBrutos.map((s, i) => {
        const item = (s && typeof s === 'object') ? (s as Record<string, unknown>) : {}
        return {
          number: i + 1,
          headline: str(item.headline, `slides[${i}].headline`, 90),
          body: str(item.body, `slides[${i}].body`, 320),
        }
      }),
      caption: str(o.caption, 'caption', 900),
      cta: str(o.cta, 'cta', 160),
      hashtags: (Array.isArray(o.hashtags) ? o.hashtags : [])
        .filter((h): h is string => typeof h === 'string')
        .slice(0, HASHTAG_MAX)
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

    // Instrução interna vazada é INVÁLIDA — mesmo defeito terminal da 2A/2B.
    const vazamento = findMetaLeak(textos)
    if (vazamento) throw new Error(`carousel contém instrução interna (padrão: ${vazamento})`)

    // Estatística/fonte sem base no que o usuário informou: inválida.
    const inventados = findUnsupportedClaims(textos, brief)
    if (inventados.length > 0) {
      throw new Error(`carousel contém dado não sustentado (${inventados.join(', ')})`)
    }

    return out
  }
}
