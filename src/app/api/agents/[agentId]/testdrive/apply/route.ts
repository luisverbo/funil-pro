import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { callAnthropic } from '@/lib/agents/chat'

export const maxDuration = 60

// Aplica as melhorias do test drive automaticamente: converte o diagnóstico em
// regras comportamentais curtas e grava como "correções aprendidas"
// (doc_type='correction') — prioridade máxima no prompt, sem sobrescrever a
// configuração escrita pelo usuário, e removível a qualquer momento.

interface ApplyBody {
  melhorias?: string[]
  transcripts?: { label: string; exchanges: { lead: string; agent: string }[] }[]
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params

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

  let body: ApplyBody
  try { body = await request.json() } catch { return NextResponse.json({ error: 'body inválido' }, { status: 400 }) }
  const melhorias = (body.melhorias ?? []).filter(m => typeof m === 'string' && m.trim())
  if (melhorias.length === 0) return NextResponse.json({ error: 'sem melhorias para aplicar' }, { status: 400 })

  try {
    // Converte o diagnóstico em regras comportamentais imperativas e específicas
    const prompt = `Você é um treinador de agentes de vendas por chat. O agente "${agent.name}" (objetivo: ${agent.objective}) passou por uma auditoria que apontou estas melhorias:
${melhorias.map((m, i) => `${i + 1}. ${m}`).join('\n')}
${body.transcripts?.length ? `\nTrechos das conversas auditadas (para contexto):\n${body.transcripts.map(t => t.exchanges.map(e => `Lead: ${e.lead}\nAgente: ${e.agent}`).join('\n')).join('\n---\n')}` : ''}

Transforme as melhorias em regras de comportamento para o agente seguir DALI EM DIANTE. Cada regra: imperativa, específica, autocontida, em português brasileiro, no máximo 2 frases. NÃO invente preços, produtos ou promessas — só comportamento de conversa.

Responda APENAS com JSON válido: {"regras":["regra 1","regra 2","..."]} (no máximo ${Math.min(melhorias.length, 4)} regras).`

    const raw = await callAnthropic('Você responde somente JSON válido, sem markdown, sem texto antes ou depois.', [{ role: 'user', content: prompt }], 1200)
    let regras: string[] = []
    try {
      const full = raw.replace(/```json|```/g, '')
      const parsed = JSON.parse(full.slice(full.indexOf('{'), full.lastIndexOf('}') + 1)) as { regras?: unknown }
      regras = Array.isArray(parsed.regras) ? parsed.regras.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).slice(0, 4) : []
    } catch { /* fallback abaixo */ }
    if (regras.length === 0) regras = melhorias.slice(0, 3)   // fallback: usa as melhorias direto

    const today = new Date().toLocaleDateString('pt-BR')
    const rows = regras.map(r => ({
      agent_id: agentId,
      tenant_id: agent.tenant_id,
      doc_type: 'correction',
      file_name: `Test drive ${today}: ${r.slice(0, 50)}`,
      extracted_text: r,
    }))
    // SUBSTITUI as correções de test drive anteriores em vez de empilhar —
    // acumular regras incha o prompt e elas passam a se contradizer (piora a nota).
    // As correções manuais (do 👎) são preservadas.
    await admin.from('agent_documents')
      .delete()
      .eq('agent_id', agentId).eq('doc_type', 'correction')
      .like('file_name', 'Test drive %')
    const { error: insErr } = await admin.from('agent_documents').insert(rows)
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

    return NextResponse.json({ applied: regras })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
