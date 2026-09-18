// ============================================================================
// Tamanho do título da pergunta — UMA régua para pergunta e rótulo de campo
// ----------------------------------------------------------------------------
// Relato do dono: numa página que mistura campo de formulário e pergunta de
// escolha, a pergunta saía ENORME (2,125rem em negrito extra) ao lado dos
// rótulos dos campos (1,125rem) — "fica despropocional e eu não tenho como
// ajustar". O tamanho era fixo no renderer, sem controle nenhum.
//
// Aqui o tamanho vira escolha do dono, com a MESMA escala nos dois lugares:
// pergunta de escolha/escala/vídeo e rótulo de campo passam a falar a mesma
// língua, então dá para deixar tudo igual ou destacar de propósito.
//
// Padrão = 'grande' porque é exatamente o que os quizzes já publicados têm
// hoje: ninguém acorda com a página mudada sem pedir.
// ============================================================================

export const TAMANHOS_TITULO = ['pequeno', 'medio', 'grande', 'gigante'] as const
export type TamanhoTitulo = (typeof TAMANHOS_TITULO)[number]

export const PADRAO_TITULO: TamanhoTitulo = 'grande'

/** Rótulos do seletor no editor. */
export const ROTULOS_TAMANHO: Record<TamanhoTitulo, string> = {
  pequeno: 'Pequeno',
  medio: 'Médio',
  grande: 'Grande',
  gigante: 'Gigante',
}

export function tamanhoValido(v: unknown): v is TamanhoTitulo {
  return typeof v === 'string' && (TAMANHOS_TITULO as readonly string[]).includes(v)
}

interface EstiloTitulo {
  fontSize: string
  fontWeight: number
  lineHeight: string
  letterSpacing: string
}

/**
 * Cada degrau usa clamp(): cresce com a largura da tela sem precisar de duas
 * classes e sem estourar no celular. 'pequeno' bate com o rótulo dos campos
 * (1,125rem / 600) — é o degrau que deixa a página toda uniforme. 'grande'
 * reproduz o que existe hoje (1,5rem no celular → 2,125rem no desktop / 800).
 */
const ESCALA: Record<TamanhoTitulo, EstiloTitulo> = {
  pequeno: { fontSize: 'clamp(1rem, 0.94rem + 0.3vw, 1.125rem)',   fontWeight: 600, lineHeight: '1.35', letterSpacing: '0' },
  medio:   { fontSize: 'clamp(1.25rem, 1.15rem + 0.5vw, 1.5rem)',  fontWeight: 700, lineHeight: '1.25', letterSpacing: '-0.01em' },
  grande:  { fontSize: 'clamp(1.5rem, 1.18rem + 1.6vw, 2.125rem)', fontWeight: 800, lineHeight: '1.15', letterSpacing: '-0.02em' },
  gigante: { fontSize: 'clamp(1.875rem, 1.4rem + 2.4vw, 2.75rem)', fontWeight: 800, lineHeight: '1.1',  letterSpacing: '-0.03em' },
}

/** Estilo inline do título, pronto para o `style` do elemento. */
export function estiloDoTitulo(tamanho: unknown): EstiloTitulo {
  return ESCALA[tamanhoValido(tamanho) ? tamanho : PADRAO_TITULO]
}

/**
 * Subtítulo acompanha o título: num título pequeno, um subtítulo de 1,125rem
 * competiria com ele.
 */
export function estiloDoSubtitulo(tamanho: unknown): { fontSize: string; lineHeight: string } {
  const t = tamanhoValido(tamanho) ? tamanho : PADRAO_TITULO
  const escala: Record<TamanhoTitulo, string> = {
    pequeno: '0.875rem',
    medio:   'clamp(0.9375rem, 0.9rem + 0.2vw, 1rem)',
    grande:  'clamp(1rem, 0.95rem + 0.3vw, 1.125rem)',
    gigante: 'clamp(1.0625rem, 1rem + 0.4vw, 1.25rem)',
  }
  return { fontSize: escala[t], lineHeight: '1.5' }
}

/** Proporção para o preview do canvas do editor (o card é pequeno). */
export function tamanhoNoPreview(tamanho: unknown): string {
  const t = tamanhoValido(tamanho) ? tamanho : PADRAO_TITULO
  return { pequeno: '0.75rem', medio: '0.8125rem', grande: '0.875rem', gigante: '1rem' }[t]
}
