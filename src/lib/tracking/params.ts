// ============================================================================
// Rastreamento de origem — captura, persistência e leitura
// ----------------------------------------------------------------------------
// Fase 1 do Gestor de Tráfego. O objetivo é uma frase: saber de qual ANÚNCIO
// veio cada venda.
//
// Três defeitos que este módulo existe para consertar, todos levantados na
// auditoria:
//
//   1. `fbclid` não era capturado em lugar nenhum. Sem ele não há como casar
//      uma venda com o clique no anúncio quando a UTM se perde.
//   2. Os parâmetros só sobreviviam à PRIMEIRA página. Quem entrava pelo
//      anúncio, navegava e só depois convertia, chegava sem origem.
//   3. `utm_medium` e `utm_term` não eram guardados.
//
// REGRA DE OURO: a origem é do PRIMEIRO toque e é IMUTÁVEL. Se o visitante já
// tem origem gravada, uma nova visita sem parâmetros não apaga a anterior —
// senão o tráfego direto de retorno roubaria o crédito do anúncio.
//
// Sem dependência nova: cookie de primeira parte + localStorage.
// ============================================================================

/** Chaves aceitas — lista branca. Nada fora daqui é lido da URL. */
export const TRACKING_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_campaign_id', 'utm_adset_id', 'utm_ad_id',
  'fbclid', 'gclid', 'ttclid',
] as const

export type TrackingKey = (typeof TRACKING_KEYS)[number]
export type TrackingParams = Partial<Record<TrackingKey, string>> & {
  referrer_url?: string
  landing_url?: string
  first_touch_at?: string
}

/** Nome do cookie/registro. Primeira parte, mesmo domínio — sem terceiros. */
export const TRACKING_STORAGE_KEY = 'fp_src'

/** 90 dias: cobre a janela de atribuição mais longa que a Meta usa (28d) com folga. */
export const TRACKING_MAX_AGE_DAYS = 90

/** Um valor de parâmetro nunca passa disto — corta lixo e tentativa de estufar cookie. */
const MAX_VALOR = 300
const MAX_URL = 500

function limpar(valor: unknown, max = MAX_VALOR): string | undefined {
  if (typeof valor !== 'string') return undefined
  const s = valor.trim().slice(0, max)
  return s.length > 0 ? s : undefined
}

/**
 * Lê os parâmetros de rastreamento de uma URL (ou de um objeto de query já
 * pronto, como o `searchParams` do servidor).
 */
export function lerParametros(
  fonte: URLSearchParams | Record<string, string | string[] | undefined>,
): TrackingParams {
  const pegar = (k: string): string | undefined => {
    if (fonte instanceof URLSearchParams) return limpar(fonte.get(k) ?? undefined)
    const v = fonte[k]
    return limpar(Array.isArray(v) ? v[0] : v)
  }

  const out: TrackingParams = {}
  for (const chave of TRACKING_KEYS) {
    const valor = pegar(chave)
    if (valor) out[chave] = valor
  }
  return out
}

/** Tem alguma informação de origem de verdade? */
export function temOrigem(p: TrackingParams): boolean {
  return TRACKING_KEYS.some(k => !!p[k])
}

/**
 * O `_fbc` que a Meta espera na API de Conversões, derivado do `fbclid`.
 * Formato oficial: `fb.1.<timestamp>.<fbclid>`.
 */
export function montarFbc(fbclid: string | undefined, agoraMs = Date.now()): string | undefined {
  const id = limpar(fbclid)
  return id ? `fb.1.${agoraMs}.${id}` : undefined
}

// ─── Persistência no navegador ──────────────────────────────────────────────

function lerGuardado(): TrackingParams | null {
  if (typeof window === 'undefined') return null
  try {
    const bruto = window.localStorage.getItem(TRACKING_STORAGE_KEY)
      ?? lerCookie(TRACKING_STORAGE_KEY)
    if (!bruto) return null
    const dados = JSON.parse(decodeURIComponent(bruto)) as TrackingParams
    return typeof dados === 'object' && dados ? dados : null
  } catch {
    return null
  }
}

function lerCookie(nome: string): string | null {
  if (typeof document === 'undefined') return null
  const alvo = `${nome}=`
  for (const parte of document.cookie.split(';')) {
    const p = parte.trim()
    if (p.startsWith(alvo)) return p.slice(alvo.length)
  }
  return null
}

function guardar(p: TrackingParams): void {
  if (typeof window === 'undefined') return
  const bruto = encodeURIComponent(JSON.stringify(p))
  try { window.localStorage.setItem(TRACKING_STORAGE_KEY, bruto) } catch { /* modo privado */ }
  try {
    const maxAge = TRACKING_MAX_AGE_DAYS * 24 * 60 * 60
    // SameSite=Lax: o cookie acompanha a navegação normal (inclusive a vinda
    // do anúncio), mas não vaza em requisição de terceiro.
    document.cookie = `${TRACKING_STORAGE_KEY}=${bruto}; path=/; max-age=${maxAge}; SameSite=Lax`
  } catch { /* sem cookie: o localStorage já cobre */ }
}

/**
 * Captura a origem da página atual e devolve a origem VÁLIDA para usar.
 *
 * Regra de primeiro toque: se já existe origem guardada, ela prevalece — a
 * visita nova só grava quando não havia nada antes. É isso que impede o
 * tráfego direto de retorno de apagar o crédito do anúncio.
 */
export function capturarOrigem(agora = () => new Date().toISOString()): TrackingParams {
  if (typeof window === 'undefined') return {}

  const guardado = lerGuardado()
  if (guardado && temOrigem(guardado)) return guardado

  const daUrl = lerParametros(new URLSearchParams(window.location.search))
  if (!temOrigem(daUrl)) return guardado ?? {}

  const completo: TrackingParams = {
    ...daUrl,
    referrer_url: limpar(document.referrer, MAX_URL),
    landing_url: limpar(window.location.href, MAX_URL),
    first_touch_at: agora(),
  }
  guardar(completo)
  return completo
}

/** Origem guardada, sem tentar capturar de novo (para telas internas). */
export function origemAtual(): TrackingParams {
  return lerGuardado() ?? {}
}

/**
 * Junta o que veio na URL desta requisição com o que já estava guardado.
 * O guardado (primeiro toque) vence campo a campo.
 */
export function mesclarOrigem(guardada: TrackingParams, daUrl: TrackingParams): TrackingParams {
  if (temOrigem(guardada)) return guardada
  return temOrigem(daUrl) ? daUrl : guardada
}
