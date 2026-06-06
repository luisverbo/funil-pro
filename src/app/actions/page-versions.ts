'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        },
      },
    }
  )
}

async function getTenantId(supabase: ReturnType<typeof createServerClient>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

export async function savePageVersion(pageId: string, craftJson: object, label?: string) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)

  const { data: versions } = await supabase
    .from('page_versions')
    .select('id, version_number')
    .eq('page_id', pageId)
    .eq('tenant_id', tenant_id)
    .order('created_at', { ascending: false })

  const nextVersion = ((versions?.[0]?.version_number ?? 0) + 1)

  if (versions && versions.length >= 15) {
    const toDelete = versions.slice(14).map((v) => v.id)
    await supabase.from('page_versions').delete().in('id', toDelete)
  }

  const { data, error } = await supabase
    .from('page_versions')
    .insert({ page_id: pageId, tenant_id, version_number: nextVersion, label: label || null, craft_json: craftJson })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function listPageVersions(pageId: string) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)

  const { data, error } = await supabase
    .from('page_versions')
    .select('id, version_number, label, created_at')
    .eq('page_id', pageId)
    .eq('tenant_id', tenant_id)
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function restorePageVersion(pageId: string, versionId: string): Promise<object> {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)

  const { data: version, error: vErr } = await supabase
    .from('page_versions')
    .select('craft_json')
    .eq('id', versionId)
    .eq('tenant_id', tenant_id)
    .single()

  if (vErr || !version) throw new Error('Versão não encontrada')

  const { error } = await supabase
    .from('pages')
    .update({ craft_json: version.craft_json })
    .eq('id', pageId)
    .eq('tenant_id', tenant_id)

  if (error) throw new Error(error.message)
  return version.craft_json as object
}