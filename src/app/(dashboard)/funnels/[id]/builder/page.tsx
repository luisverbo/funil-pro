import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import type { FunnelBlock, FunnelEdge, Funnel, WhatsappInstance } from '@/types'
import FunnelBuilderWrapper from '@/components/builder/funnel-builder-wrapper'

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

export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabase()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!userTenant) redirect('/login')

  const { data: funnel } = await supabase
    .from('funnels')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', userTenant.tenant_id)
    .single()

  if (!funnel) notFound()

  const { data: waInstances } = await supabase
    .from('whatsapp_instances')
    .select('id, instance_name, phone_number, status')
    .eq('tenant_id', userTenant.tenant_id)
    .order('created_at')

  const { data: blocks } = await supabase
    .from('funnel_blocks')
    .select('*')
    .eq('funnel_id', id)

  const { data: edges } = await supabase
    .from('funnel_edges')
    .select('*')
    .eq('funnel_id', id)

  // Fetch metrics per block (only for published funnels)
  const blockIds = (blocks ?? []).map((b) => b.id)
  let blockMetrics: Record<string, { sent: number; delivered: number; opened: number; clicked: number }> = {}

  if (funnel.status === 'published' && blockIds.length > 0) {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const admin = createAdminClient()
    const { data: events } = await admin
      .from('lead_events')
      .select('block_id, event_type')
      .eq('funnel_id', id)
      .in('block_id', blockIds)
      .in('event_type', ['message_sent', 'message_delivered', 'message_opened', 'message_clicked', 'link_clicked'])

    if (events) {
      for (const ev of events) {
        if (!ev.block_id) continue
        if (!blockMetrics[ev.block_id]) blockMetrics[ev.block_id] = { sent: 0, delivered: 0, opened: 0, clicked: 0 }
        if (ev.event_type === 'message_sent') blockMetrics[ev.block_id].sent++
        if (ev.event_type === 'message_delivered') blockMetrics[ev.block_id].delivered++
        if (ev.event_type === 'message_opened') blockMetrics[ev.block_id].opened++
        if (ev.event_type === 'message_clicked' || ev.event_type === 'link_clicked') blockMetrics[ev.block_id].clicked++
      }
    }
  }

  return (
    <FunnelBuilderWrapper
      funnel={funnel as Funnel}
      initialBlocks={(blocks ?? []) as FunnelBlock[]}
      initialEdges={(edges ?? []) as FunnelEdge[]}
      blockMetrics={funnel.status === 'published' ? blockMetrics : null}
      waInstances={(waInstances ?? []) as WhatsappInstance[]}
    />
  )
}
