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
  const config = block.config as { condition?: string }
  const condition = config.condition ?? 'opened'

  let conditionMet = false

  const eventType = CONDITION_EVENT_MAP[condition]
  if (eventType) {
    const { data: events } = await supabase
      .from('lead_events')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('event_type', eventType)
      .limit(1)
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
