// ============================================================================
// Mesa de estrategistas — carrega os números do banco e monta a entrada
// ----------------------------------------------------------------------------
// Separado de mesa.ts para o motor continuar puro (testável sem banco).
// `agregarInsights` também é pura: recebe as linhas diárias e devolve o
// consolidado por item, com as janelas "últimos 3 dias × 3 anteriores".
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import type { NivelAnuncio } from '@/lib/meta/sync-v2'
import { intervaloPadrao } from '@/lib/meta/sync-v2'
import { calcularRoasReal } from './roas'
import { contarResultados, type AcaoMeta, type ContaMesa, type EntradaMesa, type LinhaMesa, type TipoResultado } from './mesa'

export interface InsightDia {
  level: NivelAnuncio
  external_id: string
  date: string
  spend_cents: number
  impressions: number
  clicks: number
  frequency: number | null
  actions: AcaoMeta[] | null
}

export interface EntidadeMesa {
  level: NivelAnuncio
  external_id: string
  parent_external_id: string | null
  name: string | null
  effective_status: string | null
  daily_budget_cents: number | null
}

const soma = (r: Record<TipoResultado, number>) => r.compra + r.lead + r.conversa + r.cadastro

/** Consolida as linhas diárias por item (pura). `ate` = último dia do período. */
export function agregarInsights(
  insights: InsightDia[],
  entidades: EntidadeMesa[],
  ate: string,
  vendas: Map<string, { vendas: number; receitaCents: number }> = new Map(),
): LinhaMesa[] {
  const ent = new Map(entidades.map(e => [`${e.level}:${e.external_id}`, e]))
  const pai = (e: EntidadeMesa | undefined): string | null => {
    if (!e) return null
    if (e.level === 'campaign') return e.external_id
    if (e.level === 'adset') return e.parent_external_id
    return pai(ent.get(`adset:${e.parent_external_id}`)) ?? null
  }
  const fim = new Date(`${ate}T00:00:00Z`).getTime()
  const idade = (d: string) => Math.round((fim - new Date(`${d}T00:00:00Z`).getTime()) / 86_400_000)

  const grupos = new Map<string, InsightDia[]>()
  for (const i of insights) {
    const k = `${i.level}:${i.external_id}`
    const g = grupos.get(k); if (g) g.push(i); else grupos.set(k, [i])
  }

  const out: LinhaMesa[] = []
  for (const [k, dias] of grupos) {
    const e = ent.get(k)
    const [nivel, id] = [dias[0].level, dias[0].external_id]
    const todas: AcaoMeta[] = []
    const recente = { gastoCents: 0, resultados: 0 }
    const anterior = { gastoCents: 0, resultados: 0 }
    let gasto = 0, imp = 0, cli = 0, freqPond = 0
    const gastoPorDia = new Map<number, number>()
    for (const d of dias) {
      gasto += d.spend_cents; imp += d.impressions; cli += d.clicks
      if (d.frequency !== null && d.frequency !== undefined) freqPond += Number(d.frequency) * d.impressions
      todas.push(...(d.actions ?? []))
      const a = idade(d.date)
      gastoPorDia.set(a, (gastoPorDia.get(a) ?? 0) + d.spend_cents)
      const r = soma(contarResultados(d.actions))
      if (a <= 2) { recente.gastoCents += d.spend_cents; recente.resultados += r }
      else if (a <= 5) { anterior.gastoCents += d.spend_cents; anterior.resultados += r }
    }
    let parado = 0
    while (parado < 7 && (gastoPorDia.get(parado) ?? 0) === 0) parado++
    const v = vendas.get(k)
    out.push({
      nivel, id,
      nome: e?.name ?? id,
      campanhaId: pai(e) ?? (nivel === 'campaign' ? id : null),
      status: e?.effective_status ?? null,
      orcamentoDiarioCents: e?.daily_budget_cents ?? null,
      gastoCents: gasto, impressoes: imp, cliques: cli,
      ctr: imp > 0 ? Math.round((cli / imp) * 10_000) / 100 : null,
      cpmCents: imp > 0 ? Math.round((gasto / imp) * 1000) : null,
      frequencia: imp > 0 && freqPond > 0 ? Math.round((freqPond / imp) * 100) / 100 : null,
      resultados: contarResultados(todas),
      vendasReais: v?.vendas ?? 0,
      receitaRealCents: v?.receitaCents ?? 0,
      recente, anterior,
      diasSemGastoNoFim: parado >= 7 ? 0 : parado,
    })
  }
  return out
}

