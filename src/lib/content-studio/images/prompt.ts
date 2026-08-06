// ============================================================================
// Content Studio — prompt de imagem (studio_image_v1)
// ----------------------------------------------------------------------------
// O prompt NUNCA vem do cliente: é montado aqui, no servidor, a partir do que
// o Designer gravou em cs_steps (direção geral + direção do slide).
//
// DIVISÃO DE RESPONSABILIDADE (a regra do produto):
//   OpenAI  -> fundo/ilustração. SEM texto, letras, números, logos, marca-d'água.
//   FunilPro-> headline, body, CTA, tipografia, contraste e logo, via sharp.
// O sufixo de proibição é FIXO e sempre anexado — não é opinião do modelo.
// ============================================================================

import type { ResultVisual, ResultVisualSlide } from '../result-view'

export const STUDIO_IMAGE_PROMPT_VERSION = 'studio_image_v1'

/**
 * Proibições anexadas a TODO prompt de imagem. A arte final quem monta é o
 * FunilPro — a imagem é só a base visual.
 */
export const IMAGE_PROMPT_BANS =
  'Imagem de fundo para post: sem texto, sem letras, sem números, sem logotipos ' +
  'e sem marca-d\'água. No text, no letters, no numbers, no words, no logos, ' +
  'no watermarks, no typography of any kind.'

/** Mantém o prompt dentro de um teto são para o endpoint. */
const PROMPT_MAX = 1600

export function buildImagePrompt(
  geral: ResultVisual['geral'],
  slide: ResultVisualSlide,
): string {
  const partes = [
    slide.promptImagem,
    slide.composicao,
    slide.estilo && `Estilo: ${slide.estilo}.`,
    slide.cores && `Cores: ${slide.cores}.`,
    geral.estilo && `Direção geral: ${geral.estilo}.`,
    geral.clima && `Clima: ${geral.clima}.`,
    // Área de respiro para o FunilPro desenhar o texto por cima.
    'Composição com áreas amplas e calmas, sem elementos pequenos demais, adequada para sobrepor texto depois.',
  ].filter((p): p is string => typeof p === 'string' && p.trim().length > 0)

  const corpo = partes.join(' ').replace(/\s+/g, ' ').trim()
  // O sufixo de proibição NUNCA é cortado: entra por último, inteiro.
  const teto = PROMPT_MAX - IMAGE_PROMPT_BANS.length - 1
  return `${corpo.slice(0, Math.max(teto, 0))} ${IMAGE_PROMPT_BANS}`.trim()
}
