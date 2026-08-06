// ============================================================================
// Content Studio — enums de geração de imagem (módulo PURO)
// ----------------------------------------------------------------------------
// Vive separado de run.ts de propósito: componentes de CLIENTE importam estes
// enums para os seletores, e run.ts importa sharp — que jamais pode entrar no
// bundle do navegador. Aqui: zero dependências.
// ============================================================================

/** Modos de geração — enum do cliente; o servidor decide a quality real. */
export const IMAGE_MODES = ['quick', 'premium'] as const
export type ImageMode = (typeof IMAGE_MODES)[number]
export const IMAGE_MODE_DEFAULT: ImageMode = 'premium'
export function isValidImageMode(v: unknown): v is ImageMode {
  return typeof v === 'string' && (IMAGE_MODES as readonly string[]).includes(v)
}
