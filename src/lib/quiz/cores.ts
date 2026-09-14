// ============================================================================
// Cores do quiz — tudo derivado da COR PRIMÁRIA que o dono escolheu
// ----------------------------------------------------------------------------
// Um quiz profissional não usa uma cor só: usa a família dela — gradiente do
// botão (primária → mais escura), brilho do foco (primária translúcida),
// sombra colorida (a "luz" do botão no fundo), texto que contrasta. Estas
// funções são puras: o renderer só pede "me dá a variante".
// ============================================================================

/** "#6366f1" → { r, g, b }. Aceita 3 ou 6 dígitos; inválido → índigo padrão. */
export function hexParaRgb(hex: string | null | undefined): { r: number; g: number; b: number } {
  const limpo = (hex ?? '').trim().replace('#', '')
  const cheio = limpo.length === 3 ? limpo.split('').map(c => c + c).join('') : limpo
  if (!/^[0-9a-fA-F]{6}$/.test(cheio)) return { r: 99, g: 102, b: 241 }
  return {
    r: parseInt(cheio.slice(0, 2), 16),
    g: parseInt(cheio.slice(2, 4), 16),
    b: parseInt(cheio.slice(4, 6), 16),
  }
}

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const paraHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('')

/** Primária com transparência: "rgba(99,102,241,0.15)". */
export function comAlpha(hex: string | null | undefined, alpha: number): string {
  const { r, g, b } = hexParaRgb(hex)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`
}

/** Escurece por uma fração (0.2 = 20% mais escura). */
export function escurecer(hex: string | null | undefined, fracao: number): string {
  const { r, g, b } = hexParaRgb(hex)
  const f = 1 - Math.max(0, Math.min(1, fracao))
  return paraHex(r * f, g * f, b * f)
}

/** Clareia por uma fração (0.2 = 20% em direção ao branco). */
export function clarear(hex: string | null | undefined, fracao: number): string {
  const { r, g, b } = hexParaRgb(hex)
  const f = Math.max(0, Math.min(1, fracao))
  return paraHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f)
}

/** Gradiente do botão: primária → um degrau mais escura, na diagonal. */
export function gradientePrimario(hex: string | null | undefined): string {
  return `linear-gradient(135deg, ${clarear(hex, 0.08)} 0%, ${escurecer(hex, 0.18)} 100%)`
}

/** Sombra colorida: a "luz" que o botão joga no fundo. */
export function sombraColorida(hex: string | null | undefined, forte = false): string {
  return forte
    ? `0 18px 40px -12px ${comAlpha(hex, 0.55)}`
    : `0 10px 28px -10px ${comAlpha(hex, 0.45)}`
}

/** Anel de foco/seleção: borda + brilho translúcido. */
export function brilhoFoco(hex: string | null | undefined): string {
  return `0 0 0 4px ${comAlpha(hex, 0.18)}`
}

/**
 * Preto ou branco sobre a cor — pela luminância relativa (WCAG). É o que
 * evita texto branco em botão amarelo.
 */
export function textoContraste(hex: string | null | undefined): '#ffffff' | '#111827' {
  const { r, g, b } = hexParaRgb(hex)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return lum > 0.5 ? '#111827' : '#ffffff'
}

/**
 * Orbes decorativos do fundo: dois radiais suaves da primária (e um do
 * complementar) — profundidade sem imagem, sem peso.
 */
export function decoracaoFundo(hex: string | null | undefined, escuro: boolean): string {
  const a1 = escuro ? 0.35 : 0.18
  const a2 = escuro ? 0.22 : 0.12
  const { r, g, b } = hexParaRgb(hex)
  // complementar simples: gira o matiz invertendo os canais
  const comp = paraHex(255 - r, 255 - g, 255 - b)
  return [
    `radial-gradient(60% 50% at 15% 10%, ${comAlpha(hex, a1)} 0%, transparent 70%)`,
    `radial-gradient(50% 45% at 85% 90%, ${comAlpha(comp, a2)} 0%, transparent 70%)`,
  ].join(', ')
}
