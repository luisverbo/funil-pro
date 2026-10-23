// ============================================================================
// Estúdio IA — Painel de resultado (puro, sem rede)
// ----------------------------------------------------------------------------
// Tudo em R$ (moeda estrangeira convertida pela cotação das Configurações).
// Lucro = faturamento − gasto nos anúncios − custo de IA (atendimento +
// geração das fotos). Comparação com o período anterior de mesmo tamanho.
// Venda = pedido pago (não cancelado/reembolsado), prévia grátis fora.
// ============================================================================

export interface ContatoPainel { pais: string | null; ad_id: string | null }
export interface PedidoPainel { pais: string | null; ad_id: string | null; contato_id: string | null; valor_pago_cents: number | null; moeda: string | null; status: string }
export interface UsoPainel { finalidade: string; custo_usd: number }
export interface GastoPainel { ad_id: string; spend_cents: number; currency: string | null }

export interface DadosPeriodo { contatos: ContatoPainel[]; vendas: PedidoPainel[]; usos: UsoPainel[]; gastos: GastoPainel[] }

export interface Kpis {
  faturamento_cents: number; vendas: number; clientes: number; ticket_cents: number | null
  leads: number; conversao: number | null; leads_anuncio: number; vendas_anuncio: number
  gasto_anuncio_cents: number; custo_ia_cents: number; custo_atendimento_cents: number; custo_fotos_cents: number
  lucro_cents: number; margem: number | null; roas: number | null
  custo_por_venda_cents: number | null; custo_por_lead_cents: number | null; cac_anuncio_cents: number | null
}

export interface LinhaPais { pais: string | null; leads: number; vendas: number; faturamento_cents: number; conversao: number | null; ticket_cents: number | null }
export interface LinhaAnuncio { ad_id: string | null; leads: number; vendas: number; faturamento_cents: number; gasto_cents: number; lucro_cents: number; roas: number | null; custo_por_venda_cents: number | null }

export type Cotacoes = Record<string, number>
const FOTOS = new Set(['geracao', 'nota_rosto'])
const VALIDA = (p: PedidoPainel) => !['cancelado', 'reembolsado'].includes(p.status)

export function emReais(cents: number, moeda: string | null | undefined, cot: Cotacoes): number {
  const m = (moeda ?? 'BRL').toUpperCase()
  return Math.round(cents * (m === 'BRL' ? 1 : Number(cot[m]) || 0))
}

const div = (a: number, b: number) => (b > 0 ? a / b : null)
const divC = (a: number, b: number) => (b > 0 ? Math.round(a / b) : null)

export function calcularKpis(d: DadosPeriodo, cot: Cotacoes): Kpis {
  const vendas = d.vendas.filter(VALIDA)
  const fat = vendas.reduce((s, p) => s + emReais(p.valor_pago_cents ?? 0, p.moeda, cot), 0)
  const clientes = new Set(vendas.map((p, i) => p.contato_id ?? `sem-contato-${i}`)).size
  const usd = Number(cot.USD) || 0
  const fotos = Math.round(d.usos.filter(u => FOTOS.has(u.finalidade)).reduce((s, u) => s + u.custo_usd, 0) * usd * 100)
  const atend = Math.round(d.usos.filter(u => !FOTOS.has(u.finalidade)).reduce((s, u) => s + u.custo_usd, 0) * usd * 100)
  const gasto = d.gastos.reduce((s, g) => s + emReais(g.spend_cents, g.currency, cot), 0)
  const vendasAnuncio = vendas.filter(p => p.ad_id).length
  const custoIa = fotos + atend
  const lucro = fat - gasto - custoIa
  return {
    faturamento_cents: fat, vendas: vendas.length, clientes, ticket_cents: divC(fat, vendas.length),
    leads: d.contatos.length, conversao: div(clientes, d.contatos.length),
    leads_anuncio: d.contatos.filter(c => c.ad_id).length, vendas_anuncio: vendasAnuncio,
    gasto_anuncio_cents: gasto, custo_ia_cents: custoIa, custo_atendimento_cents: atend, custo_fotos_cents: fotos,
    lucro_cents: lucro, margem: div(lucro, fat), roas: gasto > 0 ? fat / gasto : null,
    custo_por_venda_cents: divC(gasto + custoIa, vendas.length), custo_por_lead_cents: divC(gasto, d.contatos.filter(c => c.ad_id).length),
    cac_anuncio_cents: divC(gasto, vendasAnuncio),
  }
}

