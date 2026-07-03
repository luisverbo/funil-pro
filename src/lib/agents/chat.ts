import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage } from '@/lib/evolution'

const ACTION_DELIM_RE = /\|\|\|ACTION:(\{[\s\S]*?\})\|\|\|/
const ANTHROPIC_MODEL = process.env.AGENT_MODEL ?? 'claude-haiku-4-5-20251001'

interface AgentRow {
  id: string
  tenant_id: string
  name: string
  status: string
  objective: string
  product_name: string | null
  product_description: string | null
  product_price_cents: number | null
  product_prices: { id: string; label: string; value_cents: number }[] | null
  product_page_url: string | null
  tone_of_voice: string | null
  greeting_message: string | null
  qualification_rules: string | null
  objection_handling: string | null
  payment_link: string | null
  max_messages_per_conversation: number | null
  handoff_to_human_keywords: string[] | null
  business_hours_only: boolean | null
  business_hours_start: string | null
  business_hours_end: string | null
  whatsapp_instance_id: string | null
  max_activations_per_month: number | null
  activations_used: number
  activations_reset_at: string | null
}

export interface AgentChatResult {
  reply: string
  parts: string[]
  action: { type: string; data: Record<string, unknown> }
  conversationId: string
}

function objectiveInstructions(agent: AgentRow): string {
  switch (agent.objective) {
    case 'sell_direct':
      return `Conduzir o lead até a compra do produto. Apresente o valor, contorne objeções e, quando o lead demonstrar intenção de compra, envie o link de pagamento${agent.payment_link ? `: ${agent.payment_link}` : ''}. Quando concluir a venda, marque action "sell".${agent.objection_handling ? `\n\nComo contornar objeções:\n${agent.objection_handling}` : ''}`
    case 'route_to_funnel':
      return `Entender a necessidade do lead e, quando apropriado, encaminhá-lo para o funil de vendas. Quando decidir encaminhar, marque action "route".`
    case 'qualify':
    default:
      return `Qualificar o lead segundo as regras abaixo. Quando tiver informação suficiente, marque action "qualify" com data.score (0-100).${agent.qualification_rules ? `\n\nRegras de qualificação:\n${agent.qualification_rules}` : ''}`
  }
}

function withinBusinessHours(agent: AgentRow): boolean {
  if (!agent.business_hours_only) return true
  const now = new Date()
  const hm = now.getHours() * 60 + now.getMinutes()
  const parse = (t: string | null, def: number) => {
    if (!t) return def
    const [h, m] = t.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  const start = parse(agent.business_hours_start, 9 * 60)
  const end = parse(agent.business_hours_end, 18 * 60)
  return hm >= start && hm <= end
}

// Resolve a instância WhatsApp do envio:
// 1) instância vinculada diretamente ao agente (modo standalone)
// 2) fallback: instância do funil do lead (modo bloco de funil)
async function resolveInstanceName(
  leadId: string,
  agentInstanceId: string | null | undefined,
  admin: ReturnType<typeof createAdminClient>
): Promise<{ instanceName: string | null; phone: string | null }> {
  const { data: leadRow } = await admin.from('leads').select('phone, funnel_id').eq('id', leadId).single()
  if (!leadRow?.phone) return { instanceName: null, phone: null }

  let instanceId = agentInstanceId ?? null

  if (!instanceId && leadRow.funnel_id) {
    const { data: funnel } = await admin.from('funnels').select('whatsapp_instance_id').eq('id', leadRow.funnel_id).single()
    instanceId = funnel?.whatsapp_instance_id ?? null
  }

  if (!instanceId) return { instanceName: null, phone: leadRow.phone }

  const { data: instance } = await admin.from('whatsapp_instances').select('instance_name').eq('id', instanceId).single()
  return { instanceName: instance?.instance_name ?? null, phone: leadRow.phone }
}

async function sendPartsViaWhatsApp(
  leadId: string,
  parts: string[],
  admin: ReturnType<typeof createAdminClient>,
  agentInstanceId?: string | null
) {
  const { instanceName, phone } = await resolveInstanceName(leadId, agentInstanceId, admin)
  if (!instanceName || !phone) {
    console.error(`[chat] envio WA impossível: leadId=${leadId} instanceName=${instanceName} phone=${phone ? 'ok' : 'null'} — nenhuma instância resolvida (agente sem whatsapp_instance_id e lead sem funil com instância)`)
    return
  }

  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1200))
    try {
      await sendTextMessage(instanceName, phone, parts[i])
    } catch (err) {
      console.error(`[chat] falha ao enviar parte ${i + 1}/${parts.length} para ${phone}: ${String(err)}`)
    }
  }
}

