// ============================================================================
// Content Studio — prompt fotográfico da CAPA viral (viral_cover_photo_v1)
// ----------------------------------------------------------------------------
// Uma fotografia editorial/publicitária hiper-realista que para o scroll:
// cena extraordinária mas fisicamente possível, história compreensível só
// pela imagem, e uma pergunta mental específica que o carrossel responde.
//
// A DIREÇÃO vem do Designer quando ele gravou o bloco `cover` (Designer v3);
// sem ele, é DERIVADA deterministicamente da copy + direção geral — nunca uma
// segunda chamada de IA. Tudo persiste no output do step da capa.
// ============================================================================

export const VIRAL_COVER_PROMPT_VERSION = 'viral_cover_photo_v1'

/** Intensidades permitidas — enum do cliente, lista branca. */
export const VIRAL_INTENSITIES = ['forte', 'curiosidade_maxima'] as const
export type ViralIntensity = (typeof VIRAL_INTENSITIES)[number]
export const VIRAL_INTENSITY_DEFAULT: ViralIntensity = 'curiosidade_maxima'
export function isValidViralIntensity(v: unknown): v is ViralIntensity {
  return typeof v === 'string' && (VIRAL_INTENSITIES as readonly string[]).includes(v)
}

/** Os 6 mecanismos de curiosidade aprovados — a capa combina NO MÁXIMO dois. */
export const CURIOSITY_MECHANISMS = [
  'contraste', 'escala', 'reacao', 'situacao_rara', 'consequencia_visivel', 'misterio',
] as const
export type CuriosityMechanism = (typeof CURIOSITY_MECHANISMS)[number]

const MECHANISM_SCENE: Record<CuriosityMechanism, string> = {
  contraste: 'an ordinary person accomplishing something clearly extraordinary',
  escala: 'an unexpected visual quantity or consequence filling part of the scene',
  reacao: 'other people around reacting with genuine, authentic surprise',
  situacao_rara: 'a rare but completely realistic moment frozen mid-action',
  consequencia_visivel: 'the environment itself showing evidence that something important just happened',
  misterio: 'a clear human story with one visible piece of information missing',
}

export interface ViralCoverDirection extends Record<string, unknown> {
  curiosityMechanisms: CuriosityMechanism[]
  visualQuestion: string
  coverConcept: string
  mainSubject: string
  foreground: string
  middleGround: string
  background: string
  reactions: string
  visibleConsequence: string
  camera: string
  lens: string
  lighting: string
  colorGrade: string
  realismGuards: string
}

