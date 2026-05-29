import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params
  const body = await request.json()
  console.log(`Kiwify webhook for tenant ${tenantId}:`, body)
  // TODO: verify signature, parse event, update lead
  return NextResponse.json({ received: true })
}
