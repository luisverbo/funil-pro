// ============================================================================
// Carga do editor de quiz — rota HTTP simples, no lugar da server action
// ----------------------------------------------------------------------------
// POR QUE EXISTE: em produção, a carga via server action (`loadQuizV2`)
// passou a falhar com o erro MASCARADO do Next ("An error occurred in the
// Server Components render... digest") — sem causa visível e sem como
// depurar. Server action embute um ID de build na página: aba aberta durante
// um deploy chama um ID que não existe mais, e a resposta vira esse erro
// genérico. Uma rota GET não tem nada disso: é HTTP puro, imune a
// dessincronização de deploy, e quando falha devolve o motivo REAL em JSON.
//
// A autenticação é a mesma da action: sessão do Supabase + tenant do usuário.
// ============================================================================

import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll() { return cookieStore.getAll() }, setAll() { /* leitura apenas */ } } },
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'sem_sessao' }, { status: 401 })

    const { data: ut } = await supabase
      .from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
    if (!ut) return NextResponse.json({ error: 'sem_tenant' }, { status: 403 })
    const tenantId = String(ut.tenant_id)

    const admin = createAdminClient()
    const { data: page, error: pageError } = await admin
      .from('pages')
      .select('id, title, slug, published, quiz_data')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single()

    if (pageError || !page) return NextResponse.json({ error: 'page_not_found' }, { status: 404 })

    const quizData = (page.quiz_data as { version?: number } | null) ?? null

    const [funnelsResult, questionsResult] = await Promise.all([
      admin.from('funnels').select('id, name')
        .eq('tenant_id', tenantId).eq('status', 'published').order('name'),
      // Perguntas v1, para a migração automática v1 → v2 no cliente.
      quizData?.version !== 2
        ? admin.from('interactive_questions').select('*').eq('page_id', id).order('order_index')
        : Promise.resolve({ data: null }),
    ])

    return NextResponse.json({
      page: { id: page.id, title: page.title, slug: page.slug, published: page.published },
      quizData,
      v1Questions: questionsResult.data ?? null,
      funnels: funnelsResult.data ?? [],
      tenantId,
    })
  } catch (err) {
    // O MOTIVO REAL, sempre — é justamente o que a server action escondia.
    console.error('[quiz-editor-load] falha:', String(err))
    return NextResponse.json(
      { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) },
      { status: 500 },
    )
  }
}
