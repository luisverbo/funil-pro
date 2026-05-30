import { createAdminClient } from '@/lib/supabase/admin'
import { getFunnelQueue } from '@/lib/queue'

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
