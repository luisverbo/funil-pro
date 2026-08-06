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

// ════════════════════════════════════════════════════════════════════════════
// V2 — briefing visual estruturado (studio_image_v2)
// ----------------------------------------------------------------------------
// O v1 concatenava frases soltas do Designer e o modelo respondia com o mínimo:
// ícone pequeno num fundo escuro vazio. O v2 monta um BRIEFING de direção de
// arte: cena, assunto concreto, planos, iluminação, materiais, enquadramento,
// ponto focal, área reservada para a copy e a "bíblia visual" da série — com
// proibições explícitas do que estava saindo (ícone solto, wireframe, fundo
// preto vazio). As proibições de TEXTO continuam e nunca são cortadas.
// ════════════════════════════════════════════════════════════════════════════

export const STUDIO_IMAGE_PROMPT_VERSION_V2 = 'studio_image_v2'
const PROMPT_MAX_V2 = 3200

/** Estilos permitidos — lista branca; o cliente só envia o enum. */
export const IMAGE_PRESETS = [
  'editorial_premium', 'tech_3d', 'photo_ad', 'modern_illustration', 'cinematic',
] as const
export type ImagePreset = (typeof IMAGE_PRESETS)[number]
export const IMAGE_PRESET_DEFAULT: ImagePreset = 'editorial_premium'

export const IMAGE_PRESET_LABELS: Record<ImagePreset, string> = {
  editorial_premium: 'Editorial premium',
  tech_3d: 'Tecnologia 3D',
  photo_ad: 'Fotografia publicitária',
  modern_illustration: 'Ilustração moderna',
  cinematic: 'Cinematográfico',
}

/** Expansão CONTROLADA de cada preset — nunca texto livre do usuário. */
const PRESET_INSTRUCTIONS: Record<ImagePreset, string> = {
  editorial_premium:
    'Direção editorial premium: composição de revista de negócios sofisticada, ' +
    'objetos e cenas reais fotografados com estilo, cores ricas e profundas, ' +
    'texturas táteis (papel, metal escovado, vidro, tecido), luz natural lateral suave.',
  tech_3d:
    'Render 3D premium: formas volumétricas com materiais realistas (vidro fosco, ' +
    'metal, cerâmica), iluminação de estúdio com reflexos suaves, profundidade de ' +
    'campo, gradientes ricos — nível de acabamento de campanha de produto tech.',
  photo_ad:
    'Fotografia publicitária profissional: cena real com produção de estúdio, ' +
    'iluminação dramática intencional, profundidade de campo rasa, cores calibradas, ' +
    'acabamento de campanha impressa de marca líder.',
  modern_illustration:
    'Ilustração moderna rica: formas orgânicas sobrepostas, paleta vibrante e ' +
    'coerente, texturas de grão sutil, personagens/objetos estilizados com volume ' +
    'e sombra — nível editorial, nunca clip-art.',
  cinematic:
    'Fotograma cinematográfico: iluminação de cinema com contraste dramático, ' +
    'atmosfera com neblina/partículas sutis, paleta em harmonia de cor, composição ' +
    'em regra dos terços, textura de filme.',
}

export function isValidImagePreset(v: unknown): v is ImagePreset {
  return typeof v === 'string' && (IMAGE_PRESETS as readonly string[]).includes(v)
}

/** O que estava saindo — e não pode mais sair (salvo direção explícita). */
const NEGATIVE_BANS =
  'Proibido: ícone isolado no centro, desenho de contorno, wireframe, mockup ' +
  'vazio, interface genérica, fundo preto quase vazio, clip-art, estilo de banco ' +
  'de ícones, composição com um único objeto pequeno, aparência de template ' +
  'barato, imagem excessivamente escura, elementos desconectados flutuando.'

const QUALITY_BAR =
  'Acabamento de campanha publicitária premium: composição editorial, ' +
  'profundidade visual real (primeiro plano, plano médio e fundo), iluminação ' +
  'intencional, assunto principal claramente reconhecível, riqueza de materiais ' +
  'e detalhes, aparência profissional para Instagram. Uma CENA completa, não um ' +
  'ícone solto.'

/**
 * A "bíblia visual" do carrossel: derivada DETERMINISTICAMENTE da direção
 * geral + preset — a mesma entrada produz o mesmo texto, e todos os slides da
 * produção recebem o MESMO bloco. É o que faz a série parecer uma campanha.
 */
export function buildVisualBible(
  geral: ResultVisual['geral'],
  preset: ImagePreset,
): string {
  const partes = [
    `Sistema visual da série (igual em todos os slides): ${PRESET_INSTRUCTIONS[preset]}`,
    geral.estilo && `Estilo da campanha: ${geral.estilo}.`,
    geral.paleta && `Paleta fixa da série: ${geral.paleta}.`,
    geral.clima && `Clima emocional: ${geral.clima}.`,
    'Iluminação, materiais, tratamento de fundo e linguagem de formas consistentes do primeiro ao último slide; enquadramento recorrente com variação de ritmo.',
  ].filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
  return partes.join(' ')
}

export interface ImagePromptV2Options {
  preset: ImagePreset
  slideNumber: number
  totalSlides: number
}

/**
 * O briefing visual COMPLETO de um slide (v2). Estrutura fixa; conteúdo vindo
 * apenas do output persistido do Designer + expansões de lista branca.
 */
export function buildImagePromptV2(
  geral: ResultVisual['geral'],
  slide: ResultVisualSlide,
  opts: ImagePromptV2Options,
): string {
  const bible = buildVisualBible(geral, opts.preset)

  const corpo = [
    `Briefing de direção de arte — slide ${opts.slideNumber} de ${opts.totalSlides} de um carrossel de Instagram (1080x1080).`,
    `CENA PRINCIPAL: ${slide.promptImagem}`,
    `Composição e enquadramento: ${slide.composicao}. Ponto focal único e claro; câmera a média distância, com profundidade de campo perceptível.`,
    slide.elementos.length > 0 && `Elementos presentes na cena: ${slide.elementos.join(', ')} — integrados à cena, nunca flutuando soltos.`,
    slide.cores && `Cores deste slide: ${slide.cores}.`,
    slide.estilo && `Tratamento: ${slide.estilo}.`,
    bible,
    QUALITY_BAR,
    `Reserve área calma e de baixo detalhe para sobreposição de texto depois (região ${areaDeCopy(slide.layout)}), mantendo o restante da cena rico.`,
    NEGATIVE_BANS,
  ].filter((p): p is string => typeof p === 'string' && p.trim().length > 0)

  const texto = corpo.join('\n').replace(/[ \t]+/g, ' ').trim()
  // O sufixo de proibição de TEXTO nunca é cortado: entra por último, inteiro.
  const teto = PROMPT_MAX_V2 - IMAGE_PROMPT_BANS.length - 1
  return `${texto.slice(0, Math.max(teto, 0))}\n${IMAGE_PROMPT_BANS}`.trim()
}

/** Traduz a direção de layout do Designer em região de respiro para a copy. */
function areaDeCopy(layout: string): string {
  const l = layout.toLowerCase()
  if (/esquerd/.test(l)) return 'esquerda'
  if (/direit/.test(l)) return 'direita'
  if (/topo|superior/.test(l)) return 'superior'
  return 'inferior'
}

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
