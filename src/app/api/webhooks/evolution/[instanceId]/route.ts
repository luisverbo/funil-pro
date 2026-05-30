import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFunnelQueue } from '@/lib/queue'

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
  // remoteJid format: "5511999999999@s.whatsapp.net"
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

  // Handle CONNECTION_UPDATE event — sync status to DB
  if (body.event === 'CONNECTION_UPDATE' || body.state) {
    const state = body.state ?? ((body as unknown as Record<string, unknown>)?.['data.state'] as string | undefined)
    if (state) {
      const dbStatus = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
      await admin.from('whatsapp_instances').update({ status: dbStatus }).eq('id', instanceId)
    }
    return NextResponse.json({ received: true })
  }

  // Handle QRCODE_UPDATED — just acknowledge
  if (body.event === 'QRCODE_UPDATED') {
    return NextResponse.json({ received: true })
  }

  // Handle MESSAGES_UPSERT — incoming message
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

  // Find the whatsapp instance to get tenant_id
  const { data: waInstance } = await admin
    .from('whatsapp_instances')
    .select('id, tenant_id')
    .eq('id', instanceId)
    .single()

  if (!waInstance) return NextResponse.json({ received: true })

  const tenantId = waInstance.tenant_id

  // Find active lead matching this phone number in any active funnel
  const { data: lead } = await admin
    .from('leads')
    .select('id, funnel_id, current_block_id, status, name')
    .eq('tenant_id', tenantId)
    .eq('phone', senderPhone)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!lead) {
    console.log(`[webhook/evolution] Mensagem de número desconhecido: ${senderPhone}`)
    return NextResponse.json({ received: true })
  }

  // Record 'replied' event
  await admin.from('lead_events').insert({
    tenant_id: tenantId,
    lead_id: lead.id,
    funnel_id: lead.funnel_id,
    block_id: lead.current_block_id,
    event_type: 'replied',
    event_data: { text: messageText, phone: senderPhone },
  })

  // If lead is paused on a condition block, evaluate and advance
  if (lead.current_block_id) {
    const { data: currentBlock } = await admin
      .from('funnel_blocks')
      .select('id, block_type, funnel_id')
      .eq('id', lead.current_block_id)
      .single()

    if (currentBlock?.block_type === 'condition') {
      // Re-queue the condition block so it gets evaluated now that replied event exists
      await getFunnelQueue().add('execute-block', {
        funnelId: lead.funnel_id,
        blockId: currentBlock.id,
        leadId: lead.id,
        tenantId,
      })
    }
  }

  return NextResponse.json({ received: true })
}
