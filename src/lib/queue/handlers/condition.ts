import type { SupabaseClient } from '@supabase/supabase-js'

interface HandlerCtx {
  lead: { id: string }
  block: { id: string; funnel_id: string; config: Record<string, unknown> }
  supabase: SupabaseClient
}

const CONDITION_EVENT_MAP: Record<string, string> = {
  opened: 'message_opened',
  clicked: 'message_clicked',
  replied: 'replied',
  purchased: 'purchased',
}

export async function handleCondition({ lead, block, supabase }: HandlerCtx): Promise<{ nextBlockId?: string }> {
  const config = block.config as { condition?: string; purchased_product?: string; replied_with?: string }
  const condition = config.condition ?? 'opened'

  let conditionMet = false

  if (condition === 'replied' || condition === 'replied_with') {
    // Fetch all reply events for this lead
    const { data: replyEvents } = await supabase
      .from('lead_events')
      .select('event_data')
      .eq('lead_id', lead.id)
      .eq('event_type', 'replied')
      .order('created_at', { ascending: false })
      .limit(20)

    if (!replyEvents || replyEvents.length === 0) {
      // No reply yet — pause execution and wait for webhook to re-trigger
      return {}
    }

    if (condition === 'replied') {
      conditionMet = true
    } else {
      const keyword = (config.replied_with ?? '').trim().toLowerCase()
      conditionMet = keyword
        ? replyEvents.some((ev) => {
            const text = ((ev.event_data as Record<string, unknown>)?.text as string ?? '').toLowerCase()
            return text.includes(keyword)
          })
        : true
    }
  } else {
    const eventType = CONDITION_EVENT_MAP[condition]
    if (eventType) {
      let query = supabase
        .from('lead_events')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('event_type', eventType)

      if (condition === 'purchased' && config.purchased_product?.trim()) {
        query = query.ilike('product_name', `%${config.purchased_product.trim()}%`)
      }

      const { data: events } = await query.limit(1)
      conditionMet = (events?.length ?? 0) > 0
    }

    if (condition === 'not_opened') {
      const { data: events } = await supabase
        .from('lead_events')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('event_type', 'message_opened')
        .limit(1)
      conditionMet = (events?.length ?? 0) === 0
    }
    if (condition === 'not_clicked') {
      const { data: events } = await supabase
        .from('lead_events')
        .select('id')
        .eq('lead_id', lead.id)
        .eq('event_type', 'message_clicked')
        .limit(1)
      conditionMet = (events?.length ?? 0) === 0
    }
  }

  const { data: edges } = await supabase
    .from('funnel_edges')
    .select('target_block_id, condition')
    .eq('funnel_id', block.funnel_id)
    .eq('source_block_id', block.id)

  const yesEdge = edges?.find((e) => e.condition === 'yes' || e.condition === 'default')
  const noEdge = edges?.find((e) => e.condition === 'no')

  const nextBlockId = conditionMet
    ? (yesEdge?.target_block_id ?? noEdge?.target_block_id)
    : (noEdge?.target_block_id ?? yesEdge?.target_block_id)

  return { nextBlockId: nextBlockId ?? undefined }
}
