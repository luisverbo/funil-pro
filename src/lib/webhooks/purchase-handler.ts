import { createAdminClient } from '@/lib/supabase/admin'
import { funnelQueue } from '@/lib/queue'

function getFunnelQueue() { return funnelQueue }

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
      await admin.from('lead_sources').insert({
        lead_id: newLead.id,
        utm_source: data.platform,
      })
    } catch (_) { /* ignore */ }

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
  /** Extra products for order bump / upsell detection */
  extraProducts?: Array<{ name: string; revenueCents: number; type?: string }>
}

export async function handlePurchaseWebhook(data: PurchaseData): Promise<{ handled: boolean; leadId?: string }> {
  const admin = createAdminClient()

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

  // Case C — lead does NOT exist: create lead with direct attribution
  if (!lead) {
    const { data: newLead } = await admin
      .from('leads')
      .insert({
        tenant_id: data.tenantId,
        funnel_id: null,
        name: data.buyerName ?? 'Desconhecido',
        email: data.buyerEmail,
        phone: data.buyerPhone,
        status: data.eventType === 'purchased' ? 'converted' : 'active',
      })
      .select('id')
      .single()

    if (!newLead) {
      // Can't create lead — save as orphan
      await admin.from('orphan_purchases').insert({
        tenant_id: data.tenantId,
        platform: data.platform,
        event_type: 'purchase',
        buyer_email: data.buyerEmail,
        buyer_phone: data.buyerPhone,
        buyer_name: data.buyerName,
        product_name: data.productName,
        revenue_cents: data.revenueCents,
        raw_payload: data.rawPayload,
      })
      return { handled: false }
    }

    // Create lead_source with platform as source
    try {
      await admin.from('lead_sources').insert({
        lead_id: newLead.id,
        utm_source: data.platform,
      })
    } catch (_) { /* ignore */ }

    // Record purchase event with direct_purchase attribution
    await admin.from('lead_events').insert({
      tenant_id: data.tenantId,
      lead_id: newLead.id,
      funnel_id: null,
      block_id: null,
      event_type: data.eventType === 'purchased' ? 'purchased' : `payment_${data.eventType}`,
      event_data: {
        product_name: data.productName,
        revenue_cents: data.revenueCents,
        within_funnel: false,
        attribution: 'direct_purchase',
      },
      platform: data.platform,
      revenue_cents: data.eventType === 'purchased' ? data.revenueCents : 0,
      product_name: data.productName,
    })

    // Save to orphan_purchases for visibility
    await admin.from('orphan_purchases').insert({
      tenant_id: data.tenantId,
      platform: data.platform,
      event_type: 'purchase',
      buyer_email: data.buyerEmail,
      buyer_phone: data.buyerPhone,
      buyer_name: data.buyerName,
      product_name: data.productName,
      revenue_cents: data.revenueCents,
      raw_payload: data.rawPayload,
    })

    // Record extra products (order bumps / upsells)
    if (data.extraProducts && data.extraProducts.length > 0) {
      for (const extra of data.extraProducts) {
        const extraEventType = extra.type === 'upsell' ? 'purchased_upsell' : 'purchased_order_bump'
        await admin.from('lead_events').insert({
          tenant_id: data.tenantId,
          lead_id: newLead.id,
          funnel_id: null,
          block_id: null,
          event_type: extraEventType,
          event_data: {
            product_name: extra.name,
            revenue_cents: extra.revenueCents,
            within_funnel: false,
            attribution: 'direct_purchase',
            is_order_bump: extraEventType === 'purchased_order_bump',
          },
          platform: data.platform,
          revenue_cents: extra.revenueCents,
          product_name: extra.name,
        })
      }
    }

    return { handled: false, leadId: newLead.id }
  }

  // Lead exists — determine attribution
  const { data: leadSource } = await admin
    .from('lead_sources')
    .select('utm_campaign_id, utm_ad_id, utm_source')
    .eq('lead_id', lead.id)
    .single()

  const hasPaidAd = !!(leadSource?.utm_campaign_id || leadSource?.utm_ad_id)
  const attribution = hasPaidAd ? 'paid_ad' : 'organic'
  const withinFunnel = hasPaidAd

  // Check products table for order bump / upsell type
  let productType = 'main'
  if (data.productName) {
    const { data: productRecord } = await admin
      .from('products')
      .select('type')
      .eq('tenant_id', data.tenantId)
      .eq('platform', data.platform)
      .ilike('name', data.productName)
      .maybeSingle()
    productType = productRecord?.type ?? 'main'
  }

  const mainEventType = data.eventType === 'purchased'
    ? (productType === 'order_bump' ? 'purchased_order_bump' : productType === 'upsell' ? 'purchased_upsell' : 'purchased')
    : `payment_${data.eventType}`

  // Record lead event with attribution
  await admin.from('lead_events').insert({
    tenant_id: data.tenantId,
    lead_id: lead.id,
    funnel_id: lead.funnel_id,
    block_id: lead.current_block_id,
    event_type: mainEventType,
    event_data: {
      product_name: data.productName,
      revenue_cents: data.revenueCents,
      within_funnel: withinFunnel,
      attribution,
      utm_ad_id: leadSource?.utm_ad_id ?? null,
      utm_campaign_id: leadSource?.utm_campaign_id ?? null,
    },
    platform: data.platform,
    revenue_cents: data.eventType === 'purchased' ? data.revenueCents : 0,
    product_name: data.productName,
  })

  // Record extra products (order bumps / upsells)
  if (data.extraProducts && data.extraProducts.length > 0) {
    for (const extra of data.extraProducts) {
      // Check products table for type
      let extraType = extra.type ?? 'order_bump'
      if (!extra.type && extra.name) {
        const { data: extraProduct } = await admin
          .from('products')
          .select('type')
          .eq('tenant_id', data.tenantId)
          .eq('platform', data.platform)
          .ilike('name', extra.name)
          .maybeSingle()
        extraType = extraProduct?.type ?? 'order_bump'
      }
      const extraEventType = extraType === 'upsell' ? 'purchased_upsell' : 'purchased_order_bump'
      await admin.from('lead_events').insert({
        tenant_id: data.tenantId,
        lead_id: lead.id,
        funnel_id: lead.funnel_id,
        block_id: lead.current_block_id,
        event_type: extraEventType,
        event_data: {
          product_name: extra.name,
          revenue_cents: extra.revenueCents,
          within_funnel: withinFunnel,
          attribution,
          is_order_bump: extraEventType === 'purchased_order_bump',
        },
        platform: data.platform,
        revenue_cents: extra.revenueCents,
        product_name: extra.name,
      })
    }
  }

  // If purchased, update lead status and advance funnel
  if (data.eventType === 'purchased') {
    await admin.from('leads').update({ status: 'converted' }).eq('id', lead.id)

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
