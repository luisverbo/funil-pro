import { NextRequest, NextResponse } from 'next/server'
import { handlePurchaseWebhook } from '@/lib/webhooks/purchase-handler'

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  try {
    const body = await req.json()
    const event = body?.event ?? body?.data?.event

    // Map Hotmart events
    const eventMap: Record<string, 'purchased' | 'refunded' | 'chargeback' | 'canceled'> = {
      PURCHASE_APPROVED: 'purchased',
      PURCHASE_REFUNDED: 'refunded',
      PURCHASE_CHARGEBACK: 'chargeback',
      PURCHASE_CANCELED: 'canceled',
      PURCHASE_COMPLETE: 'purchased',
    }
    const eventType = eventMap[event]
    if (!eventType) return NextResponse.json({ ok: true, skipped: true })

    const buyer = body?.data?.buyer ?? body?.buyer ?? {}
    const purchase = body?.data?.purchase ?? body?.purchase ?? {}
    const product = body?.data?.product ?? body?.product ?? {}

    await handlePurchaseWebhook({
      tenantId,
      platform: 'hotmart',
      buyerEmail: buyer.email ?? null,
      buyerPhone: buyer.checkout_phone ?? buyer.phone ?? null,
      buyerName: buyer.name ?? null,
      productName: product.name ?? purchase.product_name ?? null,
      revenueCents: Math.round((purchase.price?.value ?? purchase.total_value ?? 0) * 100),
      eventType,
      rawPayload: body,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[hotmart webhook]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
