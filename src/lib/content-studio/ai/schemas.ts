// ============================================================================
// Content Studio — schemas dos outputs de IA (Fase 2B)
// ----------------------------------------------------------------------------
// Validação feita À MÃO, sem biblioteca nova, no servidor. Cada validador:
//
//   • aceita `unknown` e devolve o objeto TIPADO e SANEADO (campos copiados um
//     a um — propriedade extra do modelo simplesmente não sobrevive)
//   • impõe limites de tamanho em todo texto
//   • lança Error com o NOME do campo, nunca com o conteúdo
//
// Nada é persistido antes de passar por aqui. Nada daqui vira HTML: os textos
// seguem como texto puro até o React renderizá-los como texto.
// ============================================================================

export const SLIDES_AI_MIN = 6
export const SLIDES_AI_MAX = 8
export const HEADLINE_AI_MAX = 90
export const BODY_AI_MAX = 320
export const CAPTION_AI_MAX = 900
export const TITLE_AI_MAX = 120
export const LIST_MAX = 12
export const ITEM_MAX = 300
export const HASHTAG_MAX = 8

// ─── Primitivas ─────────────────────────────────────────────────────────────

function texto(v: unknown, campo: string, max: number, min = 1): string {
  if (typeof v !== 'string') throw new Error(`${campo}: esperado texto`)
  const limpo = v.replace(/\s+/g, ' ').trim()
  if (limpo.length < min) throw new Error(`${campo}: vazio`)
  if (limpo.length > max) throw new Error(`${campo}: excede ${max} caracteres`)
  return limpo
}

function lista(v: unknown, campo: string, maxItens = LIST_MAX, maxItem = ITEM_MAX): string[] {
  if (!Array.isArray(v)) throw new Error(`${campo}: esperado lista`)
  return v.slice(0, maxItens).map((item, i) => texto(item, `${campo}[${i}]`, maxItem))
}

function listaOpcional(v: unknown, campo: string): string[] {
  if (v === undefined || v === null) return []
  return lista(v, campo)
}

function nota(v: unknown, campo: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${campo}: esperado número`)
  if (v < 0 || v > 10) throw new Error(`${campo}: fora de 0-10`)
  return Math.round(v * 10) / 10
}

function objeto(v: unknown, campo: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${campo}: esperado objeto`)
  return v as Record<string, unknown>
}

// ─── Instruções internas vazadas ────────────────────────────────────────────

/**
 * Expressões metalinguísticas: sinal de que o modelo descreveu o slide em vez
 * de escrevê-lo. QUALQUER ocorrência derruba a validação do copy — este é o
 * defeito exato que enterrou a saída da Fase 2A.
 */
export const META_PATTERNS: RegExp[] = [
  /\bneste slide\b/i,
  /\bnesse slide\b/i,
  /\bobjetivo do slide\b/i,
  /\bheadline aqui\b/i,
  /\btexto curto\b/i,
  /\binserir cta\b/i,
  /\binserir\s+(texto|imagem|legenda)\b/i,
  /^\s*(mostrar|explicar|apresentar|nomear|levar|descrever|listar|destacar)\b/i,
  /\b(mostrar|explicar|apresentar) (como|por que|a oferta|o problema)\b/i,
  /\blevar à ação\b/i,
  /\bplaceholder\b/i,
  /\blorem ipsum\b/i,
]

export function findMetaLeak(textos: string[]): string | null {
  for (const t of textos) {
    for (const re of META_PATTERNS) {
      if (re.test(t)) return re.source
    }
  }
  return null
}

// ─── Estatística/fonte não sustentada ───────────────────────────────────────

const PADROES_INVENTADOS: { re: RegExp; nome: string }[] = [
  { re: /\b\d{1,3}\s*%/g, nome: 'porcentagem' },
  { re: /\b\d+\s+em\s+cada\s+\d+/gi, nome: 'proporção' },
  { re: /\b(estudo|pesquisa|levantamento|relat[óo]rio)\s+d[aeo]\b/gi, nome: 'referência a estudo' },
  {
    re: /\bsegundo\s+(a|o|os|as)\s+(pesquisa|estudo|dados|relat[óo]rio|levantamento|instituto|fonte|especialista)/gi,
    nome: 'citação de fonte',
  },
  { re: /\b\d[\d.,]*\s*(milh(ão|ões)|bilh(ão|ões))\b/gi, nome: 'magnitude' },
]

