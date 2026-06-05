import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { lead_id, page_id, event_type, event_data } = body

    if (!lead_id || !event_type) {
      return NextResponse.json({ ok: false, error: 'lead_id and event_type are required' })
    }

    const admin = createAdminClient()

    // Get lead to find tenant_id and funnel_id
    const { data: lead } = await admin
      .from('leads')
      .select('tenant_id, funnel_id, current_block_id')
      .eq('id', lead_id)
      .single()

    if (!lead) {
      return NextResponse.json({ ok: false, error: 'lead not found' })
    }

    // Insert into lead_events
    await admin.from('lead_events').insert({
      tenant_id: lead.tenant_id,
      lead_id,
      funnel_id: lead.funnel_id,
      block_id: lead.current_block_id,
      event_type,
      event_data: { page_id, ...event_data },
    })

    // Also insert into page_events if page_id provided
    if (page_id) {
      await admin.from('page_events').insert({
        tenant_id: lead.tenant_id,
        page_id,
        lead_id,
        event_type,
      }).catch(() => {})

      // Increment counters
      if (event_type === 'page_viewed') {
        await admin
          .from('pages')
          .update({ views_count: admin.rpc('coalesce', {}) as never })
          .eq('id', page_id)
          .select('views_count')
          .single()
          .then(async ({ data: p }) => {
            if (p) {
              await admin.from('pages').update({ views_count: (p.views_count ?? 0) + 1 }).eq('id', page_id)
            }
          })
          .catch(() => {})
      }
      if (event_type === 'button_clicked') {
        await admin
          .from('pages')
          .select('clicks_count')
          .eq('id', page_id)
          .single()
          .then(async ({ data: p }) => {
            if (p) {
              await admin.from('pages').update({ clicks_count: (p.clicks_count ?? 0) + 1 }).eq('id', page_id)
            }
          })
          .catch(() => {})
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[track]', err)
    return NextResponse.json({ ok: false, error: 'internal error' }, { status: 500 })
  }
}
