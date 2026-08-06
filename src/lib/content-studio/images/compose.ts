// ============================================================================
// Content Studio — composição FINAL do slide (FunilPro, server-side via sharp)
// ----------------------------------------------------------------------------
// A OpenAI entrega SÓ o fundo. Este módulo monta a arte publicável:
//   fundo (cover 1080×1080) + véu de contraste + headline + body + CTA +
//   nome da marca quando houver — tudo desenhado pelo FunilPro.
//
// As partes PURAS (quebra de linha, escape, SVG do overlay) ficam separadas da
// parte com sharp de propósito: são elas que os testes exercitam à exaustão; o
// sharp entra só para rasterizar e compor.
// ============================================================================

import sharp from 'sharp'

export const SLIDE_W = 1080
export const SLIDE_H = 1080

export interface SlideComposeInput {
  headline: string
  body: string
  /** CTA — desenhado apenas quando presente (tipicamente no último slide). */
  cta?: string
  /** Nome da marca (config do usuário) — rodapé discreto, nunca logotipo da IA. */
  marca?: string
  slideNumber: number
  totalSlides: number
}

/** Escape para texto dentro de SVG — o conteúdo vem da copy, não é confiável. */
export function escapeSvgText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Quebra de linha por LARGURA APROXIMADA (caracteres): determinística e pura.
 * Palavra maior que a linha é cortada com hífen em vez de vazar da arte.
 */
export function wrapText(texto: string, maxChars: number, maxLines: number): string[] {
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
    if (candidata.length <= maxChars) {
      atual = candidata
    } else {
      if (atual) linhas.push(atual)
      atual = palavra
    }
  }
  if (atual) linhas.push(atual)

  if (linhas.length > maxLines) {
    const corte = linhas.slice(0, maxLines)
    corte[maxLines - 1] = corte[maxLines - 1].replace(/[.,;: ]+$/, '') + '…'
    return corte
  }
  return linhas
}

/**
 * O overlay COMPLETO do slide como SVG (1080×1080), pronto para compor sobre o
 * fundo. Todo texto visível da arte nasce AQUI, no FunilPro — nunca na imagem
 * da OpenAI.
 */
export function buildSlideOverlaySvg(input: SlideComposeInput): string {
  const headline = wrapText(input.headline, 22, 3)
  const body = wrapText(input.body, 44, 4)

  const headlineSize = 72
  const headlineLh = 84
  const bodySize = 36
  const bodyLh = 50

  // Bloco de texto ancorado no terço inferior, sobre o véu de contraste.
  const blocoAltura = headline.length * headlineLh + 24 + body.length * bodyLh
  const baseY = SLIDE_H - 150 - blocoAltura

  const headlineTspans = headline.map((l, i) =>
    `<tspan x="80" dy="${i === 0 ? 0 : headlineLh}">${escapeSvgText(l)}</tspan>`).join('')
  const bodyTspans = body.map((l, i) =>
    `<tspan x="80" dy="${i === 0 ? 0 : bodyLh}">${escapeSvgText(l)}</tspan>`).join('')

  const cta = input.cta?.trim()
  const ctaSvg = cta
    ? `<g>
        <rect x="80" y="${SLIDE_H - 118}" rx="14" width="${Math.min(60 + cta.length * 17, 920)}" height="64" fill="#ffffff"/>
        <text x="110" y="${SLIDE_H - 76}" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#111111">${escapeSvgText(cta.slice(0, 48))}</text>
      </g>`
    : ''

  const marca = input.marca?.trim()
  const marcaSvg = marca
    ? `<text x="${SLIDE_W - 80}" y="96" text-anchor="end" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#ffffff" opacity="0.85">${escapeSvgText(marca.slice(0, 40))}</text>`
    : ''

  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="veu" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.35" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.72" stop-color="#000000" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.78"/>
    </linearGradient>
  </defs>
  <rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#veu)"/>
  <text x="80" y="96" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" fill="#ffffff" opacity="0.75">${input.slideNumber}/${input.totalSlides}</text>
  ${marcaSvg}
  <text x="80" y="${baseY}" font-family="Arial, Helvetica, sans-serif" font-size="${headlineSize}" font-weight="800" fill="#ffffff">${headlineTspans}</text>
  <text x="80" y="${baseY + headline.length * headlineLh + 24}" font-family="Arial, Helvetica, sans-serif" font-size="${bodySize}" fill="#f3f4f6">${bodyTspans}</text>
  ${ctaSvg}
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
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer()

  return { bytes: new Uint8Array(bytes), contentType: 'image/jpeg', width: SLIDE_W, height: SLIDE_H }
}
