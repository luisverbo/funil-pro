import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processJob, type QueueJob } from '@/lib/queue/processor'

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

  if (!funnel) return NextResponse.json({ error: 'Funil não encontrado' }, { status: 404 })
  if (funnel.status !== 'published') return NextResponse.json({ error: 'Funil não está publicado' }, { status: 400 })

  const { data: existingLead } = await supabase
    .from('leads')
    .select('id, name')
    .eq('tenant_id', funnel.tenant_id)
    .eq('phone', phone)
    .limit(1)
    .single()

  let leadId: string
  const isNew = !existingLead

  if (existingLead) {
    leadId = existingLead.id
    if (name && name !== existingLead.name) {
      await supabase.from('leads').update({ name, status: 'active', funnel_id: funnelId }).eq('id', leadId)
    } else {
      await supabase.from('leads').update({ status: 'active', funnel_id: funnelId }).eq('id', leadId)
    }
  } else {
    const { data: newLead, error: leadError } = await supabase
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

    if (leadError || !newLead) return NextResponse.json({ error: 'Erro ao criar lead' }, { status: 500 })
    leadId = newLead.id

    await supabase.from('lead_sources').insert({
      lead_id: leadId,
      utm_source: utm_source ?? null,
      utm_campaign: utm_campaign ?? null,
      utm_campaign_id: utm_campaign_id ?? null,
      utm_adset_id: utm_adset_id ?? null,
      utm_ad_id: utm_ad_id ?? null,
      utm_content: utm_content ?? null,
      referrer_url: referrer_url ?? null,
      landing_url: landing_url ?? request.headers.get('referer') ?? null,
    })
  }

  const { data: allBlocks } = await supabase
    .from('funnel_blocks')
    .select('id, block_type, position_y')
    .eq('funnel_id', funnelId)

  const { data: allEdges } = await supabase
    .from('funnel_edges')
    .select('target_block_id')
    .eq('funnel_id', funnelId)

  const targetIds = new Set((allEdges ?? []).map((e) => e.target_block_id))
  const entryBlock = (allBlocks ?? []).find((b) => b.block_type === 'entry')
  const rootBlocks = (allBlocks ?? []).filter((b) => !targetIds.has(b.id))
  const firstBlock = entryBlock
    ?? rootBlocks.sort((a, b) => a.position_y - b.position_y)[0]
    ?? (allBlocks ?? []).sort((a, b) => a.position_y - b.position_y)[0]

  if (!firstBlock) return NextResponse.json({ error: 'Funil sem blocos' }, { status: 400 })

  await supabase.from('lead_events').insert({
    tenant_id: funnel.tenant_id,
    lead_id: leadId,
    funnel_id: funnelId,
    block_id: firstBlock.id,
    event_type: 'entered_funnel',
    event_data: { utm_source, utm_campaign, utm_campaign_id, utm_adset_id, utm_ad_id, utm_content, is_returning: !isNew },
  })

  const { data: nextEdge } = await supabase
    .from('funnel_edges')
    .select('target_block_id')
    .eq('funnel_id', funnelId)
    .eq('source_block_id', firstBlock.id)
    .limit(1)
    .single()

  const actionBlockId = firstBlock.block_type === 'entry' && nextEdge?.target_block_id
    ? nextEdge.target_block_id
    : firstBlock.id

  const job: QueueJob = {
    id: crypto.randomUUID(),
    tenant_id: funnel.tenant_id,
    lead_id: leadId,
    funnel_id: funnelId,
    block_id: actionBlockId,
    status: 'pending',
    scheduled_for: new Date().toISOString(),
    attempts: 0,
  }

  try {
    await processJob(job)
  } catch (err) {
    console.error('[activate] inline processJob failed, inserting to queue:', err)
    try {
      await supabase.from('queue_jobs').insert({
        tenant_id: job.tenant_id,
        lead_id: job.lead_id,
        funnel_id: job.funnel_id,
        block_id: job.block_id,
        status: 'pending',
        scheduled_for: job.scheduled_for,
      })
    } catch {}
  }

  return NextResponse.json({ success: true, lead_id: leadId, is_returning: !isNew })
}