/** Padrões com cara de dado que NÃO aparecem literalmente no briefing. */
export function findUnsupportedClaims(
  textos: string[],
  brief: Record<string, unknown>,
): string[] {
  const briefTexto = Object.values(brief)
    .filter((v): v is string => typeof v === 'string')
    .join('\n')
    .toLowerCase()

  const achados: string[] = []
  const corpo = textos.join('\n').toLowerCase()
  for (const { re, nome } of PADROES_INVENTADOS) {
    for (const m of corpo.matchAll(new RegExp(re.source, re.flags))) {
      if (!briefTexto.includes(m[0])) { achados.push(nome); break }
    }
  }
  return achados
}

// ─── Researcher ─────────────────────────────────────────────────────────────

export interface ResearchOutput extends Record<string, unknown> {
  contexto_do_produto: string
  objetivo: string
  perfil_do_publico: string
  nivel_de_consciencia: string
  dores_explicitas: string[]
  dores_inferidas: string[]
  desejos: string[]
  objecoes: string[]
  beneficios: string[]
  diferenciais_informados: string[]
  riscos_de_comunicacao: string[]
  informacoes_ausentes: string[]
  hipoteses: string[]
  fatos_nao_afirmaveis: string[]
  perguntas_para_melhorar_briefing: string[]
  pesquisa_externa_realizada: false
}

export function parseResearch(raw: unknown): ResearchOutput {
  const o = objeto(raw, 'research')
  return {
    contexto_do_produto: texto(o.contexto_do_produto, 'contexto_do_produto', ITEM_MAX),
    objetivo: texto(o.objetivo, 'objetivo', ITEM_MAX),
    perfil_do_publico: texto(o.perfil_do_publico, 'perfil_do_publico', ITEM_MAX),
    nivel_de_consciencia: texto(o.nivel_de_consciencia, 'nivel_de_consciencia', ITEM_MAX),
    dores_explicitas: listaOpcional(o.dores_explicitas, 'dores_explicitas'),
    dores_inferidas: lista(o.dores_inferidas, 'dores_inferidas'),
    desejos: lista(o.desejos, 'desejos'),
    objecoes: lista(o.objecoes, 'objecoes'),
    beneficios: listaOpcional(o.beneficios, 'beneficios'),
    diferenciais_informados: listaOpcional(o.diferenciais_informados, 'diferenciais_informados'),
    riscos_de_comunicacao: listaOpcional(o.riscos_de_comunicacao, 'riscos_de_comunicacao'),
    informacoes_ausentes: listaOpcional(o.informacoes_ausentes, 'informacoes_ausentes'),
    hipoteses: lista(o.hipoteses, 'hipoteses'),
    fatos_nao_afirmaveis: listaOpcional(o.fatos_nao_afirmaveis, 'fatos_nao_afirmaveis'),
    perguntas_para_melhorar_briefing:
      listaOpcional(o.perguntas_para_melhorar_briefing, 'perguntas_para_melhorar_briefing'),
    // Fixado pelo VALIDADOR, não pelo modelo: nesta fase não há pesquisa externa.
    pesquisa_externa_realizada: false,
  }
}

// ─── Strategist ─────────────────────────────────────────────────────────────

export interface SlidePlan extends Record<string, unknown> {
  number: number
  role: string
  funcao: string
  emocao: string
}

export interface StrategyOutput extends Record<string, unknown> {
  big_idea: string
  angulo: string
  tensao: string
  promessa_editorial: string
  mecanismo_central: string
  nivel_de_consciencia: string
  objecao_principal: string
  sequencia: SlidePlan[]
  tom: string
  abordagem_do_cta: string
  evitar: string[]
}

