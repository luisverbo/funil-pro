import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { processAgentMessage, callAnthropic } from '@/lib/agents/chat'

export const maxDuration = 60

// Test drive: simula 3 leads difíceis contra o agente e avalia a performance
// com notas e melhorias sugeridas. Conversas de teste são apagadas no final.

const SCENARIOS: { key: string; label: string; turns: string[] }[] = [
  { key: 'frio', label: 'Lead frio e curto', turns: ['oi', 'quanto custa?'] },
  { key: 'objecao', label: 'Lead com objeção', turns: ['achei caro isso', 'vou pensar e te falo'] },
  { key: 'apressado', label: 'Lead apressado', turns: ['quero marcar uma reunião', 'pode ser amanhã?'] },
]

export async function POST(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params

  // Auth: usuário logado do tenant dono do agente
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: ut } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  const admin = createAdminClient()
  const { data: agent } = await admin.from('ai_agents').select('id, tenant_id, name, objective').eq('id', agentId).single()
  if (!agent || agent.tenant_id !== ut?.tenant_id) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const transcripts: { label: string; exchanges: { lead: string; agent: string }[] }[] = []
  const testConvIds: string[] = []

  try {
    for (const sc of SCENARIOS) {
      let convId: string | undefined
      const exchanges: { lead: string; agent: string }[] = []
      for (const turn of sc.turns) {
        const result = await processAgentMessage(agentId, turn, { channel: 'test', conversationId: convId })
        convId = result.conversationId || convId
        exchanges.push({ lead: turn, agent: result.reply })
      }
      if (convId) testConvIds.push(convId)
      transcripts.push({ label: sc.label, exchanges })
    }

    // Avaliação por IA: notas + melhorias acionáveis
    const evalPrompt = `Você é um auditor sênior de agentes de vendas por chat. Avalie o agente "${agent.name}" (objetivo: ${agent.objective}) pelos transcripts abaixo. Seja exigente e prático.

${transcripts.map(t => `### ${t.label}\n${t.exchanges.map(e => `Lead: ${e.lead}\nAgente: ${e.agent}`).join('\n')}`).join('\n\n')}

Responda APENAS com JSON válido neste formato exato:
{"scores":{"humanizacao":0-10,"conducao":0-10,"objecoes":0-10,"clareza":0-10},"nota_geral":0-10,"veredito":"1 frase direta","melhorias":["até 3 melhorias específicas e acionáveis"]}`

    const rawEval = await callAnthropic('Você responde somente JSON válido, sem markdown.', [{ role: 'user', content: evalPrompt }])
    let evaluation: unknown = null
    try {
      evaluation = JSON.parse(rawEval.replace(/```json|```/g, '').trim())
    } catch { evaluation = { veredito: rawEval.slice(0, 300) } }

    return NextResponse.json({ transcripts, evaluation })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    // Limpa as conversas de teste para não poluir o painel
    if (testConvIds.length > 0) {
      await admin.from('agent_messages').delete().in('conversation_id', testConvIds)
      await admin.from('agent_conversations').delete().in('id', testConvIds)
    }
  }
}