/** Hash determinístico simples — mesma entrada, mesmos mecanismos. */
function hashDet(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Direção da capa DERIVADA (fallback determinístico) quando o Designer não
 * gravou o bloco `cover`: escolhe 2 mecanismos pelo hash do tema, monta a
 * pergunta visual e fixa câmera/lente/luz/realismo em valores editoriais.
 */
export function deriveViralCoverDirection(input: {
  tema: string
  headline: string
  bigIdea?: string | null
  publico?: string | null
}): ViralCoverDirection {
  const h = hashDet(input.tema + input.headline)
  const m1 = CURIOSITY_MECHANISMS[h % CURIOSITY_MECHANISMS.length]
  let m2 = CURIOSITY_MECHANISMS[(h >> 3) % CURIOSITY_MECHANISMS.length]
  if (m2 === m1) m2 = CURIOSITY_MECHANISMS[(h >> 3) % CURIOSITY_MECHANISMS.length === 5 ? 0 : ((h >> 3) % CURIOSITY_MECHANISMS.length) + 1]

  const sujeito = input.publico?.trim()
    ? `a person who clearly belongs to this audience: ${input.publico}`
    : 'an ordinary, anonymous person'

  return {
    curiosityMechanisms: [m1, m2],
    visualQuestion: `What exactly happened here related to "${input.tema}" — and how did this person do it?`,
    coverConcept: `${MECHANISM_SCENE[m1]}, combined with ${MECHANISM_SCENE[m2]}, telling one clear human story about: ${input.bigIdea ?? input.headline}`,
    mainSubject: sujeito,
    foreground: 'tangible evidence of the work: real papers, notes, devices, objects with visible wear and detail',
    middleGround: 'the main subject mid-action, clearly recognizable, natural posture and expression',
    background: 'a rich, lived-in real environment with depth — never an empty backdrop',
    reactions: 'if other people appear, their surprise is genuine and unstaged',
    visibleConsequence: 'the scene itself shows that something meaningful just happened',
    camera: 'eye-level or slightly low angle, medium shot, subject off-center (rule of thirds)',
    lens: '35mm or 50mm full-frame look, shallow but realistic depth of field',
    lighting: 'professional commercial lighting that still reads as natural — window light or practicals, soft shadows',
    colorGrade: 'cinematic but natural color grading, rich tones, no heavy filters',
    realismGuards: 'realistic skin, hands, hair, fabrics and objects; correct anatomy; physically plausible everything',
  }
}

// ─── Proibições — NUNCA cortadas pelo teto ──────────────────────────────────

export const VIRAL_NEGATIVE_BANS =
  'Strictly avoid: illustration, cartoon, childish drawing, clip-art, line art, ' +
  'outline style, wireframe, icon-only composition, isolated icon, generic app ' +
  'mockup, neon smartphone drawing, abstract technology symbols, floating UI ' +
  'elements, empty black background, generic stock-photo pose, low-detail ' +
  'environment, cheap template appearance.'

export const VIRAL_TEXT_BANS =
  'Absolutely no embedded text, no readable letters, no words, no numbers, no ' +
  'logos, no watermarks anywhere in the photograph.'

/** Salvaguardas quando a cena envolve criança/adolescente. */
export const VIRAL_MINOR_GUARDS =
  'If the scene includes a child or teenager: an anonymous, illustrative ' +
  'fictional character only, not resembling any real identifiable person; ' +
  'age-appropriate clothing, environment and behavior; nothing sexualized; ' +
  'no personal information; never presented as documentary photography of a ' +
  'real person.'

const TECH_RULES =
  'If technology appears: real laptop, real phone, real papers and real ' +
  'surroundings; screens may appear only blurred or at an angle with ' +
  'unreadable content; no vector interfaces, no holograms, no glowing neon ' +
  'device drawings.'

const INTENSITY_TEXT: Record<ViralIntensity, string> = {
  forte: 'Strong visual impact: bold composition and confident lighting, while keeping the scene grounded and believable.',
  curiosidade_maxima:
    'Maximum curiosity: push contrast, scale, reactions, environmental evidence, composition and lighting as far as they can go — the scene must look improbable at first glance yet remain completely possible in the real world. The exaggeration lives in the situation, never in physics.',
}

const PROMPT_MAX = 4000

/**
 * O prompt fotográfico COMPLETO (inglês). Os blocos de proibição entram por
 * último, inteiros — o corte de tamanho nunca os alcança.
 */
export function buildViralCoverPrompt(
  direction: ViralCoverDirection,
  intensity: ViralIntensity,
): string {
  const corpo = [
    'Highly photorealistic editorial advertising photography, vertical 4:5 composition.',
    `COVER CONCEPT: ${direction.coverConcept}`,
    `The image must make the viewer ask: "${direction.visualQuestion}" — a clear human story understandable from the image alone, with one piece of information missing. Scroll-stopping curiosity.`,
    `MAIN SUBJECT (strong focal point, clearly recognizable): ${direction.mainSubject}.`,
    `Foreground: ${direction.foreground}. Middle ground: ${direction.middleGround}. Background: ${direction.background}.`,
    `Reactions: ${direction.reactions}. Visible consequence: ${direction.visibleConsequence}.`,
    `Camera: ${direction.camera}. Lens: ${direction.lens}.`,
    `Lighting: ${direction.lighting}. Color grade: ${direction.colorGrade}.`,
    `Realism: ${direction.realismGuards}. Realistic shadows and reflections. Environmental storytelling with rich detail. A real physical scene — extraordinary but believable. Premium campaign finish.`,
    INTENSITY_TEXT[intensity],
    TECH_RULES,
    VIRAL_MINOR_GUARDS,
  ].join('\n')

  const bans = `${VIRAL_NEGATIVE_BANS}\n${VIRAL_TEXT_BANS}`
  const teto = PROMPT_MAX - bans.length - 1
  return `${corpo.slice(0, Math.max(teto, 0))}\n${bans}`.trim()
}

/** O bloco `cover` do Designer, quando existir e for utilizável. */
export function coerceDesignerCover(raw: unknown): ViralCoverDirection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null
  const conceito = str(o.coverConcept, 600)
  const pergunta = str(o.visualQuestion, 300)
  const sujeito = str(o.mainSubject, 300)
  if (!conceito || !pergunta || !sujeito) return null

  const mecanismos = (Array.isArray(o.curiosityMechanisms) ? o.curiosityMechanisms : [])
    .filter((m): m is CuriosityMechanism => (CURIOSITY_MECHANISMS as readonly string[]).includes(m as string))
    .slice(0, 2)  // NO MÁXIMO dois mecanismos

  const base = deriveViralCoverDirection({ tema: conceito, headline: pergunta })
  return {
    ...base,
    curiosityMechanisms: mecanismos.length > 0 ? mecanismos : base.curiosityMechanisms,
    visualQuestion: pergunta,
    coverConcept: conceito,
    mainSubject: sujeito,
    foreground: str(o.foreground, 300) ?? base.foreground,
    middleGround: str(o.middleGround, 300) ?? base.middleGround,
    background: str(o.background, 300) ?? base.background,
    reactions: str(o.reactions, 300) ?? base.reactions,
    visibleConsequence: str(o.visibleConsequence, 300) ?? base.visibleConsequence,
    camera: str(o.camera, 200) ?? base.camera,
    lens: str(o.lens, 120) ?? base.lens,
    lighting: str(o.lighting, 240) ?? base.lighting,
    colorGrade: str(o.colorGrade, 200) ?? base.colorGrade,
    realismGuards: str(o.realismGuards, 300) ?? base.realismGuards,
  }
}