export function parseStrategy(raw: unknown): StrategyOutput {
  const o = objeto(raw, 'strategy')
  const seq = o.sequencia
  if (!Array.isArray(seq) || seq.length < SLIDES_AI_MIN || seq.length > SLIDES_AI_MAX) {
    throw new Error(`sequencia: esperado ${SLIDES_AI_MIN}-${SLIDES_AI_MAX} slides`)
  }
  return {
    big_idea: texto(o.big_idea, 'big_idea', ITEM_MAX),
    angulo: texto(o.angulo, 'angulo', ITEM_MAX),
    tensao: texto(o.tensao, 'tensao', ITEM_MAX),
    promessa_editorial: texto(o.promessa_editorial, 'promessa_editorial', ITEM_MAX),
    mecanismo_central: texto(o.mecanismo_central, 'mecanismo_central', ITEM_MAX),
    nivel_de_consciencia: texto(o.nivel_de_consciencia, 'nivel_de_consciencia', ITEM_MAX),
    objecao_principal: texto(o.objecao_principal, 'objecao_principal', ITEM_MAX),
    sequencia: seq.map((s, i) => {
      const item = objeto(s, `sequencia[${i}]`)
      return {
        number: i + 1,
        role: texto(item.role, `sequencia[${i}].role`, 40),
        funcao: texto(item.funcao, `sequencia[${i}].funcao`, ITEM_MAX),
        emocao: texto(item.emocao, `sequencia[${i}].emocao`, 80),
      }
    }),
    tom: texto(o.tom, 'tom', 160),
    abordagem_do_cta: texto(o.abordagem_do_cta, 'abordagem_do_cta', ITEM_MAX),
    evitar: listaOpcional(o.evitar, 'evitar'),
  }
}

// ─── Copywriter ─────────────────────────────────────────────────────────────

export interface CopySlide extends Record<string, unknown> {
  number: number
  role: string
  headline: string
  body: string
}

export interface CopyOutput extends Record<string, unknown> {
  title: string
  slides: CopySlide[]
  caption: string
  cta: string
  hashtags: string[]
}

export function parseCopy(raw: unknown): CopyOutput {
  const o = objeto(raw, 'copy')
  const slides = o.slides
  if (!Array.isArray(slides) || slides.length < SLIDES_AI_MIN || slides.length > SLIDES_AI_MAX) {
    throw new Error(`slides: esperado ${SLIDES_AI_MIN}-${SLIDES_AI_MAX} slides`)
  }
  const parsed: CopyOutput = {
    title: texto(o.title, 'title', TITLE_AI_MAX),
    slides: slides.map((s, i) => {
      const item = objeto(s, `slides[${i}]`)
      return {
        number: i + 1,
        role: texto(item.role, `slides[${i}].role`, 40),
        headline: texto(item.headline, `slides[${i}].headline`, HEADLINE_AI_MAX),
        body: texto(item.body, `slides[${i}].body`, BODY_AI_MAX),
      }
    }),
    caption: texto(o.caption, 'caption', CAPTION_AI_MAX),
    cta: texto(o.cta, 'cta', 160),
    hashtags: listaOpcional(o.hashtags, 'hashtags')
      .slice(0, HASHTAG_MAX)
      .map(h => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '')),
  }

  // Instrução interna vazada é INVÁLIDA já no schema — nem chega ao revisor.
  const vazamento = findMetaLeak([
    parsed.title, parsed.caption,
    ...parsed.slides.flatMap(s => [s.headline, s.body]),
  ])
  if (vazamento) throw new Error(`copy contém instrução interna (padrão: ${vazamento})`)

  return parsed
}

// ─── Reviewer ───────────────────────────────────────────────────────────────

export const SCORE_KEYS = [
  'specificity', 'hook', 'narrative', 'clarity', 'persuasion', 'naturalness',
] as const
export type ScoreKey = (typeof SCORE_KEYS)[number]

export interface ReviewAIOutput extends Record<string, unknown> {
  scores: Record<ScoreKey, number>
  strengths: string[]
  problems: string[]
  revision_instructions: string[]
}

/**
 * O veredito NÃO vem daqui: o modelo entrega notas e problemas, e o SERVIDOR
 * decide aprovado/reprovado aplicando a régua da configuração. Um modelo
 * bonzinho demais não aprova nada sozinho.
 */
export function parseReviewAI(raw: unknown): ReviewAIOutput {
  const o = objeto(raw, 'review')
  const s = objeto(o.scores, 'scores')
  const scores = {} as Record<ScoreKey, number>
  for (const k of SCORE_KEYS) scores[k] = nota(s[k], `scores.${k}`)
  return {
    scores,
    strengths: listaOpcional(o.strengths, 'strengths'),
    problems: listaOpcional(o.problems, 'problems'),
    revision_instructions: listaOpcional(o.revision_instructions, 'revision_instructions'),
  }
}
