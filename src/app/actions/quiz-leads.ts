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
import { publicoPortalValido, type PublicoPortal } from '@/lib/quiz/portal'

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

// ─── Portal do cliente ──────────────────────────────────────────────────────
// UM acesso por cliente (link + senha), com VÁRIOS funis dentro. O dono
// escolhe o que o cliente vê em cada funil — por padrão só quem concluiu, o
// lead quente. A senha nunca é guardada em claro (scrypt) e nunca volta para
// a tela; esquecer = gerar link novo (o antigo morre junto).

function portalTabelaAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  if (erro.code === '42P01' || erro.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(erro.message ?? '')
}

const PORTAL_MIGRATION_MSG =
  'Aplique a migration 20260823000000_client_portals.sql no Supabase para ativar o portal do cliente'

export interface PortalQuizConfig { pageId: string; titulo: string; publico: PublicoPortal }
export interface PortalInfo {
  ativo: boolean
  portalId: string | null
  token: string | null
  nome: string
  acessos: number
  ultimoAcesso: string | null
  quizzes: PortalQuizConfig[]
  mostrarMetricas: boolean
  mostrarFunil: boolean
  permitirStatus: boolean
}

/** Quizzes do tenant — para o dono escolher quais entram no portal. */
export async function listarQuizzesDoTenant(): Promise<{ id: string; titulo: string }[] | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data } = await admin
      .from('pages')
      .select('id, title, quiz_data, page_type')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(0, 499)
    return (data ?? [])
      .filter(p => p.quiz_data != null || p.page_type === 'interactive')
      .map(p => ({ id: String(p.id), titulo: String(p.title ?? 'Quiz') }))
  } catch (err) {
    return { error: String(err) }
  }
}

/** O portal que contém este quiz (se houver). O modal abre a partir do quiz. */
export async function getPortalDoQuiz(quizId: string): Promise<PortalInfo | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    const admin = createAdminClient()

    const { data: vinculo, error } = await admin
      .from('client_portal_quizzes')
      .select('portal_id')
      .eq('page_id', quizId)
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle()
    if (error) {
      return portalTabelaAusente(error) ? { error: PORTAL_MIGRATION_MSG } : { error: error.message }
    }

    const vazio: PortalInfo = {
      ativo: false, portalId: null, token: null, nome: '', acessos: 0, ultimoAcesso: null,
      quizzes: [], mostrarMetricas: true, mostrarFunil: false, permitirStatus: true,
    }
    if (!vinculo) return vazio

    const { data: portal } = await admin
      .from('client_portals')
      .select('id, nome, token, enabled, access_count, last_access_at, mostrar_metricas, mostrar_funil, permitir_status')
      .eq('id', vinculo.portal_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!portal) return vazio

    const { data: quizzes } = await admin
      .from('client_portal_quizzes')
      .select('page_id, publico, pages(title)')
      .eq('portal_id', portal.id)

    return {
      ativo: Boolean(portal.enabled),
      portalId: String(portal.id),
      token: portal.enabled ? String(portal.token) : null,
      nome: String(portal.nome ?? ''),
      acessos: Number(portal.access_count ?? 0),
      ultimoAcesso: portal.last_access_at ?? null,
      quizzes: (quizzes ?? []).map(q => ({
        pageId: String(q.page_id),
        titulo: String((q.pages as { title?: string } | null)?.title ?? 'Quiz'),
        publico: publicoPortalValido(q.publico) ? q.publico : 'concluidos',
      })),
      mostrarMetricas: Boolean(portal.mostrar_metricas),
      mostrarFunil: Boolean(portal.mostrar_funil),
      permitirStatus: Boolean(portal.permitir_status),
    }
  } catch (err) {
    return { error: String(err) }
  }
}

export interface AtivarPortalInput {
  nome: string
  senha: string
  /** Quais quizzes entram, com o público de cada um. */
  quizzes: { pageId: string; publico: PublicoPortal }[]
  mostrarMetricas: boolean
  mostrarFunil: boolean
  permitirStatus: boolean
  /** Portal existente a renovar; ausente = criar novo. */
  portalId?: string
}

/**
 * Cria ou renova o portal. SEMPRE gera token novo: trocar a senha mata o
 * link antigo junto — quem tinha o link velho não continua entrando.
 */
