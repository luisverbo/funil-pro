import { createAdminClient } from '@/lib/supabase/admin'
import TenantActions from './tenant-actions'

function planBadge(plan: string) {
  const colors: Record<string, string> = {
    starter: 'bg-gray-100 text-gray-700',
    pro: 'bg-blue-100 text-blue-700',
    scale: 'bg-purple-100 text-purple-700',
  }
  return colors[plan] ?? 'bg-gray-100 text-gray-600'
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('pt-BR')
}

export default async function AdminTenantsPage() {
  const admin = createAdminClient()

  const { data: tenants } = await admin
    .from('tenants')
    .select('id, name, slug, plan, created_at')
    .order('created_at', { ascending: false })

  const tenantIds = (tenants ?? []).map((t) => t.id)

  const [funnelCountsRes, leadCountsRes] = await Promise.all([
    admin.from('funnels').select('tenant_id').in('tenant_id', tenantIds),
    admin.from('leads').select('tenant_id').in('tenant_id', tenantIds),
  ])

  const funnelCounts = (funnelCountsRes.data ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.tenant_id] = (acc[r.tenant_id] ?? 0) + 1
    return acc
  }, {})
  const leadCounts = (leadCountsRes.data ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.tenant_id] = (acc[r.tenant_id] ?? 0) + 1
    return acc
  }, {})

  return (
    <div>
      <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-6">Clientes</h1>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Nome</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Plano</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Slug</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Funis</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Leads</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Criado em</th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(tenants ?? []).map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3 font-medium text-gray-900">{t.name}</td>
                  <td className="px-6 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${planBadge(t.plan)}`}>
                      {t.plan}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-500">{t.slug}</td>
                  <td className="px-6 py-3 text-gray-700">{funnelCounts[t.id] ?? 0}</td>
                  <td className="px-6 py-3 text-gray-700">{leadCounts[t.id] ?? 0}</td>
                  <td className="px-6 py-3 text-gray-500">{fmtDate(t.created_at)}</td>
                  <td className="px-6 py-3">
                    <TenantActions tenantId={t.id} currentPlan={t.plan} />
                  </td>
                </tr>
              ))}
              {(tenants ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-400">Nenhum cliente ainda</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
