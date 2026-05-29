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

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: 'Rascunho', className: 'bg-gray-100 text-gray-700' },
  published: { label: 'Publicado', className: 'bg-green-100 text-green-700' },
  paused: { label: 'Pausado', className: 'bg-yellow-100 text-yellow-700' },
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
    <main className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Meus Funis</h1>
        <CreateFunnelDialog />
      </div>

      {list.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-gray-500 text-lg mb-4">Você ainda não criou nenhum funil.</p>
          <p className="text-gray-400 text-sm mb-6">Comece criando seu primeiro funil de vendas.</p>
          <CreateFunnelDialog variant="cta" />
        </div>
      ) : (
        <div className="grid gap-4">
          {list.map((funnel) => {
            const status = statusConfig[funnel.status] ?? statusConfig.draft
            return (
              <div
                key={funnel.id}
                className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-md transition"
              >
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="font-semibold text-gray-900 text-base">{funnel.name}</h2>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm">
                    Criado em {new Date(funnel.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <Link
                  href={`/funnels/${funnel.id}/builder`}
                  className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
                >
                  Abrir Builder
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