async function resumeFunnel(
  leadId: string,
  agentId: string,
  actionType: string,
  admin: ReturnType<typeof createAdminClient>
) {
  const { data: leadRow } = await admin
    .from('leads').select('funnel_id, funnel_resume_block_id, tenant_id').eq('id', leadId).single()
  if (!leadRow) return

  // Sempre limpar o estado do agente, mesmo sem bloco de retomada,
  // para o lead não ficar preso em agent_active
  await admin.from('leads').update({
    agent_active: false,
    funnel_paused_at: null,
    funnel_resume_block_id: null,
  }).eq('id', leadId)

  if (!leadRow.funnel_resume_block_id || !leadRow.funnel_id) return

  await admin.from('lead_events').insert({
    tenant_id: leadRow.tenant_id,
    lead_id: leadId,
    funnel_id: leadRow.funnel_id,
    block_id: leadRow.funnel_resume_block_id,
    event_type: 'agent_deactivated',
    event_data: { outcome: actionType, agent_id: agentId },
  })

  const { data: nextEdge } = await admin
    .from('funnel_edges').select('target_block_id')
    .eq('funnel_id', leadRow.funnel_id)
    .eq('source_block_id', leadRow.funnel_resume_block_id)
    .eq('condition', 'default')
    .limit(1).maybeSingle()

  if (nextEdge?.target_block_id) {
    await admin.from('queue_jobs').insert({
      tenant_id: leadRow.tenant_id,
      lead_id: leadId,
      funnel_id: leadRow.funnel_id,
      block_id: nextEdge.target_block_id,
      status: 'pending',
      scheduled_for: new Date().toISOString(),
    })
  }
}

async function callAnthropic(systemPrompt: string, apiMessages: { role: string; content: string }[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('anthropic_key_missing: configure ANTHROPIC_API_KEY no ambiente')

  const doCall = async () => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        system: systemPrompt,
        messages: apiMessages,
      }),
    })
    const json = await res.json() as { content?: { type: string; text: string }[]; error?: { type: string; message: string } }
    return { status: res.status, json }
  }

  let { status, json } = await doCall()

  // 1 retry para erros transitórios (rate limit / overloaded)
  if (status === 429 || status === 529) {
    await new Promise(r => setTimeout(r, 2000))
    ;({ status, json } = await doCall())
  }

  if (status !== 200 || json.error) {
    throw new Error(`anthropic_error: status=${status} ${json.error?.message ?? ''}`)
  }

  const text = Array.isArray(json.content)
    ? json.content.filter(b => b.type === 'text').map(b => b.text).join('')
    : ''
  if (!text) throw new Error('anthropic_empty_response')
  return text
}

