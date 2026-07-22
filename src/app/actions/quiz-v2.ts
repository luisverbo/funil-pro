'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlockType =
  | 'field_text' | 'field_email' | 'field_phone' | 'field_number' | 'field_textarea'
  | 'field_date' | 'field_height' | 'field_weight'
  | 'single_choice' | 'multi_choice' | 'yes_no' | 'scale' | 'video_answer'
  | 'heading' | 'text_block' | 'image' | 'video' | 'audio'
  | 'button' | 'final_capture' | 'result'
  | 'hero' | 'testimonials' | 'features' | 'faq' | 'countdown'
  | 'alert' | 'notification' | 'loading' | 'level'
  | 'pricing' | 'checklist' | 'before_after' | 'carousel'
  | 'metrics' | 'chart'
  | 'spacer' | 'html_embed'

export interface BlockOption {
  id: string
  label: string
  emoji?: string
  image_url?: string
  points?: number
  goto_page_id?: string | null
}

export interface TestimonialItem {
  id: string
  name: string
  photo_url?: string
  text: string
  stars?: number
}

export interface FeatureItem {
  id: string
  icon?: string
  title: string
  description?: string
}

export interface FaqItem {
  id: string
  question: string
  answer: string
}

export interface ScoreRangeV2 {
  min: number
  max: number
  goto_page_id?: string | null
}

export interface PricingItem {
  id: string
  text: string
  included?: boolean
}

export interface ChecklistItem {
  id: string
  text: string
}

export interface CarouselItem {
  id: string
  image_url: string
  caption?: string
}

export interface MetricItem {
  id: string
  value: string        // ex: "10.000" ou "98"
  suffix?: string      // ex: "+", "%"
  label: string
}

export interface ChartDatum {
  id: string
  label: string
  value: number
  color?: string
}

export interface NotificationItem {
  id: string
  text: string
}

export interface BlockConfig {
  // Form fields
  label?: string
  placeholder?: string
  required?: boolean
  bg_color?: string          // cor dos cards de opção (escolha única/múltipla)
  next_button_text?: string  // texto do botão "Próximo" da múltipla escolha

  // Choice/scale blocks
  question?: string
  subtitle?: string
  options?: BlockOption[]
  scale_min?: number
  scale_max?: number

  // Heading (Título)
  heading_text?: string
  heading_size?: 'sm' | 'md' | 'lg' | 'xl'
  heading_align?: 'left' | 'center' | 'right'
  heading_color?: string
  heading_highlight?: string   // cor do marca-texto atrás do título (vazio = sem)

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
  button_size?: 'sm' | 'md' | 'lg'

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

  // Integrations (button + final_capture)
  webhook_enabled?: boolean
  webhook_url?: string
  webhook_send_name?: boolean
  webhook_send_email?: boolean
  webhook_send_phone?: boolean
  webhook_send_answers?: boolean
  webhook_send_score?: boolean
  funnel_enroll_enabled?: boolean
  funnel_enroll_id?: string

  // Pixel de conversão por etapa (button + final_capture)
  pixel_event?: 'Lead' | 'CompleteRegistration' | 'InitiateCheckout' | 'Purchase' | 'custom' | 'none'
  pixel_event_custom?: string

  // Hero (landing)
  hero_headline?: string
  hero_subheadline?: string
  hero_image_url?: string
  hero_cta_text?: string
  hero_cta_action?: 'next_page' | 'external_url'
  hero_cta_url?: string
  hero_align?: 'left' | 'center'

  // Testimonials (landing)
  testimonials_title?: string
  testimonials?: TestimonialItem[]

  // Features (landing)
  features_title?: string
  features?: FeatureItem[]
  features_columns?: 2 | 3

  // FAQ (landing)
  faq_title?: string
  faq_items?: FaqItem[]

  // Countdown (landing)
  countdown_mode?: 'date' | 'evergreen'
  countdown_target?: string       // ISO date quando mode='date'
  countdown_minutes?: number      // minutos quando mode='evergreen'
  countdown_text?: string
  countdown_expired_text?: string

