// ============================================================================
// Casar venda externa com o lead — a regra do TELEFONE
// ----------------------------------------------------------------------------
// Funil que pede só NOME e TELEFONE (sem e-mail) depende inteiramente disto:
// é o telefone que liga a venda no ERP ao lead do painel.
//
// Dois erros que esta regra evita:
//
//   1. NÃO CASAR o que é a mesma pessoa. O telefone chega de todo jeito —
//      "+55 (21) 99629-9978", "21996299978", "(21) 9629-9978" (sem o nono
//      dígito, cadastro antigo). Comparar texto cru perde todos esses.
//
//   2. CASAR o que é gente diferente. Comparar só os 8 últimos dígitos
//      colide entre DDDs: (11) 99999-1234 e (21) 99999-1234 terminam igual.
//      Marcar a venda no lead errado é PIOR do que não marcar — então,
//      quando os dois lados têm DDD, o DDD precisa bater.
//
// O banco faz o filtro grosso (últimos 8 dígitos, tolerante a formatação) e
// esta função dá a palavra final. Assim a regra decisiva é testável sem banco.
// ============================================================================

/** Só os dígitos, sem o DDI 55: "+55 (21) 99629-9978" → "21996299978". */
export function foneDigitos(bruto: string | null | undefined): string {
  const d = (bruto ?? '').replace(/\D/g, '')
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d.slice(2)
  return d
}

/**
 * Chave comparável: DDD + os 8 finais (10 caracteres) quando dá para saber o
 * DDD; só os 8 finais quando o número veio sem ele. Vazio = inutilizável.
 */
export function foneChave(bruto: string | null | undefined): string {
  const d = foneDigitos(bruto)
  if (d.length < 8) return ''
  if (d.length >= 10) return d.slice(0, 2) + d.slice(-8)
  return d.slice(-8)
}

/** As duas chaves são a MESMA pessoa? */
export function foneBate(a: string, b: string): boolean {
  if (!a || !b) return false
  // Os dois com DDD: DDD e núcleo precisam bater.
  if (a.length === 10 && b.length === 10) return a === b
  // Um dos lados sem DDD: só o núcleo de 8 pode decidir.
  return a.slice(-8) === b.slice(-8)
}

/** Atalho: o telefone do lead é o mesmo que veio na venda? */
export function mesmoTelefone(
  doLead: string | null | undefined,
  daVenda: string | null | undefined,
): boolean {
  return foneBate(foneChave(doLead), foneChave(daVenda))
}

/** E-mail casa por igualdade, ignorando caixa e espaços. */
export function mesmoEmail(
  doLead: string | null | undefined,
  daVenda: string | null | undefined,
): boolean {
  const a = (doLead ?? '').trim().toLowerCase()
  const b = (daVenda ?? '').trim().toLowerCase()
  return a.length > 0 && a === b
}

/** A venda é deste lead? (e-mail OU telefone) */
export function ehOMesmoContato(
  lead: { email?: string | null; phone?: string | null },
  venda: { email?: string | null; telefone?: string | null },
): boolean {
  return mesmoEmail(lead.email, venda.email) || mesmoTelefone(lead.phone, venda.telefone)
}
