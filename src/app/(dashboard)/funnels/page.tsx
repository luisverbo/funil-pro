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

const statusConfig: Record<string, { label: string; textClass: string; badgeClass: string; gradientClass: string }> = {
  draft:     { label: 'Rascunho',  textClass: 'text-gray-600',   badgeClass: 'bg-gray-100 text-gray-600',   gradientClass: 'from-gray-50 to-gray-100' },
  published: { label: 'Publicado', textClass: 'text-indigo-700', badgeClass: 'bg-indigo-50 text-indigo-700', gradientClass: 'from-indigo-50 to-indigo-100' },
  paused:    { label: 'Pausado',   textClass: 'text-amber-700',  badgeClass: 'bg-amber-50 text-amber-700',   gradientClass: 'from-amber-50 to-amber-100' },
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
                className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
              >
                {/* Card top accent */}
                <div className={`h-1.5 w-full bg-gradient-to-r ${st.gradientClass}`} />

                {/* Card body */}
                <div className="p-5 flex-1 flex flex-col gap-3">
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
                <div className="px-5 pb-4 flex items-center gap-2">
                  <Link
                    href={`/funnels/${funnel.id}/builder`}
                    className="flex-1 text-center px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Abrir Builder
                  </Link>
                  <button
                    className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors font-medium"
                    title="Duplicar (em breve)"
                    disabled
                  >
                    Duplicar
                  </button>
                  <button
                    className="px-3 py-2 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors font-medium"
                    title="Excluir (em breve)"
                    disabled
                  >
                    Excluir
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
