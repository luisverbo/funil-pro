import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const { pageId } = await params
    const { funnelId, phone, name, email } = await req.json()
    if (!funnelId || !phone) return NextResponse.json({ error: 'funnelId and phone required' }, { status: 400 })

    const admin = createAdminClient()

    // Verify funnel is published and belongs to same tenant as the quiz page
    const { data: page } = await admin.from('pages').select('tenant_id, published, quiz_data').eq('id', pageId).single()
    if (!page || !page.published) return NextResponse.json({ error: 'page not found' }, { status: 404 })

    // SEGURANÇA: o funil precisa estar configurado NESTE quiz (body não manda)
    const configured = new Set<string>()
    const collect = (o: unknown) => {
      if (Array.isArray(o)) { o.forEach(collect); return }
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          if ((k === 'funnel_id' || k === 'target_funnel_id' || k === 'enroll_funnel_id') && typeof v === 'string' && v) configured.add(v)
          else collect(v)
        }
      }
    }
    collect(page.quiz_data)
    if (!configured.has(String(funnelId))) {
      return NextResponse.json({ error: 'funil não configurado neste quiz' }, { status: 403 })
    }

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
