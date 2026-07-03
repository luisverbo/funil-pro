import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processAgentMessage } from '@/lib/agents/chat'

export const maxDuration = 60

interface PublicChatBody {
  message: string
  conversationId?: string
  leadData?: { name?: string; email?: string; phone?: string }
  utm?: Record<string, string>
  landingUrl?: string
}

// Rate limit simples em memória por conversa (best-effort; reinicia a cada cold start)
const hits = new Map<string, { count: number; ts: number }>()
function rateLimited(key: string): boolean {
  const now = Date.now()
  const rec = hits.get(key)
  if (!rec || now - rec.ts > 60_000) { hits.set(key, { count: 1, ts: now }); return false }
  rec.count++
  return rec.count > 20   // máx 20 msg/min por conversa
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    const body = (await request.json()) as PublicChatBody
    const { message, conversationId, leadData, utm, landingUrl } = body

    if (!message?.trim()) return NextResponse.json({ error: 'message obrigatória' }, { status: 400 })

    const admin = createAdminClient()

    // Resolve agente pelo slug público — NUNCA aceita agentId/tenantId do cliente
    const { data: agent } = await admin
      .from('ai_agents')
      .select('id, tenant_id, public_enabled, payment_link')
      .eq('public_slug', slug)
      .maybeSingle()
    if (!agent || !agent.public_enabled) {
      return NextResponse.json({ error: 'agent_unavailable' }, { status: 404 })
    }

    if (rateLimited(conversationId || request.headers.get('x-forwarded-for') || slug)) {
      return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
    }

    // Cria/atualiza lead quando o visitante envia dados de captura
    let leadId: string | undefined
    if (leadData && (leadData.email || leadData.phone)) {
      const q = admin.from('leads').select('id').eq('tenant_id', agent.tenant_id)
      if (leadData.phone) q.eq('phone', leadData.phone)
      else if (leadData.email) q.eq('email', leadData.email)
      const { data: existing } = await q.limit(1).maybeSingle()
      if (existing) {
        leadId = existing.id
        await admin.from('leads').update({
          name: leadData.name ?? undefined,
          email: leadData.email ?? undefined,
          phone: leadData.phone ?? undefined,
        }).eq('id', existing.id)
      } else {
        const { data: newLead } = await admin.from('leads').insert({
          tenant_id: agent.tenant_id,
          funnel_id: null,
          name: leadData.name ?? null,
          email: leadData.email ?? null,
          phone: leadData.phone ?? null,
          status: 'active',
        }).select('id').single()
        leadId = newLead?.id
        // Grava origem (UTMs) — imutável
        if (leadId && (utm || landingUrl)) {
          await admin.from('lead_sources').insert({
            lead_id: leadId,
            utm_source: utm?.utm_source ?? null,
            utm_campaign: utm?.utm_campaign ?? null,
            utm_campaign_id: utm?.utm_campaign_id ?? null,
            utm_adset_id: utm?.utm_adset_id ?? null,
            utm_ad_id: utm?.utm_ad_id ?? null,
            utm_content: utm?.utm_content ?? null,
            landing_url: landingUrl ?? null,
          }).select('id').maybeSingle()
        }
      }
      // Liga o lead à conversa existente
      if (leadId && conversationId) {
        await admin.from('agent_conversations').update({ lead_id: leadId }).eq('id', conversationId).is('lead_id', null)
      }
    }

    const result = await processAgentMessage(agent.id, message, { conversationId, leadId, channel: 'web' })
    // Injeta o link de pagamento na ação de venda para a landing exibir o botão
    if (result.action?.type === 'sell' && agent.payment_link) {
      result.action.data = { ...result.action.data, payment_link: agent.payment_link }
    }
    return NextResponse.json(result)
  } catch (err) {
    const msg = String(err)
    if (msg.includes('activation_limit_reached')) return NextResponse.json({ error: 'activation_limit_reached' }, { status: 429 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
