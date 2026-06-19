import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface EvolutionMessageEvent {
  event: string
  instance: string
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean }
    message?: { conversation?: string; extendedTextMessage?: { text?: string } }
    pushName?: string
  }
  state?: string
  qrcode?: { base64?: string }
}

function extractPhone(remoteJid: string): string {
  return remoteJid.replace(/@.*$/, '').replace(/\D/g, '')
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const { instanceId } = await params

  let body: EvolutionMessageEvent
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ received: true })
  }

  const admin = createAdminClient()

  if (body.event === 'CONNECTION_UPDATE' || body.state) {
    const state = body.state ?? ((body as unknown as Record<string, unknown>)?.['data.state'] as string | undefined)
    if (state) {
      const dbStatus = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
      await admin.from('whatsapp_instances').update({ status: dbStatus }).eq('id', instanceId)
    }
    return NextResponse.json({ received: true })
  }

  if (body.event === 'QRCODE_UPDATED') {
    return NextResponse.json({ received: true })
  }

  if (body.event !== 'MESSAGES_UPSERT' && body.event !== 'messages.upsert') {
    return NextResponse.json({ received: true })
  }

  const messageData = body.data
  if (!messageData?.key?.remoteJid || messageData.key.fromMe) {
    return NextResponse.json({ received: true })
  }

  const senderPhone = extractPhone(messageData.key.remoteJid)
  const messageText = messageData.message?.conversation ?? messageData.message?.extendedTextMessage?.text ?? ''

  if (!senderPhone) return NextResponse.json({ received: true })

  const { data: waInstance } = await admin
    .from('whatsapp_instances')
    .select('id, tenant_id')
    .eq('id', instanceId)
    .single()

  if (!waInstance) return NextResponse.json({ received: true })

  const tenantId = waInstance.tenant_id

  // Evolution delivers phone with country code (e.g. 5511999999999)
  // but leads may be stored without it (11999999999) — try both
  const phoneWithoutCode = senderPhone.startsWith('55') ? senderPhone.slice(2) : senderPhone

  const { data: lead } = await admin
    .from('leads')
    .select('id, funnel_id, current_block_id, status, name, agent_active, funnel_resume_block_id')
    .eq('tenant_id', tenantId)
    .or(`phone.eq.${senderPhone},phone.eq.${phoneWithoutCode}`)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!lead) {
    console.log(`[webhook/evolution] Mensagem de número desconhecido: ${senderPhone} / ${phoneWithoutCode}`)
    return NextResponse.json({ received: true })
  }

  // Record replied event
  await admin.from('lead_events').insert({
    tenant_id: tenantId,
    lead_id: lead.id,
    funnel_id: lead.funnel_id,
    block_id: lead.current_block_id,
    event_type: 'replied',
    event_data: { text: messageText, phone: senderPhone },
  })

  // If lead has an active AI agent, route message to the agent
  if ((lead as Record<string, unknown>).agent_active && (lead as Record<string, unknown>).funnel_resume_block_id) {
    const { data: agentBlock } = await admin
      .from('funnel_blocks')
      .select('id, config')
      .eq('id', (lead as Record<string, unknown>).funnel_resume_block_id as string)
      .single()

    const agentId = (agentBlock?.config as Record<string, unknown>)?.agent_id as string | undefined

    if (agentId && messageText) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      fetch(`${baseUrl}/api/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageText, leadId: lead.id }),
      }).catch(() => {})
    }

    return NextResponse.json({ received: true })
  }

  // If lead is paused on a condition block, re-enqueue via queue_jobs (cron picks it up)
  if (lead.current_block_id) {
    const { data: currentBlock } = await admin
      .from('funnel_blocks')
      .select('id, block_type, funnel_id, config')
      .eq('id', lead.current_block_id)
      .single()

    if (currentBlock?.block_type === 'condition') {
      const conditionType = ((currentBlock.config as Record<string, unknown>)?.condition as string) ?? ''
      const isReplyCondition = conditionType === 'replied' || conditionType === 'replied_with' || conditionType === 'replied_number'

      if (isReplyCondition) {
        await admin.from('queue_jobs').insert({
          tenant_id: tenantId,
          lead_id: lead.id,
          funnel_id: lead.funnel_id,
          block_id: currentBlock.id,
          status: 'pending',
          scheduled_for: new Date().toISOString(),
        })
      }
    }
  }

  return NextResponse.json({ received: true })
}
