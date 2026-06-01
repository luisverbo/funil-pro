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

  const funnelList = (funnels ?? []) as Funnel[]
  const waInstanceIds = funnelList.map((f) => f.whatsapp_instance_id).filter((id): id is string => !!id)
  let waMap: Record<string, { instance_name: string; status: string }> = {}
  if (waInstanceIds.length > 0) {
    const { data: instances } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, display_name, status')
      .in('id', waInstanceIds)
    if (instances) {
      waMap = Object.fromEntries(instances.map((i) => [i.id, {
        instance_name: (i.display_name as string | null) || i.instance_name,
        status: i.status,
      }]))
    }
  }

  const admin = createAdminClient()
  const funnelIds = funnelList.map((f) => f.id)
  let leadsCountMap: Record<string, number> = {}
  let salesCountMap: Record<string, number> = {}
  let lastActivityMap: Record<string, string> = {}
  let revenueMap: Record<string, number> = {}
  let activeLeadsMap: Record<string, number> = {}

  if (funnelIds.length > 0) {
    const { data: leadCounts } = await admin
      .from('leads')
      .select('funnel_id')
      .in('funnel_id', funnelIds)
      .eq('tenant_id', userTenant.tenant_id)
    if (leadCounts) {
      for (const row of leadCounts) {
        leadsCountMap[row.funnel_id] = (leadsCountMap[row.funnel_id] ?? 0) + 1
      }
    }

    const { data: purchaseEvents } = await admin
      .from('lead_events')
      .select('funnel_id, lead_id, created_at')
      .in('funnel_id', funnelIds)
      .eq('event_type', 'purchased')
    if (purchaseEvents) {
      const salesLeads: Record<string, Set<string>> = {}
      for (const ev of purchaseEvents) {
        if (!salesLeads[ev.funnel_id]) salesLeads[ev.funnel_id] = new Set()
        salesLeads[ev.funnel_id].add(ev.lead_id)
        if (!lastActivityMap[ev.funnel_id] || ev.created_at > lastActivityMap[ev.funnel_id]) {
          lastActivityMap[ev.funnel_id] = ev.created_at
        }
      }
      for (const [fid, leads] of Object.entries(salesLeads)) {
        salesCountMap[fid] = leads.size
      }
    }

    const { data: revenueEvents } = await admin
      .from('lead_events')
      .select('funnel_id, revenue_cents')
      .in('funnel_id', funnelIds)
      .eq('event_type', 'purchased')
      .not('revenue_cents', 'is', null)
    if (revenueEvents) {
      for (const ev of revenueEvents) {
        revenueMap[ev.funnel_id] = (revenueMap[ev.funnel_id] ?? 0) + (ev.revenue_cents ?? 0)
      }
    }

    const { data: activeLeads } = await admin
      .from('leads')
      .select('funnel_id')
      .in('funnel_id', funnelIds)
      .eq('tenant_id', userTenant.tenant_id)
      .eq('status', 'active')
    if (activeLeads) {
      for (const row of activeLeads) {
        activeLeadsMap[row.funnel_id] = (activeLeadsMap[row.funnel_id] ?? 0) + 1
      }
    }

    const { data: recentEvents } = await admin
      .from('lead_events')
      .select('funnel_id, created_at')
      .in('funnel_id', funnelIds)
      .order('created_at', { ascending: false })
      .limit(funnelIds.length * 2)
    if (recentEvents) {
      for (const ev of recentEvents) {
        if (!lastActivityMap[ev.funnel_id]) {
          lastActivityMap[ev.funnel_id] = ev.created_at
        }
      }
    }
  }

  const list = funnelList.map((f) => ({
    ...f,
    _leadsCount: leadsCountMap[f.id] ?? 0,
    _salesCount: salesCountMap[f.id] ?? 0,
    _lastActivity: lastActivityMap[f.id] ?? null,
  }))

  const { data: tplData } = await admin
    .from('funnel_templates')
    .select('*')
    .eq('is_public', true)
    .order('downloads_count', { ascending: false })
    .limit(6)
  const popularTemplates = (tplData ?? []) as FunnelTemplate[]

  return (
    <div className="max-w-6xl mx-auto pb-24 md:pb-0">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Funis</h1>
          <p className="text-sm text-gray-500 mt-0.5">Crie e gerencie seus funis de vendas</p>
        </div>
        <div className="hidden md:block">
          <CreateFunnelDialog popularTemplates={popularTemplates} />
        </div>
      </div>

      <FunnelsGrid
        initialFunnels={list as unknown as Funnel[]}
        waMap={waMap}
        leadsCountMap={leadsCountMap}
        salesCountMap={salesCountMap}
        lastActivityMap={lastActivityMap}
        revenueMap={revenueMap}
        activeLeadsMap={activeLeadsMap}
      />

      <div className="md:hidden fixed bottom-6 right-6 z-30">
        <CreateFunnelDialog popularTemplates={popularTemplates} fab />
      </div>
    </div>
  )
}
