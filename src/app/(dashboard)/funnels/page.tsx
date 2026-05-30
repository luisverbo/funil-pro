import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Funnel, FunnelTemplate } from '@/types'
import CreateFunnelDialog from '@/components/funnels/create-funnel-dialog'
import FunnelsGrid from '@/components/funnels/funnels-grid'
import { createAdminClient } from '@/lib/supabase/admin'

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

  // Fetch WA instances to enrich funnel cards
  const funnelList = (funnels ?? []) as Funnel[]
  const waInstanceIds = funnelList.map((f) => f.whatsapp_instance_id).filter((id): id is string => !!id)
  let waMap: Record<string, { instance_name: string; status: string }> = {}
  if (waInstanceIds.length > 0) {
    const { data: instances } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, status')
      .in('id', waInstanceIds)
    if (instances) {
      waMap = Object.fromEntries(instances.map((i) => [i.id, { instance_name: i.instance_name, status: i.status }]))
    }
  }

  const list = funnelList.map((f) => ({
    ...f,
    _waInstance: f.whatsapp_instance_id ? (waMap[f.whatsapp_instance_id] ?? null) : null,
  }))

  const admin = createAdminClient()
  const { data: tplData } = await admin
    .from('funnel_templates')
    .select('*')
    .eq('is_public', true)
    .order('downloads_count', { ascending: false })
    .limit(6)
  const popularTemplates = (tplData ?? []) as FunnelTemplate[]

  return (
    <div className="max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Funis</h1>
          <p className="text-sm text-gray-500 mt-1">Crie e gerencie seus funis de vendas</p>
        </div>
        <CreateFunnelDialog popularTemplates={popularTemplates} />
      </div>

      <FunnelsGrid initialFunnels={list as unknown as Funnel[]} waMap={waMap} />
    </div>
  )
}
