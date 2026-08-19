// ============================================================================
// ROAS REAL — gasto da Meta × venda confirmada (Fase 1, item 1.12)
// ----------------------------------------------------------------------------
// O ROAS que o sistema mostrava antes vinha de `ad_metrics.revenue_cents`, um
// número recalculado dentro da própria sincronização. Ele tinha três defeitos
// que faziam o painel mentir para cima:
//
//   1. contava reembolso como faturamento — a venda estornada nunca saía;
//   2. era recalculado a cada sincronização a partir da origem ATUAL do lead,
//      então o histórico se reescrevia sozinho;
//   3. venda sem anúncio identificado sumia da conta, o que inflava o ROAS de
//      quem sobrava.
//
// Aqui o cálculo usa `ad_insights` (gasto) contra `sales` (venda, com a
// atribuição CONGELADA na hora da compra). E o que não deu para atribuir
// aparece num balde à parte: um número que o usuário precisa ver, não
// esconder — é ele que denuncia link de anúncio sem `utm_ad_id`.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { NivelAnuncio } from '@/lib/meta/sync-v2'

/** Status que continuam valendo como faturamento. */
const STATUS_RECEITA = new Set(['approved'])
/** Status que tiram dinheiro que já foi contado. */
const STATUS_ESTORNO = new Set(['refunded', 'chargeback'])

export interface LinhaInsightRoas {
  level: string
  external_id: string
  spend_cents: number | null
  impressions?: number | null
  clicks?: number | null
  link_clicks?: number | null
  ctr?: number | null
  frequency?: number | null
}

export interface LinhaVendaRoas {
  status: string
  revenue_cents: number | null
  attr_ad_id: string | null
  attr_adset_id: string | null
  attr_campaign_id: string | null
}

export interface LinhaRoas {
  externalId: string
  nome: string | null
  gastoCents: number
  receitaCents: number
  estornadoCents: number
  vendas: number
  impressoes: number
  cliques: number
  /** null quando não houve gasto — dividir por zero viraria Infinity na tela. */
  roas: number | null
  /** Custo por venda; null sem venda. */
  cpaCents: number | null
  /** Média ponderada por impressão — média simples de dias distorce. */
  ctrMedio: number | null
  frequenciaMedia: number | null
}

export interface ResumoRoas {
  nivel: NivelAnuncio
  linhas: LinhaRoas[]
  totais: {
    gastoCents: number
    receitaCents: number
    estornadoCents: number
    vendas: number
    roas: number | null
  }
  /**
   * Venda confirmada que NÃO tem anúncio de origem.
   *
   * Nunca é somada às linhas: se fosse, o ROAS de anúncios que não geraram
   * essa venda subiria sem motivo. Fica visível de propósito.
   */
  semAtribuicao: { vendas: number; receitaCents: number }
}

function chaveDaVenda(venda: LinhaVendaRoas, nivel: NivelAnuncio): string | null {
  const bruto = nivel === 'ad' ? venda.attr_ad_id
    : nivel === 'adset' ? venda.attr_adset_id
    : venda.attr_campaign_id
  const s = (bruto ?? '').trim()
  return s.length > 0 ? s : null
}

function divide(receita: number, gasto: number): number | null {
  if (gasto <= 0) return null
  return Math.round((receita / gasto) * 100) / 100
}

/**
 * Junta gasto e venda no nível pedido. Função pura: os testes conferem a
 * regra sem banco nenhum.
 *
 * Anúncio com gasto e sem venda CONTINUA na lista, com ROAS 0 — é justamente
 * o que precisa ser visto para ser pausado.
 */