/** Variação relativa (0,2 = +20%). null quando não há base para comparar. */
export function variacao(atual: number | null, anterior: number | null): number | null {
  if (atual === null || anterior === null || anterior === 0) return null
  return (atual - anterior) / Math.abs(anterior)
}

/** Por país (DDI do WhatsApp). */
export function porPais(d: DadosPeriodo, cot: Cotacoes): LinhaPais[] {
  const m = new Map<string, LinhaPais>()
  const l = (p: string | null) => {
    const k = p ?? '??'
    if (!m.has(k)) m.set(k, { pais: p, leads: 0, vendas: 0, faturamento_cents: 0, conversao: null, ticket_cents: null })
    return m.get(k)!
  }
  for (const c of d.contatos) l(c.pais).leads++
  for (const p of d.vendas.filter(VALIDA)) { const x = l(p.pais); x.vendas++; x.faturamento_cents += emReais(p.valor_pago_cents ?? 0, p.moeda, cot) }
  return [...m.values()].map(x => ({ ...x, conversao: div(x.vendas, x.leads), ticket_cents: divC(x.faturamento_cents, x.vendas) }))
    .sort((a, b) => b.faturamento_cents - a.faturamento_cents || b.leads - a.leads)
}

/** Por anúncio com gasto, lucro e ROAS (Orgânico = ad_id null, sem gasto). */
export function porAnuncio(d: DadosPeriodo, cot: Cotacoes): LinhaAnuncio[] {
  const m = new Map<string, LinhaAnuncio>()
  const l = (a: string | null) => {
    const k = a ?? '__organico'
    if (!m.has(k)) m.set(k, { ad_id: a, leads: 0, vendas: 0, faturamento_cents: 0, gasto_cents: 0, lucro_cents: 0, roas: null, custo_por_venda_cents: null })
    return m.get(k)!
  }
  for (const c of d.contatos) l(c.ad_id).leads++
  for (const p of d.vendas.filter(VALIDA)) { const x = l(p.ad_id); x.vendas++; x.faturamento_cents += emReais(p.valor_pago_cents ?? 0, p.moeda, cot) }
  for (const g of d.gastos) l(g.ad_id).gasto_cents += emReais(g.spend_cents, g.currency, cot)
  return [...m.values()]
    .map(x => ({ ...x, lucro_cents: x.faturamento_cents - x.gasto_cents, roas: x.gasto_cents > 0 ? x.faturamento_cents / x.gasto_cents : null, custo_por_venda_cents: divC(x.gasto_cents, x.vendas) }))
    .sort((a, b) => (a.ad_id === null ? 1 : b.ad_id === null ? -1 : b.faturamento_cents - a.faturamento_cents || b.gasto_cents - a.gasto_cents))
}

/** Período anterior de mesmo tamanho (datas YYYY-MM-DD, inclusivas). */
export function periodoAnterior(de: string, ate: string): { de: string; ate: string } {
  const d0 = Date.parse(`${de}T00:00:00Z`), d1 = Date.parse(`${ate}T00:00:00Z`)
  const dias = Math.round((d1 - d0) / 86400e3) + 1
  const f = (t: number) => new Date(t).toISOString().slice(0, 10)
  return { de: f(d0 - dias * 86400e3), ate: f(d0 - 86400e3) }
}
