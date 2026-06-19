import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pageId: string }> }
) {
  const { pageId } = await params
  const body = await req.json()
  const admin = createAdminClient()

  try {
    // Get quiz page info (need tenant_id)
    const { data: page } = await admin
      .from('pages')
      .select('id, tenant_id')
      .eq('id', pageId)
      .single()

    if (!page) return NextResponse.json({ error: 'quiz not found' }, { status: 404 })

    const action = body.action as string

    if (action === 'start') {
      const { data: lead, error } = await admin
        .from('quiz_leads')
        .insert({ quiz_id: pageId, tenant_id: page.tenant_id })
        .select('id')
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ leadId: lead.id })
    }

    if (action === 'event') {
      const { leadId, pageId: quizPageId, blockId, eventType, value } = body
      if (!leadId) return NextResponse.json({ error: 'missing leadId' }, { status: 400 })

      await Promise.all([
        admin.from('quiz_lead_events').insert({
          lead_id: leadId,
          quiz_id: pageId,
          tenant_id: page.tenant_id,
          page_id: quizPageId,
          block_id: blockId ?? null,
          event_type: eventType,
          value: value ?? {},
        }),
        admin.from('quiz_leads')
          .update({ last_activity_at: new Date().toISOString(), current_page_id: quizPageId })
          .eq('id', leadId),
      ])
      return NextResponse.json({ ok: true })
    }

    if (action === 'contact') {
      const { leadId, name, email, phone } = body
      if (!leadId) return NextResponse.json({ error: 'missing leadId' }, { status: 400 })

      const patch: Record<string, string> = {}
      if (name)  patch.name  = name
      if (email) patch.email = email
      if (phone) patch.phone = phone

      if (Object.keys(patch).length > 0) {
        await admin.from('quiz_leads').update(patch).eq('id', leadId)
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'complete') {
      const { leadId, score, resultShown } = body
      if (!leadId) return NextResponse.json({ error: 'missing leadId' }, { status: 400 })

      await admin.from('quiz_leads').update({
        status: 'completed',
        score: score ?? 0,
        result_shown: resultShown ?? null,
        last_activity_at: new Date().toISOString(),
      }).eq('id', leadId)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
