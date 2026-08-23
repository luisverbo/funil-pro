// ============================================================================
// Custos do funil — investido, CPL, CPL quente e custo por venda
// ----------------------------------------------------------------------------
// Um módulo só, usado pelo painel do DONO e pelo portal do CLIENTE. Duplicar
// a conta faria as duas telas divergirem na primeira mudança — e "meu painel
// diz um número, o do cliente diz outro" é o tipo de erro que destrói a
// confiança na ferramenta inteira.
//
// A regra que faltava: o gasto é lançado POR DIA, então o custo tem que
// respeitar o período escolhido. Antes o investido era o total de todos os
// tempos dividido por leads filtrados — misturava períodos e mentia.
// Agora o mesmo recorte vale para os dois lados da divisão.
// ============================================================================

export interface LancamentoDia {
  /** 'YYYY-MM-DD' — o dia do gasto, como o dono lançou. */
  date: string
  amountCents: number
}

export interface LeadCusto {
  /** ISO da entrada do lead; null quando desconhecida. */
  data: string | null
  temContato: boolean
  fechado: boolean
}

export type ModoPeriodo = 'tudo' | 'hoje' | '7d' | '30d'

export interface FiltroPeriodo {
  modo: ModoPeriodo
  /** 'YYYY-MM-DD' — quando presente, vence o modo. */
  dia?: string
}

export interface Custos {
  investidoCents: number
  leads: number
  comContato: number
  fechados: number
  /** null quando não há gasto ou não há lead — nunca Infinity, nunca zero falso. */
  cplCents: number | null
  cplQuenteCents: number | null
  custoPorVendaCents: number | null
  rotulo: string
}

/** Dia local ('YYYY-MM-DD') de um ISO — o lançamento é feito em dia local. */
export function diaLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** O dia (YYYY-MM-DD) está dentro do filtro? Serve para lead e para gasto. */
export function diaNoPeriodo(dia: string, filtro: FiltroPeriodo, agora = new Date()): boolean {
  if (filtro.dia) return dia === filtro.dia
  if (filtro.modo === 'tudo') return true

  const hoje = diaLocal(agora.toISOString())
  if (filtro.modo === 'hoje') return dia === hoje

  const dias = filtro.modo === '7d' ? 7 : 30
  const corte = new Date(agora)
  corte.setHours(0, 0, 0, 0)
  corte.setDate(corte.getDate() - (dias - 1))
  return dia >= diaLocal(corte.toISOString())
}

export function rotuloPeriodo(filtro: FiltroPeriodo): string {
  if (filtro.dia) {
    const [a, m, d] = filtro.dia.split('-')
    return `em ${d}/${m}/${a}`
  }
  if (filtro.modo === 'hoje') return 'hoje'
  if (filtro.modo === '7d') return 'nos últimos 7 dias'
  if (filtro.modo === '30d') return 'nos últimos 30 dias'
  return 'no total'
}

function dividir(total: number, quantidade: number): number | null {
  if (total <= 0 || quantidade <= 0) return null
  return Math.round(total / quantidade)
}

/**
 * Custos do período. Gasto e leads são recortados pelo MESMO filtro — é isso
 * que torna "custo do dia 18" um número honesto.
 *
 * Lead sem data não entra em recorte nenhum (a não ser 'tudo'): melhor faltar
 * do que ser contado no dia errado.
 */
export function calcularCustos(
  lancamentos: LancamentoDia[],
  leads: LeadCusto[],
  filtro: FiltroPeriodo,
  agora = new Date(),
): Custos {
  const investidoCents = lancamentos
    .filter(l => diaNoPeriodo(l.date, filtro, agora))
    .reduce((soma, l) => soma + (Number(l.amountCents) || 0), 0)

  const noPeriodo = leads.filter(l => {
    if (!l.data) return filtro.modo === 'tudo' && !filtro.dia
    return diaNoPeriodo(diaLocal(l.data), filtro, agora)
  })

  const comContato = noPeriodo.filter(l => l.temContato).length
  const fechados = noPeriodo.filter(l => l.fechado).length

  return {
    investidoCents,
    leads: noPeriodo.length,
    comContato,
    fechados,
    cplCents: dividir(investidoCents, noPeriodo.length),
    cplQuenteCents: dividir(investidoCents, comContato),
    custoPorVendaCents: dividir(investidoCents, fechados),
    rotulo: rotuloPeriodo(filtro),
  }
}
