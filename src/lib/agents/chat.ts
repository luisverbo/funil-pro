import { createAdminClient } from '@/lib/supabase/admin'
import { sendTextMessage } from '@/lib/evolution'

const ACTION_DELIM_RE = /\|\|\|ACTION:(\{[\s\S]*?\})\|\|\|/

interface AgentRow {
  id: string
  tenant_id: string
  name: string
  status: string
  objective: string
  product_name: string | null
  product_description: string | null
  product_price_cents: number | null
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
  max_activations_per_month: number | null
  activations_used: number
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

async function sendPartsViaWhatsApp(
  leadId: string,
  parts: string[],
  admin: ReturnType<typeof createAdminClient>
) {
  const { data: leadRow } = await admin.from('leads').select('phone, funnel_id').eq('id', leadId).single()
  if (!leadRow?.phone || !leadRow.funnel_id) return
  const { data: funnel } = await admin.from('funnels').select('whatsapp_instance_id').eq('id', leadRow.funnel_id).single()
  if (!funnel?.whatsapp_instance_id) return
  const { data: instance } = await admin.from('whatsapp_instances').select('instance_name').eq('id', funnel.whatsapp_instance_id).single()
  if (!instance?.instance_name) return

  for (let i = 0; i < parts.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1200))
    await sendTextMessage(instance.instance_name, leadRow.phone, parts[i])
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
  if (!leadRow?.funnel_resume_block_id) return

  await admin.from('leads').update({
    agent_active: false,
    funnel_paused_at: null,
    funnel_resume_block_id: null,
  }).eq('id', leadId)

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
    console.error(`[chat] BLOCKED: agent_not_found agentId=${agentId} error=${agentError?.message}`)
    throw new Error('agent_not_found')
  }
  const a = agent as AgentRow
  console.log(`[chat] agent carregado: id=${a.id} status=${a.status} testMode=${testMode} activations=${a.activations_used}/${a.max_activations_per_month}`)

  // Check agent status
  if (!testMode && a.status !== 'active') {
    console.error(`[chat] BLOCKED: agent_not_active status=${a.status}`)
    throw new Error(`agent_not_active: status=${a.status}`)
  }

  // Check activation limit
  if (!testMode && a.max_activations_per_month !== null && a.activations_used >= a.max_activations_per_month) {
    console.error(`[chat] BLOCKED: activation_limit_reached used=${a.activations_used} max=${a.max_activations_per_month}`)
    const limitMsg = 'Em breve alguém da equipe vai te responder! 🙂'
    if (leadId) {
      await sendPartsViaWhatsApp(leadId, [limitMsg], admin).catch(() => {})
    }
    throw new Error('activation_limit_reached')
  }

  // Business hours
  if (!withinBusinessHours(a)) {
    console.log(`[chat] BLOCKED: fora do horário comercial business_hours_only=${a.business_hours_only} start=${a.business_hours_start} end=${a.business_hours_end}`)
    const offHoursMsg = 'Olá! No momento estamos fora do horário de atendimento. Retornaremos assim que possível.'
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

  // Find or create conversation (Bug C fix: always look for active conversation for this lead+agent)
  let messageCount = 0
  let history: { role: string; content: string }[] = []

  if (!conversationId && leadId) {
    // Look for existing active conversation
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
      console.error(`[chat] BLOCKED: falha ao criar conversa error=${convError?.message}`)
      throw new Error(`conversation_create_failed: ${convError?.message}`)
    }
    conversationId = newConv.id
    console.log(`[chat] nova conversa criada conversationId=${conversationId}`)
    // Increment activations on new conversation
    if (!testMode) {
      await admin.from('ai_agents').update({ activations_used: (a.activations_used ?? 0) + 1 }).eq('id', agentId)
    }
  } else {
    console.log(`[chat] conversa existente conversationId=${conversationId} messageCount=${messageCount}`)
  }

  // Max messages check
  const maxMsgs = a.max_messages_per_conversation ?? 20
  if (messageCount >= maxMsgs) {
    console.log(`[chat] BLOCKED: max_messages_reached messageCount=${messageCount} maxMsgs=${maxMsgs}`)
    const abandonMsg = 'Esta conversa atingiu o limite de mensagens. Em breve um de nossos atendentes entrará em contato.'
    await admin.from('agent_conversations').update({ status: 'abandoned', ended_at: new Date().toISOString() }).eq('id', conversationId)
    if (!testMode && leadId) {
      await sendPartsViaWhatsApp(leadId, [abandonMsg], admin).catch(() => {})
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
      await sendPartsViaWhatsApp(leadId, [handoffMsg], admin).catch(() => {})
    }
    if (!testMode && leadId) await resumeFunnel(leadId, agentId, 'handoff', admin).catch(() => {})
    return { reply: handoffMsg, parts: [handoffMsg], action: { type: 'handoff', data: {} }, conversationId: conversationId ?? '' }
  }

  // Build system prompt
  const priceLine = a.product_price_cents ? `Preço: R$ ${(a.product_price_cents / 100).toFixed(2)}` : ''
  const systemPrompt = `Você é um assistente de vendas chamado ${a.name} para o produto: ${a.product_name ?? ''}

Descrição do produto: ${a.product_description ?? ''}
${priceLine}

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

  console.log(`[chat] chamando Anthropic API agentId=${agentId} historyLen=${history.length} messageLen=${message.length} apiKey=${process.env.ANTHROPIC_API_KEY ? 'SET' : 'MISSING'}`)
  let rawText = ''
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: systemPrompt,
        messages: apiMessages,
      }),
    })
    const json = await res.json() as { content?: { type: string; text: string }[]; error?: { type: string; message: string } }
    console.log(`[chat] Anthropic respondeu status=${res.status} hasContent=${Array.isArray(json.content)} error=${json.error?.message ?? 'none'}`)
    if (Array.isArray(json.content)) {
      rawText = json.content.filter(b => b.type === 'text').map(b => b.text).join('')
    }
    if (!rawText) rawText = 'Desculpe, não consegui responder agora. Pode reformular?'
  } catch (err) {
    console.error(`[chat] ERRO na chamada Anthropic: ${String(err)}`)
    rawText = 'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.'
  }

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
    await sendPartsViaWhatsApp(leadId, parts, admin).catch(() => {})
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
    await resumeFunnel(leadId, agentId, action.type, admin).catch(() => {})
  }

  return { reply, parts, action, conversationId: conversationId ?? '' }
}
