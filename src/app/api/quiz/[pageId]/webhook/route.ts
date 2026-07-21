import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const { pageId } = await params
    const { blockId, leadId, url, payload } = await req.json()
    const admin = createAdminClient()

    // Verify page exists and is published
    const { data: page } = await admin.from('pages').select('id, tenant_id, published, quiz_data').eq('id', pageId).single()
    if (!page || !page.published) return NextResponse.json({ error: 'not found' }, { status: 404 })

    // ANTI-SSRF: só dispara URLs que estão de fato configuradas nos blocos deste
    // quiz — nunca uma URL vinda do body do visitante
    const configured = new Set<string>()
    const collect = (o: unknown) => {
      if (Array.isArray(o)) { o.forEach(collect); return }
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          if (k === 'webhook_url' && typeof v === 'string' && v.startsWith('http')) configured.add(v)
          else collect(v)
        }
      }
    }
    collect(page.quiz_data)
    if (!configured.has(String(url))) {
      return NextResponse.json({ error: 'webhook não configurado neste quiz' }, { status: 403 })
    }

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
