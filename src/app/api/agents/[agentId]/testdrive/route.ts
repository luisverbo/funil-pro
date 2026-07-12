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
    // Cenários rodam em PARALELO (cada um é sequencial por dentro) — em série
    // eram 6 chamadas encadeadas e o total estourava o limite de 60s da função
    const results = await Promise.all(SCENARIOS.map(async sc => {
      let convId: string | undefined
      const exchanges: { lead: string; agent: string }[] = []
      for (const turn of sc.turns) {
        try {
          const result = await processAgentMessage(agentId, turn, { channel: 'test', conversationId: convId })
          convId = result.conversationId || convId
          exchanges.push({ lead: turn, agent: result.reply || '(sem resposta)' })
        } catch (err) {
          // Um turno falhou — registra e continua, sem abortar o test drive inteiro
          exchanges.push({ lead: turn, agent: `(erro ao responder: ${String(err).slice(0, 80)})` })
        }
      }
      return { label: sc.label, exchanges, convId }
    }))
    for (const r of results) {
      if (r.convId) testConvIds.push(r.convId)
      transcripts.push({ label: r.label, exchanges: r.exchanges })
    }

    // Se NENHUM turno respondeu de verdade, avisa em vez de mandar lixo pra avaliação
    const anyReal = transcripts.some(t => t.exchanges.some(e => e.agent && !e.agent.startsWith('(')))
    if (!anyReal) {
      return NextResponse.json({ transcripts, evaluation: null, note: 'O agente não respondeu nas simulações — verifique a configuração e tente de novo.' })
    }

    // Avaliação por IA: notas + melhorias acionáveis
    const evalPrompt = `Você é um auditor sênior de agentes de vendas por chat. Avalie o agente "${agent.name}" (objetivo: ${agent.objective}) pelos transcripts abaixo. Seja exigente e prático.

${transcripts.map(t => `### ${t.label}\n${t.exchanges.map(e => `Lead: ${e.lead}\nAgente: ${e.agent}`).join('\n')}`).join('\n\n')}

Responda APENAS com JSON válido neste formato exato:
{"scores":{"humanizacao":0-10,"conducao":0-10,"objecoes":0-10,"clareza":0-10},"nota_geral":0-10,"veredito":"1 frase direta","melhorias":["até 3 melhorias específicas e acionáveis"]}`

    // max_tokens alto: JSON com scores + veredito + melhorias não pode ser truncado
    const rawEval = await callAnthropic('Você responde somente JSON válido, sem markdown, sem texto antes ou depois.', [{ role: 'user', content: evalPrompt }], 1500)
    let evaluation: unknown = null
    try {
      // Extrai do primeiro "{" ao último "}" — tolera qualquer texto/markdown em volta
      const full = rawEval.replace(/```json|```/g, '')
      const start = full.indexOf('{')
      const end = full.lastIndexOf('}')
      evaluation = JSON.parse(full.slice(start, end + 1))
    } catch {
      // Parse falhou (JSON truncado/malformado): não despeja texto cru na UI.
      // Deixa null para o modal mostrar o aviso limpo de "rode de novo".
      evaluation = null
    }

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
