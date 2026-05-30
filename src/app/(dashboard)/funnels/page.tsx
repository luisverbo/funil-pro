import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Funnel } from '@/types'
import CreateFunnelDialog from '@/components/funnels/create-funnel-dialog'

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

const statusConfig: Record<string, { label: string; badgeClass: string; areaBg: string; iconColor: string }> = {
  draft:     { label: 'Rascunho',  badgeClass: 'bg-gray-100 text-gray-600',    areaBg: '#F3F4F6', iconColor: '#9ca3af' },
  published: { label: 'Publicado', badgeClass: 'bg-indigo-50 text-indigo-700', areaBg: '#EEF2FF', iconColor: '#6366f1' },
  paused:    { label: 'Pausado',   badgeClass: 'bg-amber-50 text-amber-700',   areaBg: '#FFFBEB', iconColor: '#f59e0b' },
}

export default async function FunnelsPage() {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!userTenant) redirect('/login')

  const { data: funnels } = await supabase
    .from('funnels')
    .select('*')
    .eq('tenant_id', userTenant.tenant_id)
    .order('created_at', { ascending: false })

  const list = (funnels ?? []) as Funnel[]

  return (
    <div className="max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Funis</h1>
          <p className="text-sm text-gray-500 mt-1">Crie e gerencie seus funis de vendas</p>
        </div>
        <CreateFunnelDialog />
      </div>

      {list.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-indigo-400">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </div>
          <p className="text-gray-700 font-semibold text-base mb-1">Nenhum funil criado</p>
          <p className="text-gray-400 text-sm mb-6">Comece criando seu primeiro funil de vendas.</p>
          <CreateFunnelDialog variant="cta" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((funnel) => {
            const st = statusConfig[funnel.status] ?? statusConfig.draft
            return (
              <div
                key={funnel.id}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
              >
                {/* Card top area with icon */}
                <div
                  className="flex items-center justify-center h-24"
                  style={{ backgroundColor: st.areaBg }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10" style={{ color: st.iconColor }}>
                    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                  </svg>
                </div>

                {/* Card body */}
                <div className="p-4 flex-1 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-gray-900 text-base leading-snug">{funnel.name}</h2>
                    <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${st.badgeClass}`}>
                      {st.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    Criado em {new Date(funnel.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>

                {/* Card footer */}
                <div className="px-4 pb-4 flex items-center gap-2">
                  <Link
                    href={`/funnels/${funnel.id}/builder`}
                    className="flex-1 text-center px-3 py-2 border border-indigo-600 text-indigo-600 text-sm font-medium rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    Abrir Builder
                  </Link>
                  <button
                    className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Excluir (em breve)"
                    disabled
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <polyline points="3,6 5,6 21,6" />
                      <path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6" />
                      <path d="M10,11v6M14,11v6" />
                      <path d="M9,6V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1V6" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
