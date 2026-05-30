import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { User, Phone, Mail } from 'lucide-react'
import type { Lead } from '@/types'
import DeleteLeadButton from '@/components/leads/delete-lead-button'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

const statusConfig: Record<string, { label: string; className: string }> = {
  active:       { label: 'Ativo',        className: 'bg-indigo-50 text-indigo-700' },
  converted:    { label: 'Convertido',   className: 'bg-emerald-50 text-emerald-700' },
  unsubscribed: { label: 'Descadastrado', className: 'bg-gray-100 text-gray-600' },
  lost:         { label: 'Perdido',      className: 'bg-red-50 text-red-700' },
}

export default async function LeadsPage() {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!userTenant) redirect('/login')

  const { data: leads } = await supabase
    .from('leads')
    .select('*')
    .eq('tenant_id', userTenant.tenant_id)
    .order('created_at', { ascending: false })
    .limit(100)

  const list = (leads ?? []) as Lead[]

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500 mt-1">{list.length} leads registrados</p>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <User className="w-8 h-8 text-indigo-400" />
          </div>
          <p className="text-gray-700 font-semibold text-base mb-1">Nenhum lead ainda</p>
          <p className="text-gray-400 text-sm">Os leads aparecerão aqui quando alguém entrar no funil.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lead</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Contato</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Criado em</th>
                  <th className="px-5 py-3.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.map((lead) => {
                  const st = statusConfig[lead.status] ?? statusConfig.active
                  return (
                    <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center shrink-0">
                            <User className="w-4 h-4 text-indigo-500" />
                          </div>
                          <span className="font-medium text-gray-900">{lead.name ?? '—'}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="space-y-0.5">
                          {lead.phone && (
                            <div className="flex items-center gap-1.5 text-gray-600">
                              <Phone className="w-3.5 h-3.5 text-gray-400" />
                              {lead.phone}
                            </div>
                          )}
                          {lead.email && (
                            <div className="flex items-center gap-1.5 text-gray-500 text-xs">
                              <Mail className="w-3 h-3 text-gray-400" />
                              {lead.email}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${st.className}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-500">
                        {new Date(lead.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/leads/${lead.id}`}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                          >
                            Ver detalhes →
                          </Link>
                          <DeleteLeadButton leadId={lead.id} leadName={lead.name} />
                        </div>
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
