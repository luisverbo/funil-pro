import { NextRequest, NextResponse } from 'next/server'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const { instanceId } = await params
  const body = await request.json()
  console.log(`Evolution webhook for instance ${instanceId}:`, body)
  // TODO: classify message, route to funnel, activate agent if needed
  return NextResponse.json({ received: true })
}
