import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
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

    // SEGURANÇA: este endpoint exige sessão (middleware) mas antes não validava que o
    // agente pertence ao tenant do usuário — qualquer usuário logado podia conversar com
    // agente de outro tenant sabendo o UUID. Validamos tenant + plano Scale aqui.
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: ut } = await admin.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
    const tenantId = ut?.tenant_id
    if (!tenantId) return NextResponse.json({ error: 'no_tenant' }, { status: 403 })

    const { data: agent } = await admin.from('ai_agents').select('tenant_id').eq('id', agentId).single()
    if (!agent) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })
    if (agent.tenant_id !== tenantId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

    const { data: tenant } = await admin.from('tenants').select('plan').eq('id', tenantId).single()
    if (tenant?.plan !== 'scale') return NextResponse.json({ error: 'plan_required_scale' }, { status: 403 })

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
