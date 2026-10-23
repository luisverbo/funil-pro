// ============================================================================
// Estúdio IA — envio humanizado pela Cloud API
// ----------------------------------------------------------------------------
// • "digitando…": status read + typing_indicator na mensagem da cliente (some
//   sozinho quando a resposta chega ou após 25 s).
// • Atraso humano: texto 1,2 s + 35 ms/caractere (±20%), entre 1,5 s e o
//   máximo (6 s); áudio 3–5 s (gravação); foto/PDF 1,5–2,5 s. O atraso conta a
//   partir do fim do processamento: se já demorou mais, envia na hora.
// • Áudio como MENSAGEM DE VOZ: {"type":"audio","audio":{"id":…,"voice":true}}
//   — sobe o OGG/Opus uma vez em /<phone_number_id>/media e guarda o media_id
//   (vale 30 dias) em estudio_midia_cache.
// • Reação (❤️/👍) no lugar de texto em confirmações soltas.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ContaCloud } from '@/lib/whatsapp-cloud'

const GRAPH = 'https://graph.facebook.com/v21.0'
type Fetch = typeof fetch

// ── Atrasos (puros) ─────────────────────────────────────────────────────────

export const ATRASO_MIN_MS = 1500
export const ATRASO_MAX_PADRAO_MS = 6000

/** 1,2 s + 35 ms por caractere, variação ±20%, entre 1,5 s e o máximo. `sorte` ∈ [0,1). */
export function atrasoDeTexto(texto: string, maxMs = ATRASO_MAX_PADRAO_MS, sorte = Math.random()): number {
  const base = 1200 + 35 * [...(texto ?? '')].length
  const variado = base * (0.8 + 0.4 * sorte)
  return Math.round(Math.min(Math.max(variado, ATRASO_MIN_MS), Math.max(maxMs, ATRASO_MIN_MS)))
}
/** Antes de áudio: 3–5 s (simula a gravação). */
export function atrasoDeAudio(sorte = Math.random()): number { return Math.round(3000 + 2000 * sorte) }
/** Antes de foto/PDF: 1,5–2,5 s. */
export function atrasoDeMidia(sorte = Math.random()): number { return Math.round(1500 + 1000 * sorte) }
/** Quanto ainda esperar: o atraso conta do fim do processamento; o que já passou desconta. */
export function esperaRestante(alvoMs: number, jaPassouMs: number): number { return Math.max(0, Math.round(alvoMs - jaPassouMs)) }

// ── Corpos dos envios (puros — os testes conferem) ──────────────────────────

export function corpoAudioDeVoz(para: string, m: { id: string } | { link: string }) {
  return { messaging_product: 'whatsapp', to: para, type: 'audio', audio: { ...m, voice: true } }
}
export function corpoLidoDigitando(wamid: string) {
  return { messaging_product: 'whatsapp', status: 'read', message_id: wamid, typing_indicator: { type: 'text' } }
}
export function corpoReacao(para: string, wamid: string, emoji: string) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: para, type: 'reaction', reaction: { message_id: wamid, emoji } }
}

// ── Chamadas à Meta ─────────────────────────────────────────────────────────

