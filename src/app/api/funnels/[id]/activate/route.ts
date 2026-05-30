import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFunnelQueue } from '@/lib/queue'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: funnelId } = await params

  const body = await request.json()
  const {
    phone,
    name,
    email,
    utm_source,
    utm_campaign,
    utm_campaign_id,
    utm_adset_id,
    utm_ad_id,
    utm_content,
    referrer_url,
    landing_url,
  } = body

  if (!phone || !name) {
    return NextResponse.json({ error: 'phone e name são obrigatórios' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: funnel } = await supabase
    .from('funnels')
    .select('id, tenant_id, status')
    .eq('id', funnelId)
    .single()

  if (!funnel) {
    return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
  }

  if (funnel.status !== 'published') {
    return NextResponse.json({ error: 'Funil não está publicado' }, { status: 400 })
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .insert({
      tenant_id: funnel.tenant_id,
      funnel_id: funnelId,
      name,
      phone,
      email: email ?? null,
      status: 'active',
    })
    .select('id')
    .single()

  if (leadError || !lead) {
    return NextResponse.json({ error: 'Erro ao criar lead' }, { status: 500 })
  }

  await supabase.from('lead_sources').insert({
    lead_id: lead.id,
    utm_source: utm_source ?? null,
    utm_campaign: utm_campaign ?? null,
    utm_campaign_id: utm_campaign_id ?? null,
    utm_adset_id: utm_adset_id ?? null,
    utm_ad_id: utm_ad_id ?? null,
    utm_content: utm_content ?? null,
    referrer_url: referrer_url ?? null,
    landing_url: landing_url ?? request.headers.get('referer') ?? null,
  })

  const { data: allBlocks } = await supabase
    .from('funnel_blocks')
    .select('id, position_y')
    .eq('funnel_id', funnelId)

  const { data: allEdges } = await supabase
    .from('funnel_edges')
    .select('target_block_id')
    .eq('funnel_id', funnelId)

  const targetIds = new Set((allEdges ?? []).map((e) => e.target_block_id))
  const rootBlocks = (allBlocks ?? []).filter((b) => !targetIds.has(b.id))
  const firstBlock = rootBlocks.sort((a, b) => a.position_y - b.position_y)[0]
    ?? (allBlocks ?? []).sort((a, b) => a.position_y - b.position_y)[0]

  if (!firstBlock) {
    return NextResponse.json({ error: 'Funil sem blocos' }, { status: 400 })
  }

  await supabase.from('lead_events').insert({
    tenant_id: funnel.tenant_id,
    lead_id: lead.id,
    funnel_id: funnelId,
    block_id: firstBlock.id,
    event_type: 'entered_funnel',
    event_data: { utm_source, utm_campaign, utm_campaign_id, utm_adset_id, utm_ad_id, utm_content },
  })

  await getFunnelQueue().add('execute-block', {
    funnelId,
    blockId: firstBlock.id,
    leadId: lead.id,
    tenantId: funnel.tenant_id,
  })

  return NextResponse.json({ success: true, lead_id: lead.id })
}
