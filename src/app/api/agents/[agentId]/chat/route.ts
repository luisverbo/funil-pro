import { NextRequest, NextResponse } from 'next/server'
import { processAgentMessage } from '@/lib/agents/chat'

interface ChatBody {
  message: string
  conversationId?: string
  leadId?: string
  testMode?: boolean
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  try {
    const body = (await request.json()) as ChatBody
    const { message, conversationId, leadId, testMode } = body

    if (!message?.trim()) {
      return NextResponse.json({ error: 'message obrigatória' }, { status: 400 })
    }

    const result = await processAgentMessage(agentId, message, { conversationId, leadId, testMode })
    return NextResponse.json(result)
  } catch (err) {
    const msg = String(err)
    if (msg.includes('agent_not_found')) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })
    if (msg.includes('agent_not_active')) return NextResponse.json({ error: msg }, { status: 403 })
    if (msg.includes('activation_limit_reached')) return NextResponse.json({ error: msg }, { status: 429 })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
