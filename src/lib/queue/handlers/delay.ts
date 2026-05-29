import type { SupabaseClient } from '@supabase/supabase-js'

interface HandlerCtx {
  lead: { id: string }
  block: { id: string; funnel_id: string; config: Record<string, unknown> }
  supabase: SupabaseClient
}

const UNIT_MS: Record<string, number> = {
  minutos: 60_000,
  horas: 3_600_000,
  dias: 86_400_000,
}

export async function handleDelay({ block, supabase }: HandlerCtx): Promise<{ nextBlockId?: string; delayMs?: number }> {
  const config = block.config as { duration?: number; unit?: string }
  const duration = config.duration ?? 1
  const unit = config.unit ?? 'horas'
  const delayMs = duration * (UNIT_MS[unit] ?? UNIT_MS.horas)

  const { data: edge } = await supabase
    .from('funnel_edges')
    .select('target_block_id')
    .eq('funnel_id', block.funnel_id)
    .eq('source_block_id', block.id)
    .limit(1)
    .single()

  return { nextBlockId: edge?.target_block_id ?? undefined, delayMs }
}
