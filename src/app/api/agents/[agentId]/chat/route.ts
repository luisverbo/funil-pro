import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface ChatBody {
  message: string
  conversationId?: string
  leadId?: string
  testMode?: boolean
}

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
  target_funnel_id: string | null
  max_messages_per_conversation: number | null
  handoff_to_human_keywords: string[] | null
  business_hours_only: boolean | null
  business_hours_start: string | null
  business_hours_end: string | null
  max_activations_per_month: number | null
  activations_used: number
}

const ACTION_DELIM_RE = /\|\|\|ACTION:(\{[\s\S]*?\})\|\|\|/

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

export async function POST(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  try {
    const body = (await request.json()) as ChatBody
    const { message, testMode } = body
    let { conversationId, leadId } = body

    if (!message?.trim()) {
      return NextResponse.json({ error: 'message obrigatória' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: agent } = await admin
      .from('ai_agents').select('*').eq('id', agentId).single()
    if (!agent) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })
    const a = agent as AgentRow

    const { data: documents } = await admin
      .from('agent_documents').select('extracted_text').eq('agent_id', agentId)
    const docs = (documents ?? []).filter(d => d.extracted_text)

    // Business hours
    if (!withinBusinessHours(a)) {
      return NextResponse.json({
        reply: 'Olá! No momento estamos fora do horário de atendimento. Retornaremos assim que possível.',
        action: { type: 'continue', data: {} },
        conversationId: conversationId ?? null,
      })
    }

    // Load or create conversation
    let history: { role: string; content: string }[] = []
    let messageCount = 0
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
      const { data: newConv } = await admin
        .from('agent_conversations')
        .insert({ agent_id: agentId, tenant_id: a.tenant_id, lead_id: leadId ?? null, status: 'active', message_count: 0 })
        .select('id').single()
      conversationId = newConv?.id
    }

    // Max messages reached
    const maxMsgs = a.max_messages_per_conversation ?? 20
    if (messageCount >= maxMsgs) {
      await admin.from('agent_conversations').update({ status: 'abandoned', ended_at: new Date().toISOString() }).eq('id', conversationId)
      return NextResponse.json({
        reply: 'Esta conversa atingiu o limite de mensagens. Em breve um de nossos atendentes entrará em contato.',
        action: { type: 'handoff', data: {} },
        conversationId,
      })
    }

    // Handoff keyword check
    const keywords = a.handoff_to_human_keywords ?? []
    const lower = message.toLowerCase()
    if (keywords.some(k => k && lower.includes(k.toLowerCase()))) {
      await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'lead', content: message })
      const reply = 'Claro! Vou transferir você para um atendente humano. Aguarde um momento, por favor.'
      await admin.from('agent_messages').insert({ conversation_id: conversationId, tenant_id: a.tenant_id, role: 'agent', content: reply })
      await admin.from('agent_conversations').update({ status: 'handed_to_human', outcome_summary: 'Lead solicitou atendimento humano', ended_at: new Date().toISOString() }).eq('id', conversationId)
      return NextResponse.json({ reply, action: { type: 'handoff', data: {} }, conversationId })
    }

    // Build system prompt
    const priceLine = a.product_price_cents ? `Preço: R$ ${(a.product_price_cents / 100).toFixed(2)}` : ''
    const historyText = history.map(h => `${h.role === 'lead' ? 'Lead' : 'Agente'}: ${h.content}`).join('\n')
    const systemPrompt = `Você é um assistente de vendas chamado ${a.name} para o produto: ${a.product_name ?? ''}

Descrição do produto: ${a.product_description ?? ''}
${priceLine}

Tom de voz: ${a.tone_of_voice ?? 'amigável e consultivo'}

${docs.length > 0 ? `Documentos de referência:\n${docs.map(d => d.extracted_text).join('\n\n')}` : ''}

Seu objetivo é: ${objectiveInstructions(a)}

${a.greeting_message ? `Mensagem de saudação preferida: ${a.greeting_message}` : ''}

Responda de forma natural e conversacional. Quando identificar que atingiu seu objetivo ou precisar executar uma ação, inclua no FINAL da sua resposta (será removido antes de enviar ao lead) exatamente neste formato:
|||ACTION:{"action":"continue|qualify|route|sell|handoff","data":{}}|||
Se ainda não atingiu o objetivo, use action "continue".`

    // Build messages array (history + new message)
    const apiMessages = [
      ...history.map(h => ({ role: h.role === 'lead' ? 'user' : 'assistant', content: h.content })),
      { role: 'user', content: message },
    ]

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
      const json = await res.json()
      if (Array.isArray(json.content)) {
        rawText = json.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
      }
      if (!rawText) rawText = 'Desculpe, não consegui responder agora. Pode reformular?'
    } catch {
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
    const reply = rawText.replace(ACTION_DELIM_RE, '').trim()

    // Persist messages
    await admin.from('agent_messages').insert([
      { conversation_id: conversationId, tenant_id: a.tenant_id, role: 'lead', content: message },
      { conversation_id: conversationId, tenant_id: a.tenant_id, role: 'agent', content: reply },
    ])

    // Apply action to conversation status
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

    // Increment activations (only on real usage, on first message of conversation)
    if (!testMode && messageCount === 0) {
      await admin.from('ai_agents').update({ activations_used: (a.activations_used ?? 0) + 1 }).eq('id', agentId)
    }

    return NextResponse.json({ reply, action, conversationId })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