/** Lê o banco e devolve a entrada da mesa, ou null se não há conta/tabela. */
export interface SerieDia { date: string; gastoCents: number; resultados: number }

/** Gasto e resultados por dia (nível campanha), para o gráfico (pura). */
export function serieDiaria(insights: InsightDia[], periodo: { desde: string; ate: string }): SerieDia[] {
  const mapa = new Map<string, SerieDia>()
  for (let d = new Date(`${periodo.desde}T00:00:00Z`); d.toISOString().slice(0, 10) <= periodo.ate; d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10); mapa.set(k, { date: k, gastoCents: 0, resultados: 0 })
  }
  for (const i of insights) {
    if (i.level !== 'campaign') continue
    const s = mapa.get(i.date); if (!s) continue
    s.gastoCents += i.spend_cents; s.resultados += soma(contarResultados(i.actions))
  }
  return [...mapa.values()]
}

/**
 * Lê o banco e devolve a entrada da mesa, ou null se não há conta/tabela.
 * `adAccountId` recorta UMA conta (o dono escolhe no seletor).
 */
export async function carregarEntradaMesa(
  admin: SupabaseClient, tenantId: string, dias: number, adAccountId: string | null = null,
): Promise<(EntradaMesa & { serie: SerieDia[] }) | null> {
  const periodo = intervaloPadrao(dias)
  let qContas = admin.from('ad_accounts')
    .select('id, name, external_id, status, last_error, token_expires_at')
    .eq('tenant_id', tenantId).eq('provider', 'meta')
  if (adAccountId) qContas = qContas.eq('id', adAccountId)
  const { data: contasRaw, error } = await qContas
  if (error || !contasRaw || contasRaw.length === 0) return null
  const contas: ContaMesa[] = contasRaw.map(c => ({
    nome: c.name ?? `Conta ${c.external_id}`, status: String(c.status),
    erro: c.last_error ?? null, tokenExpiraEm: c.token_expires_at ?? null,
  }))

  const insights: InsightDia[] = []
  for (let de = 0; ; de += 1000) {
    let q = admin.from('ad_insights')
      .select('level, external_id, date, spend_cents, impressions, clicks, frequency, actions')
      .eq('tenant_id', tenantId).is('hour', null)
      .gte('date', periodo.desde).lte('date', periodo.ate)
    if (adAccountId) q = q.eq('ad_account_id', adAccountId)
    const { data } = await q.order('date').order('id').range(de, de + 999)
    insights.push(...((data ?? []) as InsightDia[]))
    if (!data || data.length < 1000) break
  }
  // PAGINADO: o PostgREST corta em 1000 linhas. Conta com 5 mil itens perdia
  // os nomes das campanhas e o painel mostrava só o número (29/09).
  const ents: EntidadeMesa[] = []
  for (let de = 0; ; de += 1000) {
    let q = admin.from('ad_entities')
      .select('level, external_id, parent_external_id, name, effective_status, daily_budget_cents')
      .eq('tenant_id', tenantId)
    if (adAccountId) q = q.eq('ad_account_id', adAccountId)
    const { data } = await q.order('id').range(de, de + 999)
    ents.push(...((data ?? []) as EntidadeMesa[]))
    if (!data || data.length < 1000) break
  }

  // Venda confirmada por item, nos três níveis — mesma régua da tabela.
  const vendas = new Map<string, { vendas: number; receitaCents: number }>()
  let semAtribuicao = { vendas: 0, receitaCents: 0 }
  let receitaAtribuida = 0
  for (const nivel of ['campaign', 'adset', 'ad'] as NivelAnuncio[]) {
    const { resumo } = await calcularRoasReal(admin, tenantId, periodo, nivel)
    if (!resumo) continue
    for (const l of resumo.linhas) vendas.set(`${nivel}:${l.externalId}`, { vendas: l.vendas, receitaCents: l.receitaCents })
    if (nivel === 'campaign') {
      semAtribuicao = { vendas: resumo.semAtribuicao.vendas, receitaCents: resumo.semAtribuicao.receitaCents }
      receitaAtribuida = resumo.totais.receitaCents
    }
  }

  return {
    dias, contas, semAtribuicao, receitaAtribuidaCents: receitaAtribuida,
    linhas: agregarInsights(insights, ents, periodo.ate, vendas),
    serie: serieDiaria(insights, periodo),
  }
}
