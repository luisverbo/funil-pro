'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

export interface QuizOption {
  id: string
  label: string
  emoji?: string
  next_question_id?: string | null
}

export interface QuizQuestion {
  id: string
  page_id: string
  tenant_id: string
  order_index: number
  question_type: 'single_choice' | 'multi_choice' | 'text_short' | 'text_long' | 'scale' | 'email' | 'phone' | 'final_capture' | 'result'
  question_text: string
  subtitle?: string | null
  options: QuizOption[]
  required: boolean
  next_question_id?: string | null
  config: {
    is_result?: boolean
    result_profile?: string
    result_text?: string
    cta_text?: string
    cta_url?: string
    funnel_id?: string
    bg_color?: string
    scale_min?: number
    scale_max?: number
  }
  pos_x: number
  pos_y: number
}

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

async function getTenantId(): Promise<string> {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

export async function getQuizQuestions(pageId: string): Promise<QuizQuestion[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('interactive_questions')
    .select('*')
    .eq('page_id', pageId)
    .order('order_index')
  return (data ?? []) as QuizQuestion[]
}

export async function saveQuizQuestions(
  pageId: string,
  questions: Omit<QuizQuestion, 'tenant_id' | 'page_id'>[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()

    // Verify page belongs to tenant
    const { data: page } = await admin.from('pages').select('id').eq('id', pageId).eq('tenant_id', tenantId).single()
    if (!page) return { success: false, error: 'Página não encontrada' }

    await admin.from('interactive_questions').delete().eq('page_id', pageId)

    if (questions.length > 0) {
      const rows = questions.map((q, idx) => ({
        ...q,
        id: q.id,
        page_id: pageId,
        tenant_id: tenantId,
        order_index: idx,
      }))
      const { error } = await admin.from('interactive_questions').insert(rows)
      if (error) return { success: false, error: error.message }
    }

    revalidatePath('/pages')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function publishQuizPage(
  pageId: string
): Promise<{ success: boolean; slug?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data: page } = await supabase.from('pages').select('slug, title').eq('id', pageId).eq('tenant_id', tenantId).single()
    if (!page) return { success: false, error: 'Página não encontrada' }
    const slug = page.slug || (page.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
    await supabase.from('pages').update({ published: true, slug }).eq('id', pageId).eq('tenant_id', tenantId)
    revalidatePath('/pages')
    return { success: true, slug }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function getQuizAnalytics(pageId: string) {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()

    const { data: responses } = await admin
      .from('interactive_responses')
      .select('answers, result_profile, completed, created_at')
      .eq('page_id', pageId)
      .eq('tenant_id', tenantId)

    const total = responses?.length ?? 0
    const completed = responses?.filter(r => r.completed).length ?? 0
    const profileCounts: Record<string, number> = {}
    for (const r of responses ?? []) {
      if (r.result_profile) profileCounts[r.result_profile] = (profileCounts[r.result_profile] ?? 0) + 1
    }

    // Drop-off per question: count how many responses contain each question_id in answers
    const questionDropoff: Record<string, number> = {}
    for (const r of responses ?? []) {
      for (const qId of Object.keys(r.answers ?? {})) {
        questionDropoff[qId] = (questionDropoff[qId] ?? 0) + 1
      }
    }

    return { total, completed, completionRate: total > 0 ? (completed / total) * 100 : 0, profileCounts, questionDropoff }
  } catch {
    return { total: 0, completed: 0, completionRate: 0, profileCounts: {}, questionDropoff: {} }
  }
}
