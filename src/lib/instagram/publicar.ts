// ============================================================================
// Publicação de Reels e carrosséis — Instagram Content Publishing API
// ----------------------------------------------------------------------------
// Fluxo da Meta (v21, graph.instagram.com, mesmo host e token do resto):
//
//   Reel:      POST /{ig-user-id}/media  media_type=REELS video_url caption
//              share_to_feed=true [cover_url]   → container
//              GET  /{container}?fields=status_code até FINISHED
//              POST /{ig-user-id}/media_publish creation_id → media id
//
//   Carrossel: POST /{ig-user-id}/media  image_url is_carousel_item=true
//              (um por imagem, com alt_text)     → N containers
//              POST /{ig-user-id}/media  media_type=CAROUSEL children=… caption
//              GET status_code até FINISHED · POST media_publish
//
// alt_text: aceito em contêiner de IMAGEM (inclusive item de carrossel). Se a
// API recusar o parâmetro, reenviamos sem ele — o texto fica guardado no banco.
// Em REELS não há alt_text na API; só guardamos.
//
// A função `fetchImpl` é injetável para os testes não tocarem a rede.
// ============================================================================

const GRAPH = 'https://graph.instagram.com/v21.0'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ClientePublicacao {
  token: string
  igUserId: string
  fetchImpl?: FetchLike
  /** Espera entre consultas de status (ms). */
  intervaloMs?: number
  /** Teto de espera pelo processamento do container (ms). */
  tempoMaximoMs?: number
}

export interface ResultadoPublicacao {
  mediaId: string
  permalink: string | null
  containerId: string
}

class ErroGraph extends Error {
  constructor(public readonly status: number, message: string, public readonly codigo?: number, public readonly subcodigo?: number) {
    super(message)
  }
}

function form(params: Record<string, string | number | boolean | undefined | null>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.append(k, String(v))
  return u.toString()
}

async function chamar<T>(c: ClientePublicacao, path: string, init: { method: 'GET' | 'POST'; body?: string }): Promise<T> {
  const f = c.fetchImpl ?? fetch
  const res = await f(`${GRAPH}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${c.token}`,
      ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: init.body,
  })
  const json = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: { message?: string; code?: number; error_subcode?: number } }
  if (!res.ok || json.error) {
    const e = json.error
    throw new ErroGraph(res.status, e?.message ?? `Graph HTTP ${res.status}`, e?.code, e?.error_subcode)
  }
  return json as T
}

/** Erro da Meta dizendo que um parâmetro não existe para aquele tipo de mídia. */
export function ehParametroRecusado(err: unknown, parametro: string): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message.toLowerCase()
  return m.includes(parametro.toLowerCase()) && /(invalid|unknown|unsupported|not supported|não suportado|param)/.test(m)
}

async function criarContainer(c: ClientePublicacao, params: Record<string, string | number | boolean | undefined | null>): Promise<string> {
  const r = await chamar<{ id: string }>(c, `/${c.igUserId}/media`, { method: 'POST', body: form(params) })
  if (!r.id) throw new Error('Meta não devolveu o id do container')
  return r.id
}

/** Cria com alt_text; se a API recusar o parâmetro, refaz sem ele. */
async function criarContainerComAlt(c: ClientePublicacao, params: Record<string, string | number | boolean | undefined | null>, altText: string | null | undefined): Promise<string> {
  if (!altText) return criarContainer(c, params)
  try {
    return await criarContainer(c, { ...params, alt_text: altText.slice(0, 1000) })
  } catch (err) {
    if (ehParametroRecusado(err, 'alt_text')) return criarContainer(c, params)
    throw err
  }
}

export type StatusContainer = 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED'

export async function statusDoContainer(c: ClientePublicacao, containerId: string): Promise<{ status: StatusContainer; detalhe?: string }> {
  const r = await chamar<{ status_code?: StatusContainer; status?: string }>(c, `/${containerId}?fields=status_code,status`, { method: 'GET' })
  return { status: r.status_code ?? 'IN_PROGRESS', detalhe: r.status }
}

/** Espera o container ficar FINISHED (vídeo leva de segundos a minutos). */
export async function esperarContainer(c: ClientePublicacao, containerId: string): Promise<void> {
  const intervalo = c.intervaloMs ?? 5_000
  const teto = c.tempoMaximoMs ?? 240_000
  const inicio = Date.now()
  for (;;) {
    const { status, detalhe } = await statusDoContainer(c, containerId)
    if (status === 'FINISHED' || status === 'PUBLISHED') return
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`container ${status}${detalhe ? `: ${detalhe}` : ''}`)
    if (Date.now() - inicio > teto) throw new Error('tempo esgotado esperando a Meta processar a mídia')
    await new Promise(r => setTimeout(r, intervalo))
  }
}

async function publicarContainer(c: ClientePublicacao, containerId: string): Promise<string> {
  const r = await chamar<{ id: string }>(c, `/${c.igUserId}/media_publish`, { method: 'POST', body: form({ creation_id: containerId }) })
  if (!r.id) throw new Error('Meta não devolveu o id da mídia publicada')
  return r.id
}

async function permalinkDe(c: ClientePublicacao, mediaId: string): Promise<string | null> {
  try {
    const r = await chamar<{ permalink?: string }>(c, `/${mediaId}?fields=permalink`, { method: 'GET' })
    return r.permalink ?? null
  } catch { return null }
}

export interface EntradaReel {
  videoUrl: string
  caption: string
  coverUrl?: string | null
}

export async function publicarReel(c: ClientePublicacao, e: EntradaReel): Promise<ResultadoPublicacao> {
  const containerId = await criarContainer(c, {
    media_type: 'REELS',
    video_url: e.videoUrl,
    caption: e.caption,
    share_to_feed: true,
    cover_url: e.coverUrl ?? undefined,
  })
  await esperarContainer(c, containerId)
  const mediaId = await publicarContainer(c, containerId)
  return { mediaId, permalink: await permalinkDe(c, mediaId), containerId }
}

export interface EntradaCarrossel {
  imagens: string[]
  caption: string
  altText?: string | null
}

export async function publicarCarrossel(c: ClientePublicacao, e: EntradaCarrossel): Promise<ResultadoPublicacao> {
  if (e.imagens.length < 2 || e.imagens.length > 10) throw new Error('carrossel precisa de 2 a 10 imagens')
  const filhos: string[] = []
  for (const url of e.imagens) {
    filhos.push(await criarContainerComAlt(c, { image_url: url, is_carousel_item: true }, e.altText))
  }
  const containerId = await criarContainer(c, {
    media_type: 'CAROUSEL',
    children: filhos.join(','),
    caption: e.caption,
  })
  await esperarContainer(c, containerId)
  const mediaId = await publicarContainer(c, containerId)
  return { mediaId, permalink: await permalinkDe(c, mediaId), containerId }
}

/** Resolve o ID da conta com o token (mesma chamada que o painel /instagram usa). */
export async function idDaContaConectada(token: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await fetchImpl(`${GRAPH}/me?fields=user_id,username`, { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => null) as { user_id?: string; id?: string; error?: { message?: string } } | null
  if (!res.ok || !json || json.error) throw new Error(json?.error?.message ?? `Graph HTTP ${res.status}`)
  const id = json.user_id ?? json.id
  if (!id) throw new Error('Meta não devolveu o id da conta')
  return id
}
