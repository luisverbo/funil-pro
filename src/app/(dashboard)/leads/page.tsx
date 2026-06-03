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

  // Fetch leads joined with funnel name
  const { data: leadsRaw } = await supabase
    .from('leads')
    .select('*, funnels(name)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(500)

  // Fetch purchaser lead IDs
  const { data: purchaseEvents } = await supabase
    .from('lead_events')
    .select('lead_id')
    .eq('event_type', 'purchased')
    .eq('tenant_id', tenantId)

  const purchaserIds = new Set((purchaseEvents ?? []).map((e: { lead_id: string }) => e.lead_id))

  // Fetch all funnels for the enrollment dropdown
  const { data: funnels } = await supabase
    .from('funnels')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })

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
  }))

  return (
    <LeadsClient
      leads={leads}
      funnels={(funnels ?? []) as { id: string; name: string }[]}
      tenantId={tenantId}
    />
  )
}
