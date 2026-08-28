// ============================================================================
// Gravador de voz → WhatsApp: reempacotar WebM/Opus em OGG/Opus
// ----------------------------------------------------------------------------
// O microfone do navegador (MediaRecorder) grava Opus dentro de WebM — e a
// Cloud API não aceita WebM. Mas aceita OGG/Opus, e o ÁUDIO é o mesmo: só o
// "envelope" muda. Aqui a gente abre o envelope WebM (EBML), tira os pacotes
// Opus intactos e sela num envelope OGG — zero recompressão, zero perda,
// zero dependência externa.
//
//   WebM (EBML): Segment → Cluster → SimpleBlock (pacote Opus cru)
//   OGG: página OpusHead → página OpusTags → páginas de pacotes com
//        granulepos (posição em amostras @48kHz, exigência do Opus-in-Ogg)
//
// A duração de cada pacote sai do TOC (1º byte do próprio pacote Opus) —
// não confiamos nos timestamps do WebM, que variam por navegador.
// ============================================================================

// ─── Leitura EBML (WebM) ────────────────────────────────────────────────────

interface Lido { valor: number; tamanho: number }

/** VINT do EBML: o nº de zeros à esquerda diz o comprimento. */
function lerVint(b: Uint8Array, pos: number, mascarar: boolean): Lido | null {
  if (pos >= b.length) return null
  const primeiro = b[pos]
  if (primeiro === 0) return null
  let comprimento = 1
  let marca = 0x80
  while ((primeiro & marca) === 0) { comprimento++; marca >>= 1 }
  if (pos + comprimento > b.length) return null
  let valor = mascarar ? primeiro & (marca - 1) : primeiro
  for (let i = 1; i < comprimento; i++) valor = valor * 256 + b[pos + i]
  return { valor, tamanho: comprimento }
}

const ID_SEGMENT = 0x18538067
const ID_CLUSTER = 0x1f43b675
const ID_TRACKS = 0x1654ae6b
const ID_TRACKENTRY = 0xae
const ID_CODECPRIVATE = 0x63a2
const ID_SIMPLEBLOCK = 0xa3

interface WebmLido {
  /** OpusHead vindo do CodecPrivate do WebM (o cabeçalho oficial do áudio). */
  opusHead: Uint8Array | null
  /** Pacotes Opus crus, na ordem. */
  pacotes: Uint8Array[]
}

/** Varre o WebM e extrai OpusHead + pacotes. Estrutura estranha → null. */
export function lerWebmOpus(bytes: Uint8Array): WebmLido | null {
  const pacotes: Uint8Array[] = []
  let opusHead: Uint8Array | null = null

  const varrer = (de: number, ate: number, dentroDe: number) => {
    let pos = de
    while (pos < ate) {
      const id = lerVint(bytes, pos, false)
      if (!id) return
      const tam = lerVint(bytes, pos + id.tamanho, true)
      if (!tam) return
      const inicioDados = pos + id.tamanho + tam.tamanho
      // "tamanho desconhecido" (todos os bits 1): vai até o fim do pai.
      const desconhecido = tam.valor >= Math.pow(2, 7 * tam.tamanho) - 1
      const fimDados = desconhecido ? ate : Math.min(inicioDados + tam.valor, ate)

      if (id.valor === ID_SEGMENT || id.valor === ID_CLUSTER || id.valor === ID_TRACKS
        || (id.valor === ID_TRACKENTRY && dentroDe === ID_TRACKS)) {
        varrer(inicioDados, fimDados, id.valor)
      } else if (id.valor === ID_CODECPRIVATE && dentroDe === ID_TRACKENTRY) {
        opusHead = bytes.slice(inicioDados, fimDados)
      } else if (id.valor === ID_SIMPLEBLOCK && dentroDe === ID_CLUSTER) {
        // SimpleBlock: nº da trilha (vint) + timecode int16 + flags + payload
        const trilha = lerVint(bytes, inicioDados, true)
        if (trilha) {
          const payload = inicioDados + trilha.tamanho + 3
          if (payload < fimDados) pacotes.push(bytes.slice(payload, fimDados))
        }
      }
      pos = desconhecido ? fimDados : inicioDados + tam.valor
    }
  }
  varrer(0, bytes.length, 0)

  if (pacotes.length === 0) return null
  return { opusHead, pacotes }
}

// ─── Duração dos pacotes Opus (para o granulepos do OGG) ────────────────────

/**
 * Amostras @48kHz de UM frame, pelo config do TOC (RFC 6716 §3.1).
 * SILK: 10/20/40/60ms · Híbrido: 10/20ms · CELT: 2.5/5/10/20ms.
 */
