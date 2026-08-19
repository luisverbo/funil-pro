// ============================================================================
// Sincronização Meta v2 — estrutura + métricas (Fase 1, itens 1.9 e 1.10)
// ============================================================================
// Substitui `sync.ts`, que tinha três problemas de fundo:
//
//   • disparava 30 requisições em série (um dia por vez) sem paginar, então
//     conta grande vinha truncada e a execução demorava minutos;
//   • gravava só o nível de anúncio, sem CTR/CPM/frequência nem as conversões
//     do pixel — não dá para diagnosticar campanha sem isso;
//   • `catch {}` engolia qualquer erro: token expirado parecia "conta sem
//     dados".
//
// Aqui a leitura usa `time_increment=1`, que traz TODOS os dias do intervalo
// numa consulta paginada, nos três níveis. O `sync.ts` antigo continua no
// repositório e intocado até o painel novo assumir.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  MetaApiError, metaFetchPaginado, urlGraph, type MetaFetchDeps,
} from './client'
import { registrarSincronizacao, type ContaDeAnuncio } from './accounts'

export type NivelAnuncio = 'campaign' | 'adset' | 'ad'

/** Campos de estrutura por nível — o que o diagnóstico precisa saber. */
const CAMPOS_ESTRUTURA: Record<NivelAnuncio, string> = {
  campaign: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,created_time',
  adset: 'id,name,status,effective_status,campaign_id,daily_budget,lifetime_budget,bid_strategy,created_time',
  ad: 'id,name,status,effective_status,adset_id,created_time',
}

const CAMINHO_ESTRUTURA: Record<NivelAnuncio, string> = {
  campaign: 'campaigns',
  adset: 'adsets',
  ad: 'ads',
}

/** Métricas: tudo o que a análise usa, numa consulta só. */
const CAMPOS_INSIGHTS = [
  'date_start', 'campaign_id', 'adset_id', 'ad_id',
  'spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks',
  'ctr', 'cpm', 'cpc', 'frequency', 'actions', 'action_values', 'account_currency',
].join(',')

interface LinhaEstrutura {
  id: string; name?: string; status?: string; effective_status?: string
  objective?: string; daily_budget?: string; lifetime_budget?: string
  bid_strategy?: string; created_time?: string
  campaign_id?: string; adset_id?: string
}

interface LinhaInsight {
  date_start: string
  campaign_id?: string; adset_id?: string; ad_id?: string
  spend?: string; impressions?: string; reach?: string; clicks?: string
  inline_link_clicks?: string; ctr?: string; cpm?: string; cpc?: string
  frequency?: string; account_currency?: string
  actions?: { action_type: string; value: string }[]
  action_values?: { action_type: string; value: string }[]
}

