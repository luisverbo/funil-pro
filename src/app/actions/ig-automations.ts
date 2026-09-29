'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { listRecentMedia, getConnectedAccount, type IgMedia, type ContaConectada } from '@/lib/instagram'
import type { DmStep } from '@/lib/instagram/sequence'
import { nomeDaCopia } from '@/lib/pages/editor-path'

export interface IgAutomation {
  id: string
  name: string
  status: string
  media_id: string | null
  /** Post AGENDADO no /conteudos: o media_id é preenchido quando ele publicar. */
  conteudo_id: string | null
  media_caption: string | null
  media_thumb: string | null
  keywords: string[]
  comment_replies: string[]
  dm_message: string | null
  dm_steps: DmStep[] | null
  dm_use_agent: boolean
  funnel_id: string | null
  lead_tag: string | null
  follow_gate: boolean
  follow_gate_message: string | null
  canvas: Record<string, { x: number; y: number }> | null
  trigger_type: 'comment' | 'dm' | 'story_reply'
  triggers_count: number
  created_at: string
}

export interface IgAutomationInput {
  name: string
  media_id?: string | null
  conteudo_id?: string | null
  media_caption?: string | null
  media_thumb?: string | null
  keywords?: string[]
  comment_replies?: string[]
  dm_message?: string | null
  dm_steps?: DmStep[] | null
  dm_use_agent?: boolean
  funnel_id?: string | null
  lead_tag?: string | null
  follow_gate?: boolean
  follow_gate_message?: string | null
  canvas?: Record<string, { x: number; y: number }> | null
  trigger_type?: 'comment' | 'dm' | 'story_reply'
}

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } }
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

export async function listIgAutomations(): Promise<{ automations: IgAutomation[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('ig_automations').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false })
    if (error) return { automations: [], error: error.message }
    return { automations: (data ?? []) as IgAutomation[] }
  } catch (err) { return { automations: [], error: String(err) } }
}

export async function getIgAutomation(id: string): Promise<{ automation?: IgAutomation; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('ig_automations').select('*').eq('id', id).eq('tenant_id', tenantId).single()
    if (error || !data) return { error: error?.message ?? 'not_found' }
    return { automation: data as IgAutomation }
  } catch (err) { return { error: String(err) } }
}

export async function createIgAutomation(input: IgAutomationInput): Promise<{ id?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data, error } = await supabase.from('ig_automations').insert({
      tenant_id: tenantId,
      name: input.name?.trim() || 'Automação',
      media_id: input.media_id || null,
      conteudo_id: input.media_id ? null : (input.conteudo_id || null),
      media_caption: input.media_caption || null,
      media_thumb: input.media_thumb || null,
      keywords: (input.keywords ?? []).map(k => k.trim()).filter(Boolean),
      comment_replies: (input.comment_replies ?? []).map(r => r.trim()).filter(Boolean),
      dm_message: input.dm_message?.trim() || null,
      dm_steps: input.dm_steps ?? null,
      dm_use_agent: input.dm_use_agent ?? true,
      funnel_id: input.funnel_id || null,
      lead_tag: input.lead_tag?.trim() || null,
      follow_gate: input.follow_gate ?? false,
      follow_gate_message: input.follow_gate_message?.trim() || null,
      trigger_type: input.trigger_type ?? 'comment',
      status: 'active',
    }).select('id').single()
    if (error) return { error: error.message }
    revalidatePath('/instagram')
    return { id: data?.id }
  } catch (err) { return { error: String(err) } }
}

