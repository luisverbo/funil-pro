// ============================================================================
// Duplicação de página — regras puras (testáveis sem banco)
// ----------------------------------------------------------------------------
// DEFEITO QUE ORIGINOU ESTE MÓDULO: `duplicatePage` copiava uma lista fixa de
// cinco colunas (title, page_type, funnel_id, slug, craft_json). O conteúdo do
// quiz mora em `pages.quiz_data` — que não estava na lista. Resultado: duplicar
// um quiz produzia uma casca vazia. O SEO (meta_title, meta_description,
// og_image_url) e o pixel se perdiam pelo mesmo motivo.
//
// A correção inverte a regra: em vez de listar o que copiar, lista o que NÃO
// copiar. Coluna nova criada daqui em diante já nasce sendo duplicada, e o
// defeito não volta por esquecimento — que é exatamente como ele apareceu.
// ============================================================================

/**
 * O que precisa nascer do zero na cópia.
 *
 * Identidade e endereço público são únicos; estado de publicação começa em
 * rascunho; e contador herdado MENTIRIA — a cópia diria ter visitas e
 * conversões que nunca teve.
 */
export const COLUNAS_NAO_COPIADAS = new Set([
  'id', 'created_at', 'updated_at', 'slug', 'title', 'tenant_id',
  'published', 'published_at',
  'views_count', 'clicks_count', 'conversions_count',
])

/** Tudo o que define a página, menos o que precisa ser novo. */
export function camposHerdados(
  original: Record<string, unknown>,
  naoCopiar: Set<string> = COLUNAS_NAO_COPIADAS,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [coluna, valor] of Object.entries(original)) {
    if (!naoCopiar.has(coluna)) out[coluna] = valor
  }
  return out
}

export interface PerguntaV1 {
  id: string
  page_id?: string
  next_question_id?: string | null
  options?: unknown
  created_at?: string
  [k: string]: unknown
}

/**
 * Copia as perguntas do quiz antigo (v1) REAPONTANDO os vínculos.
 *
 * É o ponto delicado: cada pergunta guarda o id da próxima, e cada opção de
 * resposta também. Copiadas cruas, as perguntas da cópia apontariam para as
 * perguntas do ORIGINAL — e editar a cópia mudaria o fluxo do quiz original.
 *
 * Vínculo que aponta para fora da página vira nulo em vez de apontar para o
 * original: preferimos um caminho que termina a um caminho que atravessa para
 * outro quiz sem ninguém perceber.
 */
export function remapearPerguntasV1(
  perguntas: PerguntaV1[],
  destinoId: string,
  tenantId: string,
  novoId: (antigo: string) => string,
): Record<string, unknown>[] {
  const mapa = new Map<string, string>()
  for (const p of perguntas) mapa.set(String(p.id), novoId(String(p.id)))

  const remapear = (valor: unknown): string | null => {
    const s = valor == null ? null : String(valor)
    if (!s) return null
    return mapa.get(s) ?? null
  }

  return perguntas.map(p => {
    const opcoes = Array.isArray(p.options)
      ? (p.options as Record<string, unknown>[]).map(o => ({
          ...o,
          ...(o.next_question_id !== undefined
            ? { next_question_id: remapear(o.next_question_id) }
            : {}),
        }))
      : p.options

    const resto: Record<string, unknown> = { ...p }
    delete resto.created_at

    return {
      ...resto,
      id: mapa.get(String(p.id))!,
      page_id: destinoId,
      tenant_id: tenantId,
      options: opcoes,
      next_question_id: remapear(p.next_question_id),
    }
  })
}
