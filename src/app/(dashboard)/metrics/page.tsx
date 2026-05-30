import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdMetric } from '@/types'

function fmtBRL(cents: number) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtROAS(roas: number) {
  return `${roas.toFixed(2)}x`
}

const PLATFORM_LABELS: Record<string, string> = {
  hotmart: 'Hotmart',
  kiwify: 'Kiwify',
  eduzz: 'Eduzz',
  yampi: 'Yampi',
  internal: 'Interno',
}

const PLATFORM_COLORS: Record<string, string> = {
  hotmart: 'bg-orange-100 text-orange-700',
  kiwify: 'bg-purple-100 text-purple-700',
  eduzz: 'bg-blue-100 text-blue-700',
  yampi: 'bg-green-100 text-green-700',
  internal: 'bg-gray-100 text-gray-600',
}

export default async function MetricsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ut } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!ut) redirect('/onboarding')

  const admin = createAdminClient()
  const tenantId = ut.tenant_id

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [{ data: purchaseEvents }, { data: adMetricsRaw }, { data: tenantData }] = await Promise.all([
    admin
      .from('lead_events')
      .select('event_type, revenue_cents, product_name, platform, event_data')
      .eq('tenant_id', tenantId)
      .or('event_type.eq.purchased,event_type.eq.purchased_order_bump,event_type.eq.purchased_upsell'),
    admin
      .from('ad_metrics')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('date', since30)
      .order('date', { ascending: false }),
    admin
      .from('tenants')
      .select('meta_access_token, meta_ad_account_id')
      .eq('id', tenantId)
      .single(),
  ])

  const events = (purchaseEvents ?? []) as Array<{
    event_type: string
    revenue_cents: number | null
    product_name: string | null
    platform: string | null
    event_data: Record<string, unknown> | null
  }>

  // Calculate revenue totals
  let totalRevenue = 0
  let funnelRevenue = 0
  let organicRevenue = 0
  let orderBumpRevenue = 0
  const productsMap = new Map<string, { count: number; revenue: number; platform: string }>()

  for (const e of events) {
    const revenue = e.revenue_cents ?? 0
    totalRevenue += revenue

    const attribution = (e.event_data as Record<string, unknown> | null)?.attribution as string | undefined
    const withinFunnel = (e.event_data as Record<string, unknown> | null)?.within_funnel

    if (withinFunnel === true || withinFunnel === 'true') funnelRevenue += revenue
    if (attribution === 'organic') organicRevenue += revenue
    if (e.event_type === 'purchased_order_bump' || e.event_type === 'purchased_upsell') orderBumpRevenue += revenue

    if (e.product_name) {
      const existing = productsMap.get(e.product_name)
      if (existing) {
        existing.count++
        existing.revenue += revenue
      } else {
        productsMap.set(e.product_name, { count: 1, revenue, platform: e.platform ?? 'internal' })
      }
    }
  }

  const topProducts = Array.from(productsMap.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10)
    .map(([name, stats]) => ({ name, ...stats }))

  const hasRevenueData = events.length > 0

  // Process ad metrics
  const adMetrics = (adMetricsRaw ?? []) as AdMetric[]
  const hasMetaConnected = !!tenantData?.meta_access_token && !!tenantData?.meta_ad_account_id
  const hasAdData = adMetrics.length > 0

  // Aggregate totals
  let totalSpend = 0
  let totalLeadsMeta = 0
  let totalRevenueMeta = 0

  for (const m of adMetrics) {
    totalSpend += m.spend_cents
    totalLeadsMeta += m.leads_count
    totalRevenueMeta += m.revenue_cents
  }

  const avgCPL = totalLeadsMeta > 0 ? Math.round(totalSpend / totalLeadsMeta) : 0
  const avgROAS = totalSpend > 0 ? totalRevenueMeta / totalSpend : 0

  // Group by campaign
  const campaignMap = new Map<string, { spend: number; leads: number; revenue: number }>()
  for (const m of adMetrics) {
    const key = m.campaign_name ?? m.campaign_id ?? 'Sem campanha'
    const existing = campaignMap.get(key)
    if (existing) {
      existing.spend += m.spend_cents
      existing.leads += m.leads_count
      existing.revenue += m.revenue_cents
    } else {
      campaignMap.set(key, { spend: m.spend_cents, leads: m.leads_count, revenue: m.revenue_cents })
    }
  }
  const campaigns = Array.from(campaignMap.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.spend - a.spend)

  // Group by ad (most recent row per ad_id)
  const adMap = new Map<string, AdMetric & { totalSpend: number; totalLeads: number; totalRevenue: number }>()
  for (const m of adMetrics) {
    const existing = adMap.get(m.ad_id)
    if (existing) {
      existing.totalSpend += m.spend_cents
      existing.totalLeads += m.leads_count
      existing.totalRevenue += m.revenue_cents
    } else {
      adMap.set(m.ad_id, { ...m, totalSpend: m.spend_cents, totalLeads: m.leads_count, totalRevenue: m.revenue_cents })
    }
  }
  const ads = Array.from(adMap.values())
    .sort((a, b) => {
      const roasA = a.totalSpend > 0 ? a.totalRevenue / a.totalSpend : 0
      const roasB = b.totalSpend > 0 ? b.totalRevenue / b.totalSpend : 0
      return roasB - roasA
    })
    .slice(0, 20)

  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Métricas</h1>
        <p className="text-sm text-gray-500 mt-0.5">Visão geral de receita e desempenho dos seus funis</p>
      </div>

      {/* Revenue section */}
      {!hasRevenueData ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center mb-8">
          <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-400">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <p className="text-gray-600 font-semibold">Nenhuma venda registrada ainda</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
            As métricas aparecerão aqui quando seus funis receberem as primeiras compras via Hotmart, Kiwify, Eduzz ou Yampi.
          </p>
        </div>
      ) : (
        <>
          {/* Revenue Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-500">Receita Total</p>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-indigo-500">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <p className="text-xl font-bold text-gray-900">{fmtBRL(totalRevenue)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{events.length} venda{events.length !== 1 ? 's' : ''}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-500">Receita do Funil</p>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-emerald-500">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
              </div>
              <p className="text-xl font-bold text-emerald-700">{fmtBRL(funnelRevenue)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {totalRevenue > 0 ? `${Math.round((funnelRevenue / totalRevenue) * 100)}% do total` : '0%'}
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-500">Receita Orgânica</p>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-blue-500">
                  <path d="M12 22V12M12 12C12 6 6 3 3 3c0 3 3 9 9 9zM12 12c0-6 6-9 9-9 0 3-3 9-9 9" />
                </svg>
              </div>
              <p className="text-xl font-bold text-blue-700">{fmtBRL(organicRevenue)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {totalRevenue > 0 ? `${Math.round((organicRevenue / totalRevenue) * 100)}% do total` : '0%'}
              </p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-500">Order Bumps & Upsells</p>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-orange-500">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              </div>
              <p className="text-xl font-bold text-orange-700">{fmtBRL(orderBumpRevenue)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {totalRevenue > 0 ? `${Math.round((orderBumpRevenue / totalRevenue) * 100)}% do total` : '0%'}
              </p>
            </div>
          </div>

          {/* Top Products Table */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-8">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-800">Produtos mais vendidos</h2>
            </div>
            {topProducts.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-400 text-sm">
                Nenhum produto identificado ainda
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Produto</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Vendas</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Receita</th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Plataforma</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((p, i) => (
                      <tr key={p.name} className={i < topProducts.length - 1 ? 'border-b border-gray-100' : ''}>
                        <td className="px-6 py-3.5">
                          <p className="font-medium text-gray-800 truncate max-w-[200px]">{p.name}</p>
                        </td>
                        <td className="px-6 py-3.5 text-right text-gray-600 font-medium">{p.count}</td>
                        <td className="px-6 py-3.5 text-right font-semibold text-gray-800">{fmtBRL(p.revenue)}</td>
                        <td className="px-6 py-3.5">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${PLATFORM_COLORS[p.platform] ?? 'bg-gray-100 text-gray-600'}`}>
                            {PLATFORM_LABELS[p.platform] ?? p.platform}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Meta Ads section */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-xs">
              f
            </div>
            <h2 className="text-base font-semibold text-gray-800">Meta Ads</h2>
            <span className="text-xs text-gray-400 font-normal">últimos 30 dias</span>
          </div>
          {hasMetaConnected && (
            <a
              href="/api/meta/sync"
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              Sincronizar
            </a>
          )}
        </div>
      </div>

      {!hasMetaConnected ? (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-10 text-center">
          <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">f</div>
          </div>
          <p className="text-gray-600 font-medium text-sm mb-1">Meta Ads não conectado</p>
          <p className="text-xs text-gray-400 mb-3">Conecte o Meta Ads em Integrações para ver métricas de anúncios, CPL e ROAS.</p>
          <a
            href="/integrations"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-lg px-3 py-1.5 transition-colors"
          >
            Ir para Integrações
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      ) : !hasAdData ? (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-2xl p-10 text-center">
          <p className="text-gray-500 font-medium text-sm">Nenhum dado de anúncio nos últimos 30 dias</p>
          <p className="text-xs text-gray-400 mt-1">
            Clique em &quot;Sincronizar&quot; acima para importar dados do Meta Ads agora.
          </p>
        </div>
      ) : (
        <>
          {/* Meta Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-medium text-gray-500 mb-2">Total Gasto</p>
              <p className="text-xl font-bold text-gray-900">{fmtBRL(totalSpend)}</p>
              <p className="text-xs text-gray-400 mt-0.5">no período</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-medium text-gray-500 mb-2">Total Leads</p>
              <p className="text-xl font-bold text-gray-900">{totalLeadsMeta.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-gray-400 mt-0.5">via anúncios Meta</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-medium text-gray-500 mb-2">CPL Médio</p>
              <p className="text-xl font-bold text-gray-900">{fmtBRL(avgCPL)}</p>
              <p className="text-xs text-gray-400 mt-0.5">custo por lead</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-medium text-gray-500 mb-2">ROAS Médio</p>
              <p className={`text-xl font-bold ${avgROAS >= 1 ? 'text-emerald-700' : 'text-red-600'}`}>
                {fmtROAS(avgROAS)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">retorno sobre gasto</p>
            </div>
          </div>

          {/* Campaigns Table */}
          {campaigns.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden mb-6">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">Por Campanha</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Campanha</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Gasto</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Leads</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">CPL</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Receita</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c, i) => {
                      const cpl = c.leads > 0 ? Math.round(c.spend / c.leads) : 0
                      const roas = c.spend > 0 ? c.revenue / c.spend : 0
                      return (
                        <tr key={c.name} className={i < campaigns.length - 1 ? 'border-b border-gray-100' : ''}>
                          <td className="px-6 py-3.5 font-medium text-gray-800 max-w-[200px] truncate">{c.name}</td>
                          <td className="px-6 py-3.5 text-right text-gray-600">{fmtBRL(c.spend)}</td>
                          <td className="px-6 py-3.5 text-right text-gray-600">{c.leads.toLocaleString('pt-BR')}</td>
                          <td className="px-6 py-3.5 text-right text-gray-600">{cpl > 0 ? fmtBRL(cpl) : '—'}</td>
                          <td className="px-6 py-3.5 text-right font-semibold text-gray-800">{fmtBRL(c.revenue)}</td>
                          <td className={`px-6 py-3.5 text-right font-semibold ${roas >= 1 ? 'text-emerald-700' : 'text-red-600'}`}>
                            {fmtROAS(roas)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Ads Table */}
          {ads.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">Por Anúncio — ordenado por ROAS</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Anúncio</th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Campanha</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Gasto</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Leads</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">CPL</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Receita</th>
                      <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ads.map((a, i) => {
                      const cpl = a.totalLeads > 0 ? Math.round(a.totalSpend / a.totalLeads) : 0
                      const roas = a.totalSpend > 0 ? a.totalRevenue / a.totalSpend : 0
                      return (
                        <tr key={a.ad_id} className={i < ads.length - 1 ? 'border-b border-gray-100' : ''}>
                          <td className="px-6 py-3.5 max-w-[180px]">
                            <p className="font-medium text-gray-800 truncate">{a.ad_name ?? a.ad_id}</p>
                          </td>
                          <td className="px-6 py-3.5 max-w-[140px]">
                            <p className="text-gray-500 truncate text-xs">{a.campaign_name ?? '—'}</p>
                          </td>
                          <td className="px-6 py-3.5 text-right text-gray-600">{fmtBRL(a.totalSpend)}</td>
                          <td className="px-6 py-3.5 text-right text-gray-600">{a.totalLeads.toLocaleString('pt-BR')}</td>
                          <td className="px-6 py-3.5 text-right text-gray-600">{cpl > 0 ? fmtBRL(cpl) : '—'}</td>
                          <td className="px-6 py-3.5 text-right font-semibold text-gray-800">{fmtBRL(a.totalRevenue)}</td>
                          <td className={`px-6 py-3.5 text-right font-semibold ${roas >= 1 ? 'text-emerald-700' : 'text-red-600'}`}>
                            {fmtROAS(roas)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
