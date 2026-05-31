import { createAdminClient } from '@/lib/supabase/admin'

const PLAN_PRICES: Record<string, number> = { starter: 97, pro: 197, scale: 397 }

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR')
}

function planBadge(plan: string) {
  const colors: Record<string, string> = {
    starter: 'bg-gray-100 text-gray-700',
    pro: 'bg-blue-100 text-blue-700',
    scale: 'bg-purple-100 text-purple-700',
  }
  return colors[plan] ?? 'bg-gray-100 text-gray-600'
}

export default async function AdminOverviewPage() {
  const admin = createAdminClient()

  const [tenantsRes, funnelsRes, leadsRes, recentTenantsRes] = await Promise.all([
    admin.from('tenants').select('id, plan'),
    admin.from('funnels').select('id', { count: 'exact', head: true }),
    admin.from('leads').select('id', { count: 'exact', head: true }),
    admin.from('tenants').select('id, name, plan, slug, created_at').order('created_at', { ascending: false }).limit(10),
  ])

  const tenants = tenantsRes.data ?? []
  const totalTenants = tenants.length
  const totalFunnels = funnelsRes.count ?? 0
  const totalLeads = leadsRes.count ?? 0

  const mrr = tenants.reduce((acc, t) => acc + (PLAN_PRICES[t.plan] ?? 0), 0)

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const activeRes = await admin
    .from('leads')
    .select('tenant_id')
    .gte('created_at', thirtyDaysAgo)
  const activeCount = new Set((activeRes.data ?? []).map((r) => r.tenant_id)).size

  const recentTenants = recentTenantsRes.data ?? []

  const kpis = [
    { label: 'Total Clientes', value: totalTenants },
    { label: 'MRR Estimado', value: `R$ ${mrr.toLocaleString('pt-BR')}` },
    { label: 'Ativos (30d)', value: activeCount },
    { label: 'Total Funis', value: totalFunnels },
    { label: 'Total Leads', value: totalLeads },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Painel Admin</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs text-gray-500 font-medium mb-1">{k.label}</p>
            <p className="text-2xl font-bold text-gray-900">{k.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">Clientes Recentes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Plano</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Slug</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Criado em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentTenants.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3 font-medium text-gray-900">{t.name}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${planBadge(t.plan)}`}>
                      {t.plan}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-500">{t.slug}</td>
                  <td className="px-6 py-3 text-gray-500">{fmtDate(t.created_at)}</td>
                </tr>
              ))}
              {recentTenants.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-400">Nenhum cliente ainda</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
