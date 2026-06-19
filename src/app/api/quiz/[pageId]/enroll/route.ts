import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const { pageId } = await params
    const { funnelId, phone, name, email } = await req.json()
    if (!funnelId || !phone) return NextResponse.json({ error: 'funnelId and phone required' }, { status: 400 })

    const admin = createAdminClient()

    // Verify funnel is published and belongs to same tenant as the quiz page
    const { data: page } = await admin.from('pages').select('tenant_id').eq('id', pageId).single()
    if (!page) return NextResponse.json({ error: 'page not found' }, { status: 404 })

    const { data: funnel } = await admin.from('funnels').select('id, tenant_id, status').eq('id', funnelId).single()
    if (!funnel || funnel.tenant_id !== page.tenant_id || funnel.status !== 'published') {
      return NextResponse.json({ error: 'funnel not found or not published' }, { status: 404 })
    }

    // Call the internal activate logic
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const res = await fetch(`${baseUrl}/api/funnels/${funnelId}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name: name || 'Lead', email }),
    })

    const result = await res.json()
    return NextResponse.json(result, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
