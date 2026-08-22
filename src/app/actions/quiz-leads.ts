'use server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  estruturaComContagens, metricasDoQuiz, montarTabelaLeads,
  type ExportLeadResumo, type ExportPageInfo, type ExportPublico, type ExportTable,
  type OpcoesTabela, type QuizMetricas,
} from '@/lib/quiz/leads-core'
import {
  gerarTokenShare, hashSenhaShare, validarSenhaShare,
} from '@/lib/quiz/share'

// Tipos re-exportados para os componentes que já importam daqui.
export type { ExportLeadResumo, ExportPageInfo, ExportPublico, ExportTable, QuizMetricas }

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


/**
 * Busca TODOS os eventos, em páginas.
 *
 * O PostgREST corta a resposta em 1000 linhas por padrão. As consultas de
 * evento não paginavam: com dezenas de leads, os eventos passavam do teto e a
 * maior parte dos leads chegava SEM respostas — a exportação trazia 8 pessoas
 * quando havia muito mais, e as contagens por coluna vinham menores que a
 * realidade. Aqui a leitura continua até a última página.
 */
async function buscarEventos<T>(
  montarConsulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const TAMANHO = 1000
  const todos: T[] = []
  for (let pagina = 0; pagina < 200; pagina++) {   // teto de segurança: 200k eventos
    const de = pagina * TAMANHO
    const { data, error } = await montarConsulta(de, de + TAMANHO - 1)
    if (error || !data) break
    todos.push(...data)
    if (data.length < TAMANHO) break
  }
  return todos
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
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  referrer?: string | null
  landing_url?: string | null
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
      .range(0, 9999)

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
      .range(0, 9999)

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

    // Estrutura das páginas (pra colunas de resposta por pergunta)
    const { data: pageRow } = await admin.from('pages').select('quiz_data').eq('id', quizId).single()
    const qpages = ((pageRow?.quiz_data as { pages?: { id: string; title: string }[] } | null)?.pages) ?? []

    // Respostas de cada lead por página (escolha/texto)
    const events = await buscarEventos<{ lead_id: string; page_id: string; event_type: string; value: unknown }>(
      (de, ate) => admin
        .from('quiz_lead_events')
        .select('lead_id, page_id, event_type, value')
        .eq('quiz_id', quizId)
        .in('event_type', ['choice_selected', 'text_entered', 'button_clicked'])
        .order('created_at', { ascending: true })
        .range(de, ate),
    )
    const answerMap: Record<string, Record<string, string>> = {}
    for (const ev of events) {
      const v = ev.value as { selected?: unknown; text?: unknown } | null
      const ans = ev.event_type === 'choice_selected'
        ? (Array.isArray(v?.selected) ? (v!.selected as unknown[]).join(' | ') : String(v?.selected ?? ''))
        : ev.event_type === 'button_clicked'
        ? (v?.text ? `Clicou: ${String(v.text)}` : '')
        : String(v?.text ?? '')
      if (!ans) continue
      const lid = ev.lead_id as string, pid = ev.page_id as string
      answerMap[lid] = answerMap[lid] || {}
      answerMap[lid][pid] = ans   // última resposta da página vence
    }

    const escape = (v: string | number | null | undefined) => {
      if (v == null) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }

    const header = ['ID','Data','Nome','Email','Telefone','Status','Score','Resultado','Tempo (min)',
      'Origem (utm_source)','Campanha (utm_campaign)','utm_medium','utm_content',
      ...qpages.map(p => p.title || 'Pergunta')].map(escape).join(',')

    const rows = (leads ?? []).map((lead) => {
      const startedAt = lead.started_at ? new Date(lead.started_at).toLocaleString('pt-BR') : ''
      const durationMin = lead.last_activity_at && lead.started_at
        ? Math.round((new Date(lead.last_activity_at).getTime() - new Date(lead.started_at).getTime()) / 60000) : 0
      const la = answerMap[lead.id] ?? {}
      return [
        lead.id.slice(0, 8), startedAt,
        escape(lead.name), escape(lead.email), escape(lead.phone),
        lead.status ?? '', lead.score ?? 0, escape(lead.result_shown), durationMin,
        escape(lead.utm_source), escape(lead.utm_campaign), escape(lead.utm_medium), escape(lead.utm_content),
        ...qpages.map(p => escape(la[p.id] ?? '')),
      ].join(',')
    })

    const csv = [header, ...rows].join('\n')
    return { csv }
  } catch (err) {
    return { error: String(err) }
  }
}

