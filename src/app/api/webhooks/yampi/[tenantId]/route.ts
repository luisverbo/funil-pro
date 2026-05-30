import { NextRequest, NextResponse } from 'next/server'
import { handlePurchaseWebhook } from '@/lib/webhooks/purchase-handler'

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  try {
    const body = await req.json()
    const event = body?.event ?? body?.type

    const eventMap: Record<string, 'purchased' | 'refunded' | 'chargeback' | 'canceled'> = {
      'order.paid': 'purchased',
      'order.approved': 'purchased',
      'order.canceled': 'canceled',
      'order.refunded': 'refunded',
    }
    const eventType = eventMap[event]
    if (!eventType) return NextResponse.json({ ok: true, skipped: true })

    const order = body?.resource ?? body?.order ?? body
    const customer = order?.customer ?? {}
    const totals = order?.totals ?? {}

    await handlePurchaseWebhook({
      tenantId,
      platform: 'yampi',
      buyerEmail: customer.email ?? null,
      buyerPhone: customer.mobile ?? customer.phone ?? null,
      buyerName: [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null,
      productName: order?.items?.[0]?.name ?? null,
      revenueCents: Math.round((totals?.total ?? order?.total ?? 0) * 100),
      eventType,
      rawPayload: body,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[yampi webhook]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
