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

function interpolate(
  text: string,
  lead: { name?: string | null; phone?: string | null; email?: string | null }
): string {
  const now = new Date()
  const firstName = lead.name?.split(' ')[0] ?? ''
  return text
    .replace(/{nome}/g, lead.name ?? '')
    .replace(/{primeiro_nome}/g, firstName)
    .replace(/{telefone}/g, lead.phone ?? '')
    .replace(/{email}/g, lead.email ?? '')
    .replace(/{data}/g, now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
    .replace(/{hora}/g, now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }))
}

export async function processJob(job: QueueJob): Promise<void> {
  const admin = createAdminClient()

  const { data: lead } = await admin.from('leads').select('id, name, phone, email, tenant_id').eq('id', job.lead_id).single()
  if (!lead) {
    console.warn(`[processor] Lead ${job.lead_id} não encontrado — pulando job ${job.id}`)
    return
  }

  // Check if funnel is paused
  const { data: funnelData } = await admin.from('funnels').select('status, whatsapp_instance_id').eq('id', job.funnel_id).single()
  if (funnelData?.status === 'paused') {
    // Reschedule 30 minutes later
    await admin.from('queue_jobs').update({
      status: 'pending',
      scheduled_for: new Date(Date.now() + 1_800_000).toISOString(),
    }).eq('id', job.id)
    return
  }

  const { data: block } = await admin.from('funnel_blocks').select('*').eq('id', job.block_id).single()
  if (!block) {
    console.warn(`[processor] Block ${job.block_id} não encontrado — pulando job ${job.id}`)
    return
  }

  const config = (block.config ?? {}) as Record<string, unknown>

  const logEvent = (eventType: string, eventData: Record<string, unknown> = {}) =>
    admin.from('lead_events').insert({
      tenant_id: job.tenant_id, lead_id: job.lead_id, funnel_id: job.funnel_id,
      block_id: job.block_id, event_type: eventType, event_data: eventData,
    })

  if (block.block_type === 'message') {
    const channel = (config.channel as string) ?? 'whatsapp'
    const rawBody = ((config.body as string) ?? '').trim()
    const body = interpolate(rawBody, lead)

    if (!body) {
      await logEvent('message_skipped', { reason: 'empty_body', channel })
      await enqueueNext(job, 'default', admin)
      return
    }

    if (channel === 'whatsapp' && lead.phone) {
      const overrideInstanceId = (config.override_whatsapp_instance_id as string) || null
      const instanceId = overrideInstanceId ?? funnelData?.whatsapp_instance_id ?? null
      if (instanceId) {
        const { data: instance } = await admin.from('whatsapp_instances').select('instance_name').eq('id', instanceId).single()
        if (instance?.instance_name) {
          await sendTextMessage(instance.instance_name, lead.phone, body)
        }
      }
    } else if (channel === 'email' && lead.email) {
      const subject = (config.subject as string) ?? 'Nova mensagem'
      await sendEmail({
        from: 'FunilPro <noreply@funil.pro>',
        to: lead.email,
        subject,
        html: `<p>${body.replace(/\n/g, '<br>')}</p>`,
      })
    }

    await logEvent('message_sent', { channel })
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
    await logEvent('delay_scheduled', { scheduled_for: scheduledFor, amount, unit })
    await enqueueNext(job, 'default', admin, scheduledFor)
  }

  else if (block.block_type === 'condition') {
    const conditionType = (config.condition as string) ?? 'default'
    let matched = false

    if (conditionType === 'replied_with') {
      const keyword = ((config.replied_with as string) ?? '').trim().toLowerCase()
      if (keyword) {
        const { data: events } = await admin.from('lead_events')
          .select('event_data').eq('lead_id', job.lead_id).eq('event_type', 'replied')
          .order('created_at', { ascending: false }).limit(10)
        matched = (events ?? []).some((ev) => {
          const text = ((ev.event_data as Record<string, unknown>)?.text as string ?? '').toLowerCase()
          return text.includes(keyword)
        })
      }
    } else if (conditionType === 'purchased') {
      let query = admin.from('lead_events').select('id').eq('lead_id', job.lead_id).eq('event_type', 'purchased')
      if ((config.purchased_product as string)?.trim()) {
        query = query.ilike('product_name', `%${(config.purchased_product as string).trim()}%`)
      }
      const { data: events } = await query.limit(1)
      matched = (events?.length ?? 0) > 0
    } else if (conditionType === 'not_opened') {
      const { data: events } = await admin.from('lead_events').select('id').eq('lead_id', job.lead_id).eq('event_type', 'message_opened').limit(1)
      matched = (events?.length ?? 0) === 0
    } else if (conditionType === 'not_clicked') {
      const { data: events } = await admin.from('lead_events').select('id').eq('lead_id', job.lead_id).eq('event_type', 'message_clicked').limit(1)
      matched = (events?.length ?? 0) === 0
    } else if (conditionType === 'tag') {
      const tagName = ((config.tag_name as string) ?? '').trim()
      const { data: currentLead } = await admin.from('leads').select('tags').eq('id', job.lead_id).single()
      matched = tagName ? ((currentLead?.tags ?? []) as string[]).includes(tagName) : false
    } else {
      const eventMap: Record<string, string> = { opened: 'message_opened', clicked: 'message_clicked', replied: 'replied' }
      const eventType = eventMap[conditionType]
      if (eventType) {
        const { data: events } = await admin.from('lead_events').select('id').eq('lead_id', job.lead_id).eq('event_type', eventType).limit(1)
        matched = (events?.length ?? 0) > 0
      } else {
        matched = true
      }
    }

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
      await logEvent('tag_added', { tag: tagName, action: tagAction })
    }
    await enqueueNext(job, 'default', admin)
  }

  else if (block.block_type === 'sale') {
    const paymentLink = (config.payment_link as string) ?? ''
    const rawMessage = ((config.sale_message as string) ?? (config.message as string) ?? paymentLink).trim()
    const message = interpolate(rawMessage, lead)
    if (lead.phone && message) {
      const instanceId = funnelData?.whatsapp_instance_id
      if (instanceId) {
        const { data: instance } = await admin.from('whatsapp_instances').select('instance_name').eq('id', instanceId).single()
        if (instance?.instance_name) {
          await sendTextMessage(instance.instance_name, lead.phone, message)
        }
      }
    }
    await logEvent('message_sent', { channel: 'whatsapp', type: 'sale' })
    await enqueueNext(job, 'default', admin)
  }

  else if (block.block_type === 'goto') {
    const targetBlockId = (config.target_block_id as string) ?? ''
    if (!targetBlockId) return

    // Loop protection: max 10 gotos per hour
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const { count } = await admin.from('lead_events')
      .select('id', { count: 'exact', head: true })
      .eq('lead_id', job.lead_id)
      .eq('event_type', 'goto_redirect')
      .gte('created_at', oneHourAgo)

    if ((count ?? 0) >= 10) {
      await logEvent('loop_detected', { block_id: job.block_id })
      return
    }

    await logEvent('goto_redirect', { target_block_id: targetBlockId })
    await admin.from('queue_jobs').insert({
      tenant_id: job.tenant_id, lead_id: job.lead_id, funnel_id: job.funnel_id,
      block_id: targetBlockId, status: 'pending', scheduled_for: new Date().toISOString(),
    })
  }

  else if (block.block_type === 'ab_test') {
    const percentA = (config.percent_a as number) ?? 50
    const rand = Math.random() * 100
    const variant = rand < percentA ? 'a' : 'b'
    await logEvent('ab_variant', { variant, percent_a: percentA })
    await enqueueNext(job, variant, admin)
  }

  else if (block.block_type === 'remove_from_funnel') {
    await admin.from('leads').update({ status: 'completed' }).eq('id', job.lead_id)
    await logEvent('funnel_completed', { reason: 'removed_by_block' })
    // No next block — funnel ends here
  }
}

async function enqueueNext(
  job: QueueJob,
  condition: string,
  admin: ReturnType<typeof createAdminClient>,
  scheduledFor?: string
) {
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