export function agregarRoas(
  nivel: NivelAnuncio,
  insights: LinhaInsightRoas[],
  vendas: LinhaVendaRoas[],
  nomes: Map<string, string> = new Map(),
): ResumoRoas {
  const linhas = new Map<string, LinhaRoas>()
  // Somatórios ponderados por impressão: CTR e frequência são taxas, e média
  // simples entre dias faz um dia de 10 impressões pesar como um de 100 mil.
  const pesos = new Map<string, { ctr: number; freq: number; imp: number }>()

  const pegar = (id: string): LinhaRoas => {
    let l = linhas.get(id)
    if (!l) {
      l = {
        externalId: id, nome: nomes.get(id) ?? null,
        gastoCents: 0, receitaCents: 0, estornadoCents: 0,
        vendas: 0, impressoes: 0, cliques: 0, roas: null, cpaCents: null,
        ctrMedio: null, frequenciaMedia: null,
      }
      linhas.set(id, l)
    }
    return l
  }

  for (const i of insights) {
    if (i.level !== nivel) continue
    const id = (i.external_id ?? '').trim()
    if (!id) continue
    const l = pegar(id)
    l.gastoCents += i.spend_cents ?? 0
    const imp = Number(i.impressions ?? 0)
    l.impressoes += imp
    l.cliques += Number(i.link_clicks ?? i.clicks ?? 0)
    if (imp > 0) {
      const p = pesos.get(id) ?? { ctr: 0, freq: 0, imp: 0 }
      p.ctr += (i.ctr ?? 0) * imp
      p.freq += (i.frequency ?? 0) * imp
      p.imp += imp
      pesos.set(id, p)
    }
  }

  const semAtribuicao = { vendas: 0, receitaCents: 0 }

  for (const v of vendas) {
    const valor = v.revenue_cents ?? 0
    const receita = STATUS_RECEITA.has(v.status)
    const estorno = STATUS_ESTORNO.has(v.status)
    if (!receita && !estorno) continue          // pendente/cancelada não entra

    const id = chaveDaVenda(v, nivel)
    if (!id) {
      if (receita) { semAtribuicao.vendas++; semAtribuicao.receitaCents += valor }
      continue
    }
    const l = pegar(id)
    if (receita) { l.vendas++; l.receitaCents += valor }
    else l.estornadoCents += valor
  }

  const lista = [...linhas.values()]
  for (const l of lista) {
    l.roas = divide(l.receitaCents, l.gastoCents)
    l.cpaCents = l.vendas > 0 ? Math.round(l.gastoCents / l.vendas) : null
    const p = pesos.get(l.externalId)
    l.ctrMedio = p && p.imp > 0 ? Math.round((p.ctr / p.imp) * 100) / 100 : null
    l.frequenciaMedia = p && p.imp > 0 ? Math.round((p.freq / p.imp) * 100) / 100 : null
  }
  // Maior gasto primeiro: é onde o dinheiro está sendo decidido.
  lista.sort((a, b) => b.gastoCents - a.gastoCents)

  const totais = lista.reduce(
    (acc, l) => ({
      gastoCents: acc.gastoCents + l.gastoCents,
      receitaCents: acc.receitaCents + l.receitaCents,
      estornadoCents: acc.estornadoCents + l.estornadoCents,
      vendas: acc.vendas + l.vendas,
      roas: null as number | null,
    }),
    { gastoCents: 0, receitaCents: 0, estornadoCents: 0, vendas: 0, roas: null as number | null },
  )
  totais.roas = divide(totais.receitaCents, totais.gastoCents)

  return { nivel, linhas: lista, totais, semAtribuicao }
}

/** Lê TODAS as páginas — o PostgREST devolve 1000 linhas por padrão. */
async function lerTudo<T>(
  monta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const passo = 1000
  const out: T[] = []
  for (let de = 0; de < 50_000; de += passo) {
    const { data, error } = await monta(de, de + passo - 1)
    if (error || !data) break
    out.push(...data)
    if (data.length < passo) break
  }
  return out
}

function ehTabelaAusente(erro: unknown): boolean {
  const e = erro as { code?: string; message?: string } | null
  if (!e) return false
  if (e.code === '42P01' || e.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(e.message ?? '')
}

/**
 * ROAS real do tenant no período.
 *
 * Devolve `indisponivel` (em vez de zero) quando as tabelas da Fase 1 ainda
 * não existem: mostrar zero seria dizer que não houve venda.
 */
export async function calcularRoasReal(
  admin: SupabaseClient,
  tenantId: string,
  periodo: { desde: string; ate: string },
  nivel: NivelAnuncio = 'ad',
): Promise<{ resumo: ResumoRoas | null; indisponivel: boolean }> {
  const respInsights = await admin
    .from('ad_insights')
    .select('level, external_id, spend_cents, impressions, clicks, link_clicks, ctr, frequency')
    .eq('tenant_id', tenantId)
    .eq('level', nivel)
    .gte('date', periodo.desde)
    .lte('date', periodo.ate)
    .range(0, 999)

  if (respInsights.error && ehTabelaAusente(respInsights.error)) {
    return { resumo: null, indisponivel: true }
  }

  const insights = await lerTudo<LinhaInsightRoas>((de, ate) => admin
    .from('ad_insights')
    .select('level, external_id, spend_cents, impressions, clicks, link_clicks, ctr, frequency')
    .eq('tenant_id', tenantId)
    .eq('level', nivel)
    .gte('date', periodo.desde)
    .lte('date', periodo.ate)
    .range(de, ate) as unknown as PromiseLike<{ data: LinhaInsightRoas[] | null; error: unknown }>)

  const vendas = await lerTudo<LinhaVendaRoas>((de, ate) => admin
    .from('sales')
    .select('status, revenue_cents, attr_ad_id, attr_adset_id, attr_campaign_id')
    .eq('tenant_id', tenantId)
    .gte('occurred_at', `${periodo.desde}T00:00:00Z`)
    .lte('occurred_at', `${periodo.ate}T23:59:59Z`)
    .range(de, ate) as unknown as PromiseLike<{ data: LinhaVendaRoas[] | null; error: unknown }>)

  const entidades = await lerTudo<{ external_id: string; name: string | null }>((de, ate) => admin
    .from('ad_entities')
    .select('external_id, name')
    .eq('tenant_id', tenantId)
    .eq('level', nivel)
    .range(de, ate) as unknown as PromiseLike<{ data: { external_id: string; name: string | null }[] | null; error: unknown }>)

  const nomes = new Map(entidades.map(e => [String(e.external_id), e.name ?? null] as const)
    .filter((p): p is readonly [string, string] => typeof p[1] === 'string'))

  return { resumo: agregarRoas(nivel, insights, vendas, nomes), indisponivel: false }
}
