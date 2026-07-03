'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentStatus = 'draft' | 'active' | 'paused'
export type AgentMode = 'standalone' | 'funnel_block'
export type AgentObjective = 'qualify' | 'route_to_funnel' | 'sell_direct'

export interface ProductPrice {
  id: string
  label: string   // ex: "Mensal", "Anual", "Avulso"
  value_cents: number
}

export interface AgentInput {
  name: string
  mode?: AgentMode
  objective?: AgentObjective
  product_name?: string | null
  product_description?: string | null
  product_price_cents?: number | null
  product_prices?: ProductPrice[] | null
  product_page_url?: string | null
  tone_of_voice?: string | null
  greeting_message?: string | null
  qualification_rules?: string | null
  objection_handling?: string | null
  payment_link?: string | null
  target_funnel_id?: string | null
  max_messages_per_conversation?: number | null
  handoff_to_human_keywords?: string[] | null
  business_hours_only?: boolean | null
  business_hours_start?: string | null
  business_hours_end?: string | null
  whatsapp_instance_id?: string | null
  max_activations_per_month?: number | null
}

export interface Agent extends AgentInput {
  id: string
  tenant_id: string
  status: AgentStatus
  activations_used: number
  created_at: string
  updated_at: string
}

export interface AgentWithStats extends Agent {
  total_conversations: number
  rate: number
  rate_label: string
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

const ALLOWED_FIELDS: (keyof AgentInput)[] = [
  'name', 'mode', 'objective', 'product_name', 'product_description', 'product_price_cents',
  'tone_of_voice', 'greeting_message', 'qualification_rules', 'objection_handling', 'payment_link',
  'target_funnel_id', 'max_messages_per_conversation', 'handoff_to_human_keywords',
  'business_hours_only', 'business_hours_start', 'business_hours_end', 'whatsapp_instance_id',
  'max_activations_per_month', 'product_prices', 'product_page_url',
]

function sanitize(data: Partial<AgentInput>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in data) out[key] = data[key]
  }
  return out
}

// ─── Conversation stats helper ──────────────────────────────────────────────

function computeRate(
  objective: AgentObjective | undefined,
  conversations: { status: string }[]
): { total: number; rate: number; label: string } {
  const total = conversations.length
  let goodStatuses: string[]
  let label: string
  if (objective === 'sell_direct') { goodStatuses = ['sold']; label = 'venda' }
  else if (objective === 'route_to_funnel') { goodStatuses = ['routed_to_funnel']; label = 'roteado' }
  else { goodStatuses = ['qualified', 'sold', 'routed_to_funnel']; label = 'qualificação' }
  const good = conversations.filter(c => goodStatuses.includes(c.status)).length
  const rate = total > 0 ? Math.round((good / total) * 100) : 0
  return { total, rate, label }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function listAgents(): Promise<{ agents: AgentWithStats[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data: agents, error } = await supabase
      .from('ai_agents')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    if (error) return { agents: [], error: error.message }

    const ids = (agents ?? []).map(a => a.id)
    let convs: { agent_id: string; status: string }[] = []
    if (ids.length > 0) {
      const { data } = await supabase
        .from('agent_conversations')
        .select('agent_id, status')
        .in('agent_id', ids)
      convs = data ?? []
    }

    const withStats: AgentWithStats[] = (agents ?? []).map(a => {
      const agentConvs = convs.filter(c => c.agent_id === a.id)
      const { total, rate, label } = computeRate(a.objective, agentConvs)
      return { ...(a as Agent), total_conversations: total, rate, rate_label: label }
    })
    return { agents: withStats }
  } catch (err) {
    return { agents: [], error: String(err) }
  }
}

export async function getAgent(id: string): Promise<{
  agent?: Agent
  documents?: { id: string; file_name: string; uploaded_at: string }[]
  conversations?: { id: string; status: string; message_count: number; started_at: string }[]
  error?: string
}> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data: agent, error } = await supabase
      .from('ai_agents').select('*').eq('id', id).eq('tenant_id', tenantId).single()
    if (error || !agent) return { error: 'not_found' }

    const [docsRes, convRes] = await Promise.all([
      supabase.from('agent_documents').select('id, file_name, uploaded_at').eq('agent_id', id).order('uploaded_at', { ascending: false }),
      supabase.from('agent_conversations').select('id, status, message_count, started_at').eq('agent_id', id).order('started_at', { ascending: false }).limit(10),
    ])
    return {
      agent: agent as Agent,
      documents: docsRes.data ?? [],
      conversations: convRes.data ?? [],
    }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function createAgent(data: AgentInput): Promise<{ id?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    if (!data.name?.trim()) return { error: 'Nome obrigatório' }
    const { data: row, error } = await supabase
      .from('ai_agents')
      .insert({ ...sanitize(data), tenant_id: tenantId })
      .select('id')
      .single()
    if (error) return { error: error.message }
    revalidatePath('/agents')
    return { id: row.id }
  } catch (err) {
    return { error: String(err) }
  }
}

