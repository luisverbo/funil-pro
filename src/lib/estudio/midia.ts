// ============================================================================
// Estúdio IA — mídia do chat (Fase 2b)
// ----------------------------------------------------------------------------
// A URL que a Meta dá para uma mídia recebida EXPIRA (minutos) e só abre com
// o token. Por isso toda mídia que chega é baixada na hora e guardada no
// bucket PRIVADO estudio-clientes/conversas/<contato>/… ; a tela recebe só
// links assinados curtos. Para ENVIAR, a Meta busca o arquivo por um link
// assinado de 1 dia.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { BUCKET_CLIENTES, urlPublicaDoCatalogo } from './catalogo'
import { caminhoMidiaDaConversa, extensaoDoMime } from './chat'

const GRAPH = 'https://graph.facebook.com/v21.0'
type Fetch = typeof fetch

/** Teto do que guardamos (vídeo da Meta chega até 16 MB; documento pode mais). */
export const MAX_MIDIA_RECEBIDA = 25 * 1024 * 1024

/** GET /{media_id} → url temporária; depois baixa com o token. */
export async function baixarMidiaDaMeta(mediaId: string, token: string, f: Fetch = fetch): Promise<{ bytes: Uint8Array; mime: string }> {
  const meta = await f(`${GRAPH}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  const info = await meta.json().catch(() => null) as { url?: string; mime_type?: string; file_size?: number; error?: { message?: string } } | null
  if (!meta.ok || !info?.url) throw new Error(info?.error?.message ?? `mídia ${mediaId}: HTTP ${meta.status}`)
  if (info.file_size && info.file_size > MAX_MIDIA_RECEBIDA) throw new Error(`mídia grande demais (${Math.round(info.file_size / 1048576)} MB)`)
  const arq = await f(info.url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!arq.ok) throw new Error(`download da mídia: HTTP ${arq.status}`)
  const bytes = new Uint8Array(await arq.arrayBuffer())
  if (bytes.length > MAX_MIDIA_RECEBIDA) throw new Error('mídia grande demais')
  return { bytes, mime: info.mime_type ?? arq.headers.get('content-type') ?? 'application/octet-stream' }
}

/** Baixa a mídia recebida e guarda no bucket privado. Devolve o caminho. */
export async function guardarMidiaRecebida(
  admin: SupabaseClient, contatoId: string, wamid: string, mediaId: string, token: string,
  nomeOriginal?: string | null, f?: Fetch,
): Promise<{ path: string; mime: string }> {
  const { bytes, mime } = await baixarMidiaDaMeta(mediaId, token, f)
  const ext = extensaoDoMime(mime, nomeOriginal)
  const path = caminhoMidiaDaConversa(contatoId, `${wamid.slice(-24)}.${ext}`)
  const { error } = await admin.storage.from(BUCKET_CLIENTES).upload(path, bytes, { contentType: mime.split(';')[0], upsert: true })
  if (error) throw new Error(`storage: ${error.message}`)
  return { path, mime }
}

/** Link assinado para a tela (curto) ou para a Meta buscar no envio (1 dia). */
export async function linkAssinado(admin: SupabaseClient, path: string, segundos: number): Promise<string | null> {
  // Áudios da Ana (A1–A6) moram no catálogo público: "catalogo:<caminho>".
  if (path.startsWith('catalogo:')) return urlPublicaDoCatalogo(path.slice('catalogo:'.length), process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
  const { data } = await admin.storage.from(BUCKET_CLIENTES).createSignedUrl(path, segundos)
  return data?.signedUrl ?? null
}
