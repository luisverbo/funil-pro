// ============================================================================
// Content Studio — modo VIRAL "capa com foto" (viral_cover_text_v1)
// ----------------------------------------------------------------------------
// Um carrossel 1080×1350 (4:5) com UMA fotografia (só a capa) e slides
// internos 100% tipográficos montados pelo FunilPro — custo visual padrão de
// UMA geração de imagem para 5, 6, 7 ou 8 slides.
//
// CAPA: ~66% superiores = fotografia LIMPA (sem véu escurecendo-a, sem texto
// por cima); ~34% inferiores = painel preto separado com headline de impacto
// (Archivo Black embutida), até 2 trechos com marca-texto colorido, marca +
// avatar/iniciais e contador 1/N.
//
// SLIDES 2..N: fundo preto sólido, texto branco com 0–2 marca-textos, muito
// espaço negativo, seta de continuação e CTA forte no último — zero OpenAI.
//
// Todo texto vira <path> vetorial (opentype.js + fontes embutidas): nada aqui
// depende de fontconfig ou do ambiente. Prova por PIXELS nos testes.
// ============================================================================

import sharp from 'sharp'
import * as opentype from 'opentype.js'
import {
  ARCHIVO_BLACK_B64, LIBERATION_SANS_BOLD_B64, LIBERATION_SANS_REGULAR_B64,
} from './fonts'

export {
  VIRAL_VISUAL_MODE, VIRAL_VISUAL_MODE_LABEL,
  ACCENT_COLORS, ACCENT_DEFAULT, parseAccentColor, isValidAccentInput, textColorFor,
} from './accent'
export type { AccentName } from './accent'
import { textColorFor } from './accent'

export const VIRAL_W = 1080
export const VIRAL_H = 1350
/** Altura da fotografia na capa (~66% — dentro da faixa 65–68% aprovada). */
export const VIRAL_PHOTO_H = 891
/** Painel preto da capa: o restante. */
export const VIRAL_PANEL_H = VIRAL_H - VIRAL_PHOTO_H
export const VIRAL_MARGIN = 72

// ─── Fontes ─────────────────────────────────────────────────────────────────

function parseFont(b64: string): opentype.Font {
  const bytes = Buffer.from(b64, 'base64')
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}
let fontes: { impact: opentype.Font; bold: opentype.Font; regular: opentype.Font } | null = null
function getFontes() {
  if (!fontes) {
    fontes = {
      impact: parseFont(ARCHIVO_BLACK_B64),
      bold: parseFont(LIBERATION_SANS_BOLD_B64),
      regular: parseFont(LIBERATION_SANS_REGULAR_B64),
    }
  }
  return fontes
}
type FontKind = 'impact' | 'bold' | 'regular'
function fonte(kind: FontKind): opentype.Font { return getFontes()[kind] }

export function viralMeasure(texto: string, size: number, kind: FontKind = 'impact'): number {
  return fonte(kind).getAdvanceWidth(texto, size)
}

// ─── Quebra + destaque (marca-texto) ────────────────────────────────────────

export interface HighlightSegment { texto: string; destacado: boolean }
export interface LaidOutLine { segmentos: HighlightSegment[] }

/**
 * Quebra o texto pela LARGURA MEDIDA e marca os intervalos cobertos pelas
 * `highlightPhrases` — correspondência EXATA (após normalizar espaços);
 * frase não encontrada simplesmente não destaca nada. Um destaque pode
 * atravessar a quebra de linha: cada linha carrega seus próprios segmentos.
 */
