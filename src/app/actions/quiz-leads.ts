'use server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'

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

export interface QuizLead {
  id: string
  quiz_id: string
  started_at: string
  last_activity_at: string
  status: 'in_progress' | 'completed' | 'abandoned'
  current_page_id: string | null
  score: number
  result_shown: string | null
  name: string | null
  email: string | null
  phone: string | null
}

export interface QuizLeadEvent {
  id: string
  lead_id: string
  page_id: string
  block_id: string | null
  event_type: string
  value: Record<string, unknown>
  created_at: string
}

export interface QuizLeadWithEvents extends QuizLead {
  events: QuizLeadEvent[]
}

export interface QuizLeadsResult {
  leads: QuizLeadWithEvents[]
  total: number
  page: number
  pageSize: number
}

async function verifyTenantOwnsQuiz(quizId: string, tenantId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('pages')
    .select('tenant_id')
    .eq('id', quizId)
    .single()
  return data?.tenant_id === tenantId
}

export async function getQuizLeads(
  quizId: string,
  options?: {
    search?: string
    period?: '24h' | '7d' | '30d' | 'all'
    page?: number
    pageSize?: number
  }
): Promise<QuizLeadsResult | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const owns = await verifyTenantOwnsQuiz(quizId, tenantId)
    if (!owns) return { error: 'Quiz não encontrado ou sem permissão' }

    const page = options?.page ?? 1
    const pageSize = options?.pageSize ?? 50
    const search = options?.search?.trim()
    const period = options?.period ?? 'all'

    const admin = createAdminClient()

    // Build period filter
    let periodStart: string | null = null
    if (period !== 'all') {
      const hours = period === '24h' ? 24 : period === '7d' ? 168 : 720
      periodStart = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    }

    // Count query
    let countQuery = admin
      .from('quiz_leads')
      .select('id', { count: 'exact', head: true })
      .eq('quiz_id', quizId)
      .eq('tenant_id', tenantId)

    if (periodStart) countQuery = countQuery.gte('started_at', periodStart)
    if (search) {
      countQuery = countQuery.or(
        `name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
      )
    }

    const { count } = await countQuery
    const total = count ?? 0

    // Data query
    let dataQuery = admin
      .from('quiz_leads')
      .select('*')
      .eq('quiz_id', quizId)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1)

    if (periodStart) dataQuery = dataQuery.gte('started_at', periodStart)
    if (search) {
      dataQuery = dataQuery.or(
        `name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
      )
    }

    const { data: leads, error } = await dataQuery
    if (error) return { error: error.message }

    if (!leads || leads.length === 0) {
      return { leads: [], total, page, pageSize }
    }

    // Fetch events for these leads
    const leadIds = leads.map((l) => l.id)
    const { data: events } = await admin
      .from('quiz_lead_events')
      .select('*')
      .in('lead_id', leadIds)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })

    const eventsByLead = new Map<string, QuizLeadEvent[]>()
    for (const ev of events ?? []) {
      const arr = eventsByLead.get(ev.lead_id) ?? []
      arr.push(ev as QuizLeadEvent)
      eventsByLead.set(ev.lead_id, arr)
    }

    const leadsWithEvents: QuizLeadWithEvents[] = leads.map((lead) => ({
      ...(lead as QuizLead),
      events: eventsByLead.get(lead.id) ?? [],
    }))

    return { leads: leadsWithEvents, total, page, pageSize }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function getLeadDetail(
  leadId: string
): Promise<{ lead: QuizLeadWithEvents } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()

    const { data: lead, error: leadError } = await admin
      .from('quiz_leads')
      .select('*')
      .eq('id', leadId)
      .single()

    if (leadError || !lead) return { error: 'Lead não encontrado' }

    // Verify tenant ownership via quiz (page)
    const owns = await verifyTenantOwnsQuiz(lead.quiz_id, tenantId)
    if (!owns) return { error: 'Sem permissão para acessar este lead' }

    const { data: events } = await admin
      .from('quiz_lead_events')
      .select('*')
      .eq('lead_id', leadId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })

    return {
      lead: {
        ...(lead as QuizLead),
        events: (events ?? []) as QuizLeadEvent[],
      },
    }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function exportLeadsCSV(
  quizId: string
): Promise<{ csv: string } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const owns = await verifyTenantOwnsQuiz(quizId, tenantId)
    if (!owns) return { error: 'Quiz não encontrado ou sem permissão' }

    const admin = createAdminClient()

    const { data: leads, error } = await admin
      .from('quiz_leads')
      .select('*')
      .eq('quiz_id', quizId)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })

    if (error) return { error: error.message }

    const header = 'ID,Data,Nome,Email,Telefone,Status,Score,Resultado,Tempo (min)'

    const rows = (leads ?? []).map((lead) => {
      const shortId = lead.id.slice(0, 8)
      const startedAt = lead.started_at
        ? new Date(lead.started_at).toLocaleString('pt-BR')
        : ''
      const durationMin =
        lead.last_activity_at && lead.started_at
          ? Math.round(
              (new Date(lead.last_activity_at).getTime() -
                new Date(lead.started_at).getTime()) /
                60000
            )
          : 0

      const escape = (v: string | null | undefined) => {
        if (v == null) return ''
        const s = String(v)
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s
      }

      return [
        shortId,
        startedAt,
        escape(lead.name),
        escape(lead.email),
        escape(lead.phone),
        lead.status ?? '',
        lead.score ?? 0,
        escape(lead.result_shown),
        durationMin,
      ].join(',')
    })

    const csv = [header, ...rows].join('\n')
    return { csv }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function resetQuizLeads(
  quizId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const owns = await verifyTenantOwnsQuiz(quizId, tenantId)
    if (!owns) return { success: false, error: 'Quiz não encontrado ou sem permissão' }

    const admin = createAdminClient()

    const { error } = await admin
      .from('quiz_leads')
      .delete()
      .eq('quiz_id', quizId)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function getQuizStats(quizId: string): Promise<
  | {
      total: number
      completed: number
      inProgress: number
      completionRate: number
      topDropOffPageId: string | null
    }
  | { error: string }
> {
  try {
    const tenantId = await getTenantId()
    const owns = await verifyTenantOwnsQuiz(quizId, tenantId)
    if (!owns) return { error: 'Quiz não encontrado ou sem permissão' }

    const admin = createAdminClient()

    const { data: leads, error } = await admin
      .from('quiz_leads')
      .select('status, current_page_id')
      .eq('quiz_id', quizId)
      .eq('tenant_id', tenantId)

    if (error) return { error: error.message }

    const all = leads ?? []
    const total = all.length
    const completed = all.filter((l) => l.status === 'completed').length
    const inProgress = all.filter((l) => l.status === 'in_progress').length
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0

    // Find top drop-off page among non-completed leads
    const dropOffCounts = new Map<string, number>()
    for (const lead of all) {
      if (lead.status !== 'completed' && lead.current_page_id) {
        dropOffCounts.set(
          lead.current_page_id,
          (dropOffCounts.get(lead.current_page_id) ?? 0) + 1
        )
      }
    }

    let topDropOffPageId: string | null = null
    let maxCount = 0
    for (const [pageId, count] of dropOffCounts.entries()) {
      if (count > maxCount) {
        maxCount = count
        topDropOffPageId = pageId
      }
    }

    return { total, completed, inProgress, completionRate, topDropOffPageId }
  } catch (err) {
    return { error: String(err) }
  }
}
