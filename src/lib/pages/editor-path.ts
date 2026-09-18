// ============================================================================
// Qual editor abre cada tipo de página — UMA autoridade
// ----------------------------------------------------------------------------
// Por que existe: a lista de páginas tinha a regra escrita no botão "Editar" e
// o botão "Duplicar" mandava TODO mundo para /page-editor. Resultado: duplicar
// um quiz abria o editor de Craft.js (o errado), onde o quiz não existe e não
// há como renomear nada — foi assim que a cópia ficou presa no nome
// "Cópia de …". Com a regra num lugar só, os dois botões concordam sempre.
// ============================================================================

export type TipoDePagina = string

/** Caminho do editor certo para o tipo da página. */
export function caminhoDoEditor(pageType: TipoDePagina | null | undefined, id: string): string {
  switch (pageType) {
    case 'interactive': return `/quiz-editor/${id}`
    case 'biolink':     return `/bio-editor/${id}`
    default:            return `/page-editor/${id}`
  }
}

/**
 * Nome da cópia. Fica aqui para o teste poder cobrar que a cópia nasce com um
 * nome DIFERENTE (senão a lista vira um monte de páginas iguais) e que
 * duplicar duas vezes não empilha "Cópia de Cópia de Cópia de…".
 */
export function nomeDaCopia(titulo: string): string {
  const base = titulo.replace(/^(Cópia de )+/, '').trim() || 'Página'
  return `Cópia de ${base}`
}