function paraCentavos(valor: string | undefined): number {
  const n = Number.parseFloat(valor ?? '0')
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function paraInteiro(valor: string | undefined): number {
  const n = Number.parseInt(valor ?? '0', 10)
  return Number.isFinite(n) ? n : 0
}

function paraDecimal(valor: string | undefined): number | null {
  if (valor === undefined) return null
  const n = Number.parseFloat(valor)
  return Number.isFinite(n) ? n : null
}

export interface ResultadoSync {
  ok: boolean
  entidades: number
  insights: number
  truncado: boolean
  erro?: string
  tipoErro?: string
}

/**
 * Estrutura da conta: campanhas, conjuntos e anúncios.
 *
 * Sem isto não há como agir depois — insights trazem números, não o nome nem
 * o orçamento do que precisa ser pausado ou escalado.
 */
export async function sincronizarEstrutura(
  admin: SupabaseClient,
  conta: ContaDeAnuncio,
  deps: MetaFetchDeps = {},
): Promise<{ gravadas: number; truncado: boolean }> {
  if (!conta.id) return { gravadas: 0, truncado: false }  // modo antigo: sem tabela

  let gravadas = 0
  let truncado = false

  for (const nivel of ['campaign', 'adset', 'ad'] as NivelAnuncio[]) {
    const url = urlGraph(
      `/act_${conta.externalId}/${CAMINHO_ESTRUTURA[nivel]}`,
      { fields: CAMPOS_ESTRUTURA[nivel], limit: 200 },
      conta.accessToken,
    )
    const r = await metaFetchPaginado<LinhaEstrutura>(url, deps)
    truncado = truncado || r.truncado

    const linhas = r.itens.map(item => ({
      tenant_id: conta.tenantId,
      ad_account_id: conta.id,
      level: nivel,
      external_id: String(item.id),
      parent_external_id: nivel === 'adset' ? (item.campaign_id ?? null)
        : nivel === 'ad' ? (item.adset_id ?? null) : null,
      name: item.name ?? null,
      status: item.status ?? null,
      effective_status: item.effective_status ?? null,
      objective: item.objective ?? null,
      daily_budget_cents: item.daily_budget ? paraInteiro(item.daily_budget) : null,
      lifetime_budget_cents: item.lifetime_budget ? paraInteiro(item.lifetime_budget) : null,
      bid_strategy: item.bid_strategy ?? null,
      created_time: item.created_time ?? null,
      raw: item as unknown as Record<string, unknown>,
      synced_at: new Date().toISOString(),
    }))

    // Em blocos: um upsert gigante estoura o limite de payload do PostgREST.
    for (let i = 0; i < linhas.length; i += 200) {
      const bloco = linhas.slice(i, i + 200)
      const { error } = await admin
        .from('ad_entities')
        .upsert(bloco, { onConflict: 'ad_account_id,level,external_id' })
      if (!error) gravadas += bloco.length
    }
  }

  return { gravadas, truncado }
}

/**
 * Métricas diárias no intervalo pedido, nos três níveis.
 *
 * `time_increment=1` faz a Meta devolver uma linha por dia numa consulta só —
 * no lugar das 30 chamadas em série do código antigo.
 */
export async function sincronizarInsights(
  admin: SupabaseClient,
  conta: ContaDeAnuncio,
  intervalo: { desde: string; ate: string },
  deps: MetaFetchDeps = {},
): Promise<{ gravados: number; truncado: boolean }> {
  if (!conta.id) return { gravados: 0, truncado: false }

  let gravados = 0
  let truncado = false

  for (const nivel of ['campaign', 'adset', 'ad'] as NivelAnuncio[]) {
    const url = urlGraph(
      `/act_${conta.externalId}/insights`,
      {
        fields: CAMPOS_INSIGHTS,
        level: nivel,
        time_increment: 1,
        time_range: JSON.stringify({ since: intervalo.desde, until: intervalo.ate }),
        limit: 200,
      },
      conta.accessToken,
    )

    const r = await metaFetchPaginado<LinhaInsight>(url, deps)
    truncado = truncado || r.truncado

    const linhas = r.itens.map(item => {
      const externalId = nivel === 'ad' ? item.ad_id
        : nivel === 'adset' ? item.adset_id
        : item.campaign_id
      return {
        tenant_id: conta.tenantId,
        ad_account_id: conta.id,
        level: nivel,
        external_id: String(externalId ?? ''),
        date: item.date_start,
        hour: null,
        spend_cents: paraCentavos(item.spend),
        impressions: paraInteiro(item.impressions),
        reach: item.reach ? paraInteiro(item.reach) : null,
        clicks: paraInteiro(item.clicks),
        link_clicks: item.inline_link_clicks ? paraInteiro(item.inline_link_clicks) : null,
        ctr: paraDecimal(item.ctr),
        cpm_cents: item.cpm ? paraCentavos(item.cpm) : null,
        cpc_cents: item.cpc ? paraCentavos(item.cpc) : null,
        frequency: paraDecimal(item.frequency),
        actions: item.actions ?? [],
        action_values: item.action_values ?? [],
        currency: item.account_currency ?? conta.currency ?? null,
        synced_at: new Date().toISOString(),
      }
    }).filter(l => l.external_id !== '')

    for (let i = 0; i < linhas.length; i += 200) {
      const bloco = linhas.slice(i, i + 200)
      const { error } = await admin
        .from('ad_insights')
        .upsert(bloco, { onConflict: 'ad_account_id,level,external_id,date,hour' })
      if (!error) gravados += bloco.length
    }
  }

  return { gravados, truncado }
}

/**
 * Sincroniza UMA conta e registra o desfecho nela.
 *
 * Erro nunca é engolido: token expirado marca a conta como `token_expired`,
 * e é isso que a tela usa para pedir a reconexão em vez de mostrar zero.
 */
export async function sincronizarConta(
  admin: SupabaseClient,
  conta: ContaDeAnuncio,
  intervalo: { desde: string; ate: string },
  deps: MetaFetchDeps = {},
): Promise<ResultadoSync> {
  try {
    const estrutura = await sincronizarEstrutura(admin, conta, deps)
    const insights = await sincronizarInsights(admin, conta, intervalo, deps)
    await registrarSincronizacao(admin, conta, { ok: true, status: 'active' })
    return {
      ok: true,
      entidades: estrutura.gravadas,
      insights: insights.gravados,
      truncado: estrutura.truncado || insights.truncado,
    }
  } catch (err) {
    const meta = err instanceof MetaApiError ? err : null
    const status = meta?.kind === 'token_expirado' ? 'token_expired'
      : meta?.kind === 'sem_permissao' ? 'error'
      : undefined
    await registrarSincronizacao(admin, conta, {
      ok: false,
      erro: meta ? `${meta.kind}: ${meta.metaCode ?? meta.httpStatus}` : String(err),
      status,
    })
    return {
      ok: false,
      entidades: 0,
      insights: 0,
      truncado: false,
      erro: meta?.message ?? String(err),
      tipoErro: meta?.kind ?? 'desconhecido',
    }
  }
}

/** Intervalo padrão: hoje e os N dias anteriores, em data local da conta. */
export function intervaloPadrao(dias = 7, hoje = new Date()): { desde: string; ate: string } {
  const fim = new Date(hoje)
  const inicio = new Date(hoje)
  inicio.setDate(inicio.getDate() - (dias - 1))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { desde: iso(inicio), ate: iso(fim) }
}
