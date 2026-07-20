'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInstagramDM } from '@/lib/instagram'

export interface IgThread {
  id: string
  ig_user_id: string
  username: string | null
  name: string | null
  profile_pic: string | null
  last_message_at: string
  last_message_text: string | null
  unread: boolean
  human_mode: boolean
}

export interface IgDmMessage {
  id: string
  direction: 'in' | 'out'
  source: string | null
  text: string
  created_at: string
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

export async function listIgThreads(): Promise<{ threads: IgThread[] }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data } = await supabase
      .from('ig_threads')
      .select('id, ig_user_id, username, name, profile_pic, last_message_at, last_message_text, unread, human_mode')
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false })
      .limit(100)
    return { threads: (data ?? []) as IgThread[] }
  } catch { return { threads: [] } }
}

export async function getIgThreadMessages(threadId: string): Promise<{ messages: IgDmMessage[] }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data } = await supabase
      .from('ig_dm_messages')
      .select('id, direction, source, text, created_at')
      .eq('thread_id', threadId).eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .limit(200)
    // marca como lida
    await supabase.from('ig_threads').update({ unread: false }).eq('id', threadId).eq('tenant_id', tenantId)
    return { messages: (data ?? []) as IgDmMessage[] }
  } catch { return { messages: [] } }
}

export async function setIgThreadHumanMode(threadId: string, on: boolean): Promise<{ success: boolean }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    await supabase.from('ig_threads').update({ human_mode: on }).eq('id', threadId).eq('tenant_id', tenantId)
    if (on) {
      // Assumiu: pausa passos de sequência pendentes desse contato
      const { data: th } = await supabase.from('ig_threads').select('ig_user_id').eq('id', threadId).single()
      if (th) {
        const admin = createAdminClient()
        await admin.from('ig_sequence_jobs').update({ status: 'cancelled' })
          .eq('ig_user_id', th.ig_user_id).eq('status', 'pending')
      }
    }
    return { success: true }
  } catch { return { success: false } }
}

export async function sendIgHumanReply(threadId: string, text: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const clean = text.trim()
    if (!clean) return { success: false, error: 'mensagem vazia' }
    const { data: th } = await supabase.from('ig_threads')
      .select('id, ig_user_id').eq('id', threadId).eq('tenant_id', tenantId).single()
    if (!th) return { success: false, error: 'conversa não encontrada' }

    await sendInstagramDM(th.ig_user_id, clean)
    const admin = createAdminClient()
    await admin.from('ig_dm_messages').insert({
      tenant_id: tenantId, thread_id: threadId, direction: 'out', source: 'human', text: clean,
    })
    await admin.from('ig_threads').update({
      last_message_at: new Date().toISOString(), last_message_text: clean.slice(0, 120),
    }).eq('id', threadId)
    return { success: true }
  } catch (err) {
    const msg = String(err)
    if (msg.includes('551') || msg.toLowerCase().includes('outside') || msg.includes('window')) {
      return { success: false, error: 'Fora da janela de 24h — o Instagram só permite responder até 24h após a última mensagem da pessoa.' }
    }
    return { success: false, error: msg.slice(0, 160) }
  }
}