  // ─── Universal: aparição temporizada (todos os blocos) ───
  appear_delay?: number           // segundos até o bloco aparecer (0/undefined = imediato)
  space_after?: number            // espaço (px) abaixo do bloco (default 24)

  // Text block: estilo/alinhamento herdado
  text_align?: 'left' | 'center' | 'right'

  // Alert
  alert_text?: string
  alert_variant?: 'info' | 'success' | 'warning' | 'danger'

  // Notification (prova social recorrente)
  notification_items?: NotificationItem[]
  notification_interval?: number  // segundos entre notificações

  // Loading (revela/avança após N segundos)
  loading_text?: string
  loading_seconds?: number
  loading_auto_advance?: boolean  // avança para próxima página ao terminar

  // Level (barra de nível)
  level_label?: string
  level_percent?: number
  level_color?: string

  // Pricing
  pricing_title?: string
  pricing_price?: string
  pricing_period?: string
  pricing_items?: PricingItem[]
  pricing_cta_text?: string
  pricing_cta_url?: string
  pricing_highlight?: boolean

  // Checklist
  checklist_title?: string
  checklist_items?: ChecklistItem[]

  // Before / After
  before_image_url?: string
  after_image_url?: string
  before_label?: string
  after_label?: string

  // Carousel
  carousel_items?: CarouselItem[]
  carousel_fit?: 'cover' | 'contain'   // 'contain' = mostra a imagem inteira (não corta)
  carousel_height?: number

  // Metrics
  metrics_items?: MetricItem[]

  // Chart
  chart_title?: string
  chart_type?: 'bar' | 'pie'
  chart_data?: ChartDatum[]

  // Spacer
  spacer_height?: number          // px

  // HTML embed
  html_content?: string

  // Audio
  audio_url?: string
  audio_title?: string

  // Date / Height / Weight fields reusam label/placeholder/required

  // Video answer (vídeo + opções)
  video_answer_url?: string
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

export interface QuizTheme {
  preset?: 'clean' | 'dark' | 'gradient' | 'minimal' | 'bold' | 'whatsapp'
  font?: 'inter' | 'poppins' | 'playfair' | 'montserrat'
  bg_type?: 'color' | 'gradient' | 'image'
  bg_value?: string
  card_style?: 'flat' | 'shadow' | 'glass'
  button_radius?: 'none' | 'md' | 'full'
  dark_mode?: boolean
  // overrides de cor (vazio = derivado do tema/modo escuro)
  text_color?: string     // cor do texto principal
  muted_color?: string    // cor secundária (subtítulos, textos apagados)
  card_color?: string     // cor de fundo dos cards
}

export interface QuizSettings {
  title?: string
  primary_color?: string
  logo_url?: string
  show_progress?: boolean
  progress_color?: string   // cor da barra de progresso (vazio = cor principal)
  show_back?: boolean       // mostrar botão "Voltar" (default true)
  theme?: QuizTheme
  pixel_id?: string
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

    // A coluna quiz_data já existe via migration — não rodar DDL por request
    // (o antigo rpc('exec_sql') era vetor de SQL arbitrário + lock a cada carga do editor).
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

    const base = (page.title as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'quiz'

    // Se já tem slug, mantém. Senão gera um único checando colisão global
    // (a rota /pg/[slug] é consultada por slug em toda a tabela — colisão quebraria a página errada).
    let slug = page.slug as string | null
    if (!slug) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`
        const { data: clash } = await supabase.from('pages').select('id').eq('slug', candidate).limit(1).maybeSingle()
        if (!clash) { slug = candidate; break }
      }
      if (!slug) return { success: false, error: 'Não foi possível gerar um endereço único. Tente de novo.' }
    }

    const { error: updErr } = await supabase
      .from('pages')
      .update({ published: true, slug })
      .eq('id', pageId)
      .eq('tenant_id', tenantId)
    if (updErr) return { success: false, error: updErr.message }

    revalidatePath('/pages')
    revalidatePath(`/pg/${slug}`)   // #23: revalida a página pública após publicar
    return { success: true, slug }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