/** Contagem de respostas por página (quantos escolheram cada opção) */
export async function getAnswerBreakdown(quizId: string): Promise<{ breakdown: Record<string, { value: string; count: number }[]> }> {
  try {
    const tenantId = await getTenantId()
    const owns = await verifyTenantOwnsQuiz(quizId, tenantId)
    if (!owns) return { breakdown: {} }
    const admin = createAdminClient()
    const events = await buscarEventos<{ page_id: string; event_type: string; value: unknown }>(
      (de, ate) => admin
        .from('quiz_lead_events')
        .select('page_id, event_type, value')
        .eq('quiz_id', quizId)
        .in('event_type', ['choice_selected', 'button_clicked'])
        .order('created_at', { ascending: true })
        .range(de, ate),
    )
    // page_id → valor → contagem (escolhas E cliques de botão, pra ver o que converte)
    const counts: Record<string, Record<string, number>> = {}
    for (const ev of events) {
      const v = ev.value as { selected?: unknown; text?: unknown } | null
      const pid = ev.page_id as string
      let vals: string[] = []
      if (ev.event_type === 'choice_selected') {
        vals = Array.isArray(v?.selected) ? (v!.selected as unknown[]).map(String) : [String(v?.selected ?? '')]
      } else if (ev.event_type === 'button_clicked' && v?.text) {
        vals = [`🖱 ${String(v.text)}`]
      }
      for (const val of vals) {
        if (!val) continue
        counts[pid] = counts[pid] || {}
        counts[pid][val] = (counts[pid][val] ?? 0) + 1
      }
    }
    const breakdown: Record<string, { value: string; count: number }[]> = {}
    for (const [pid, m] of Object.entries(counts)) {
      breakdown[pid] = Object.entries(m).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count)
    }
    return { breakdown }
  } catch { return { breakdown: {} } }
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

// ─── Exportação com SELEÇÃO de páginas ──────────────────────────────────────
// O miolo mora em src/lib/quiz/leads-core.ts, compartilhado com o painel
// público (/ql/[token]). Aqui só se decide QUEM pode chamar.

export async function getExportStructure(
  quizId: string,
): Promise<{ paginas: ExportPageInfo[]; leads: ExportLeadResumo[] } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    return await estruturaComContagens(createAdminClient(), quizId, tenantId)
  } catch (err) {
    return { error: String(err) }
  }
}

export async function exportLeadsTable(
  quizId: string,
  opts?: OpcoesTabela,
): Promise<ExportTable | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    return await montarTabelaLeads(createAdminClient(), quizId, tenantId, opts)
  } catch (err) {
    return { error: String(err) }
  }
}

/** Métricas completas do painel: cartões + funil página a página. */
export async function getQuizMetricas(
  quizId: string,
): Promise<QuizMetricas | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    return await metricasDoQuiz(createAdminClient(), quizId, tenantId)
  } catch (err) {
    return { error: String(err) }
  }
}

// ─── Link compartilhado com senha ───────────────────────────────────────────
// Para quem capta lead para clientes: gera /ql/<token> + senha, e o cliente
// abre o painel DAQUELE quiz sem conta. A senha nunca é guardada em claro
// (scrypt) e nunca volta para a tela — se for esquecida, gera-se outra.

function shareTabelaAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  if (erro.code === '42P01' || erro.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(erro.message ?? '')
}

const SHARE_MIGRATION_MSG =
  'Aplique a migration 20260822000000_quiz_share_links.sql no Supabase para ativar o compartilhamento'

export interface QuizShareInfo {
  ativo: boolean
  token: string | null
  acessos: number
  ultimoAcesso: string | null
}

export async function getQuizShare(
  quizId: string,
): Promise<QuizShareInfo | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('quiz_share_links')
      .select('token, enabled, access_count, last_access_at')
      .eq('page_id', quizId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (error) {
      return shareTabelaAusente(error) ? { error: SHARE_MIGRATION_MSG } : { error: error.message }
    }
    if (!data || !data.enabled) return { ativo: false, token: null, acessos: 0, ultimoAcesso: null }
    return {
      ativo: true,
      token: String(data.token),
      acessos: Number(data.access_count ?? 0),
      ultimoAcesso: data.last_access_at ?? null,
    }
  } catch (err) {
    return { error: String(err) }
  }
}

/**
 * Ativa (ou renova) o compartilhamento com uma senha nova.
 *
 * Sempre gera token novo: trocar a senha invalida o link antigo junto — quem
 * tinha o link velho não continua entrando com a senha velha.
 */
export async function ativarQuizShare(
  quizId: string,
  senha: string,
): Promise<{ token: string } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    const invalida = validarSenhaShare(senha)
    if (invalida) return { error: invalida }

    const admin = createAdminClient()
    const token = gerarTokenShare()
    const { error } = await admin
      .from('quiz_share_links')
      .upsert({
        tenant_id: tenantId,
        page_id: quizId,
        token,
        password_hash: hashSenhaShare(senha.trim()),
        enabled: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'page_id' })
    if (error) {
      return shareTabelaAusente(error) ? { error: SHARE_MIGRATION_MSG } : { error: error.message }
    }
    return { token }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function desativarQuizShare(
  quizId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    const admin = createAdminClient()
    const { error } = await admin
      .from('quiz_share_links')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('page_id', quizId)
      .eq('tenant_id', tenantId)
    if (error && !shareTabelaAusente(error)) return { error: error.message }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}
