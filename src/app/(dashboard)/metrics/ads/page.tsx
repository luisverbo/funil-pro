import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { AdMetric } from '@/types'

function fmtBRL(cents: number) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function roasBadge(roas: number) {
  if (roas >= 3) return 'bg-emerald-50 text-emerald-700'
  if (roas >= 1) return 'bg-yellow-50 text-yellow-700'
  return 'bg-red-50 text-red-700'
}

export default async function MetricsAdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  const sortField = sp.sort ?? 'roas'
  const sortDir = sp.dir ?? 'desc'

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

  const { data: tenantData } = await admin
    .from('tenants')
    .select('meta_access_token, meta_ad_account_id')
    .eq('id', tenantId)
    .single()

  if (!tenantData?.meta_access_token || !tenantData?.meta_ad_account_id) {
    redirect('/integrations')
  }

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const { data: adMetricsRaw } = await admin
    .from('ad_metrics')
    .select('*')
    .eq('tenant_id', tenantId)
    .gte('date', since30)

  const adMetrics = (adMetricsRaw ?? []) as AdMetric[]

  // Aggregate by ad_id
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

  let ads = Array.from(adMap.values()).map((a) => ({
    ...a,
    cpl: a.totalLeads > 0 ? Math.round(a.totalSpend / a.totalLeads) : 0,
    roas: a.totalSpend > 0 ? a.totalRevenue / a.totalSpend : 0,
  }))

  // Sort
  ads = ads.sort((a, b) => {
    let aVal: number, bVal: number
    switch (sortField) {
      case 'spend': aVal = a.totalSpend; bVal = b.totalSpend; break
      case 'leads': aVal = a.totalLeads; bVal = b.totalLeads; break
      case 'cpl': aVal = a.cpl; bVal = b.cpl; break
      case 'revenue': aVal = a.totalRevenue; bVal = b.totalRevenue; break
      default: aVal = a.roas; bVal = b.roas
    }
    return sortDir === 'asc' ? aVal - bVal : bVal - aVal
  })

  function sortLink(field: string) {
    const newDir = sortField === field && sortDir === 'desc' ? 'asc' : 'desc'
    return `/metrics/ads?sort=${field}&dir=${newDir}`
  }

  function sortArrow(field: string) {
    if (sortField !== field) return null
    return sortDir === 'desc' ? ' ↓' : ' ↑'
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Métricas</h1>
        <p className="text-sm text-gray-500 mt-0.5">Desempenho dos anúncios — últimos 30 dias</p>
      </div>

      {/* Sub-nav */}
      <div className="flex gap-6 border-b border-gray-200 mb-6 text-sm font-medium">
        <Link href="/metrics" className="pb-2.5 border-b-2 border-transparent text-gray-500 hover:text-gray-700">
          Visão Geral
        </Link>
        <Link href="/metrics/funnels" className="pb-2.5 border-b-2 border-transparent text-gray-500 hover:text-gray-700">
          Por Funil
        </Link>
        <Link href="/metrics/ads" className="pb-2.5 border-b-2 border-indigo-600 text-indigo-600">
          Anúncios
        </Link>
      </div>

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-600">{ads.length} anúncio{ads.length !== 1 ? 's' : ''} encontrado{ads.length !== 1 ? 's' : ''}</p>
        <a
          href="/api/meta/sync"
          className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          Sincronizar Meta Ads
        </a>
      </div>

      {ads.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center">
          <p className="text-gray-600 font-medium">Nenhum dado de anúncio nos últimos 30 dias</p>
          <p className="text-sm text-gray-400 mt-1">
            Clique em &quot;Sincronizar Meta Ads&quot; acima para importar dados agora.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Anúncio</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Campanha</th>
                  <th className="text-right px-5 py-3">
                    <Link href={sortLink('spend')} className="text-xs font-semibold text-gray-500 hover:text-gray-800">
                      Gasto{sortArrow('spend')}
                    </Link>
                  </th>
                  <th className="text-right px-5 py-3">
                    <Link href={sortLink('leads')} className="text-xs font-semibold text-gray-500 hover:text-gray-800">
                      Leads{sortArrow('leads')}
                    </Link>
                  </th>
                  <th className="text-right px-5 py-3">
                    <Link href={sortLink('cpl')} className="text-xs font-semibold text-gray-500 hover:text-gray-800">
                      CPL{sortArrow('cpl')}
                    </Link>
                  </th>
                  <th className="text-right px-5 py-3">
                    <Link href={sortLink('revenue')} className="text-xs font-semibold text-gray-500 hover:text-gray-800">
                      Receita{sortArrow('revenue')}
                    </Link>
                  </th>
                  <th className="text-right px-5 py-3">
                    <Link href={sortLink('roas')} className="text-xs font-semibold text-gray-500 hover:text-gray-800">
                      ROAS{sortArrow('roas')}
                    </Link>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {ads.map((a) => (
                  <tr key={a.ad_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5 max-w-[200px]">
                      <p className="font-medium text-gray-900 truncate">{a.ad_name ?? a.ad_id}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">{a.ad_id}</p>
                    </td>
                    <td className="px-5 py-3.5 max-w-[160px]">
                      <p className="text-gray-600 truncate text-xs">{a.campaign_name ?? '—'}</p>
                    </td>
                    <td className="px-5 py-3.5 text-right text-gray-700">{fmtBRL(a.totalSpend)}</td>
                    <td className="px-5 py-3.5 text-right text-gray-700">{a.totalLeads.toLocaleString('pt-BR')}</td>
                    <td className="px-5 py-3.5 text-right text-gray-700">{a.cpl > 0 ? fmtBRL(a.cpl) : '—'}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-900">{a.totalRevenue > 0 ? fmtBRL(a.totalRevenue) : '—'}</td>
                    <td className="px-5 py-3.5 text-right">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${roasBadge(a.roas)}`}>
                        {a.roas.toFixed(2)}x
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
