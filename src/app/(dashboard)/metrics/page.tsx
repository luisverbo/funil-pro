import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function fmt(cents: number) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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

  // Fetch all purchase events for this tenant
  const { data: purchaseEvents } = await admin
    .from('lead_events')
    .select('event_type, revenue_cents, product_name, platform, event_data')
    .eq('tenant_id', tenantId)
    .or('event_type.eq.purchased,event_type.eq.purchased_order_bump,event_type.eq.purchased_upsell')

  const events = (purchaseEvents ?? []) as Array<{
    event_type: string
    revenue_cents: number | null
    product_name: string | null
    platform: string | null
    event_data: Record<string, unknown> | null
  }>

  // Calculate totals
  let totalRevenue = 0
  let funnelRevenue = 0
  let organicRevenue = 0
  let orderBumpRevenue = 0

  // Top products map
  const productsMap = new Map<string, { count: number; revenue: number; platform: string }>()

  for (const e of events) {
    const revenue = e.revenue_cents ?? 0
    totalRevenue += revenue

    const attribution = (e.event_data as Record<string, unknown> | null)?.attribution as string | undefined
    const withinFunnel = (e.event_data as Record<string, unknown> | null)?.within_funnel

    if (withinFunnel === true || withinFunnel === 'true') {
      funnelRevenue += revenue
    }
    if (attribution === 'organic') {
      organicRevenue += revenue
    }
    if (e.event_type === 'purchased_order_bump' || e.event_type === 'purchased_upsell') {
      orderBumpRevenue += revenue
    }

    // Track product stats
    if (e.product_name) {
      const key = e.product_name
      const existing = productsMap.get(key)
      if (existing) {
        existing.count++
        existing.revenue += revenue
      } else {
        productsMap.set(key, {
          count: 1,
          revenue,
          platform: e.platform ?? 'internal',
        })
      }
    }
  }

  const topProducts = Array.from(productsMap.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10)
    .map(([name, stats]) => ({ name, ...stats }))

  const hasData = events.length > 0

  return (
    <div className="max-w-5xl">
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Métricas</h1>
        <p className="text-sm text-gray-500 mt-0.5">Visão geral de receita e desempenho dos seus funis</p>
      </div>

      {!hasData ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center">
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
          {/* Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-500">Receita Total</p>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-indigo-500">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <p className="text-xl font-bold text-gray-900">{fmt(totalRevenue)}</p>
              <p className="text-xs text-gray-400 mt-0.5">{events.length} venda{events.length !== 1 ? 's' : ''}</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-500">Receita do Funil</p>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 text-emerald-500">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
              </div>
              <p className="text-xl font-bold text-emerald-700">{fmt(funnelRevenue)}</p>
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
              <p className="text-xl font-bold text-blue-700">{fmt(organicRevenue)}</p>
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
              <p className="text-xl font-bold text-orange-700">{fmt(orderBumpRevenue)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {totalRevenue > 0 ? `${Math.round((orderBumpRevenue / totalRevenue) * 100)}% do total` : '0%'}
              </p>
            </div>
          </div>

          {/* Top Products Table */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
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
                        <td className="px-6 py-3.5 text-right text-gray-600 font-medium">
                          {p.count}
                        </td>
                        <td className="px-6 py-3.5 text-right font-semibold text-gray-800">
                          {fmt(p.revenue)}
                        </td>
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
    </div>
  )
}
