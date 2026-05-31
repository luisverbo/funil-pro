import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { handlePurchaseWebhook, handleAbandonedCart } from '@/lib/webhooks/purchase-handler'

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  try {
    const body = await req.json()

    // Kiwify sends token in x-kiwify-token header
    const admin = createAdminClient()
    const { data: tenant } = await admin.from('tenants').select('webhook_tokens').eq('id', tenantId).single()
    const expectedToken = (tenant?.webhook_tokens as Record<string, string> | null)?.kiwify
    if (expectedToken) {
      const token = req.headers.get('x-kiwify-token')
      if (!token || token !== expectedToken) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const status = body?.order_status ?? body?.status

    if (status === 'abandoned_checkout' || status === 'abandoned' || body?.event === 'abandoned_checkout') {
      const customer = body?.Customer ?? body?.customer ?? {}
      const product = body?.Product ?? body?.product ?? {}
      await handleAbandonedCart({
        tenantId,
        platform: 'kiwify',
        buyerEmail: customer.email ?? null,
        buyerPhone: customer.mobile ?? customer.phone ?? null,
        buyerName: customer.full_name ?? customer.name ?? null,
        productName: product.name ?? null,
        rawPayload: body,
      })
      return NextResponse.json({ ok: true })
    }

    const eventMap: Record<string, 'purchased' | 'refunded' | 'chargeback' | 'canceled'> = {
      paid: 'purchased',
      order_approved: 'purchased',
      refunded: 'refunded',
      order_refunded: 'refunded',
      chargedback: 'chargeback',
      subscription_canceled: 'canceled',
    }
    const eventType = eventMap[status]
    if (!eventType) return NextResponse.json({ ok: true, skipped: true })

    const customer = body?.Customer ?? body?.customer ?? {}
    const product = body?.Product ?? body?.product ?? {}

    await handlePurchaseWebhook({
      tenantId,
      platform: 'kiwify',
      buyerEmail: customer.email ?? null,
      buyerPhone: customer.mobile ?? customer.phone ?? null,
      buyerName: customer.full_name ?? customer.name ?? null,
      productName: product.name ?? null,
      revenueCents: Math.round((body?.amount ?? body?.order_total ?? 0) * 100),
      eventType,
      rawPayload: body,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[kiwify webhook]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
