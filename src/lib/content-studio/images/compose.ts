// ============================================================================
// Content Studio — composição FINAL do slide (FunilPro, server-side via sharp)
// ----------------------------------------------------------------------------
// A OpenAI entrega SÓ o fundo. Este módulo monta a arte publicável: fundo
// (cover 1080×1080) + véu de contraste + headline + body + CTA + marca +
// numeração — tudo desenhado pelo FunilPro.
//
// TEXTO COMO CAMINHO VETORIAL, NUNCA <text>: a v1 usava <text> em SVG, que o
// libvips rasteriza via fontconfig + fontes DO SISTEMA — e o runtime da
// Vercel não tem nenhuma. As formas compunham (o véu escurecia o fundo), mas
// cada glifo saía vazio: a arte publicada chegava SEM texto. Agora cada letra
// vira <path> gerado por opentype.js a partir da Liberation Sans EMBUTIDA no
// bundle (fonts.ts) — a rasterização não depende de nada do ambiente, e o
// teste prova por PIXELS que o texto está no JPEG final.
//
// LAYOUT: quatro templates determinísticos (bloco inferior, texto à esquerda,
// texto à direita, headline no topo), escolhidos pela direção do Designer e
// CONSISTENTES dentro do carrossel. Margens seguras de 80px e véu direcional
// garantem legibilidade em tela de celular.
// ============================================================================

import sharp from 'sharp'
import * as opentype from 'opentype.js'
import { LIBERATION_SANS_BOLD_B64, LIBERATION_SANS_REGULAR_B64 } from './fonts'

export const SLIDE_W = 1080
export const SLIDE_H = 1080
/** Margem segura: nada de texto encostado na borda. */
export const SAFE_MARGIN = 80

// ─── Fontes embutidas (parse uma vez por processo) ──────────────────────────

