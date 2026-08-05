// ============================================================================
// Content Studio — briefing da produção (validação PURA)
// ----------------------------------------------------------------------------
// Toda validação acontece no SERVIDOR. O formulário do navegador valida também,
// mas isso é conveniência: uma Server Action é um endpoint HTTP e o cliente
// controla cada byte que chega. O que vale é o que passa por aqui.
//
// Sem banco e sem React de propósito — dá para varrer todos os casos de entrada
// inválida em teste, sem Postgres e sem navegador.
//
// O que este módulo NÃO faz: aceitar tenant_id. Nem como campo opcional, nem
// "para conveniência". O tenant vem da sessão, e um campo aqui seria um convite.
// ============================================================================

/** Campos do briefing, na ordem em que aparecem no formulário. */
export const BRIEF_FIELDS = [
  'titulo', 'tema', 'objetivo', 'publico',
  'oferta', 'tom', 'cta', 'observacoes',
] as const

export type BriefField = (typeof BRIEF_FIELDS)[number]

/** Só `observacoes` é opcional. O resto é o mínimo para produzir algo útil. */
const OPCIONAIS: readonly BriefField[] = ['observacoes']

export const BRIEF_LABELS: Record<BriefField, string> = {
  titulo: 'Nome da produção',
  tema: 'Produto, serviço ou tema',
  objetivo: 'Objetivo',
  publico: 'Público-alvo',
  oferta: 'Oferta ou mensagem principal',
  tom: 'Tom de voz',
  cta: 'Chamada para ação',
  observacoes: 'Observações (opcional)',
}

/**
 * Limites por campo.
 *
 * O máximo é trava de recurso, não de estilo: sem ele um POST de 2MB viraria um
 * `brief` de 2MB copiado para dentro de cada evento e de cada input de agente.
 * O mínimo evita "a", que passaria em "não vazio" e produziria lixo.
 */
export const BRIEF_LIMITS: Record<BriefField, { min: number; max: number }> = {
  titulo:      { min: 3,  max: 120 },
  tema:        { min: 3,  max: 200 },
  objetivo:    { min: 3,  max: 300 },
  publico:     { min: 3,  max: 200 },
  oferta:      { min: 3,  max: 300 },
  tom:         { min: 2,  max: 80  },
  cta:         { min: 2,  max: 120 },
  observacoes: { min: 0,  max: 800 },
}

/** Teto do payload inteiro, somando todos os campos. */
export const BRIEF_TOTAL_MAX = 2_000

export interface BriefInput {
  titulo?: unknown
  tema?: unknown
  objetivo?: unknown
  publico?: unknown
  oferta?: unknown
  tom?: unknown
  cta?: unknown
  observacoes?: unknown
  /** Gerado pelo navegador por SUBMISSÃO. Não concede privilégio nenhum. */
  idempotencyKey?: unknown
}

/** Briefing já validado e normalizado. É isto que vai para o banco. */
export type ValidBrief = Record<BriefField, string> & { idempotency_key: string }

export interface BriefError {
  field: BriefField | 'idempotencyKey' | 'total'
  message: string
}

export type BriefResult =
  | { ok: true; brief: ValidBrief }
  | { ok: false; errors: BriefError[] }

/**
 * Normaliza um valor de texto vindo do cliente.
 *
 * Caracteres de controle (incluindo os invisíveis usados para burlar filtro de
 * tamanho) são removidos ANTES de medir, senão a contagem mente.
 */
function normalizar(valor: unknown): string {
  if (typeof valor !== 'string') return ''
  return valor
    // Controles e invisíveis saem ANTES de medir: contar depois mentiria.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

/** Chave de idempotência aceitável: opaca, curta e sem surpresa. */
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,64}$/

/**
 * Valida o briefing inteiro.
 *
 * Devolve TODOS os erros de uma vez: corrigir um campo por vez, com um recarrego
 * a cada tentativa, é hostil em formulário de oito campos.
 */
export function validateBrief(input: BriefInput): BriefResult {
  const errors: BriefError[] = []
  const brief = {} as ValidBrief

  for (const field of BRIEF_FIELDS) {
    const valor = normalizar(input[field])
    const { min, max } = BRIEF_LIMITS[field]
    const opcional = OPCIONAIS.includes(field)

    if (!valor) {
      if (!opcional) {
        errors.push({ field, message: `Preencha "${BRIEF_LABELS[field]}".` })
      }
      brief[field] = ''
      continue
    }

    if (valor.length < min) {
      errors.push({
        field,
        message: `"${BRIEF_LABELS[field]}" precisa de pelo menos ${min} caracteres.`,
      })
    } else if (valor.length > max) {
      errors.push({
        field,
        message: `"${BRIEF_LABELS[field]}" pode ter no máximo ${max} caracteres.`,
      })
    }

    brief[field] = valor
  }

  const total = BRIEF_FIELDS.reduce((soma, f) => soma + brief[f].length, 0)
  if (total > BRIEF_TOTAL_MAX) {
    errors.push({
      field: 'total',
      message: `O briefing ficou grande demais (${total} de ${BRIEF_TOTAL_MAX} caracteres).`,
    })
  }

  const chave = normalizar(input.idempotencyKey)
  if (!IDEMPOTENCY_RE.test(chave)) {
    errors.push({
      field: 'idempotencyKey',
      message: 'Não foi possível identificar este envio. Recarregue a página e tente novamente.',
    })
  }
  brief.idempotency_key = chave

  return errors.length > 0 ? { ok: false, errors } : { ok: true, brief }
}

/** Primeira mensagem de erro — o que a Server Action devolve ao navegador. */
export function firstBriefMessage(errors: BriefError[]): string {
  return errors[0]?.message ?? 'Revise o briefing e tente novamente.'
}
