import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { processAgentMessage } from '@/lib/agents/chat'
import { getMediaBase64 } from '@/lib/evolution'
import { transcribeAudio } from '@/lib/agents/transcribe'

// Processamento síncrono do agente (Anthropic + delays entre partes) exige mais que o default de 10s
export const maxDuration = 60

interface EvolutionMessageEvent {
  event: string
  instance: string
  data?: {
    key?: { remoteJid?: string; fromMe?: boolean; id?: string }
    message?: { conversation?: string; extendedTextMessage?: { text?: string }; audioMessage?: Record<string, unknown> }
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

  // Idempotência: o Evolution reenvia webhooks em caso de timeout.
  // Registra a message key; se já foi processada, ignora silenciosamente.
  const messageKeyId = messageData.key.id
  if (messageKeyId) {
    const { error: dedupeError } = await admin
      .from('processed_wa_messages')
      .insert({ message_key_id: `${instanceId}:${messageKeyId}` })
    if (dedupeError) {
      if (dedupeError.code === '23505') {
        // Duplicata — já processada
        return NextResponse.json({ received: true, duplicate: true })
      }
      // Tabela pode não existir ainda (migration pendente) — segue sem dedupe
    }
  }

  const { data: waInstance } = await admin
    .from('whatsapp_instances')
    .select('id, tenant_id, instance_name')
    .eq('id', instanceId)
    .single()

  if (!waInstance) return NextResponse.json({ received: true })

  const tenantId = waInstance.tenant_id

  // Áudio: transcreve via Whisper (se OPENAI_API_KEY configurada); sem
  // transcrição, o agente pede o texto com naturalidade
  let effectiveText = messageText
  if (!effectiveText && messageData.message?.audioMessage) {
    let transcript: string | null = null
    if (waInstance.instance_name && messageData.key.id) {
      const media = await getMediaBase64(waInstance.instance_name, messageData.key)
        .catch(() => null)
      if (media) transcript = await transcribeAudio(media.base64, media.mimetype ?? 'audio/ogg')
    }
    effectiveText = transcript
      ? transcript
      : '[o lead enviou um áudio que você não conseguiu ouvir — peça com naturalidade para ele mandar por texto]'
  }
  const pushName = messageData?.pushName ?? null

  // Check for standalone agent linked to this WA instance
  const { data: standaloneAgent } = await admin
    .from('ai_agents')
    .select('id, name, status, max_activations_per_month, activations_used, channels')
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
    .maybeSingle()

  let resolvedLead = lead

  if (!resolvedLead) {
    if (!standaloneAgent) {
      console.log(`[webhook/evolution] número desconhecido sem agente standalone: ${senderPhone}`)
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
  }

  // Record replied event only if lead has a funnel (funnel_id is NOT NULL in lead_events)
  if (resolvedLead.funnel_id) {
    await admin.from('lead_events').insert({
      tenant_id: tenantId,
      lead_id: resolvedLead.id,
      funnel_id: resolvedLead.funnel_id,
      block_id: resolvedLead.current_block_id,
      event_type: 'replied',
      event_data: { text: effectiveText, phone: senderPhone },
    })
  }

  // PRIORITY 1: lead has active funnel agent block
  if (resolvedLead.agent_active && resolvedLead.funnel_resume_block_id) {
    const { data: agentBlock } = await admin
      .from('funnel_blocks')
      .select('id, config')
      .eq('id', resolvedLead.funnel_resume_block_id)
      .single()

    const agentId = (agentBlock?.config as Record<string, unknown>)?.agent_id as string | undefined

    if (agentId && effectiveText) {
      try {
        await processAgentMessage(agentId, effectiveText, { leadId: resolvedLead.id })
      } catch (err) {
        console.error('[webhook/evolution] funnel agent error:', { agentId, leadId: resolvedLead.id, error: String(err) })
        if (resolvedLead.funnel_id) {
          void admin.from('lead_events').insert({
            tenant_id: tenantId,
            lead_id: resolvedLead.id,
            funnel_id: resolvedLead.funnel_id,
            block_id: resolvedLead.current_block_id,
            event_type: 'agent_error',
            event_data: { agent_id: agentId, error: String(err) },
          })
        }
      }
      return NextResponse.json({ received: true })
    }

    // Estado inconsistente (agent_active mas bloco/agent_id não resolve) —
    // auto-recuperação: limpa o estado e deixa o lead seguir pelos paths normais
    console.error(`[webhook/evolution] lead ${resolvedLead.id} preso em agent_active sem agente resolvível — limpando estado`)
    await admin.from('leads').update({ agent_active: false, funnel_resume_block_id: null, funnel_paused_at: null }).eq('id', resolvedLead.id)
  }

  // PRIORITY 2: standalone agent on this WA instance
  const agentChannels: string[] | null = (standaloneAgent as typeof standaloneAgent & { channels?: string[] | null })?.channels ?? null
  const whatsappEnabled = !agentChannels || agentChannels.includes('whatsapp')
  if (standaloneAgent && whatsappEnabled && effectiveText) {
    try {
      await processAgentMessage(standaloneAgent.id, effectiveText, { leadId: resolvedLead.id })
    } catch (err) {
      console.error('[webhook/evolution] standalone agent error:', { agentId: standaloneAgent.id, leadId: resolvedLead.id, error: String(err) })
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