function parseFont(b64: string): opentype.Font {
  const bytes = Buffer.from(b64, 'base64')
  return opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

let fontes: { bold: opentype.Font; regular: opentype.Font } | null = null
function getFontes() {
  if (!fontes) {
    fontes = { bold: parseFont(LIBERATION_SANS_BOLD_B64), regular: parseFont(LIBERATION_SANS_REGULAR_B64) }
  }
  return fontes
}

/** Largura REAL do texto na fonte — a quebra de linha deixa de ser chute. */
export function measureText(texto: string, size: number, bold = true): number {
  const f = bold ? getFontes().bold : getFontes().regular
  return f.getAdvanceWidth(texto, size)
}

/**
 * Um bloco de linhas como <path> — glifos vetoriais, zero dependência de
 * fontconfig. `x`/`y` são o canto de escrita da PRIMEIRA linha (baseline).
 */
export function textToPaths(
  linhas: string[],
  opts: { x: number; y: number; size: number; lineHeight: number; fill: string; bold?: boolean; opacity?: number },
): string {
  const f = opts.bold === false ? getFontes().regular : getFontes().bold
  const partes: string[] = []
  linhas.forEach((linha, i) => {
    const d = f.getPath(linha, opts.x, opts.y + i * opts.lineHeight, opts.size).toPathData(2)
    if (d) partes.push(`<path d="${d}" fill="${opts.fill}"${opts.opacity !== undefined ? ` fill-opacity="${opts.opacity}"` : ''}/>`)
  })
  return partes.join('')
}

// ─── Quebra de linha por LARGURA REAL ───────────────────────────────────────

export function wrapText(texto: string, maxChars: number, maxLines: number): string[] {
  // Compatibilidade: quebra por caracteres (usada em testes puros).
  const palavras = texto.replace(/\s+/g, ' ').trim().split(' ')
  const linhas: string[] = []
  let atual = ''
  for (let palavra of palavras) {
    while (palavra.length > maxChars) {
      if (atual) { linhas.push(atual); atual = '' }
      linhas.push(palavra.slice(0, maxChars - 1) + '-')
      palavra = palavra.slice(maxChars - 1)
    }
    const candidata = atual ? `${atual} ${palavra}` : palavra
    if (candidata.length <= maxChars) atual = candidata
    else { if (atual) linhas.push(atual); atual = palavra }
  }
  if (atual) linhas.push(atual)
  if (linhas.length > maxLines) {
    const corte = linhas.slice(0, maxLines)
    corte[maxLines - 1] = corte[maxLines - 1].replace(/[.,;: ]+$/, '') + '…'
    return corte
  }
  return linhas
}

/** Quebra pela LARGURA MEDIDA na fonte — o que a arte realmente usa. */
export function wrapByWidth(
  texto: string, maxWidth: number, size: number, maxLines: number, bold = true,
): string[] {
  const palavras = texto.replace(/\s+/g, ' ').trim().split(' ')
  const linhas: string[] = []
  let atual = ''
  for (const palavra of palavras) {
    const candidata = atual ? `${atual} ${palavra}` : palavra
    if (measureText(candidata, size, bold) <= maxWidth) {
      atual = candidata
    } else if (!atual) {
      // Palavra maior que a linha: corta com hífen.
      let corte = palavra
      while (corte.length > 2 && measureText(corte + '-', size, bold) > maxWidth) corte = corte.slice(0, -1)
      linhas.push(corte + '-')
      atual = palavra.slice(corte.length)
    } else {
      linhas.push(atual)
      atual = palavra
    }
  }
  if (atual) linhas.push(atual)
  if (linhas.length > maxLines) {
    const corteFinal = linhas.slice(0, maxLines)
    corteFinal[maxLines - 1] = corteFinal[maxLines - 1].replace(/[.,;: ]+$/, '') + '…'
    return corteFinal
  }
  return linhas
}

export function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ─── Templates de layout ────────────────────────────────────────────────────

export type SlideLayoutTemplate = 'bottom' | 'left' | 'right' | 'top'

/**
 * Template DETERMINÍSTICO a partir da direção do Designer. `layoutSlide` é o
 * texto do slide; `layoutGeral` (estilo geral) decide o padrão do carrossel —
 * o fallback é o mesmo para todos os slides da produção, o que mantém a
 * série consistente mesmo quando o Designer não indica lado.
 */
export function pickLayoutTemplate(layoutSlide: string, layoutGeral: string): SlideLayoutTemplate {
  const slide = layoutSlide.toLowerCase()
  if (/esquerd/.test(slide)) return 'left'
  if (/direit/.test(slide)) return 'right'
  if (/topo|superior|acima/.test(slide)) return 'top'
  if (/inferior|rodapé|embaixo|abaixo/.test(slide)) return 'bottom'
  const geral = layoutGeral.toLowerCase()
  if (/esquerd/.test(geral)) return 'left'
  if (/direit/.test(geral)) return 'right'
  if (/topo|superior/.test(geral)) return 'top'
  return 'bottom'
}

export interface SlideComposeInput {
  headline: string
  body: string
  cta?: string
  marca?: string
  slideNumber: number
  totalSlides: number
  /** Template de layout — determinístico, decidido fora (pickLayoutTemplate). */
  template?: SlideLayoutTemplate
}

/** Geometria de cada template: onde o texto vive e qual véu dá o contraste. */
function geometria(template: SlideLayoutTemplate) {
  switch (template) {
    case 'left':
      return {
        textX: SAFE_MARGIN, textWidth: 560, anchorTop: 300,
        veu: `<linearGradient id="veu" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#000000" stop-opacity="0.72"/>
          <stop offset="0.55" stop-color="#000000" stop-opacity="0.45"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0"/>
        </linearGradient>`,
      }
    case 'right':
      return {
        textX: SLIDE_W - SAFE_MARGIN - 560, textWidth: 560, anchorTop: 300,
        veu: `<linearGradient id="veu" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stop-color="#000000" stop-opacity="0.72"/>
          <stop offset="0.55" stop-color="#000000" stop-opacity="0.45"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0"/>
        </linearGradient>`,
      }
    case 'top':
      return {
        textX: SAFE_MARGIN, textWidth: SLIDE_W - SAFE_MARGIN * 2, anchorTop: 190,
        veu: `<linearGradient id="veu" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0.75"/>
          <stop offset="0.45" stop-color="#000000" stop-opacity="0.35"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0"/>
        </linearGradient>`,
      }
    default: // bottom
      return {
        textX: SAFE_MARGIN, textWidth: SLIDE_W - SAFE_MARGIN * 2, anchorTop: -1,
        veu: `<linearGradient id="veu" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.32" stop-color="#000000" stop-opacity="0"/>
          <stop offset="0.68" stop-color="#000000" stop-opacity="0.55"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.8"/>
        </linearGradient>`,
      }
  }
}

/**
 * O overlay COMPLETO do slide (1080×1080). Todo texto visível da arte nasce
 * AQUI, como <path> — nunca na imagem da OpenAI, nunca como <text>.
 */
export function buildSlideOverlaySvg(input: SlideComposeInput): string {
  const template = input.template ?? 'bottom'
  const g = geometria(template)

  const headlineSize = template === 'left' || template === 'right' ? 64 : 72
  const headlineLh = Math.round(headlineSize * 1.16)
  const bodySize = 34
  const bodyLh = 48

  const headline = wrapByWidth(input.headline, g.textWidth, headlineSize, 3, true)
  const body = wrapByWidth(input.body, g.textWidth, bodySize, 4, false)

  const blocoAltura = headline.length * headlineLh + 28 + body.length * bodyLh
  // bottom ancora o bloco acima da margem inferior; os demais fixam no topo.
  const baseY = g.anchorTop >= 0 ? g.anchorTop : SLIDE_H - 170 - blocoAltura

  const partes: string[] = []

  // Headline (bold, branco) + body (regular, quase-branco) como PATHS.
  partes.push(textToPaths(headline, {
    x: g.textX, y: baseY, size: headlineSize, lineHeight: headlineLh, fill: '#ffffff', bold: true,
  }))
  partes.push(textToPaths(body, {
    x: g.textX, y: baseY + headline.length * headlineLh + 28, size: bodySize,
    lineHeight: bodyLh, fill: '#f3f4f6', bold: false, opacity: 0.95,
  }))

  // Numeração N/M no topo esquerdo.
  partes.push(textToPaths([`${input.slideNumber}/${input.totalSlides}`], {
    x: SAFE_MARGIN, y: 104, size: 30, lineHeight: 30, fill: '#ffffff', bold: true, opacity: 0.8,
  }))

  // Marca no topo direito (alinhada pela largura medida).
  const marca = input.marca?.trim()
  if (marca) {
    const rotulo = marca.slice(0, 40)
    const w = measureText(rotulo, 28, true)
    partes.push(textToPaths([rotulo], {
      x: SLIDE_W - SAFE_MARGIN - w, y: 104, size: 28, lineHeight: 28, fill: '#ffffff', bold: true, opacity: 0.88,
    }))
  }

  // CTA em botão (rect + path do texto) na base.
  const cta = input.cta?.trim()
  if (cta) {
    const rotulo = cta.slice(0, 48)
    const ctaSize = 30
    const w = Math.min(measureText(rotulo, ctaSize, true) + 64, SLIDE_W - SAFE_MARGIN * 2)
    const ctaX = template === 'right' ? SLIDE_W - SAFE_MARGIN - w : SAFE_MARGIN
    partes.push(`<rect x="${ctaX}" y="${SLIDE_H - 128}" rx="16" width="${w}" height="68" fill="#ffffff"/>`)
    partes.push(textToPaths([rotulo], {
      x: ctaX + 32, y: SLIDE_H - 128 + 45, size: ctaSize, lineHeight: ctaSize, fill: '#111111', bold: true,
    }))
  }

  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>${g.veu}</defs>
  <rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#veu)"/>
  ${partes.join('\n  ')}
</svg>`
}

/**
 * Monta a arte FINAL: fundo da OpenAI (cover 1080×1080) + overlay do FunilPro.
 * Devolve JPEG real — é este arquivo que vai para o Storage, não uma prévia.
 */
export async function composeSlideImage(
  background: Uint8Array,
  input: SlideComposeInput,
): Promise<{ bytes: Uint8Array; contentType: 'image/jpeg'; width: number; height: number }> {
  const overlay = Buffer.from(buildSlideOverlaySvg(input))

  const bytes = await sharp(Buffer.from(background))
    .resize(SLIDE_W, SLIDE_H, { fit: 'cover', position: 'attention' })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  return { bytes: new Uint8Array(bytes), contentType: 'image/jpeg', width: SLIDE_W, height: SLIDE_H }
}
