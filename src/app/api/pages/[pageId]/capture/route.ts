import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { enrollInFunnel } from '@/lib/agents/chat'

// Captura de lead das páginas do editor (Craft). Tenant SEMPRE derivado da página
// (nunca do body). Cria/atualiza o lead, grava origem UTM (imutável), matricula
// no funil da página e conta a conversão.
export async function POST(req: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  try {
    const { pageId } = await params
    const body = await req.json().catch(() => ({}))
    const name = String(body.name ?? '').trim().slice(0, 120)
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 200)
    const phone = String(body.phone ?? '').replace(/\D/g, '').slice(0, 20)
    const utm = (typeof body.utm === 'object' && body.utm) ? body.utm as Record<string, string> : {}

    // validação de verdade no servidor
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    const phoneOk = phone.length >= 10
    if (!emailOk && !phoneOk) {
      return NextResponse.json({ error: 'Informe um e-mail ou WhatsApp válido' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: page } = await admin.from('pages')
      .select('id, tenant_id, funnel_id, published, title')
      .eq('id', pageId).single()
    if (!page || !page.published) return NextResponse.json({ error: 'not found' }, { status: 404 })

    // dedupe por email OU telefone dentro do tenant
    let leadId: string | null = null
    if (emailOk) {
      const { data } = await admin.from('leads').select('id, name')
        .eq('tenant_id', page.tenant_id).eq('email', email).limit(1).maybeSingle()
      if (data) leadId = data.id
    }
    if (!leadId && phoneOk) {
      const { data } = await admin.from('leads').select('id, name')
        .eq('tenant_id', page.tenant_id).eq('phone', phone).limit(1).maybeSingle()
      if (data) leadId = data.id
    }

    if (leadId) {
      await admin.from('leads').update({
        ...(name ? { name } : {}),
        ...(emailOk ? { email } : {}),
        ...(phoneOk ? { phone } : {}),
      }).eq('id', leadId)
    } else {
      const { data: created, error } = await admin.from('leads').insert({
        tenant_id: page.tenant_id,
        funnel_id: page.funnel_id ?? null,
        status: 'active',
        name: name || null,
        email: emailOk ? email : null,
        phone: phoneOk ? phone : null,
        tags: ['pagina'],
        metadata: { source: 'page', page_id: page.id, page_title: page.title },
      }).select('id').single()
      if (error) return NextResponse.json({ error: 'erro ao salvar' }, { status: 500 })
      leadId = created.id
      // origem imutável — só na criação
      await admin.from('lead_sources').insert({
        lead_id: leadId,
        utm_source: utm.utm_source ?? null,
        utm_campaign: utm.utm_campaign ?? null,
        utm_campaign_id: utm.utm_campaign_id ?? null,
        utm_adset_id: utm.utm_adset_id ?? null,
        utm_ad_id: utm.utm_ad_id ?? null,
        utm_content: utm.utm_content ?? null,
        referrer_url: String(body.referrer ?? '').slice(0, 500) || null,
        landing_url: String(body.landing_url ?? '').slice(0, 500) || null,
      }).then(() => {}, () => {})
    }

    await admin.from('lead_events').insert({
      tenant_id: page.tenant_id, lead_id: leadId, funnel_id: page.funnel_id ?? null,
      event_type: 'entered_funnel', platform: 'internal',
      event_data: { via: 'page_capture', page_id: page.id },
    }).then(() => {}, () => {})
    await admin.rpc('increment_page_conversions', { p_page_id: page.id }).then(() => {}, () => {})

    // matricula no funil da página (dispara WhatsApp/e-mail da sequência)
    if (page.funnel_id && leadId) {
      await enrollInFunnel(leadId, page.funnel_id, page.tenant_id, admin).catch(() => {})
    }

    return NextResponse.json({ ok: true, leadId })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