export function amostrasDoPacoteOpus(pacote: Uint8Array): number {
  if (pacote.length === 0) return 0
  const toc = pacote[0]
  const config = toc >> 3
  let frameMs: number
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4]
  else if (config < 16) frameMs = [10, 20][config % 2]
  else frameMs = [2.5, 5, 10, 20][config % 4]
  const codigo = toc & 0x03
  let frames = 1
  if (codigo === 1 || codigo === 2) frames = 2
  else if (codigo === 3 && pacote.length > 1) frames = pacote[1] & 0x3f
  return Math.round(frameMs * 48) * frames    // ms * 48 amostras/ms
}

// ─── Escrita OGG ────────────────────────────────────────────────────────────

const CRC_TABELA = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
    t[i] = r >>> 0
  }
  return t
})()

function crcOgg(b: Uint8Array): number {
  let crc = 0
  for (const byte of b) crc = ((crc << 8) >>> 0 ^ CRC_TABELA[((crc >>> 24) ^ byte) & 0xff]) >>> 0
  return crc >>> 0
}

function paginaOgg(
  serial: number,
  sequencia: number,
  granulepos: number,
  tipo: number,               // 0x02 = primeira | 0x04 = última | 0x00 = meio
  pacotes: Uint8Array[],
): Uint8Array {
  const segmentos: number[] = []
  for (const p of pacotes) {
    let resto = p.length
    do { segmentos.push(Math.min(resto, 255)); resto -= 255 } while (resto >= 0 && segmentos[segmentos.length - 1] === 255)
    if (segmentos[segmentos.length - 1] === 255) segmentos.push(0)
  }
  const corpo = pacotes.reduce((soma, p) => soma + p.length, 0)
  const pagina = new Uint8Array(27 + segmentos.length + corpo)
  const dv = new DataView(pagina.buffer)
  pagina.set([0x4f, 0x67, 0x67, 0x53, 0, tipo], 0)              // "OggS", versão, tipo
  // granulepos 64 bits little-endian (cabe em Number para áudios de voz)
  dv.setUint32(6, granulepos >>> 0, true)
  dv.setUint32(10, Math.floor(granulepos / 4294967296), true)
  dv.setUint32(14, serial, true)
  dv.setUint32(18, sequencia, true)
  dv.setUint32(22, 0, true)                                     // CRC (depois)
  pagina[26] = segmentos.length
  pagina.set(segmentos, 27)
  let cursor = 27 + segmentos.length
  for (const p of pacotes) { pagina.set(p, cursor); cursor += p.length }
  dv.setUint32(22, crcOgg(pagina), true)
  return pagina
}

/** OpusHead padrão (48kHz) quando o WebM não trouxe o CodecPrivate. */
function opusHeadPadrao(canais = 1): Uint8Array {
  const h = new Uint8Array(19)
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, canais], 0)  // "OpusHead", v1, canais
  new DataView(h.buffer).setUint16(10, 312, true)               // pre-skip
  new DataView(h.buffer).setUint32(12, 48000, true)             // sample rate de entrada
  return h
}

/**
 * O conversor: bytes de um WebM/Opus do MediaRecorder → bytes de um OGG/Opus
 * que a Cloud API aceita. null = o arquivo não era WebM/Opus reconhecível.
 */
export function webmParaOgg(webm: Uint8Array): Uint8Array | null {
  const lido = lerWebmOpus(webm)
  if (!lido) return null

  const serial = 0x46756e69          // "Funi" — qualquer serial serve
  const paginas: Uint8Array[] = []

  // Página 0: OpusHead (do WebM, ou o padrão 48kHz mono)
  const head = lido.opusHead && lido.opusHead.length >= 19 ? lido.opusHead : opusHeadPadrao()
  paginas.push(paginaOgg(serial, 0, 0, 0x02, [head]))

  // Página 1: OpusTags mínimo
  const vendor = new TextEncoder().encode('FunilPro')
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  tags.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0) // "OpusTags"
  new DataView(tags.buffer).setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  paginas.push(paginaOgg(serial, 1, 0, 0x00, [tags]))

  // Páginas de áudio: ~50 pacotes por página; granulepos acumula amostras.
  let granule = 0
  let sequencia = 2
  for (let i = 0; i < lido.pacotes.length; i += 50) {
    const lote = lido.pacotes.slice(i, i + 50)
    for (const p of lote) granule += amostrasDoPacoteOpus(p)
    const ultima = i + 50 >= lido.pacotes.length
    paginas.push(paginaOgg(serial, sequencia++, granule, ultima ? 0x04 : 0x00, lote))
  }

  const total = paginas.reduce((soma, p) => soma + p.length, 0)
  const saida = new Uint8Array(total)
  let cursor = 0
  for (const p of paginas) { saida.set(p, cursor); cursor += p.length }
  return saida
}
