'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlockType =
  | 'field_text' | 'field_email' | 'field_phone' | 'field_number' | 'field_textarea'
  | 'single_choice' | 'multi_choice' | 'yes_no' | 'scale'
  | 'text_block' | 'image' | 'video'
  | 'button' | 'final_capture' | 'result'

export interface BlockOption {
  id: string
  label: string
  emoji?: string
  points?: number
  goto_page_id?: string | null
}

export interface ScoreRangeV2 {
  min: number
  max: number
  goto_page_id?: string | null
}

export interface BlockConfig {
  // Form fields
  label?: string
  placeholder?: string
  required?: boolean
  bg_color?: string

  // Choice/scale blocks
  question?: string
  subtitle?: string
  options?: BlockOption[]
  scale_min?: number
  scale_max?: number

  // Text block
  content?: string

  // Image
  image_url?: string
  image_size?: 'small' | 'medium' | 'large' | 'full'
  image_align?: 'left' | 'center' | 'right'

  // Video
  video_url?: string

  // Button
  button_text?: string
  button_action?: 'next_page' | 'external_url' | 'submit'
  button_url?: string
  button_color?: string
  button_align?: 'left' | 'center' | 'right'

  // Final capture
  show_name?: boolean
  show_email?: boolean
  show_phone?: boolean
  submit_text?: string

  // Result
  title?: string
  description?: string
  show_score?: boolean
  score_display_text?: string
  score_ranges?: ScoreRangeV2[]
  cta_text?: string
  cta_url?: string
  funnel_id?: string
}

export interface QuizBlock {
  id: string
  type: BlockType
  order: number
  config: BlockConfig
}

export interface QuizPage {
  id: string
  title: string
  order: number
  blocks: QuizBlock[]
}

export interface QuizSettings {
  title?: string
  primary_color?: string
  logo_url?: string
  show_progress?: boolean
}

export interface QuizData {
  version: 2
  pages: QuizPage[]
  settings: QuizSettings
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
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

// ─── v1 → v2 migration ────────────────────────────────────────────────────────

type V1Question = {
  id: string
  question_type: string
  question_text: string
  subtitle?: string
  options?: { id: string; label: string; emoji?: string }[]
  config?: {
    is_result?: boolean
    result_text?: string
    cta_text?: string
    cta_url?: string
    funnel_id?: string
    bg_color?: string
    scale_min?: number
    scale_max?: number
    show_score?: boolean
  }
  required?: boolean
  order_index: number
}

function migrateV1ToV2(questions: V1Question[]): QuizData {
  const typeMap: Record<string, BlockType> = {
    single_choice: 'single_choice',
    multi_choice: 'multi_choice',
    text_short: 'field_text',
    text_long: 'field_textarea',
    scale: 'scale',
    email: 'field_email',
    phone: 'field_phone',
    final_capture: 'final_capture',
    result: 'result',
    yes_no: 'yes_no',
  }

  const sorted = [...questions].sort((a, b) => a.order_index - b.order_index)

  const pages: QuizPage[] = sorted.map((q, idx) => {
    const blockType: BlockType = typeMap[q.question_type] ?? 'field_text'
    const isResult = q.config?.is_result || q.question_type === 'result' || q.question_type === 'final_capture'

    const config: BlockConfig = isResult
      ? {
          title: q.question_text || 'Resultado',
          description: q.config?.result_text,
          cta_text: q.config?.cta_text,
          cta_url: q.config?.cta_url,
          funnel_id: q.config?.funnel_id,
          show_score: q.config?.show_score,
          bg_color: q.config?.bg_color,
        }
      : {
          question: q.question_text,
          subtitle: q.subtitle,
          required: q.required,
          bg_color: q.config?.bg_color,
          options: q.options?.map(o => ({ id: o.id, label: o.label, emoji: o.emoji })),
          scale_min: q.config?.scale_min,
          scale_max: q.config?.scale_max,
        }

    const block: QuizBlock = {
      id: q.id,
      type: isResult && q.question_type === 'final_capture' ? 'final_capture' : isResult ? 'result' : blockType,
      order: 0,
      config,
    }

    return {
      id: `page-${q.id}`,
      title: `Etapa ${idx + 1}`,
      order: idx,
      blocks: [block],
    }
  })

  return { version: 2, pages, settings: {} }
}

// ─── Server actions ───────────────────────────────────────────────────────────

export async function loadQuizV2(pageId: string): Promise<{
  page?: { id: string; title: string; slug: string | null; published: boolean }
  data?: QuizData
  funnels?: { id: string; name: string }[]
  tenantId?: string
  error?: string
}> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const admin = createAdminClient()

    // Ensure quiz_data column exists (idempotent) — silently ignore if RPC absent
    try {
      await admin.rpc('exec_sql' as never, { sql: 'ALTER TABLE pages ADD COLUMN IF NOT EXISTS quiz_data jsonb;' })
    } catch { /* column already exists or RPC not available */ }

    const { data: page, error: pageError } = await supabase
      .from('pages')
      .select('id, title, slug, published, quiz_data')
      .eq('id', pageId)
      .eq('tenant_id', tenantId)
      .single()

    if (pageError || !page) return { error: 'page_not_found' }

    const [funnelsResult, questionsResult] = await Promise.all([
      supabase.from('funnels').select('id, name').eq('tenant_id', tenantId).eq('status', 'published').order('name'),
      // Load v1 questions for potential migration
      (page.quiz_data as QuizData | null)?.version !== 2
        ? supabase.from('interactive_questions').select('*').eq('page_id', pageId).order('order_index')
        : Promise.resolve({ data: null }),
    ])

    let quizData = (page.quiz_data as QuizData | null) ?? undefined

    // Auto-migrate v1 → v2 if no v2 data but v1 questions exist
    if (!quizData && questionsResult.data && questionsResult.data.length > 0) {
      quizData = migrateV1ToV2(questionsResult.data as V1Question[])
    }

    return {
      page: { id: page.id, title: page.title, slug: page.slug, published: page.published },
      data: quizData,
      funnels: funnelsResult.data ?? [],
      tenantId,
    }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function saveQuizV2(
  pageId: string,
  data: QuizData
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()

    const { data: page } = await admin
      .from('pages')
      .select('id')
      .eq('id', pageId)
      .eq('tenant_id', tenantId)
      .single()

    if (!page) return { success: false, error: 'Página não encontrada' }

    const { error } = await admin
      .from('pages')
      .update({ quiz_data: data })
      .eq('id', pageId)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/pages')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function publishQuizV2(
  pageId: string
): Promise<{ success: boolean; slug?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()

    const { data: page } = await supabase
      .from('pages')
      .select('slug, title')
      .eq('id', pageId)
      .eq('tenant_id', tenantId)
      .single()

    if (!page) return { success: false, error: 'Página não encontrada' }

    const slug = page.slug ||
      (page.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).slice(2, 6)

    await supabase
      .from('pages')
      .update({ published: true, slug })
      .eq('id', pageId)
      .eq('tenant_id', tenantId)

    revalidatePath('/pages')
    return { success: true, slug }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