export async function updateAgent(id: string, data: Partial<AgentInput>): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('ai_agents')
      .update({ ...sanitize(data), updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', tenantId)
    if (error) return { success: false, error: error.message }
    revalidatePath('/agents')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function deleteAgent(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()

    // Verify ownership before deleting
    const { data: agent } = await admin.from('ai_agents').select('id').eq('id', id).eq('tenant_id', tenantId).single()
    if (!agent) return { success: false, error: 'Agente não encontrado' }

    // Delete cascade: messages → conversations → documents → agent
    const { data: convs } = await admin.from('agent_conversations').select('id').eq('agent_id', id)
    if (convs && convs.length > 0) {
      const convIds = convs.map(c => c.id)
      await admin.from('agent_messages').delete().in('conversation_id', convIds)
      await admin.from('agent_conversations').delete().eq('agent_id', id)
    }
    await admin.from('agent_documents').delete().eq('agent_id', id)
    const { error } = await admin.from('ai_agents').delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) return { success: false, error: error.message }

    revalidatePath('/agents')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function activateAgent(id: string) { return setStatus(id, 'active') }
export async function pauseAgent(id: string) { return setStatus(id, 'paused') }

async function setStatus(id: string, status: AgentStatus): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('ai_agents')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', tenantId)
    if (error) return { success: false, error: error.message }
    revalidatePath('/agents')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function listFunnels(): Promise<{ id: string; name: string }[]> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data } = await supabase
      .from('funnels').select('id, name')
      .eq('tenant_id', tenantId).eq('status', 'published').order('name')
    return data ?? []
  } catch {
    return []
  }
}

export async function listWhatsappInstances(): Promise<{ id: string; instance_name: string; status: string }[]> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data } = await supabase
      .from('whatsapp_instances').select('id, instance_name, status')
      .eq('tenant_id', tenantId).order('instance_name')
    return data ?? []
  } catch {
    return []
  }
}

export async function getAgentStats(id: string): Promise<{
  total: number
  rate: number
  rate_label: string
  avg_messages: number
  by_day: { date: string; count: number }[]
  error?: string
}> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data: agent } = await supabase.from('ai_agents').select('objective').eq('id', id).eq('tenant_id', tenantId).single()
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: convs } = await supabase
      .from('agent_conversations')
      .select('status, message_count, started_at')
      .eq('agent_id', id).eq('tenant_id', tenantId)
      .gte('started_at', since)
    const list = convs ?? []
    const { total, rate, label } = computeRate(agent?.objective, list)
    const avg_messages = total > 0 ? Math.round(list.reduce((s, c) => s + (c.message_count || 0), 0) / total) : 0
    const dayMap: Record<string, number> = {}
    for (const c of list) {
      const d = (c.started_at as string).slice(0, 10)
      dayMap[d] = (dayMap[d] || 0) + 1
    }
    const by_day = Object.entries(dayMap).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date))
    return { total, rate, rate_label: label, avg_messages, by_day }
  } catch (err) {
    return { total: 0, rate: 0, rate_label: '', avg_messages: 0, by_day: [], error: String(err) }
  }
}

export async function listConversations(
  agentId: string,
  opts: { status?: string; page?: number; pageSize?: number } = {}
): Promise<{
  conversations: { id: string; status: string; qualification_score: number | null; message_count: number; started_at: string; ended_at: string | null; lead_name: string | null }[]
  total: number
  error?: string
}> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const page = opts.page ?? 0
    const pageSize = opts.pageSize ?? 20
    let query = supabase
      .from('agent_conversations')
      .select('id, status, qualification_score, message_count, started_at, ended_at, leads(name)', { count: 'exact' })
      .eq('agent_id', agentId).eq('tenant_id', tenantId)
    if (opts.status) query = query.eq('status', opts.status)
    const { data, count, error } = await query
      .order('started_at', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1)
    if (error) return { conversations: [], total: 0, error: error.message }
    const conversations = (data ?? []).map((c) => {
      const leadRel = (c as { leads?: { name?: string | null } | { name?: string | null }[] }).leads
      const lead = Array.isArray(leadRel) ? leadRel[0] : leadRel
      return {
        id: c.id, status: c.status, qualification_score: c.qualification_score,
        message_count: c.message_count, started_at: c.started_at, ended_at: c.ended_at,
        lead_name: lead?.name ?? null,
      }
    })
    return { conversations, total: count ?? 0 }
  } catch (err) {
    return { conversations: [], total: 0, error: String(err) }
  }
}

export async function getConversation(conversationId: string): Promise<{
  conversation?: { id: string; status: string; qualification_score: number | null; outcome_summary: string | null; started_at: string; lead_name: string | null }
  messages?: { id: string; role: string; content: string; created_at: string }[]
  error?: string
}> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data: conv, error } = await supabase
      .from('agent_conversations')
      .select('id, status, qualification_score, outcome_summary, started_at, leads(name)')
      .eq('id', conversationId).eq('tenant_id', tenantId).single()
    if (error || !conv) return { error: 'not_found' }
    const { data: messages } = await supabase
      .from('agent_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conversationId).eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
    const leadRel = (conv as { leads?: { name?: string | null } | { name?: string | null }[] }).leads
    const lead = Array.isArray(leadRel) ? leadRel[0] : leadRel
    return {
      conversation: {
        id: conv.id, status: conv.status, qualification_score: conv.qualification_score,
        outcome_summary: conv.outcome_summary, started_at: conv.started_at,
        lead_name: lead?.name ?? null,
      },
      messages: messages ?? [],
    }
  } catch (err) {
    return { error: String(err) }
  }
}
