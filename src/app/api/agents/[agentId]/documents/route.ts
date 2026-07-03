import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

async function getTenantId(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  return data?.tenant_id ?? null
}

async function extractText(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    try {
      // dynamic import keeps pdf-parse out of the edge bundle
      const mod = await import('pdf-parse')
      const pdfParse = (mod as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default
        ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>)
      const result = await pdfParse(buffer)
      return result.text ?? ''
    } catch {
      return ''
    }
  }
  // plain text / markdown / csv
  return buffer.toString('utf-8')
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  try {
    const tenantId = await getTenantId()
    if (!tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: agent } = await admin
      .from('ai_agents').select('id, tenant_id').eq('id', agentId).eq('tenant_id', tenantId).single()
    if (!agent) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'file_required' }, { status: 400 })

    const text = await extractText(file)

    // G3: avisa quando não conseguiu extrair texto (PDF escaneado/imagem, parse falhou).
    // Antes o doc "treinado" ficava vazio silenciosamente e o usuário achava que treinou.
    if (text.trim().length < 200) {
      return NextResponse.json({
        error: 'extract_failed',
        message: 'Não consegui ler texto suficiente deste arquivo. Se for um PDF escaneado (imagem), converta para texto ou cole o conteúdo como .txt.',
        chars: text.trim().length,
      }, { status: 422 })
    }

    const { data: doc, error } = await admin
      .from('agent_documents')
      .insert({
        agent_id: agentId,
        tenant_id: tenantId,
        file_name: file.name,
        file_url: null,
        extracted_text: text.slice(0, 100000),
      })
      .select('id, file_name, uploaded_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ document: doc, chars: text.length })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params
  const tenantId = await getTenantId()
  if (!tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const { data } = await admin
    .from('agent_documents').select('id, file_name, uploaded_at')
    .eq('agent_id', agentId).eq('tenant_id', tenantId).order('uploaded_at', { ascending: false })
  return NextResponse.json({ documents: data ?? [] })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  await params
  const tenantId = await getTenantId()
  if (!tenantId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const docId = searchParams.get('docId')
  if (!docId) return NextResponse.json({ error: 'docId_required' }, { status: 400 })
  const admin = createAdminClient()
  await admin.from('agent_documents').delete().eq('id', docId).eq('tenant_id', tenantId)
  return NextResponse.json({ success: true })
}