export async function updateIgAutomation(id: string, patch: Partial<IgAutomationInput> & { status?: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    // Post publicado escolhido → deixa de esperar o agendado. Agendado
    // escolhido → o post só existe depois; media_id volta a vazio.
    const final = { ...patch }
    if (patch.media_id) final.conteudo_id = null
    else if (patch.conteudo_id) final.media_id = null
    const { error } = await supabase.from('ig_automations').update(final).eq('id', id).eq('tenant_id', tenantId)
    if (error) return { success: false, error: error.message }
    revalidatePath('/instagram')
    return { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

/**
 * Duplica uma automação inteira (gatilho, palavras-chave, respostas, DMs,
 * ramificações, porteiro, funil, tag, posições do canvas). A cópia nasce
 * PAUSADA e com contadores zerados: ativa, ela disputaria os mesmos
 * comentários da original antes de você trocar o post.
 */
export async function duplicateIgAutomation(id: string): Promise<{ automation?: IgAutomation; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data: orig, error: e1 } = await supabase
      .from('ig_automations').select('*').eq('id', id).eq('tenant_id', tenantId).single()
    if (e1 || !orig) return { error: e1?.message ?? 'Automação não encontrada' }
    const o = orig as IgAutomation
    const { data, error } = await supabase.from('ig_automations').insert({
      tenant_id: tenantId,
      name: nomeDaCopia(o.name),
      status: 'paused',
      trigger_type: o.trigger_type,
      media_id: o.media_id,
      conteudo_id: o.conteudo_id,
      media_caption: o.media_caption,
      media_thumb: o.media_thumb,
      keywords: o.keywords ?? [],
      comment_replies: o.comment_replies ?? [],
      dm_message: o.dm_message,
      dm_steps: o.dm_steps,
      dm_use_agent: o.dm_use_agent,
      funnel_id: o.funnel_id,
      lead_tag: o.lead_tag,
      follow_gate: o.follow_gate,
      follow_gate_message: o.follow_gate_message,
      canvas: o.canvas,
      triggers_count: 0,
    }).select('*').single()
    if (error || !data) return { error: error?.message ?? 'Não consegui duplicar' }
    revalidatePath('/instagram')
    return { automation: data as IgAutomation }
  } catch (err) { return { error: String(err) } }
}

export async function deleteIgAutomation(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { error } = await supabase.from('ig_automations').delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) return { success: false, error: error.message }
    revalidatePath('/instagram')
    return { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

/** Status da conexão com o Instagram (token configurado e válido?) */
export async function getIgConnection(): Promise<ContaConectada> {
  try {
    await getTenantId()
    return await getConnectedAccount()
  } catch (err) { return { connected: false, error: String(err) } }
}

export interface IgAutomationContact {
  ig_user_id: string; name: string | null; username: string | null; profile_pic: string | null; last_at: string
}
/** Contatos que entraram numa automação */
export async function listAutomationContacts(automationId: string): Promise<{ contacts: IgAutomationContact[] }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data } = await supabase
      .from('ig_automation_contacts')
      .select('ig_user_id, name, username, profile_pic, last_at')
      .eq('automation_id', automationId).eq('tenant_id', tenantId)
      .order('last_at', { ascending: false }).limit(200)
    return { contacts: (data ?? []) as IgAutomationContact[] }
  } catch { return { contacts: [] } }
}

export interface IgBlockStat { sent: number; clicks: number }
/** Métricas por bloco de uma automação (envios/cliques) — mapa block_id → stat */
export async function getIgBlockStats(automationId: string): Promise<{ stats: Record<string, IgBlockStat> }> {
  try {
    await getTenantId()
    const supabase = await getSupabase()
    const { data } = await supabase
      .from('ig_block_stats').select('block_id, sent, clicks').eq('automation_id', automationId)
    const stats: Record<string, IgBlockStat> = {}
    for (const r of data ?? []) stats[r.block_id as string] = { sent: r.sent as number, clicks: r.clicks as number }
    return { stats }
  } catch { return { stats: {} } }
}

/** Posts recentes da conta conectada (para o seletor de post do modal) */
export async function listInstagramPosts(): Promise<{ posts: IgMedia[]; error?: string }> {
  try {
    await getTenantId()   // exige sessão
    const posts = await listRecentMedia(24)
    return { posts }
  } catch (err) { return { posts: [], error: String(err) } }
}


export interface ConteudoAgendavel {
  id: string
  tipo: 'reel' | 'carrossel'
  status: string
  data_agendada: string
  descricao: string
  thumb: string | null
  video: string | null
  ig_media_id: string | null
}

/**
 * Posts do /conteudos que ainda não foram publicados (pendentes e agendados)
 * — para a automação ficar pronta ANTES do post cair, como no ManyChat.
 */
export async function listConteudosParaAutomacao(): Promise<{ itens: ConteudoAgendavel[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('conteudos_instagram')
      .select('id, tipo, status, data_agendada, descricao, capa_url, midia_urls, ig_media_id')
      .eq('tenant_id', tenantId)
      .in('status', ['pendente', 'agendado', 'publicando', 'publicado'])
      .order('data_agendada', { ascending: true })
      .range(0, 199)
    if (error) return { itens: [], error: error.message }
    return {
      itens: (data ?? []).map(c => ({
        id: c.id as string,
        tipo: c.tipo as 'reel' | 'carrossel',
        status: c.status as string,
        data_agendada: c.data_agendada as string,
        descricao: (c.descricao as string) ?? '',
        thumb: c.tipo === 'carrossel' ? ((c.midia_urls as string[])?.[0] ?? null) : ((c.capa_url as string | null) ?? null),
        video: c.tipo === 'reel' ? ((c.midia_urls as string[])?.[0] ?? null) : null,
        ig_media_id: (c.ig_media_id as string | null) ?? null,
      })),
    }
  } catch (err) { return { itens: [], error: String(err) } }
}
