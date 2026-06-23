import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processAgentMessage } from '@/lib/agents/chat'

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

  console.log(`[webhook/evolution] PAYLOAD instanceId=${instanceId} event=${body.event} state=${body.state} keys=${Object.keys(body).join(',')} full=${JSON.stringify(body).slice(0, 800)}`)

  const admin = createAdminClient()

  if (body.event === 'CONNECTION_UPDATE' || body.state) {
    const state = body.state ?? ((body as unknown as Record<string, unknown>)?.['data.state'] as string | undefined)
    console.log(`[webhook/evolution] EARLY_RETURN: CONNECTION_UPDATE/state state=${state}`)
    if (state) {
      const dbStatus = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
      await admin.from('whatsapp_instances').update({ status: dbStatus }).eq('id', instanceId)
    }
    return NextResponse.json({ received: true })
  }

  if (body.event === 'QRCODE_UPDATED') {
    console.log(`[webhook/evolution] EARLY_RETURN: QRCODE_UPDATED`)
    return NextResponse.json({ received: true })
  }

  if (body.event !== 'MESSAGES_UPSERT' && body.event !== 'messages.upsert') {
    console.log(`[webhook/evolution] EARLY_RETURN: evento ignorado event=${body.event}`)
    return NextResponse.json({ received: true })
  }

  const messageData = body.data
  if (!messageData?.key?.remoteJid || messageData.key.fromMe) {
    console.log(`[webhook/evolution] EARLY_RETURN: sem remoteJid ou fromMe=true fromMe=${messageData?.key?.fromMe}`)
    return NextResponse.json({ received: true })
  }

  const senderPhone = extractPhone(messageData.key.remoteJid)
  const messageText = messageData.message?.conversation ?? messageData.message?.extendedTextMessage?.text ?? ''

  console.log(`[webhook/evolution] MESSAGES_UPSERT phone=${senderPhone} textLen=${messageText.length} fromMe=${messageData.key.fromMe} msgKeys=${Object.keys(messageData.message ?? {}).join(',')}`)

  if (!senderPhone) return NextResponse.json({ received: true })

  const { data: waInstance } = await admin
    .from('whatsapp_instances')
    .select('id, tenant_id')
    .eq('id', instanceId)
    .single()

  if (!waInstance) return NextResponse.json({ received: true })

  const tenantId = waInstance.tenant_id
  const pushName = messageData?.pushName ?? null

  // Check for standalone agent linked to this WA instance
  const { data: allAgents } = await admin
    .from('ai_agents')
    .select('id, name, mode, status, whatsapp_instance_id')
    .eq('tenant_id', tenantId)
  console.log(`[webhook/evolution] instanceId=${instanceId} tenantId=${tenantId} agents=${JSON.stringify(allAgents?.map(a => ({ id: a.id, name: a.name, mode: a.mode, status: a.status, waid: a.whatsapp_instance_id })))}`)

  const { data: standaloneAgent } = await admin
    .from('ai_agents')
    .select('id, name, status, max_activations_per_month, activations_used')
    .eq('whatsapp_instance_id', instanceId)
    .eq('mode', 'standalone')
    .eq('status', 'active')
    .eq('tenant_id', tenantId)
    .maybeSingle()

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

  let resolvedLead = lead

  if (!resolvedLead) {
    if (!standaloneAgent) {
      // No lead, no standalone agent — ignore
      console.log(`[webhook/evolution] Mensagem de número desconhecido sem agente standalone: ${senderPhone}`)
      return NextResponse.json({ received: true })
    }

    // Create lead for standalone agent conversation
    const { data: newLead } = await admin.from('leads').insert({
      tenant_id: tenantId,
      phone: senderPhone,
      name: pushName,
      status: 'active',
      funnel_id: null,
      agent_active: false,
    }).select('id, funnel_id, current_block_id, status, name, agent_active, funnel_resume_block_id').single()

    if (!newLead) return NextResponse.json({ received: true })
    resolvedLead = newLead
    console.log(`[webhook/evolution] Novo lead standalone criado: ${newLead.id} para agente ${standaloneAgent.id}`)
  }

  // Record replied event only if lead has a funnel (funnel_id is NOT NULL in lead_events)
  if (resolvedLead.funnel_id) {
    await admin.from('lead_events').insert({
      tenant_id: tenantId,
      lead_id: resolvedLead.id,
      funnel_id: resolvedLead.funnel_id,
      block_id: resolvedLead.current_block_id,
      event_type: 'replied',
      event_data: { text: messageText, phone: senderPhone },
    })
  }

  // PRIORITY 1: lead has active funnel agent block
  if ((resolvedLead as Record<string, unknown>).agent_active && (resolvedLead as Record<string, unknown>).funnel_resume_block_id) {
    const { data: agentBlock } = await admin
      .from('funnel_blocks')
      .select('id, config')
      .eq('id', (resolvedLead as Record<string, unknown>).funnel_resume_block_id as string)
      .single()

    const agentId = (agentBlock?.config as Record<string, unknown>)?.agent_id as string | undefined

    if (agentId && messageText) {
      try {
        await processAgentMessage(agentId, messageText, { leadId: resolvedLead!.id })
      } catch (err) {
        console.error('[webhook/evolution] funnel agent error:', { agentId, leadId: resolvedLead!.id, error: String(err) })
        if (resolvedLead!.funnel_id) {
          void admin.from('lead_events').insert({
            tenant_id: tenantId,
            lead_id: resolvedLead!.id,
            funnel_id: resolvedLead!.funnel_id,
            block_id: resolvedLead!.current_block_id,
            event_type: 'agent_error',
            event_data: { agent_id: agentId, error: String(err) },
          })
        }
      }
    }
    return NextResponse.json({ received: true })
  }

  // PRIORITY 2: standalone agent on this WA instance
  if (standaloneAgent && messageText) {
    try {
      console.log(`[webhook/evolution] standalone agent chamando processAgentMessage agentId=${standaloneAgent.id} leadId=${resolvedLead!.id}`)
      await processAgentMessage(standaloneAgent.id, messageText, { leadId: resolvedLead!.id })
      console.log(`[webhook/evolution] standalone agent respondeu com sucesso`)
    } catch (err) {
      console.error('[webhook/evolution] standalone agent error:', { agentId: standaloneAgent.id, leadId: resolvedLead!.id, error: String(err) })
    }
    return NextResponse.json({ received: true })
  }

  // PRIORITY 3: funnel condition block waiting for reply
  if (resolvedLead.current_block_id) {
    const { data: currentBlock } = await admin
      .from('funnel_blocks')
      .select('id, block_type, funnel_id, config')
      .eq('id', resolvedLead.current_block_id)
      .single()

    if (currentBlock?.block_type === 'condition') {
      const conditionType = ((currentBlock.config as Record<string, unknown>)?.condition as string) ?? ''
      const isReplyCondition = conditionType === 'replied' || conditionType === 'replied_with' || conditionType === 'replied_number'

      if (isReplyCondition) {
        await admin.from('queue_jobs').insert({
          tenant_id: tenantId,
          lead_id: resolvedLead.id,
          funnel_id: resolvedLead.funnel_id,
          block_id: currentBlock.id,
          status: 'pending',
          scheduled_for: new Date().toISOString(),
        })
      }
    }
  }

  return NextResponse.json({ received: true })
}
