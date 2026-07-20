'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { listRecentMedia, getConnectedAccount, type IgMedia } from '@/lib/instagram'

export interface IgAutomation {
  id: string
  name: string
  status: string
  media_id: string | null
  media_caption: string | null
  media_thumb: string | null
  keywords: string[]
  comment_replies: string[]
  dm_message: string | null
  dm_steps: { delay_minutes?: number; text?: string; buttons?: { title: string; url?: string; branch?: { text?: string; media_url?: string; media_type?: 'image' | 'video' | 'audio'; buttons?: { title: string; url?: string }[] } }[]; media_url?: string; media_type?: 'image' | 'video' | 'audio' }[] | null
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
  media_caption?: string | null
  media_thumb?: string | null
  keywords?: string[]
  comment_replies?: string[]
  dm_message?: string | null
  dm_steps?: { delay_minutes?: number; text?: string; buttons?: { title: string; url?: string; branch?: { text?: string; media_url?: string; media_type?: 'image' | 'video' | 'audio'; buttons?: { title: string; url?: string }[] } }[]; media_url?: string; media_type?: 'image' | 'video' | 'audio' }[] | null
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
    const { error } = await supabase.from('ig_automations').update(patch).eq('id', id).eq('tenant_id', tenantId)
    if (error) return { success: false, error: error.message }
    revalidatePath('/instagram')
    return { success: true }
  } catch (err) { return { success: false, error: String(err) } }
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
export async function getIgConnection(): Promise<{ connected: boolean; username?: string; accountId?: string; error?: string }> {
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

/** Posts recentes da conta conectada (para o seletor de post do modal) */
export async function listInstagramPosts(): Promise<{ posts: IgMedia[]; error?: string }> {
  try {
    await getTenantId()   // exige sessão
    const posts = await listRecentMedia(24)
    return { posts }
  } catch (err) { return { posts: [], error: String(err) } }
}
