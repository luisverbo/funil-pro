import { NextRequest, NextResponse } from 'next/server'
import { handlePurchaseWebhook } from '@/lib/webhooks/purchase-handler'

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  try {
    const body = await req.json()
    const status = body?.key ?? body?.trans_status

    const eventMap: Record<string, 'purchased' | 'refunded' | 'chargeback' | 'canceled'> = {
      sale_approved: 'purchased',
      '3': 'purchased',
      sale_refunded: 'refunded',
      '5': 'refunded',
      sale_chargeback: 'chargeback',
      '6': 'chargeback',
    }
    const eventType = eventMap[status]
    if (!eventType) return NextResponse.json({ ok: true, skipped: true })

    await handlePurchaseWebhook({
      tenantId,
      platform: 'eduzz',
      buyerEmail: body?.client_email ?? body?.cus_email ?? null,
      buyerPhone: body?.client_cel ?? body?.client_phone ?? null,
      buyerName: body?.client_name ?? null,
      productName: body?.product_name ?? null,
      revenueCents: Math.round((body?.sale_amount_win ?? body?.trans_value ?? 0) * 100),
      eventType,
      rawPayload: body,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[eduzz webhook]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
