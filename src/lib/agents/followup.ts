import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage } from '@/lib/evolution'
import { callAnthropic } from '@/lib/agents/chat'

// Follow-up automático: lead que parou de responder recebe até N retomadas
// curtas geradas pela IA com o contexto da conversa. Roda de carona no cron
// do queue (a cada minuto). Envio via WhatsApp (precisa do telefone do lead).

export interface FollowupConfig {
  enabled?: boolean
  first_after_hours?: number    // 1ª retomada após X horas sem resposta (default 4)
  second_after_hours?: number   // 2ª retomada após X horas (0 = só uma; default 24)
}

const MAX_PER_RUN = 10

export async function sendFollowups(): Promise<{ sent: number; error?: string }> {
  const admin = createAdminClient()

  // Agentes ativos com follow-up ligado
  const { data: agents, error: aErr } = await admin
    .from('ai_agents')
    .select('id, tenant_id, name, product_name, tone_of_voice, whatsapp_instance_id, followup_config')
    .eq('status', 'active')
    .not('followup_config', 'is', null)
  if (aErr) return { sent: 0, error: aErr.message }

  const enabled = (agents ?? []).filter(a => (a.followup_config as FollowupConfig | null)?.enabled === true)
  if (enabled.length === 0) return { sent: 0 }

  let sent = 0
  for (const agent of enabled) {
    if (sent >= MAX_PER_RUN) break
    const cfg = agent.followup_config as FollowupConfig
    const firstH = Math.max(1, cfg.first_after_hours ?? 4)
    const secondH = cfg.second_after_hours ?? 24
    const maxFollowups = secondH > 0 ? 2 : 1

    // Conversas ativas paradas: última fala do agente há mais tempo que o delay
    const { data: convs } = await admin
      .from('agent_conversations')
      .select('id, lead_id, followups_sent, last_agent_at, channel')
      .eq('agent_id', agent.id)
      .eq('status', 'active')
      .lt('followups_sent', maxFollowups)
      .not('last_agent_at', 'is', null)
      .not('lead_id', 'is', null)
      .limit(20)

    for (const conv of convs ?? []) {
      if (sent >= MAX_PER_RUN) break
      const waitH = conv.followups_sent === 0 ? firstH : secondH
      const dueAt = new Date(conv.last_agent_at).getTime() + waitH * 3600_000
      if (Date.now() < dueAt) continue

      try {
        // O lead respondeu depois da última fala do agente? Então não está parado.
        const { data: laterLeadMsg } = await admin
          .from('agent_messages')
          .select('id')
          .eq('conversation_id', conv.id)
          .eq('role', 'lead')
          .gt('created_at', conv.last_agent_at)
          .limit(1).maybeSingle()
        if (laterLeadMsg) continue

        // Telefone do lead (follow-up sai por WhatsApp)
        const { data: lead } = await admin
          .from('leads').select('name, phone').eq('id', conv.lead_id).single()
        if (!lead?.phone) {
          // sem telefone nunca vai dar pra enviar — para de escanear esta conversa
          await admin.from('agent_conversations').update({ followups_sent: maxFollowups }).eq('id', conv.id)
          continue
        }

        // Instância: do agente, ou qualquer conectada do tenant
        let instName: string | null = null
        if (agent.whatsapp_instance_id) {
          const { data: inst } = await admin
            .from('whatsapp_instances').select('instance_name').eq('id', agent.whatsapp_instance_id).single()
          instName = inst?.instance_name ?? null
        }
        if (!instName) {
          const { data: anyInst } = await admin
            .from('whatsapp_instances').select('instance_name')
            .eq('tenant_id', agent.tenant_id).eq('status', 'connected')
            .limit(1).maybeSingle()
          instName = anyInst?.instance_name ?? null
        }
        if (!instName) continue

        // Últimas mensagens para dar contexto à retomada
        const { data: msgs } = await admin
          .from('agent_messages')
          .select('role, content')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(8)
        const recent = (msgs ?? []).reverse()

        const attempt = conv.followups_sent + 1
        const system = `Você é ${agent.name}, atendente comercial humano de "${agent.product_name ?? 'nosso produto'}" no WhatsApp. Tom: ${agent.tone_of_voice ?? 'amigável e consultivo'}.
O lead parou de responder. Escreva a ${attempt}ª mensagem de retomada: curtíssima (1-2 frases), leve, SEM cobrança e SEM culpa ("sumiu", "está aí?" são proibidos). Retome do ponto exato da conversa (use o contexto), entregue um micro-motivo pra ele responder (uma curiosidade, um benefício, uma pergunta fácil). ${attempt >= 2 ? 'Esta é a ÚLTIMA tentativa: deixe uma porta aberta elegante ("qualquer coisa tô por aqui") sem pressionar.' : ''}
Português brasileiro coloquial. Sem markdown, sem listas, no máximo 1 emoji. Responda SÓ com a mensagem, nada mais.`
        const apiMessages = [
          { role: 'user' as const, content: `Contexto da conversa até parar:\n${recent.map(m => `${m.role === 'lead' ? 'Lead' : 'Você'}: ${m.content}`).join('\n')}\n\nEscreva a retomada agora.` },
        ]
        const text = (await callAnthropic(system, apiMessages)).trim()
        if (!text) continue

        await sendTextMessage(instName, lead.phone, text)
        await admin.from('agent_messages').insert({
          conversation_id: conv.id, tenant_id: agent.tenant_id, role: 'agent', content: text,
        })
        await admin.from('agent_conversations').update({
          followups_sent: attempt, last_agent_at: new Date().toISOString(),
        }).eq('id', conv.id)
        sent++
      } catch (err) {
        console.error(`[followup] erro conv=${conv.id}: ${String(err)}`)
      }
    }
  }
  return { sent }
}
