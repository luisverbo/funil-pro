import { createAdminClient } from '@/lib/supabase/admin'

interface AbandonedCartData {
  tenantId: string
  platform: string
  buyerEmail: string | null
  buyerPhone: string | null
  buyerName: string | null
  productName: string | null
  rawPayload: unknown
}

export async function handleAbandonedCart(data: AbandonedCartData): Promise<{ leadId: string; isNew: boolean }> {
  const admin = createAdminClient()

  let lead: { id: string; funnel_id: string; current_block_id: string | null } | null = null
  if (data.buyerEmail) {
    const { data: found } = await admin
      .from('leads')
      .select('id, funnel_id, current_block_id')
      .eq('tenant_id', data.tenantId)
      .eq('email', data.buyerEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    lead = found ?? null
  }

  let isNew = false

  if (!lead) {
    const { data: cartBlocks } = await admin
      .from('funnel_blocks')
      .select('id, funnel_id, config')
      .eq('block_type', 'cart_abandoned')
      .limit(10)

    const matchingBlock = (cartBlocks as Array<{ id: string; funnel_id: string; config?: Record<string, unknown> }> | null)?.find((b) => {
      const platform = b.config?.platform as string | undefined
      return !platform || platform === 'all' || platform === data.platform
    })

    const funnelId = matchingBlock?.funnel_id ?? null

    if (!funnelId) {
      await admin.from('orphan_purchases').insert({
        tenant_id: data.tenantId,
        platform: data.platform,
        event_type: 'abandoned_cart',
        buyer_email: data.buyerEmail,
        buyer_phone: data.buyerPhone,
        buyer_name: data.buyerName,
        product_name: data.productName,
        revenue_cents: 0,
        raw_payload: data.rawPayload,
      })
      return { leadId: '', isNew: false }
    }

    const { data: newLead } = await admin
      .from('leads')
      .insert({
        tenant_id: data.tenantId,
        funnel_id: funnelId,
        name: data.buyerName ?? 'Desconhecido',
        email: data.buyerEmail,
        phone: data.buyerPhone,
        status: 'active',
        current_block_id: matchingBlock?.id ?? null,
      })
      .select('id, funnel_id, current_block_id')
      .single()

    if (!newLead) return { leadId: '', isNew: false }
    lead = newLead
    isNew = true

    try {
      await admin.from('lead_sources').insert({ lead_id: newLead.id, utm_source: data.platform })
    } catch (_) { /* ignore */ }

    // Enqueue first block via queue_jobs (picked up by cron /api/queue/process)
    if (matchingBlock?.id) {
      const { data: nextEdge } = await admin
        .from('funnel_edges')
        .select('target_block_id')
        .eq('source_block_id', matchingBlock.id)
        .eq('condition', 'default')
        .single()

      if (nextEdge?.target_block_id) {
        await admin.from('queue_jobs').insert({
          tenant_id: data.tenantId,
          lead_id: newLead.id,
          funnel_id: funnelId,
          block_id: nextEdge.target_block_id,
          status: 'pending',
          scheduled_for: new Date().toISOString(),
        })
      }
    }
  }

  await admin.from('lead_events').insert({
    tenant_id: data.tenantId,
    lead_id: lead.id,
    funnel_id: lead.funnel_id,
    block_id: lead.current_block_id,
    event_type: 'cart_abandoned',
    event_data: { product_name: data.productName, platform: data.platform },
    platform: data.platform,
  })

  return { leadId: lead.id, isNew }
}

interface PurchaseData {
  tenantId: string
  platform: string
  buyerEmail: string | null
  buyerPhone: string | null
  buyerName: string | null
  productName: string | null
  productIdExternal?: string | null
  revenueCents: number
  eventType: 'purchased' | 'refunded' | 'chargeback' | 'canceled'
  rawPayload: unknown
}

export async function handlePurchaseWebhook(data: PurchaseData): Promise<{ handled: boolean; leadId?: string }> {
  const admin = createAdminClient()

  const phoneNorm = data.buyerPhone?.replace(/\D/g, '') ?? null

  let lead: { id: string; funnel_id: string; current_block_id: string | null } | null = null

  if (data.buyerEmail) {
    const { data: byEmail } = await admin
      .from('leads')
      .select('id, funnel_id, current_block_id')
      .eq('tenant_id', data.tenantId)
      .eq('email', data.buyerEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    lead = byEmail ?? null
  }

  if (!lead && phoneNorm) {
    const { data: rows } = await admin
      .from('leads')
      .select('id, funnel_id, current_block_id, phone')
      .eq('tenant_id', data.tenantId)
      .order('created_at', { ascending: false })
      .limit(50)
    lead = rows?.find((r: { id: string; funnel_id: string; current_block_id: string | null; phone?: string | null }) =>
      r.phone?.replace(/\D/g, '').endsWith(phoneNorm.slice(-8))
    ) ?? null
  }

  if (!lead) {
    if (data.eventType === 'purchased' && data.productIdExternal) {
      await activateProductTriggerFunnel({
        admin,
        tenantId: data.tenantId,
        platform: data.platform,
        productIdExternal: data.productIdExternal,
        triggerEvent: 'purchase',
        buyerEmail: data.buyerEmail,
        buyerPhone: data.buyerPhone,
        buyerName: data.buyerName,
        productName: data.productName,
        revenueCents: data.revenueCents,
        rawPayload: data.rawPayload,
      })
      return { handled: true }
    }

    await admin.from('orphan_purchases').insert({
      tenant_id: data.tenantId,
      platform: data.platform,
      buyer_email: data.buyerEmail,
      buyer_phone: data.buyerPhone,
      buyer_name: data.buyerName,
      product_name: data.productName,
      revenue_cents: data.revenueCents,
      raw_payload: data.rawPayload,
    })
    return { handled: false }
  }

  await admin.from('lead_events').insert({
    tenant_id: data.tenantId,
    lead_id: lead.id,
    funnel_id: lead.funnel_id,
    block_id: lead.current_block_id,
    event_type: data.eventType === 'purchased' ? 'purchased' : `payment_${data.eventType}`,
    event_data: { product_name: data.productName, revenue_cents: data.revenueCents },
    platform: data.platform,
    revenue_cents: data.eventType === 'purchased' ? data.revenueCents : 0,
    product_name: data.productName,
  })

  if (data.eventType === 'purchased') {
    await admin.from('leads').update({ status: 'converted' }).eq('id', lead.id)

    if (lead.current_block_id) {
      await admin.from('queue_jobs').insert({
        tenant_id: data.tenantId,
        lead_id: lead.id,
        funnel_id: lead.funnel_id,
        block_id: lead.current_block_id,
        status: 'pending',
        scheduled_for: new Date().toISOString(),
      })
    }
  }

  return { handled: true, leadId: lead.id }
}

interface TriggerCtx {
  admin: ReturnType<typeof createAdminClient>
  tenantId: string
  platform: string
  productIdExternal: string
  triggerEvent: 'purchase' | 'abandoned_cart'
  buyerEmail: string | null
  buyerPhone: string | null
  buyerName: string | null
  productName: string | null
  revenueCents: number
  rawPayload: unknown
}

async function activateProductTriggerFunnel(ctx: TriggerCtx) {
  const { admin } = ctx

  const { data: product } = await admin
    .from('products')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('platform', ctx.platform)
    .eq('product_id_external', ctx.productIdExternal)
    .single()

  if (!product) return

  const { data: triggers } = await admin
    .from('funnel_product_triggers')
    .select('funnel_id, funnel:funnels(id, status, whatsapp_instance_id)')
    .eq('tenant_id', ctx.tenantId)
    .eq('product_id', product.id)
    .eq('trigger_event', ctx.triggerEvent)
    .eq('is_active', true)

  if (!triggers || triggers.length === 0) return

  for (const trigger of triggers) {
    const funnelData = (trigger.funnel as unknown) as { id: string; status: string } | null
    if (!funnelData || funnelData.status !== 'published') continue

    const funnelId = trigger.funnel_id as string

    const { data: firstBlock } = await admin
      .from('funnel_blocks')
      .select('id')
      .eq('funnel_id', funnelId)
      .eq('block_type', 'entry')
      .single()

    const { data: startEdge } = await admin
      .from('funnel_edges')
      .select('target_block_id')
      .eq('funnel_id', funnelId)
      .eq('source_block_id', firstBlock?.id ?? '')
      .eq('condition', 'default')
      .single()

    const startBlockId = startEdge?.target_block_id ?? firstBlock?.id
    if (!startBlockId) continue

    const { data: newLead } = await admin
      .from('leads')
      .insert({
        tenant_id: ctx.tenantId,
        funnel_id: funnelId,
        name: ctx.buyerName ?? 'Comprador',
        email: ctx.buyerEmail,
        phone: ctx.buyerPhone,
        status: 'active',
        current_block_id: startBlockId,
      })
      .select('id')
      .single()

    if (!newLead) continue

    if (ctx.buyerEmail) {
      try { await admin.from('lead_sources').insert({ lead_id: newLead.id, utm_source: ctx.platform }) } catch { /* ignore */ }
    }

    await admin.from('lead_events').insert({
      tenant_id: ctx.tenantId,
      lead_id: newLead.id,
      funnel_id: funnelId,
      block_id: startBlockId,
      event_type: ctx.triggerEvent === 'purchase' ? 'purchased' : 'cart_abandoned',
      event_data: { product_name: ctx.productName, revenue_cents: ctx.revenueCents },
      platform: ctx.platform,
      revenue_cents: ctx.triggerEvent === 'purchase' ? ctx.revenueCents : 0,
      product_name: ctx.productName,
    })

    await admin.from('queue_jobs').insert({
      tenant_id: ctx.tenantId,
      lead_id: newLead.id,
      funnel_id: funnelId,
      block_id: startBlockId,
      status: 'pending',
      scheduled_for: new Date().toISOString(),
    })
  }
}