export function layoutHighlighted(
  texto: string,
  highlights: string[],
  maxWidth: number,
  size: number,
  maxLines: number,
  kind: FontKind = 'impact',
): LaidOutLine[] {
  const limpo = texto.replace(/\s+/g, ' ').trim()

  // Intervalos [ini, fim) destacados no texto normalizado — só matches exatos.
  const marcados: [number, number][] = []
  for (const bruta of highlights) {
    const frase = bruta.replace(/\s+/g, ' ').trim()
    if (!frase || frase.length >= limpo.length) continue  // nunca o texto inteiro
    const ini = limpo.toLowerCase().indexOf(frase.toLowerCase())
    if (ini >= 0) marcados.push([ini, ini + frase.length])
  }
  const isMarcado = (i: number) => marcados.some(([a, b]) => i >= a && i < b)

  // Quebra por palavras com largura real.
  const palavras: { texto: string; ini: number }[] = []
  let pos = 0
  for (const p of limpo.split(' ')) {
    palavras.push({ texto: p, ini: pos })
    pos += p.length + 1
  }
  const linhas: { texto: string; ini: number }[] = []
  let atual = ''
  let atualIni = 0
  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra.texto}` : palavra.texto
    if (viralMeasure(candidata, size, kind) <= maxWidth || !atual) {
      if (!atual) atualIni = palavra.ini
      atual = candidata
    } else {
      linhas.push({ texto: atual, ini: atualIni })
      atual = palavra.texto
      atualIni = palavra.ini
    }
  }
  if (atual) linhas.push({ texto: atual, ini: atualIni })
  const cortadas = linhas.slice(0, maxLines)
  if (linhas.length > maxLines) {
    const ultima = cortadas[maxLines - 1]
    ultima.texto = ultima.texto.replace(/[.,;: ]+$/, '') + '…'
  }

  // Segmentos por linha, agrupando caracteres contíguos com o mesmo estado.
  return cortadas.map(linha => {
    const segmentos: HighlightSegment[] = []
    let seg = ''
    let estado: boolean | null = null
    for (let i = 0; i < linha.texto.length; i++) {
      const m = isMarcado(linha.ini + i)
      if (estado === null || m === estado) { seg += linha.texto[i]; estado = m }
      else { segmentos.push({ texto: seg, destacado: estado }); seg = linha.texto[i]; estado = m }
    }
    if (seg) segmentos.push({ texto: seg, destacado: estado === true })
    return { segmentos }
  })
}

/** Desenha as linhas com marca-texto: rect arredondado ATRÁS do trecho. */
function linhasComDestaque(
  linhas: LaidOutLine[],
  opts: { x: number; y: number; size: number; lineHeight: number; kind: FontKind; corTexto: string; accentHex: string },
): string {
  const partes: string[] = []
  const padX = Math.round(opts.size * 0.18)
  const padY = Math.round(opts.size * 0.16)
  const corSobreAccent = textColorFor(opts.accentHex)

  linhas.forEach((linha, li) => {
    const baseline = opts.y + li * opts.lineHeight
    let cursor = opts.x
    for (const seg of linha.segmentos) {
      const w = viralMeasure(seg.texto, opts.size, opts.kind)
      if (seg.destacado && seg.texto.trim()) {
        // O retângulo cobre SÓ este trecho desta linha — nunca outras linhas.
        partes.push(`<rect x="${(cursor - padX).toFixed(1)}" y="${(baseline - opts.size * 0.82 - padY).toFixed(1)}" rx="10" width="${(w + padX * 2).toFixed(1)}" height="${(opts.size * 1.04 + padY * 2).toFixed(1)}" fill="${opts.accentHex}"/>`)
      }
      const d = fonte(opts.kind).getPath(seg.texto, cursor, baseline, opts.size).toPathData(2)
      if (d) partes.push(`<path d="${d}" fill="${seg.destacado ? corSobreAccent : opts.corTexto}"/>`)
      cursor += w
    }
  })
  return partes.join('')
}

/** Cabeçalho comum: avatar/iniciais + marca à esquerda, contador à direita. */
function cabecalho(opts: { marca: string; iniciais: string; n: number; total: number; y: number }): string {
  const partes: string[] = []
  const cy = opts.y
  // Avatar: círculo com INICIAIS (sem fluxo de upload nesta rodada).
  partes.push(`<circle cx="${VIRAL_MARGIN + 26}" cy="${cy}" r="26" fill="#ffffff" fill-opacity="0.14"/>`)
  const ini = opts.iniciais.slice(0, 2).toUpperCase()
  const iniW = viralMeasure(ini, 24, 'bold')
  const dIni = fonte('bold').getPath(ini, VIRAL_MARGIN + 26 - iniW / 2, cy + 9, 24).toPathData(2)
  if (dIni) partes.push(`<path d="${dIni}" fill="#ffffff"/>`)
  // Nome da marca.
  if (opts.marca) {
    const dM = fonte('bold').getPath(opts.marca.slice(0, 28), VIRAL_MARGIN + 66, cy + 9, 26).toPathData(2)
    if (dM) partes.push(`<path d="${dM}" fill="#ffffff" fill-opacity="0.92"/>`)
  }
  // Contador N/total.
  const contador = `${opts.n}/${opts.total}`
  const cw = viralMeasure(contador, 26, 'bold')
  const dC = fonte('bold').getPath(contador, VIRAL_W - VIRAL_MARGIN - cw, cy + 9, 26).toPathData(2)
  if (dC) partes.push(`<path d="${dC}" fill="#ffffff" fill-opacity="0.75"/>`)
  return partes.join('')
}

// ─── CAPA ───────────────────────────────────────────────────────────────────

export interface ViralCoverInput {
  headline: string
  /** Até 2 trechos EXATOS da headline para o marca-texto. */
  highlights: string[]
  marca: string
  iniciais: string
  totalSlides: number
  accentHex: string
}

/**
 * Overlay da capa: SÓ o painel inferior. A fotografia fica intocada — nenhum
 * véu escuro sobre ela; foto e texto são áreas claramente separadas.
 */
export function buildViralCoverPanelSvg(input: ViralCoverInput): string {
  const highlights = input.highlights.slice(0, 2)  // máximo DOIS na capa
  const larguraUtil = VIRAL_W - VIRAL_MARGIN * 2

  // Headline em Archivo Black, 2–4 linhas, com REDUÇÃO automática até caber.
  let size = 66
  let linhas = layoutHighlighted(input.headline, highlights, larguraUtil, size, 4, 'impact')
  while (size > 40 && (linhas.length > 4 || linhas.some(l =>
    viralMeasure(l.segmentos.map(s => s.texto).join(''), size, 'impact') > larguraUtil))) {
    size -= 4
    linhas = layoutHighlighted(input.headline, highlights, larguraUtil, size, 4, 'impact')
  }
  const lineHeight = Math.round(size * 1.22)
  const blocoAltura = linhas.length * lineHeight
  const topoTexto = VIRAL_PHOTO_H + 56 + Math.max(0, Math.round((VIRAL_PANEL_H - 120 - blocoAltura) / 2))

  return `<svg width="${VIRAL_W}" height="${VIRAL_H}" viewBox="0 0 ${VIRAL_W} ${VIRAL_H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="${VIRAL_PHOTO_H}" width="${VIRAL_W}" height="${VIRAL_PANEL_H}" fill="#0A0A0A"/>
  <rect x="0" y="${VIRAL_PHOTO_H}" width="${VIRAL_W}" height="4" fill="${input.accentHex}"/>
  ${cabecalho({ marca: input.marca, iniciais: input.iniciais, n: 1, total: input.totalSlides, y: VIRAL_PHOTO_H + 46 })}
  ${linhasComDestaque(linhas, { x: VIRAL_MARGIN, y: topoTexto + size, size, lineHeight, kind: 'impact', corTexto: '#ffffff', accentHex: input.accentHex })}
