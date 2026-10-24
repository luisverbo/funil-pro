// ============================================================================
// Estúdio IA — regras puras do chat (Fase 2b) e do idioma por país (Fase 3)
// ----------------------------------------------------------------------------
// Sem banco e sem rede: testado no `npm run test:cs`.
// ============================================================================

// ── País e idioma pelo DDI do wa_id (decisão do Luís, 23/10) ────────────────

const DDI: { prefixo: string; pais: string; idioma: string }[] = [
  // Prefixos mais longos primeiro: 351 antes de 35x, 55 antes de 5.
  { prefixo: '351', pais: 'PT', idioma: 'pt-PT' },
  { prefixo: '55', pais: 'BR', idioma: 'pt-BR' },
  { prefixo: '34', pais: 'ES', idioma: 'es-ES' },
  { prefixo: '52', pais: 'MX', idioma: 'es-MX' },
  { prefixo: '54', pais: 'AR', idioma: 'es-AR' },
  { prefixo: '57', pais: 'CO', idioma: 'es-CO' },
  { prefixo: '1', pais: 'US', idioma: 'en-US' },
]

export function paisDoWaId(waId: string | null | undefined): { pais: string | null; idioma: string } {
  const d = (waId ?? '').replace(/\D/g, '')
  const achou = DDI.find(x => d.startsWith(x.prefixo))
  return achou ? { pais: achou.pais, idioma: achou.idioma } : { pais: null, idioma: 'en' }
}

/** 🇧🇷 a partir do código ISO de 2 letras. */
export function bandeira(pais: string | null | undefined): string {
  const p = (pais ?? '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(p)) return '🌐'
  return String.fromCodePoint(...[...p].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// ── Quem responde: Ana ou Luís ──────────────────────────────────────────────

export interface EstadoAtendimento { modo: 'ana' | 'humano'; humano_desde: string | null; humano_fixo: boolean }

/**
 * Mensagem manual do Luís pausa a Ana; ela volta sozinha após N horas sem
 * mensagem manual — a menos que ele tenha clicado em "Assumir" (fixo).
 */
export function devolveParaAna(e: EstadoAtendimento, horas: number, agora: Date = new Date()): boolean {
  if (e.modo !== 'humano' || e.humano_fixo) return false
  if (!e.humano_desde) return true
  return agora.getTime() - new Date(e.humano_desde).getTime() >= Math.max(0.25, horas) * 3600 * 1000
}

// ── Janela de 24h da Meta ───────────────────────────────────────────────────

/** "23h 12min", "45min" ou null quando fechada. */
export function tempoDaJanela(janelaAte: string | null | undefined, agora: Date = new Date()): string | null {
  if (!janelaAte) return null
  const ms = new Date(janelaAte).getTime() - agora.getTime()
  if (ms <= 0) return null
  const min = Math.floor(ms / 60000)
  const h = Math.floor(min / 60)
  return h > 0 ? `${h}h ${String(min % 60).padStart(2, '0')}min` : `${min}min`
}

// ── Ticks de entrega ────────────────────────────────────────────────────────

const ORDEM_STATUS = ['sent', 'delivered', 'read', 'played'] as const

/**
 * Status anteriores que este status pode substituir (nunca volta para trás:
 * "entregue" que chega depois do "visto" não apaga o azul). Falha só vale
 * enquanto a mensagem não foi entregue.
 */
export function statusQuePodeSubstituir(novo: string): string[] {
  if (novo === 'failed') return ['sent']
  const i = ORDEM_STATUS.indexOf(novo as (typeof ORDEM_STATUS)[number])
  return i < 0 ? [] : ['failed', ...ORDEM_STATUS.slice(0, i)]
}

export function tick(status: string | null | undefined): { simbolo: string; azul: boolean; falhou: boolean } {
  switch (status) {
    case 'read': return { simbolo: '✓✓', azul: true, falhou: false }
    // Áudio de voz ouvido: a Meta manda 'played' (depois de 'read').
    case 'played': return { simbolo: '✓✓', azul: true, falhou: false }
    case 'delivered': return { simbolo: '✓✓', azul: false, falhou: false }
    case 'failed': return { simbolo: '!', azul: false, falhou: true }
    case 'sent': return { simbolo: '✓', azul: false, falhou: false }
    default: return { simbolo: '🕓', azul: false, falhou: false }
  }
}

// ── Mídia ───────────────────────────────────────────────────────────────────

export type TipoCloud = 'image' | 'video' | 'audio' | 'document'

/** Como a Cloud API manda este arquivo. Figurinha/desconhecido vai como documento. */
export function tipoCloudDoMime(mime: string | null | undefined): TipoCloud {
  const m = (mime ?? '').toLowerCase()
  if (/^image\/(jpeg|png)$/.test(m)) return 'image'        // webp na Meta só como figurinha
  if (/^video\/(mp4|3gpp)$/.test(m)) return 'video'
  if (/^audio\//.test(m)) return 'audio'
  return 'document'
}

/** Tipo salvo no histórico (o mesmo vocabulário do parser do webhook). */
export function tipoDoHistorico(t: TipoCloud): string {
  return t === 'image' ? 'imagem' : t === 'video' ? 'video' : t === 'audio' ? 'audio' : 'documento'
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'application/pdf': 'pdf',
}

export function extensaoDoMime(mime: string | null | undefined, nome?: string | null): string {
  const base = (mime ?? '').split(';')[0].trim().toLowerCase()
  if (EXT[base]) return EXT[base]
  const m = (nome ?? '').match(/\.([a-z0-9]{1,5})$/i)
  return m ? m[1].toLowerCase() : 'bin'
}

/** Limites da Cloud API para envio (bytes). */
export const LIMITE_ENVIO: Record<TipoCloud, number> = {
  image: 5 * 1024 * 1024, video: 16 * 1024 * 1024, audio: 16 * 1024 * 1024, document: 100 * 1024 * 1024,
}

/** Caminho no bucket privado estudio-clientes (as conversas ficam fora das pastas de pedido). */
export function caminhoMidiaDaConversa(contatoId: string, nomeArquivo: string): string {
  const limpo = nomeArquivo.replace(/[^\w.-]+/g, '_').slice(-80) || 'arquivo'
  return `conversas/${contatoId}/${limpo}`
}

/** Texto curto para a lista de contatos. */
export function previaDaMensagem(tipo: string, texto: string | null | undefined): string {
  const t = (texto ?? '').trim()
  const icone: Record<string, string> = { imagem: '📷', audio: '🎙', video: '🎬', documento: '📎', figurinha: '🩷', localizacao: '📍' }
  if (icone[tipo] && (!t || t.startsWith('['))) {
    const nome: Record<string, string> = { imagem: 'Foto', audio: 'Áudio', video: 'Vídeo', documento: 'Documento', figurinha: 'Figurinha', localizacao: 'Localização' }
    return `${icone[tipo]} ${nome[tipo]}`
  }
  return t.slice(0, 120)
}