export async function processAgentMessage(
  agentId: string,
  message: string,
  options: {
    leadId?: string
    conversationId?: string
    testMode?: boolean
  } = {}
): Promise<AgentChatResult> {
  const { leadId, testMode = false } = options
  let { conversationId } = options
  const admin = createAdminClient()

  // Load agent
  const { data: agent, error: agentError } = await admin.from('ai_agents').select('*').eq('id', agentId).single()
  if (!agent) {
    console.error(`[chat] agent_not_found agentId=${agentId} error=${agentError?.message}`)
    throw new Error('agent_not_found')
  }
  const a = agent as AgentRow

  // Check agent status
  if (!testMode && a.status !== 'active') {
    throw new Error(`agent_not_active: status=${a.status}`)
  }

  // Reset mensal de ativações
  if (!testMode && a.max_activations_per_month !== null) {
    const now = new Date()
    const resetAt = a.activations_reset_at ? new Date(a.activations_reset_at) : null
    const sameMonth = resetAt && resetAt.getUTCFullYear() === now.getUTCFullYear() && resetAt.getUTCMonth() === now.getUTCMonth()
    if (!sameMonth) {
      await admin.from('ai_agents')
        .update({ activations_used: 0, activations_reset_at: now.toISOString().slice(0, 10) })
        .eq('id', agentId)
      a.activations_used = 0
    }
  }

  // Check activation limit
  if (!testMode && a.max_activations_per_month !== null && a.activations_used >= a.max_activations_per_month) {
    const limitMsg = 'Em breve alguém da equipe vai te responder! 🙂'
    if (leadId) {
      await sendPartsViaWhatsApp(leadId, [limitMsg], admin, a.whatsapp_instance_id)
    }
    throw new Error('activation_limit_reached')
  }

  // Business hours
  if (!withinBusinessHours(a)) {
    const offHoursMsg = 'Olá! No momento estamos fora do horário de atendimento. Retornaremos assim que possível.'
    if (!testMode && leadId) {
      await sendPartsViaWhatsApp(leadId, [offHoursMsg], admin, a.whatsapp_instance_id)
    }
    return {
      reply: offHoursMsg,
      parts: [offHoursMsg],
      action: { type: 'continue', data: {} },
      conversationId: conversationId ?? '',
    }
  }

  // Load documents
  const { data: documents } = await admin.from('agent_documents').select('extracted_text').eq('agent_id', agentId)
  const docs = (documents ?? []).filter(d => d.extracted_text)

  // Find or create conversation
  let messageCount = 0
  let history: { role: string; content: string }[] = []

  if (!conversationId && leadId) {
    const { data: existing } = await admin
      .from('agent_conversations')
      .select('id, message_count')
      .eq('agent_id', agentId)
      .eq('lead_id', leadId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) conversationId = existing.id
  }

  if (conversationId) {
    const { data: conv } = await admin
      .from('agent_conversations').select('id, message_count, status').eq('id', conversationId).single()
    if (conv) {
      messageCount = conv.message_count ?? 0
      const { data: msgs } = await admin
        .from('agent_messages').select('role, content').eq('conversation_id', conversationId).order('created_at', { ascending: true })
      history = msgs ?? []
    } else {
      conversationId = undefined
    }
  }

  if (!conversationId) {
    const { data: newConv, error: convError } = await admin
      .from('agent_conversations')
      .insert({ agent_id: agentId, tenant_id: a.tenant_id, lead_id: leadId ?? null, status: 'active', message_count: 0 })
      .select('id').single()

    if (!newConv) {
      // Conflito do unique index parcial (conversa ativa criada em paralelo) — reaproveita
      if (leadId) {
        const { data: existing } = await admin
          .from('agent_conversations')
          .select('id, message_count')
          .eq('agent_id', agentId).eq('lead_id', leadId).eq('status', 'active')
          .limit(1).maybeSingle()
        if (existing) {
          conversationId = existing.id
          messageCount = existing.message_count ?? 0
        }
      }
      if (!conversationId) {
        throw new Error(`conversation_create_failed: ${convError?.message}`)
      }
    } else {
      conversationId = newConv.id
      // Incremento atômico via RPC (fallback: update simples se a function não existir ainda)
      if (!testMode) {
        const { error: rpcError } = await admin.rpc('increment_agent_activations', { p_agent_id: agentId })
        if (rpcError) {
          await admin.from('ai_agents').update({ activations_used: (a.activations_used ?? 0) + 1 }).eq('id', agentId)
        }
      }
    }
  }

  // Max messages check
  const maxMsgs = a.max_messages_per_conversation ?? 20
  if (messageCount >= maxMsgs) {
    const abandonMsg = 'Esta conversa atingiu o limite de mensagens. Em breve um de nossos atendentes entrará em contato.'
    await admin.from('agent_conversations').update({ status: 'abandoned', ended_at: new Date().toISOString() }).eq('id', conversationId)
    if (!testMode && leadId) {
      await sendPartsViaWhatsApp(leadId, [abandonMsg], admin, a.whatsapp_instance_id)
    }
    return { reply: abandonMsg, parts: [abandonMsg], action: { type: 'handoff', data: {} }, conversationId: conversationId ?? '' }
  }

  // Handoff keyword check
  const keywords = a.handoff_to_human_keywords ?? []
  const lower = message.toLowerCase()
  if (keywords.some(k => k && lower.includes(k.toLowerCase()))) {
    await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'lead', content: message })
    const handoffMsg = 'Claro! Vou transferir você para um atendente humano. Aguarde um momento, por favor.'
    await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'agent', content: handoffMsg })
    await admin.from('agent_conversations').update({ status: 'handed_to_human', outcome_summary: 'Lead solicitou atendimento humano', ended_at: new Date().toISOString() }).eq('id', conversationId)
    if (!testMode && leadId) {
      await sendPartsViaWhatsApp(leadId, [handoffMsg], admin, a.whatsapp_instance_id)
      await resumeFunnel(leadId, agentId, 'handoff', admin).catch(err => console.error(`[chat] resumeFunnel handoff falhou: ${String(err)}`))
    }
    return { reply: handoffMsg, parts: [handoffMsg], action: { type: 'handoff', data: {} }, conversationId: conversationId ?? '' }
  }

  // Build system prompt
  const prices = a.product_prices && a.product_prices.length > 0
    ? a.product_prices.map(p => `${p.label}: R$ ${(p.value_cents / 100).toFixed(2).replace('.', ',')}`).join(' | ')
    : a.product_price_cents ? `R$ ${(a.product_price_cents / 100).toFixed(2).replace('.', ',')}` : ''
  const priceLine = prices ? `Preços disponíveis: ${prices}` : ''
  const pageLine = a.product_page_url ? `Link da página do produto: ${a.product_page_url}` : ''
  const systemPrompt = `Você é um assistente de vendas chamado ${a.name} para o produto: ${a.product_name ?? ''}

Descrição do produto: ${a.product_description ?? ''}
${priceLine}
${pageLine}

Tom de voz: ${a.tone_of_voice ?? 'amigável e consultivo'}

${docs.length > 0 ? `Documentos de referência:\n${docs.map(d => d.extracted_text).join('\n\n')}` : ''}

Seu objetivo é: ${objectiveInstructions(a)}

${a.greeting_message ? `Mensagem de saudação preferida: ${a.greeting_message}` : ''}

IMPORTANTE — formato da resposta:
- Responda como numa conversa real de WhatsApp, não como um texto de e-mail ou artigo
- Mensagens CURTAS — no máximo 2-3 frases por vez
- NUNCA use bullets, listas numeradas ou markdown (sem **, sem -, sem #)
- Se tiver muita informação para passar, divida em várias mensagens menores, uma ideia por vez, como uma pessoa digitando no WhatsApp
- Para indicar quebra de mensagem, separe os balões com a tag [QUEBRA] entre eles — o sistema vai enviar cada parte como uma mensagem separada
- Faça perguntas para manter a conversa fluindo, não despeje todas as informações de uma vez
- Use no máximo 1 emoji por mensagem, não vários
- Tom: como um vendedor experiente conversando naturalmente, não um catálogo de produto

Quando identificar que atingiu seu objetivo ou precisar executar uma ação, inclua no FINAL da sua resposta (será removido antes de enviar ao lead) exatamente neste formato:
|||ACTION:{"action":"continue|qualify|route|sell|handoff","data":{}}|||
Se ainda não atingiu o objetivo, use action "continue".`

  const apiMessages = [
    ...history.map(h => ({ role: h.role === 'lead' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: message },
  ]

  // Erros da Anthropic sobem para o caller (webhook grava agent_error) —
  // não viram "resposta" falsa nem consomem message_count
  const rawText = await callAnthropic(systemPrompt, apiMessages)

  // Parse action tag
  let action: { type: string; data: Record<string, unknown> } = { type: 'continue', data: {} }
  const match = rawText.match(ACTION_DELIM_RE)
  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as { action?: string; data?: Record<string, unknown> }
      action = { type: parsed.action ?? 'continue', data: parsed.data ?? {} }
    } catch { /* ignore malformed */ }
  }
  const fullReply = rawText.replace(ACTION_DELIM_RE, '').trim()
  const parts = fullReply.split('[QUEBRA]').map(p => p.trim()).filter(Boolean)
  const reply = parts.join('\n')

  // Send via WhatsApp (real mode)
  if (!testMode && leadId) {
    await sendPartsViaWhatsApp(leadId, parts, admin, a.whatsapp_instance_id)
  }

  // Persist messages
  await admin.from('agent_messages').insert([
    { conversation_id: conversationId, tenant_id: a.tenant_id, role: 'lead', content: message },
    { conversation_id: conversationId, tenant_id: a.tenant_id, role: 'agent', content: reply },
  ])

  // Update conversation status
  const statusMap: Record<string, string> = {
    qualify: 'qualified', route: 'routed_to_funnel', sell: 'sold', handoff: 'handed_to_human',
  }
  const newStatus = statusMap[action.type]
  const convUpdate: Record<string, unknown> = { message_count: messageCount + 1 }
  if (newStatus) {
    convUpdate.status = newStatus
    convUpdate.ended_at = new Date().toISOString()
    if (action.type === 'qualify' && typeof action.data.score === 'number') {
      convUpdate.qualification_score = action.data.score
    }
    convUpdate.outcome_summary = `Ação: ${action.type}`
  }
  await admin.from('agent_conversations').update(convUpdate).eq('id', conversationId)

  // Resume funnel on terminal action
  if (!testMode && newStatus && leadId) {
    await resumeFunnel(leadId, agentId, action.type, admin).catch(err => console.error(`[chat] resumeFunnel falhou: ${String(err)}`))
  }

  return { reply, parts, action, conversationId: conversationId ?? '' }
}
