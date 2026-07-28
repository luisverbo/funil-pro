'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { emptyMap, type MindMap, type MindMapSummary, type MindNode } from '@/lib/mindmap/types'

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

export async function listMindMaps(): Promise<{ maps: MindMapSummary[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('mindmaps')
      .select('id, title, description, thumbnail_url, created_at, updated_at, nodes')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
    if (error) return { maps: [], error: error.message }
    const maps = (data ?? []).map(m => ({
      id: m.id, title: m.title, description: m.description,
      thumbnail_url: m.thumbnail_url, created_at: m.created_at, updated_at: m.updated_at,
      node_count: Array.isArray(m.nodes) ? (m.nodes as MindNode[]).length : 0,
    }))
    return { maps }
  } catch (err) { return { maps: [], error: String(err) } }
}

export async function getMindMap(id: string): Promise<{ map?: MindMap; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('mindmaps').select('*').eq('id', id).eq('tenant_id', tenantId).single()
    if (error || !data) return { error: error?.message ?? 'not_found' }
    const nodes = Array.isArray(data.nodes) && data.nodes.length > 0 ? data.nodes as MindNode[] : emptyMap()
    return { map: { ...data, nodes } as MindMap }
  } catch (err) { return { error: String(err) } }
}

export async function createMindMap(title?: string): Promise<{ id?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data, error } = await supabase.from('mindmaps').insert({
      tenant_id: tenantId,
      title: title?.trim() || 'Novo mapa',
      nodes: emptyMap(),
    }).select('id').single()
    if (error) return { error: error.message }
    revalidatePath('/mindmaps')
    return { id: data?.id }
  } catch (err) { return { error: String(err) } }
}

/** Autosave do editor — grava os nós inteiros (jsonb) */
export async function saveMindMapNodes(id: string, nodes: MindNode[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { error } = await supabase.from('mindmaps')
      .update({ nodes, updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', tenantId)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) { return { ok: false, error: String(err) } }
}

export async function renameMindMap(id: string, title: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { error } = await supabase.from('mindmaps')
      .update({ title: title.trim() || 'Novo mapa', updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', tenantId)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/mindmaps')
    return { ok: true }
  } catch (err) { return { ok: false, error: String(err) } }
}

export async function duplicateMindMap(id: string): Promise<{ id?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { data: original } = await supabase.from('mindmaps')
      .select('title, description, nodes').eq('id', id).eq('tenant_id', tenantId).single()
    if (!original) return { error: 'not_found' }
    const { data, error } = await supabase.from('mindmaps').insert({
      tenant_id: tenantId,
      title: `Cópia de ${original.title}`,
      description: original.description,
      nodes: original.nodes,
    }).select('id').single()
    if (error) return { error: error.message }
    revalidatePath('/mindmaps')
    return { id: data?.id }
  } catch (err) { return { error: String(err) } }
}

export async function deleteMindMap(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const supabase = await getSupabase()
    const { error } = await supabase.from('mindmaps').delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/mindmaps')
    return { ok: true }
  } catch (err) { return { ok: false, error: String(err) } }
}