export async function ativarPortal(
  entrada: AtivarPortalInput,
): Promise<{ token: string; portalId: string } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const invalida = validarSenhaShare(entrada.senha)
    if (invalida) return { error: invalida }
    if (!Array.isArray(entrada.quizzes) || entrada.quizzes.length === 0) {
      return { error: 'Escolha ao menos um funil para o portal' }
    }

    const admin = createAdminClient()

    // Lista branca: só quizzes DESTE tenant entram — id de fora é descartado.
    const { data: paginas } = await admin
      .from('pages').select('id').eq('tenant_id', tenantId)
      .in('id', entrada.quizzes.map(q => q.pageId).slice(0, 100))
    const permitidos = new Set((paginas ?? []).map(p => String(p.id)))
    const quizzes = entrada.quizzes
      .filter(q => permitidos.has(q.pageId))
      .map(q => ({ pageId: q.pageId, publico: publicoPortalValido(q.publico) ? q.publico : 'concluidos' as PublicoPortal }))
    if (quizzes.length === 0) return { error: 'Nenhum funil válido na seleção' }

    const token = gerarTokenShare()
    const linha = {
      tenant_id: tenantId,
      nome: entrada.nome.trim().slice(0, 80) || 'Cliente',
      token,
      password_hash: hashSenhaShare(entrada.senha.trim()),
      enabled: true,
      mostrar_metricas: Boolean(entrada.mostrarMetricas),
      mostrar_funil: Boolean(entrada.mostrarFunil),
      permitir_status: Boolean(entrada.permitirStatus),
      updated_at: new Date().toISOString(),
    }

    let portalId = entrada.portalId ?? null
    if (portalId) {
      const { error } = await admin.from('client_portals')
        .update(linha).eq('id', portalId).eq('tenant_id', tenantId)
      if (error) {
        return portalTabelaAusente(error) ? { error: PORTAL_MIGRATION_MSG } : { error: error.message }
      }
    } else {
      const { data, error } = await admin.from('client_portals')
        .insert(linha).select('id').single()
      if (error || !data) {
        return portalTabelaAusente(error) ? { error: PORTAL_MIGRATION_MSG } : { error: error?.message ?? 'erro' }
      }
      portalId = String(data.id)
    }

    // Vínculos recriados do zero: o que saiu da seleção sai do portal.
    await admin.from('client_portal_quizzes').delete().eq('portal_id', portalId).eq('tenant_id', tenantId)
    const { error: erroVinculo } = await admin.from('client_portal_quizzes').insert(
      quizzes.map(q => ({ tenant_id: tenantId, portal_id: portalId, page_id: q.pageId, publico: q.publico })),
    )
    if (erroVinculo) return { error: erroVinculo.message }

    return { token, portalId }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function desativarPortal(portalId: string): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { error } = await admin
      .from('client_portals')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('id', portalId)
      .eq('tenant_id', tenantId)
    if (error && !portalTabelaAusente(error)) return { error: error.message }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

// ─── Investimento manual por funil ──────────────────────────────────────────
// Enquanto a Meta não conecta, o dono lança o gasto por dia. O portal usa
// isso para calcular custo por lead e custo por lead quente. Uma linha por
// dia: lançar de novo CORRIGE o valor do dia, não soma.

export interface InvestimentoDia { id: string; date: string; amountCents: number; note: string | null }

const SPEND_MIGRATION_MSG =
  'Aplique a migration 20260824000000_quiz_spend.sql no Supabase para lançar investimento'

export async function listarInvestimentos(
  quizId: string,
): Promise<{ dias: InvestimentoDia[]; totalCents: number } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('quiz_spend_entries')
      .select('id, date, amount_cents, note')
      .eq('page_id', quizId)
      .eq('tenant_id', tenantId)
      .order('date', { ascending: false })
      .range(0, 999)
    if (error) {
      return portalTabelaAusente(error) ? { error: SPEND_MIGRATION_MSG } : { error: error.message }
    }
    const dias = (data ?? []).map(l => ({
      id: String(l.id), date: String(l.date),
      amountCents: Number(l.amount_cents ?? 0), note: l.note ?? null,
    }))
    return { dias, totalCents: dias.reduce((s, d) => s + d.amountCents, 0) }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function salvarInvestimento(
  quizId: string,
  entrada: { date: string; amountCents: number; note?: string },
): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    const cents = Math.round(Number(entrada.amountCents))
    if (!Number.isFinite(cents) || cents <= 0 || cents > 100_000_000) {
      return { error: 'Informe um valor válido (maior que zero)' }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.date)) return { error: 'Data inválida' }

    const admin = createAdminClient()
    const { error } = await admin.from('quiz_spend_entries').upsert({
      tenant_id: tenantId,
      page_id: quizId,
      date: entrada.date,
      amount_cents: cents,
      note: (entrada.note ?? '').trim().slice(0, 200) || null,
    }, { onConflict: 'tenant_id,page_id,date' })
    if (error) {
      return portalTabelaAusente(error) ? { error: SPEND_MIGRATION_MSG } : { error: error.message }
    }
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function excluirInvestimento(
  quizId: string,
  entradaId: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(await verifyTenantOwnsQuiz(quizId, tenantId))) {
      return { error: 'Quiz não encontrado ou sem permissão' }
    }
    const admin = createAdminClient()
    await admin.from('quiz_spend_entries')
      .delete().eq('id', entradaId).eq('tenant_id', tenantId).eq('page_id', quizId)
    return { ok: true }
  } catch (err) {
    return { error: String(err) }
  }
}
