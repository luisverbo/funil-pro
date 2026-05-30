import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function fmtBRL(cents: number) {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-gray-100 text-gray-600' },
  published: { label: 'Publicado', className: 'bg-emerald-50 text-emerald-700' },
  paused: { label: 'Pausado', className: 'bg-yellow-50 text-yellow-700' },
}

export default async function MetricsFunnelsPage() {
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

  const { data: funnelsRaw } = await admin
    .from('funnels')
    .select('id, name, status, created_at, published_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const funnels = (funnelsRaw ?? []) as Array<{
    id: string
    name: string
    status: string
    created_at: string
    published_at: string | null
  }>

  // For each funnel, count leads and aggregate purchases
  const funnelIds = funnels.map((f) => f.id)
  const metricsMap = new Map<string, { leads: number; buyers: number; revenue: number }>()

  if (funnelIds.length > 0) {
    const { data: leadCountsRaw } = await admin
      .from('leads')
      .select('funnel_id')
      .eq('tenant_id', tenantId)
      .in('funnel_id', funnelIds)

    const leadCounts = new Map<string, number>()
    for (const r of (leadCountsRaw ?? [])) {
      leadCounts.set(r.funnel_id, (leadCounts.get(r.funnel_id) ?? 0) + 1)
    }

    const { data: purchaseEventsRaw } = await admin
      .from('lead_events')
      .select('funnel_id, lead_id, revenue_cents')
      .eq('tenant_id', tenantId)
      .or('event_type.eq.purchased,event_type.eq.purchased_order_bump,event_type.eq.purchased_upsell')
      .in('funnel_id', funnelIds)

    const purchasesByFunnel = new Map<string, { buyers: Set<string>; revenue: number }>()
    for (const ev of (purchaseEventsRaw ?? [])) {
      if (!purchasesByFunnel.has(ev.funnel_id)) {
        purchasesByFunnel.set(ev.funnel_id, { buyers: new Set(), revenue: 0 })
      }
      const entry = purchasesByFunnel.get(ev.funnel_id)!
      entry.buyers.add(ev.lead_id)
      entry.revenue += ev.revenue_cents ?? 0
    }

    for (const f of funnels) {
      const leads = leadCounts.get(f.id) ?? 0
      const pe = purchasesByFunnel.get(f.id)
      metricsMap.set(f.id, {
        leads,
        buyers: pe?.buyers.size ?? 0,
        revenue: pe?.revenue ?? 0,
      })
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Métricas</h1>
        <p className="text-sm text-gray-500 mt-0.5">Desempenho por funil</p>
      </div>

      {/* Sub-nav */}
      <div className="flex gap-6 border-b border-gray-200 mb-6 text-sm font-medium">
        <Link href="/metrics" className="pb-2.5 border-b-2 border-transparent text-gray-500 hover:text-gray-700">
          Visão Geral
        </Link>
        <Link href="/metrics/funnels" className="pb-2.5 border-b-2 border-indigo-600 text-indigo-600">
          Por Funil
        </Link>
        <Link href="/metrics/ads" className="pb-2.5 border-b-2 border-transparent text-gray-500 hover:text-gray-700">
          Anúncios
        </Link>
      </div>

      {funnels.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-16 text-center">
          <p className="text-gray-500 font-medium">Nenhum funil criado ainda</p>
          <Link href="/funnels" className="text-indigo-600 text-sm mt-2 inline-block hover:underline">
            Criar meu primeiro funil →
          </Link>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Funil</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Status</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Leads</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Conversão</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Receita</th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {funnels.map((f) => {
                  const m = metricsMap.get(f.id) ?? { leads: 0, buyers: 0, revenue: 0 }
                  const conversion = m.leads > 0 ? ((m.buyers / m.leads) * 100).toFixed(1) : '0.0'
                  const st = statusConfig[f.status] ?? statusConfig.draft
                  return (
                    <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="font-medium text-gray-900">{f.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Criado em {new Date(f.created_at).toLocaleDateString('pt-BR')}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${st.className}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-gray-800">
                        {m.leads.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className={`font-semibold ${parseFloat(conversion) > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                          {conversion}%
                        </span>
                        <p className="text-xs text-gray-400">{m.buyers} compradores</p>
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-gray-900">
                        {m.revenue > 0 ? fmtBRL(m.revenue) : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          href={`/funnels/${f.id}/builder`}
                          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium hover:underline"
                        >
                          Abrir builder →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
