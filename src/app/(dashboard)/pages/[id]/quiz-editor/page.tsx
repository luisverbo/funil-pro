import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import dynamic from 'next/dynamic'
import { getQuizQuestions } from '@/app/actions/quiz'

const QuizEditorClient = dynamic(
  () => import('@/components/quiz/quiz-editor-client'),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center h-screen bg-gray-50">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Carregando editor...</p>
      </div>
    </div>
  )}
)

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        },
      },
    }
  )
}

export default async function QuizEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await getSupabase()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!userTenant) redirect('/login')

  const { data: page } = await supabase
    .from('pages')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', userTenant.tenant_id)
    .single()

  if (!page) notFound()

  const { data: funnels } = await supabase
    .from('funnels')
    .select('id, name')
    .eq('tenant_id', userTenant.tenant_id)
    .eq('status', 'published')
    .order('name')

  const questions = await getQuizQuestions(id)

  return (
    <QuizEditorClient
      page={page}
      initialQuestions={questions}
      funnels={funnels ?? []}
      tenantId={userTenant.tenant_id}
    />
  )
}
