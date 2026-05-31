import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage } from '@/lib/evolution'
import { sendEmail } from '@/lib/resend'

export interface QueueJob {
  id: string
  tenant_id: string
  lead_id: string
  funnel_id: string
  block_id: string
  status: string
  scheduled_for: string
  attempts: number
}

export async function processJob(job: QueueJob): Promise<void> {
  const admin = createAdminClient()

  const { data: lead } = await admin.from('leads').select('id, name, phone, email, tenant_id').eq('id', job.lead_id).single()
  if (!lead) {
    console.warn(`[processor] Lead ${job.lead_id} não encontrado — pulando job ${job.id}`)
    return
  }

  const { data: block } = await admin.from('funnel_blocks').select('*').eq('id', job.block_id).single()
  if (!block) {
    console.warn(`[processor] Block ${job.block_id} não encontrado — pulando job ${job.id}`)
    return
  }

  const config = (block.config ?? {}) as Record<string, unknown>

  if (block.block_type === 'message') {
    const channel = (config.channel as string) ?? 'whatsapp'
    const body = ((config.body as string) ?? '').trim()

    if (!body) {
      console.warn(`[processor] Job ${job.id}: bloco message sem texto — avançando sem enviar`)
      await admin.from('lead_events').insert({
        tenant_id: job.tenant_id, lead_id: job.lead_id, funnel_id: job.funnel_id,
        block_id: job.block_id, event_type: 'message_skipped', event_data: { reason: 'empty_body', channel }
      })
      await enqueueNext(job, 'default', admin)
      return
    }

    if (channel === 'whatsapp' && lead.phone) {
      const overrideInstanceId = (config.override_whatsapp_instance_id as string) || null
      const { data: funnel } = await admin.from('funnels').select('whatsapp_instance_id').eq('id', job.funnel_id).single()
      const instanceId = overrideInstanceId ?? funnel?.whatsapp_instance_id ?? null
      if (instanceId) {
        const { data: instance } = await admin.from('whatsapp_instances').select('instance_name').eq('id', instanceId).single()
        if (instance?.instance_name) {
          await sendTextMessage(instance.instance_name, lead.phone, body)
        }
      }
    } else if (channel === 'email' && lead.email) {
      const subject = (config.subject as string) ?? 'Nova mensagem'
      await sendEmail({ from: 'FunilPro <noreply@funil.pro>', to: lead.email, subject, html: `<p>${body}</p>` })
    }

    await admin.from('lead_events').insert({
      tenant_id: job.tenant_id, lead_id: job.lead_id, funnel_id: job.funnel_id,
      block_id: job.block_id, event_type: 'message_sent', event_data: { channel }
    })

    await enqueueNext(job, 'default', admin)
  }

  else if (block.block_type === 'delay') {
    const amount = (config.duration as number) ?? (config.amount as number) ?? 1
    const unit = (config.unit as string) ?? 'horas'
    const ms =
      unit === 'minutos' || unit === 'minutes' ? amount * 60_000 :
      unit === 'horas'   || unit === 'hours'   ? amount * 3_600_000 :
      amount * 86_400_000
    const scheduledFor = new Date(Date.now() + ms).toISOString()

    await admin.from('lead_events').insert({
      tenant_id: job.tenant_id, lead_id: job.lead_id, funnel_id: job.funnel_id,
      block_id: job.block_id, event_type: 'delay_scheduled', event_data: { scheduled_for: scheduledFor, amount, unit }
    })

    await enqueueNext(job, 'default', admin, scheduledFor)
  }

  else if (block.block_type === 'condition') {
    const conditionType = (config.condition as string) ?? 'default'

    const { data: events } = await admin.from('lead_events').select('event_type').eq('lead_id', job.lead_id)
    const eventTypes = (events ?? []).map((e: { event_type: string }) => e.event_type)

    let matched = false
    if (conditionType === 'opened') matched = eventTypes.includes('message_opened')
    else if (conditionType === 'clicked') matched = eventTypes.includes('message_clicked')
    else if (conditionType === 'replied') matched = eventTypes.includes('replied')
    else if (conditionType === 'purchased') matched = eventTypes.includes('purchased')
    else matched = true

    await enqueueNext(job, matched ? 'yes' : 'no', admin)
  }

  else if (block.block_type === 'tag') {
    const tagAction = (config.action as string) ?? (config.tag_action as string) ?? 'add'
    const tagName = (config.tag_name as string) ?? ''
    if (tagName) {
      const { data: currentLead } = await admin.from('leads').select('tags').eq('id', job.lead_id).single()
      const tags: string[] = currentLead?.tags ?? []
      const newTags = tagAction === 'remove'
        ? tags.filter((t: string) => t !== tagName)
        : [...new Set([...tags, tagName])]
      await admin.from('leads').update({ tags: newTags }).eq('id', job.lead_id)
      await admin.from('lead_events').insert({
        tenant_id: job.tenant_id, lead_id: job.lead_id, funnel_id: job.funnel_id,
        block_id: job.block_id, event_type: 'tag_added', event_data: { tag: tagName, action: tagAction }
      })
    }
    await enqueueNext(job, 'default', admin)
  }

  else if (block.block_type === 'sale') {
    const paymentLink = (config.payment_link as string) ?? ''
    const message = ((config.sale_message as string) ?? (config.message as string) ?? paymentLink).trim()
    if (lead.phone && message) {
      const { data: funnel } = await admin.from('funnels').select('whatsapp_instance_id').eq('id', job.funnel_id).single()
      if (funnel?.whatsapp_instance_id) {
        const { data: instance } = await admin.from('whatsapp_instances').select('instance_name').eq('id', funnel.whatsapp_instance_id).single()
        if (instance?.instance_name) {
          await sendTextMessage(instance.instance_name, lead.phone, message)
        }
      }
    }
    await enqueueNext(job, 'default', admin)
  }
}

async function enqueueNext(
  job: QueueJob,
  condition: string,
  admin: ReturnType<typeof createAdminClient>,
  scheduledFor?: string
) {
  // Try exact condition first, then fall back to 'default'
  let edge: { target_block_id: string } | null = null
  const { data: exact } = await admin
    .from('funnel_edges')
    .select('target_block_id')
    .eq('funnel_id', job.funnel_id)
    .eq('source_block_id', job.block_id)
    .eq('condition', condition)
    .limit(1)
    .maybeSingle()
  edge = exact

  if (!edge?.target_block_id && condition !== 'default') {
    const { data: fallback } = await admin
      .from('funnel_edges')
      .select('target_block_id')
      .eq('funnel_id', job.funnel_id)
      .eq('source_block_id', job.block_id)
      .eq('condition', 'default')
      .limit(1)
      .maybeSingle()
    edge = fallback
  }

  if (!edge?.target_block_id) return

  await admin.from('queue_jobs').insert({
    tenant_id: job.tenant_id,
    lead_id: job.lead_id,
    funnel_id: job.funnel_id,
    block_id: edge.target_block_id,
    status: 'pending',
    scheduled_for: scheduledFor ?? new Date().toISOString(),
  })
}
