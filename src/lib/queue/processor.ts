import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage, sendMediaMessage } from '@/lib/evolution'
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

  // Always update current_block_id so webhook can find the right block
  await admin.from('leads').update({ current_block_id: job.block_id }).eq('id', job.lead_id)

  if (block.block_type === 'message') {
    const channel = (config.channel as string) ?? 'whatsapp'
    const rawBody = ((config.body as string) ?? '').trim()
    const body = interpolateMessage(rawBody, lead)
    const mediaType = (config.media_type as string) ?? 'none'
    const mediaUrl = (config.media_url as string) ?? ''

    if (!body && mediaType === 'none') {
      console.warn(`[processor] Job ${job.id}: bloco message sem conteúdo — avançando sem enviar`)
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
          if (mediaType !== 'none' && mediaUrl) {
            await sendMediaMessage(
              instance.instance_name,
              lead.phone,
              mediaUrl,
              mediaType as 'image' | 'video' | 'document',
              body
            )
          } else {
            await sendTextMessage(instance.instance_name, lead.phone, body)
          }
        }
      }
    } else if (channel === 'email' && lead.email) {
      const subject = (config.subject as string) ?? 'Nova mensagem'
      const htmlBody = mediaUrl && mediaType !== 'none'
        ? `<p>${body}</p><p><a href="${mediaUrl}" target="_blank">📎 Clique aqui para acessar o anexo</a></p>`
        : `<p>${body}</p>`
      await sendEmail({ from: 'FunilPro <noreply@funil.pro>', to: lead.email, subject, html: htmlBody })
    }

    await admin.from('lead_events').insert({
      tenant_id: job.tenant_id, lead_id: job.lead_id, funnel_id: job.funnel_id,
      block_id: job.block_id, event_type: 'message_sent', event_data: { channel, media_type: mediaType }
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

    if (conditionType === 'replied' || conditionType === 'replied_with' || conditionType === 'replied_number') {
      const { data: replyEvents } = await admin
        .from('lead_events')
        .select('event_data')
        .eq('lead_id', job.lead_id)
        .eq('event_type', 'replied')
        .order('created_at', { ascending: false })
        .limit(20)

      if (!replyEvents || replyEvents.length === 0) {
        // current_block_id already updated above — webhook will re-enqueue when reply arrives
        console.log(`[processor] Condition block ${job.block_id}: aguardando resposta do lead ${job.lead_id}`)
        return
      }

      if (conditionType === 'replied') {
        await enqueueNext(job, 'yes', admin)
        return
      }

      if (conditionType === 'replied_with') {
        const keyword = ((config.replied_with as string) ?? '').trim().toLowerCase()
        const matched = keyword
          ? replyEvents.some((ev) => {
              const text = (((ev.event_data as Record<string, unknown>)?.text) as string ?? '').toLowerCase()
              return text.includes(keyword)
            })
          : true
        await enqueueNext(job, matched ? 'yes' : 'no', admin)
        return
      }

      if (conditionType === 'replied_number') {
        const latestText = (((replyEvents[0].event_data as Record<string, unknown>)?.text) as string ?? '')
        const t = latestText.trim().toLowerCase()
        const isYes = t === '1' || t === 'sim' || t === 's' || t.startsWith('1')
        const isNo  = t === '2' || t === 'não' || t === 'nao' || t === 'n' || t.startsWith('2')
        if (!isYes && !isNo) {
          // Unrecognized — wait for next reply
          console.log(`[processor] Condition replied_number: resposta "${latestText}" não reconhecida — aguardando`)
          return
        }
        await enqueueNext(job, isYes ? 'yes' : 'no', admin)
        return
      }
    }

    const { data: events } = await admin.from('lead_events').select('event_type, event_data').eq('lead_id', job.lead_id)
    const eventList = events ?? []
    const eventTypes = eventList.map((e: { event_type: string }) => e.event_type)

    let matched = false
    if (conditionType === 'opened') matched = eventTypes.includes('message_opened')
    else if (conditionType === 'clicked') matched = eventTypes.includes('message_clicked')
    else if (conditionType === 'purchased') matched = eventTypes.includes('purchased')
    else if (conditionType === 'page_visited') matched = eventTypes.includes('page_viewed')
    else if (conditionType === 'form_submitted') matched = eventTypes.includes('form_submitted')
    else if (conditionType === 'button_clicked') matched = eventTypes.includes('button_clicked')
    else if (conditionType === 'video_watched') {
      matched = eventList.some((e: { event_type: string; event_data: unknown }) =>
        e.event_type === 'video_progress' && ((e.event_data as Record<string, unknown>)?.percent as number ?? 0) >= 50
      )
    }
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
    const productName = (config.product_name as string) ?? 'nosso produto'
    const saleMessage = (config.sale_message as string) ?? ''
    const firstName = lead.name?.split(' ')[0] ?? 'Olá'

    let message = saleMessage.trim()
      || (paymentLink ? `Olá ${firstName}! Aqui está o link para adquirir ${productName}: ${paymentLink}` : '')
    // If custom message exists and has {link} placeholder, replace it; otherwise append link at end
    if (message && paymentLink) {
      if (message.includes('{link}')) {
        message = message.replace(/{link}/g, paymentLink)
      } else if (!message.includes(paymentLink)) {
        message = `${message}\n\n🔗 ${paymentLink}`
      }
    }

    if (message) {
      if (lead.phone) {
        const { data: funnel } = await admin.from('funnels').select('whatsapp_instance_id').eq('id', job.funnel_id).single()
        if (funnel?.whatsapp_instance_id) {
          const { data: instance } = await admin.from('whatsapp_instances').select('instance_name').eq('id', funnel.whatsapp_instance_id).single()
          if (instance?.instance_name) {
            await sendTextMessage(instance.instance_name, lead.phone, interpolateMessage(message, lead))
          }
        }
      } else if (lead.email) {
        await sendEmail({
          from: 'FunilPro <noreply@funil.pro>',
          to: lead.email,
          subject: `Seu link para ${productName}`,
          html: `<p>${interpolateMessage(message, lead)}</p>`,
        })
      }
    }

    await admin.from('lead_events').insert({
      tenant_id: job.tenant_id, lead_id: job.lead_id, funnel_id: job.funnel_id,
      block_id: job.block_id, event_type: 'sale_link_sent', event_data: { payment_link: paymentLink }
    })

    await enqueueNext(job, 'default', admin)
  }

  else if (block.block_type === 'page' || block.block_type === 'funnel_page') {
    const pageConfig = config as { page_id?: string; message?: string }
    const pageId = pageConfig.page_id
    if (!pageId) {
      await enqueueNext(job, 'default', admin)
      return
    }

    const { data: page } = await admin.from('pages').select('slug, title').eq('id', pageId).single()
    if (!page?.slug) {
      console.warn(`[processor] Page block ${job.block_id}: página ${pageId} não encontrada ou sem slug`)
      await enqueueNext(job, 'default', admin)
      return
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://funil-pro.vercel.app'
    const pageUrl = `${appUrl}/pg/${page.slug}?lid=${job.lead_id}`

    const firstName = lead.name?.split(' ')[0] ?? ''
    let msg = (pageConfig.message ?? `Acesse sua página exclusiva: {link}`).trim()
    msg = msg
      .replace(/{nome}/g, lead.name ?? '')
      .replace(/{primeiro_nome}/g, firstName)
      .replace(/{email}/g, lead.email ?? '')
      .replace(/{telefone}/g, lead.phone ?? '')
      .replace(/{link}/g, pageUrl)
    if (!msg.includes(pageUrl)) msg = `${msg}\n\n${pageUrl}`

    const { data: funnel } = await admin.from('funnels').select('whatsapp_instance_id').eq('id', job.funnel_id).single()
    const instanceId = funnel?.whatsapp_instance_id ?? null
    if (instanceId) {
      const { data: waInstance } = await admin.from('whatsapp_instances').select('instance_name').eq('id', instanceId).single()
      if (lead.phone && waInstance?.instance_name) {
        await sendTextMessage(waInstance.instance_name, lead.phone, msg).catch(console.error)
      }
    }

    await admin.from('lead_events').insert({
      tenant_id: job.tenant_id, lead_id: job.lead_id,
      funnel_id: job.funnel_id, block_id: job.block_id,
      event_type: 'page_link_sent', event_data: { page_id: pageId, page_url: pageUrl, page_title: page.title }
    })

    await enqueueNext(job, 'default', admin)
  }

  else if (block.block_type === 'ab_test') {
    const percentA = (config.percent_a as number) ?? 50
    const rand = Math.random() * 100
    const variant = rand < percentA ? 'a' : 'b'

    await admin.from('lead_events').insert({
      tenant_id: job.tenant_id, lead_id: job.lead_id, funnel_id: job.funnel_id,
      block_id: job.block_id, event_type: 'ab_test_assigned', event_data: { variant, percent_a: percentA }
    })

    await enqueueNext(job, variant, admin)
  }
}

function interpolateMessage(
  text: string,
  lead: { name?: string | null; phone?: string | null; email?: string | null }
): string {
  const firstName = lead.name?.split(' ')[0] ?? ''
  const now = new Date()
  return text
    .replace(/{nome}/g, lead.name ?? '')
    .replace(/{primeiro_nome}/g, firstName)
    .replace(/{email}/g, lead.email ?? '')
    .replace(/{telefone}/g, lead.phone ?? '')
    .replace(/{data}/g, now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
    .replace(/{hora}/g, now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }))
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
