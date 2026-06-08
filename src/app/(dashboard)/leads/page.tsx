import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import LeadsClient from '@/components/leads/leads-client'

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
  const tenantId = userTenant.tenant_id

  const [
    { data: leadsRaw },
    { data: purchaseEvents },
    { data: funnels },
    { data: waInstances },
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('*, funnels(name)')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('lead_events')
      .select('lead_id')
      .eq('event_type', 'purchased')
      .eq('tenant_id', tenantId),
    supabase
      .from('funnels')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true }),
    supabase
      .from('whatsapp_instances')
      .select('id, instance_name, display_name, status')
      .eq('tenant_id', tenantId)
      .eq('status', 'connected'),
  ])

  const purchaserIds = new Set((purchaseEvents ?? []).map((e: { lead_id: string }) => e.lead_id))

  const leadIds = (leadsRaw ?? []).map((l: Record<string, unknown>) => l.id as string)
  const lastEventMap = new Map<string, { event_type: string; created_at: string }>()

  if (leadIds.length > 0) {
    const { data: lastEventsRaw } = await supabase
      .from('lead_events')
      .select('lead_id, event_type, created_at')
      .eq('tenant_id', tenantId)
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false })
      .limit(2000)

    const seen = new Set<string>()
    for (const ev of (lastEventsRaw ?? []) as Array<{ lead_id: string; event_type: string; created_at: string }>) {
      if (!seen.has(ev.lead_id)) {
        seen.add(ev.lead_id)
        lastEventMap.set(ev.lead_id, { event_type: ev.event_type, created_at: ev.created_at })
      }
    }
  }

  const leads = (leadsRaw ?? []).map((lead: Record<string, unknown>) => ({
    id: lead.id as string,
    name: lead.name as string | null,
    phone: lead.phone as string | null,
    email: lead.email as string | null,
    status: (lead.status as string) ?? 'active',
    tags: lead.tags as string[] | null,
    funnel_id: lead.funnel_id as string | null,
    funnel_name: (lead.funnels as { name: string } | null)?.name ?? null,
    created_at: lead.created_at as string,
    isPurchaser: purchaserIds.has(lead.id as string),
    lastEvent: lastEventMap.get(lead.id as string) ?? null,
  }))

  const instances = (waInstances ?? []).map((i: Record<string, unknown>) => ({
    id: i.id as string,
    name: ((i.display_name as string | null) || (i.instance_name as string)) ?? '',
  }))

  return (
    <LeadsClient
      leads={leads}
      funnels={(funnels ?? []) as { id: string; name: string }[]}
      tenantId={tenantId}
      waInstances={instances}
    />
  )
}
