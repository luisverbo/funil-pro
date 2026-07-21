import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processJob } from '@/lib/queue/processor'

export async function POST(request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params

  try {
    const body = await request.json()
    const { answers, leadData, result_profile, funnel_id } = body as {
      answers: Record<string, unknown>
      leadData: { name?: string; email?: string; phone?: string }
      result_profile: string | null
      funnel_id: string | null
    }

    const admin = createAdminClient()

    // SEGURANÇA: o tenant é derivado da própria página (server-side), NUNCA do body.
    // Isso impede que um visitante forje um tenantId e escreva em outro tenant.
    const { data: page } = await admin
      .from('pages')
      .select('tenant_id, published, quiz_data')
      .eq('id', pageId)
      .single()
    if (!page || !page.published) {
      return NextResponse.json({ success: false, error: 'page_not_found' }, { status: 404 })
    }
    const tenantId: string = page.tenant_id

    // SEGURANÇA: só aceita funnel_id que está de fato configurado neste quiz
    // (antes um visitante podia disparar QUALQUER funil do tenant via body forjado)
    let safeFunnelId: string | null = null
    if (funnel_id) {
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
      if (configured.has(funnel_id)) safeFunnelId = funnel_id
    }

    // Find or create lead
    let leadId: string | null = null

    if (leadData.phone || leadData.email) {
      const query = admin.from('leads').select('id').eq('tenant_id', tenantId)
      if (leadData.phone) query.eq('phone', leadData.phone)
      else if (leadData.email) query.eq('email', leadData.email)
      const { data: existing } = await query.limit(1).maybeSingle()

      if (existing) {
        leadId = existing.id
        await admin.from('leads').update({
          name: leadData.name ?? undefined,
          email: leadData.email ?? undefined,
          phone: leadData.phone ?? undefined,
          metadata: answers,
        }).eq('id', leadId)
      } else {
        const { data: newLead } = await admin.from('leads').insert({
          tenant_id: tenantId,
          funnel_id: null,
          name: leadData.name ?? null,
          email: leadData.email ?? null,
          phone: leadData.phone ?? null,
          status: 'active',
          metadata: answers,
        }).select('id').single()
        leadId = newLead?.id ?? null
      }
    }

    // Save response
    const { data: responseRow } = await admin.from('interactive_responses').insert({
      page_id: pageId,
      lead_id: leadId,
      tenant_id: tenantId,
      answers,
      result_profile: result_profile ?? null,
      completed: true,
      completed_at: new Date().toISOString(),
    }).select('id').single()

    // Record event
    if (leadId) {
      await admin.from('lead_events').insert({
        tenant_id: tenantId,
        lead_id: leadId,
        event_type: 'quiz_completed',
        event_data: { page_id: pageId, result_profile, response_id: responseRow?.id },
      })
    }

    // Activate funnel if configured
    if (leadId && safeFunnelId) {
      const funnel_id = safeFunnelId
      const { data: allBlocks } = await admin.from('funnel_blocks').select('id, block_type').eq('funnel_id', funnel_id).eq('tenant_id', tenantId)
      const { data: allEdges } = await admin.from('funnel_edges').select('target_block_id').eq('funnel_id', funnel_id)
      const targetIds = new Set((allEdges ?? []).map((e: { target_block_id: string }) => e.target_block_id))
      const roots = (allBlocks ?? []).filter((b: { id: string; block_type: string }) => !targetIds.has(b.id))
      const firstBlock = roots.find((b: { id: string; block_type: string }) => b.block_type === 'entry') ?? roots[0] ?? (allBlocks ?? [])[0]

      if (firstBlock) {
        await admin.from('leads').update({ funnel_id, status: 'active' }).eq('id', leadId)
        const { data: job } = await admin.from('queue_jobs').insert({
          tenant_id: tenantId,
          lead_id: leadId,
          funnel_id,
          block_id: firstBlock.id,
          status: 'pending',
          scheduled_for: new Date().toISOString(),
        }).select('id').single()

        // Fire immediately — no need to wait for cron
        if (job?.id) {
          processJob({
            id: job.id,
            tenant_id: tenantId,
            lead_id: leadId,
            funnel_id,
            block_id: firstBlock.id,
            status: 'pending',
            scheduled_for: new Date().toISOString(),
            attempts: 0,
          }).catch(err => console.error('[quiz/submit] processJob error:', err))
        }
      }
    }

    // Update conversions count (RPC atômico — antes passava um query-builder como valor e nunca contava)
    await admin.rpc('increment_page_conversions', { p_page_id: pageId })

    return NextResponse.json({ success: true, lead_id: leadId })
  } catch (err) {
    console.error('[quiz/submit]', err)
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
