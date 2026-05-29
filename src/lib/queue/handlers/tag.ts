import type { SupabaseClient } from '@supabase/supabase-js'

interface HandlerCtx {
  lead: { id: string }
  block: { id: string; funnel_id: string; config: Record<string, unknown> }
  supabase: SupabaseClient
}

export async function handleTag({ lead, block, supabase }: HandlerCtx): Promise<{ nextBlockId?: string }> {
  const config = block.config as { tag_name?: string; action?: string }
  const tagName = config.tag_name ?? ''
  const action = config.action ?? 'add'

  if (tagName) {
    try {
      if (action === 'remove') {
        await supabase.rpc('remove_lead_tag', { lead_id: lead.id, tag: tagName })
      } else {
        await supabase.rpc('add_lead_tag', { lead_id: lead.id, tag: tagName })
      }
    } catch (err) {
      console.error('[tag] Erro ao aplicar tag:', err)
      const { data: currentLead } = await supabase
        .from('leads')
        .select('tags')
        .eq('id', lead.id)
        .single()

      const currentTags: string[] = currentLead?.tags ?? []
      const newTags = action === 'remove'
        ? currentTags.filter((t) => t !== tagName)
        : [...new Set([...currentTags, tagName])]

      await supabase.from('leads').update({ tags: newTags }).eq('id', lead.id)
    }
  }

  const { data: edge } = await supabase
    .from('funnel_edges')
    .select('target_block_id')
    .eq('funnel_id', block.funnel_id)
    .eq('source_block_id', block.id)
    .limit(1)
    .single()

  return { nextBlockId: edge?.target_block_id ?? undefined }
}
