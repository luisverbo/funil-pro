import { Worker, type Job } from 'bullmq'
import { createAdminClient } from '../supabase/admin'
import { handleMessage } from './handlers/message'
import { handleCondition } from './handlers/condition'
import { handleDelay } from './handlers/delay'
import { handleTag } from './handlers/tag'
import { handleSale } from './handlers/sale'
import { funnelQueue, redisConnection } from './index'

interface ExecuteBlockJobData {
  funnelId: string
  blockId: string
  leadId: string
  tenantId: string
}

const EVENT_TYPE_MAP: Record<string, string> = {
  message: 'message_sent',
  condition: 'condition_evaluated',
  delay: 'delay_scheduled',
  tag: 'tag_applied',
  sale: 'sale_link_sent',
}

async function processBlock(job: Job<ExecuteBlockJobData>) {
  const { funnelId, blockId, leadId, tenantId } = job.data
  const supabase = createAdminClient()

  const { data: block, error: blockError } = await supabase
    .from('funnel_blocks')
    .select('*')
    .eq('id', blockId)
    .single()

  if (blockError || !block) {
    console.error(`[worker] Block ${blockId} not found`)
    return
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, phone, email, name, tenant_id, status')
    .eq('id', leadId)
    .single()

  if (leadError || !lead) {
    console.error(`[worker] Lead ${leadId} not found`)
    return
  }

  if (lead.status === 'unsubscribed' || lead.status === 'lost') {
    console.log(`[worker] Lead ${leadId} is ${lead.status}, skipping`)
    return
  }

  let result: { nextBlockId?: string; delayMs?: number } = {}

  try {
    const ctx = { lead, block: { ...block, config: (block.config as Record<string, unknown>) ?? {} }, supabase }
    switch (block.block_type) {
      case 'message':   result = await handleMessage(ctx); break
      case 'condition': result = await handleCondition(ctx); break
      case 'delay':     result = await handleDelay(ctx); break
      case 'tag':       result = await handleTag(ctx); break
      case 'sale':      result = await handleSale(ctx); break
      default:
        console.warn(`[worker] Unknown block type: ${block.block_type}`)
    }
  } catch (err) {
    console.error(`[worker] Handler error for block ${blockId}:`, err)
  }

  const eventType = EVENT_TYPE_MAP[block.block_type] ?? 'block_executed'
  await supabase.from('lead_events').insert({
    tenant_id: tenantId,
    lead_id: leadId,
    funnel_id: funnelId,
    block_id: blockId,
    event_type: eventType,
    event_data: { block_type: block.block_type, result },
  })

  await supabase
    .from('leads')
    .update({ current_block_id: blockId })
    .eq('id', leadId)

  if (result.nextBlockId) {
    await funnelQueue.add(
      'execute-block',
      { funnelId, blockId: result.nextBlockId, leadId, tenantId },
      result.delayMs ? { delay: result.delayMs } : {}
    )
  }
}

export const worker = new Worker<ExecuteBlockJobData>(
  'funnel-execution',
  processBlock,
  { connection: redisConnection, concurrency: 10 }
)

worker.on('completed', (job) => {
  console.log(`[worker] Job ${job.id} completed — block ${job.data.blockId}`)
})

worker.on('failed', (job, err) => {
  console.error(`[worker] Job ${job?.id} failed:`, err)
})
