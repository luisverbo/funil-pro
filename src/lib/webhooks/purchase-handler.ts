import { createAdminClient } from '@/lib/supabase/admin'
import { getFunnelQueue } from '@/lib/queue'

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

  // Try to find existing lead by email
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
    // Find a cart_abandoned block for this platform
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
      // No cart funnel configured — save as orphan
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

    // Record minimal lead_source (ignore errors)
    try {
      await admin.from('lead_sources').insert({
        lead_id: newLead.id,
        utm_source: data.platform,
      })
    } catch (_) { /* ignore */ }

    // Enqueue first block after cart_abandoned trigger
    if (matchingBlock?.id) {
      const { data: nextEdge } = await admin
        .from('funnel_edges')
        .select('target_block_id')
        .eq('source_block_id', matchingBlock.id)
        .eq('condition', 'default')
        .single()

      if (nextEdge?.target_block_id) {
        try {
          const queue = getFunnelQueue()
          await queue.add('process-block', {
            leadId: newLead.id,
            blockId: nextEdge.target_block_id,
            funnelId,
            tenantId: data.tenantId,
          }, { delay: 2000 })
        } catch (err) {
          console.warn('[cart-abandoned] Failed to enqueue:', err)
        }
      }
    }
  }

  // Record event
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
  revenueCents: number
  eventType: 'purchased' | 'refunded' | 'chargeback' | 'canceled'
  rawPayload: unknown
}

export async function handlePurchaseWebhook(data: PurchaseData): Promise<{ handled: boolean; leadId?: string }> {
  const admin = createAdminClient()

  // Normalize phone: strip non-digits
  const phoneNorm = data.buyerPhone?.replace(/\D/g, '') ?? null

  // Find lead by email OR phone within this tenant
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
    // Try matching phone with or without country code
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
    // Save as orphan purchase for manual reconciliation
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

  // Record lead event
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

  // If purchased, update lead status and advance funnel
  if (data.eventType === 'purchased') {
    await admin.from('leads').update({ status: 'converted' }).eq('id', lead.id)

    // Advance funnel: enqueue current block again so worker processes condition
    if (lead.current_block_id) {
      try {
        const queue = getFunnelQueue()
        await queue.add('process-block', {
          leadId: lead.id,
          blockId: lead.current_block_id,
          funnelId: lead.funnel_id,
          tenantId: data.tenantId,
        }, { delay: 1000 })
      } catch (err) {
        console.warn('[purchase-handler] Failed to enqueue:', err)
      }
    }
  }

  return { handled: true, leadId: lead.id }
}