async function postar(conta: ContaCloud, corpo: unknown, f: Fetch = fetch): Promise<{ ok: boolean; wamid?: string | null; erro?: string }> {
  try {
    const r = await f(`${GRAPH}/${conta.phone_number_id}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${conta.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    })
    const j = await r.json().catch(() => null) as { messages?: { id?: string }[]; error?: { message?: string; error_data?: { details?: string } } } | null
    if (!r.ok) return { ok: false, erro: j?.error?.error_data?.details ?? j?.error?.message ?? `HTTP ${r.status}` }
    return { ok: true, wamid: j?.messages?.[0]?.id ?? null }
  } catch (err) { return { ok: false, erro: String(err) } }
}

/** Marca como lida + liga o "digitando…". Falha não importa (é só cosmético). */
export async function marcarLidaDigitando(conta: ContaCloud, wamid: string, f?: Fetch) {
  return postar(conta, corpoLidoDigitando(wamid), f)
}

/** Só "lida" (sem "digitando…"): para "ok"/👍/figurinha, que podem não ter resposta. */
export async function marcarLida(conta: ContaCloud, wamid: string, f?: Fetch) {
  return postar(conta, { messaging_product: 'whatsapp', status: 'read', message_id: wamid }, f)
}

export async function reagir(conta: ContaCloud, para: string, wamid: string, emoji: string, f?: Fetch) {
  return postar(conta, corpoReacao(para, wamid, emoji), f)
}

/** Sobe a mídia para a Meta e devolve o media_id. */
export async function subirMidiaMeta(conta: ContaCloud, bytes: Uint8Array, mime: string, nome = 'audio.ogg', f: Fetch = fetch): Promise<string> {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', mime)
  form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }), nome)
  const r = await f(`${GRAPH}/${conta.phone_number_id}/media`, { method: 'POST', headers: { Authorization: `Bearer ${conta.access_token}` }, body: form })
  const j = await r.json().catch(() => null) as { id?: string; error?: { message?: string } } | null
  if (!r.ok || !j?.id) throw new Error(j?.error?.message ?? `upload de mídia HTTP ${r.status}`)
  return j.id
}

const VALIDADE_CACHE_MS = 29 * 86400e3   // a Meta guarda 30 dias; renova 1 dia antes

/**
 * Áudio como MENSAGEM DE VOZ. `fonte` é o caminho no Storage (cache por ele) e
 * `baixar` traz os bytes OGG/Opus. Sem conseguir subir, manda por link com voice:true.
 */
export async function enviarVoz(admin: SupabaseClient, tenantId: string, conta: ContaCloud, para: string,
  fonte: { chave: string; link?: string | null; baixar: () => Promise<{ bytes: Uint8Array; mime: string } | null> }, f?: Fetch,
): Promise<{ ok: boolean; wamid?: string | null; erro?: string; via: 'id' | 'link' }> {
  let mediaId: string | null = null
  try {
    const { data } = await admin.from('estudio_midia_cache').select('media_id, criado_em')
      .eq('tenant_id', tenantId).eq('phone_number_id', conta.phone_number_id).eq('path', fonte.chave).maybeSingle()
    if (data && Date.now() - new Date(data.criado_em).getTime() < VALIDADE_CACHE_MS) mediaId = data.media_id
  } catch { /* sem tabela ainda: sobe de novo */ }
  if (!mediaId) {
    try {
      const arq = await fonte.baixar()
      if (arq) {
        mediaId = await subirMidiaMeta(conta, arq.bytes, arq.mime.includes('ogg') ? 'audio/ogg' : arq.mime, 'voz.ogg', f)
        await admin.from('estudio_midia_cache').upsert({ tenant_id: tenantId, phone_number_id: conta.phone_number_id, path: fonte.chave, media_id: mediaId, criado_em: new Date().toISOString() })
          .then(() => {}, () => {})
      }
    } catch (err) { console.warn('[estudio/envio] upload do áudio falhou, indo por link:', String(err).slice(0, 200)) }
  }
  if (mediaId) {
    const r = await postar(conta, corpoAudioDeVoz(para, { id: mediaId }), f)
    if (r.ok) return { ...r, via: 'id' }
    // media_id expirado/inválido: apaga o cache e cai no link
    await admin.from('estudio_midia_cache').delete().eq('tenant_id', tenantId).eq('phone_number_id', conta.phone_number_id).eq('path', fonte.chave).then(() => {}, () => {})
  }
  if (!fonte.link) return { ok: false, erro: 'áudio indisponível', via: 'link' }
  return { ...(await postar(conta, corpoAudioDeVoz(para, { link: fonte.link }), f)), via: 'link' }
}

// ── Mensagens que não pedem resposta ────────────────────────────────────────

const SO_CONFIRMACAO = /^(ok+|okay|okk+|blz|beleza|ta|tá|ta bom|tá bom|certo|certinho|show|top|perfeito|otimo|ótimo|obrigad[ao]s?|obg|brigad[ao]|valeu|vlw|tmj|combinado|entendi|entendido|ah ok|aham|uhum|sim sim|thanks?|thank you|ty|gracias|vale|perfecto|genial)[\s!.…]*$/i
const SO_EMOJI = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️\s]+$/u

/** "ok", "obrigada", "👍", "❤️"… — confirmação/agradecimento sem conteúdo novo. */
export function ehSoConfirmacao(texto: string | null | undefined): boolean {
  const t = (texto ?? '').trim()
  if (!t) return false
  return SO_CONFIRMACAO.test(t.normalize('NFC')) || (SO_EMOJI.test(t) && !/\d/.test(t))
}
