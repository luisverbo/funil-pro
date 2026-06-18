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

    const { data: page } = await supabase
      .from('pages')
      .select('id, title, slug, published, quiz_data')
      .eq('id', pageId)
      .eq('tenant_id', tenantId)
      .single()

    if (!page) return { error: 'page_not_found' }

    const { data: funnels } = await supabase
      .from('funnels')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('status', 'published')
      .order('name')

    return {
      page: { id: page.id, title: page.title, slug: page.slug, published: page.published },
      data: (page.quiz_data as QuizData | null) ?? undefined,
      funnels: funnels ?? [],
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
