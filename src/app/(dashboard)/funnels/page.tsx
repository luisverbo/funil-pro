import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Funnel } from '@/types'
import CreateFunnelDialog from '@/components/funnels/create-funnel-dialog'
import FunnelsGrid from '@/components/funnels/funnels-grid'

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

      <FunnelsGrid initialFunnels={list} />
    </div>
  )
}
