import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const { pageId } = await params
    const { blockId, leadId, url, payload } = await req.json()
    const admin = createAdminClient()

    // Verify page exists
    const { data: page } = await admin.from('pages').select('id, tenant_id').eq('id', pageId).single()
    if (!page) return NextResponse.json({ error: 'not found' }, { status: 404 })

    // Fire webhook
    let statusCode: number | null = null
    let success = false
    let error: string | undefined

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      })
      statusCode = res.status
      success = res.ok
    } catch (err) {
      error = String(err)
    }

    // Log attempt
    await admin.from('quiz_webhook_logs').insert({
      quiz_id: pageId,
      lead_id: leadId || null,
      block_id: blockId,
      url,
      status_code: statusCode,
      success,
      error: error || null,
    })

    return NextResponse.json({ success, statusCode })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