</svg>`
}

/**
 * Capa FINAL: fotografia cover no topo (limpa) + painel preto composto.
 * A foto entra por cima do canvas e o painel por cima da faixa inferior —
 * nunca um gradiente sobre a foto inteira.
 */
export async function composeViralCover(
  foto: Uint8Array,
  input: ViralCoverInput,
): Promise<{ bytes: Uint8Array; contentType: 'image/jpeg'; width: number; height: number }> {
  const fotoRedimensionada = await sharp(Buffer.from(foto))
    .resize(VIRAL_W, VIRAL_PHOTO_H, { fit: 'cover', position: 'attention' })
    .toBuffer()

  const bytes = await sharp({
    create: { width: VIRAL_W, height: VIRAL_H, channels: 3, background: { r: 10, g: 10, b: 10 } },
  })
    .composite([
      { input: fotoRedimensionada, top: 0, left: 0 },
      { input: Buffer.from(buildViralCoverPanelSvg(input)), top: 0, left: 0 },
    ])
    .jpeg({ quality: 91, mozjpeg: true })
    .toBuffer()

  return { bytes: new Uint8Array(bytes), contentType: 'image/jpeg', width: VIRAL_W, height: VIRAL_H }
}

// ─── SLIDES INTERNOS (2..N) — zero OpenAI ───────────────────────────────────

export interface ViralTextSlideInput {
  headline: string
  body: string
  /** 0–2 trechos para marca-texto (headline ou body). */
  highlights: string[]
  marca: string
  iniciais: string
  slideNumber: number
  totalSlides: number
  accentHex: string
  /** CTA — desenhado FORTE apenas no último slide. */
  cta?: string
}

export function buildViralTextSlideSvg(input: ViralTextSlideInput): string {
  const highlights = input.highlights.slice(0, 2)  // 0–2 por slide interno
  const larguraUtil = VIRAL_W - VIRAL_MARGIN * 2
  const isLast = input.slideNumber === input.totalSlides

  // Headline de impacto com auto-shrink; body em regular — muito respiro.
  let hSize = 58
  let hLinhas = layoutHighlighted(input.headline, highlights, larguraUtil, hSize, 3, 'impact')
  while (hSize > 38 && hLinhas.length > 3) {
    hSize -= 4
    hLinhas = layoutHighlighted(input.headline, highlights, larguraUtil, hSize, 3, 'impact')
  }
  const hLh = Math.round(hSize * 1.24)
  const bSize = 34
  const bLh = 52
  const bLinhas = layoutHighlighted(input.body, highlights, larguraUtil, bSize, 5, 'regular')

  const partes: string[] = []
  partes.push(`<rect width="${VIRAL_W}" height="${VIRAL_H}" fill="#0A0A0A"/>`)
  partes.push(cabecalho({ marca: input.marca, iniciais: input.iniciais, n: input.slideNumber, total: input.totalSlides, y: 96 }))

  const topo = 330
  partes.push(linhasComDestaque(hLinhas, {
    x: VIRAL_MARGIN, y: topo + hSize, size: hSize, lineHeight: hLh,
    kind: 'impact', corTexto: '#ffffff', accentHex: input.accentHex,
  }))
  partes.push(linhasComDestaque(bLinhas, {
    x: VIRAL_MARGIN, y: topo + hLinhas.length * hLh + 64 + bSize, size: bSize, lineHeight: bLh,
    kind: 'regular', corTexto: '#E5E7EB', accentHex: input.accentHex,
  }))

  if (isLast && input.cta?.trim()) {
    // CTA FORTE: botão na cor de destaque com contraste calculado.
    const rotulo = input.cta.trim().slice(0, 48)
    const ctaSize = 34
    const w = Math.min(viralMeasure(rotulo, ctaSize, 'bold') + 88, larguraUtil)
    const corTexto = textColorFor(input.accentHex)
    partes.push(`<rect x="${VIRAL_MARGIN}" y="${VIRAL_H - 210}" rx="20" width="${w}" height="86" fill="${input.accentHex}"/>`)
    const d = fonte('bold').getPath(rotulo, VIRAL_MARGIN + 44, VIRAL_H - 210 + 56, ctaSize).toPathData(2)
    if (d) partes.push(`<path d="${d}" fill="${corTexto}"/>`)
  } else if (!isLast) {
    // Seta discreta de continuação (chevron) no canto inferior direito.
    partes.push(`<path d="M ${VIRAL_W - VIRAL_MARGIN - 34} ${VIRAL_H - 118} l 26 22 l -26 22" stroke="#ffffff" stroke-opacity="0.55" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
  }

  return `<svg width="${VIRAL_W}" height="${VIRAL_H}" viewBox="0 0 ${VIRAL_W} ${VIRAL_H}" xmlns="http://www.w3.org/2000/svg">${partes.join('\n')}</svg>`
}

export async function renderViralTextSlide(
  input: ViralTextSlideInput,
): Promise<{ bytes: Uint8Array; contentType: 'image/jpeg'; width: number; height: number }> {
  const bytes = await sharp(Buffer.from(buildViralTextSlideSvg(input)))
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()
  return { bytes: new Uint8Array(bytes), contentType: 'image/jpeg', width: VIRAL_W, height: VIRAL_H }
}

/** Iniciais para o avatar quando não há logo acessível ao servidor. */
export function initialsOf(marca: string): string {
  const palavras = marca.trim().split(/\s+/).filter(Boolean)
  if (palavras.length === 0) return 'FP'
  if (palavras.length === 1) return palavras[0].slice(0, 2)
  return `${palavras[0][0]}${palavras[1][0]}`
}
