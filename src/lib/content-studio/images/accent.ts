// ============================================================================
// Content Studio — modo visual + cor de destaque (módulo PURO, sem sharp).
// ----------------------------------------------------------------------------
// Importável por componentes client (o bundle do browser não pode puxar sharp
// — mesmo motivo do images/modes.ts). Toda a lógica de desenho fica em
// images/viral.ts, que reexporta estes símbolos para o código de servidor.
// ============================================================================

export const VIRAL_VISUAL_MODE = 'viral_cover_text_v1'
export const VIRAL_VISUAL_MODE_LABEL = 'Viral — capa com foto'

// ─── Cor de destaque (lista branca + hex custom validado) ───────────────────

export const ACCENT_COLORS = {
  roxo: '#7C3AED',
  azul: '#2563EB',
  vermelho: '#DC2626',
  amarelo: '#FACC15',
  verde: '#16A34A',
  laranja: '#EA580C',
} as const
export type AccentName = keyof typeof ACCENT_COLORS
export const ACCENT_DEFAULT: AccentName = 'roxo'

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/**
 * Normaliza a escolha de cor: nome da lista branca OU hex válido. Qualquer
 * outra coisa (CSS livre, rgb(), nomes desconhecidos) cai no padrão — a
 * validação roda de novo no SERVIDOR antes de desenhar.
 */
export function parseAccentColor(v: unknown): string {
  if (typeof v !== 'string') return ACCENT_COLORS[ACCENT_DEFAULT]
  const limpo = v.trim()
  if (limpo in ACCENT_COLORS) return ACCENT_COLORS[limpo as AccentName]
  if (HEX_RE.test(limpo)) return limpo.toUpperCase()
  return ACCENT_COLORS[ACCENT_DEFAULT]
}

export function isValidAccentInput(v: unknown): boolean {
  return typeof v === 'string' && (v.trim() in ACCENT_COLORS || HEX_RE.test(v.trim()))
}

/**
 * Texto branco ou preto sobre a cor de destaque, por LUMINÂNCIA relativa —
 * nunca uma combinação ilegível.
 */
export function textColorFor(hex: string): '#ffffff' | '#111111' {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 150 ? '#111111' : '#ffffff'
}
