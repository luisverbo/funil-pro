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
        setAll(cookiesToSet) {
          try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        },
      },
    }
  )
}

async function getTenantId(supabase: Awaited<ReturnType<typeof getSupabase>>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

export interface VersionSnapshot {
  blocks: unknown[]
  edges: unknown[]
}

export async function saveVersion(
  funnelId: string,
  snapshot: VersionSnapshot,
  label?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)

    const admin = createAdminClient()

    const { data: existing } = await admin
      .from('funnel_versions')
      .select('version_number')
      .eq('funnel_id', funnelId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single()

    const nextVersion = (existing?.version_number ?? 0) + 1

    const { error } = await admin.from('funnel_versions').insert({
      funnel_id: funnelId,
      tenant_id: tenantId,
      version_number: nextVersion,
      label: label ?? null,
      snapshot,
    })

    if (error) return { success: false, error: error.message }

    // keep only last 20 versions
    const { data: allVersions } = await admin
      .from('funnel_versions')
      .select('id')
      .eq('funnel_id', funnelId)
      .order('version_number', { ascending: false })

    if (allVersions && allVersions.length > 20) {
      const toDelete = allVersions.slice(20).map((v) => v.id)
      await admin.from('funnel_versions').delete().in('id', toDelete)
    }

    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

export interface FunnelVersion {
  id: string
  version_number: number
  label: string | null
  snapshot: VersionSnapshot
  created_at: string
}

export async function listVersions(funnelId: string): Promise<FunnelVersion[]> {
  const supabase = await getSupabase()
  await getTenantId(supabase)
  const admin = createAdminClient()
  const { data } = await admin
    .from('funnel_versions')
    .select('id, version_number, label, snapshot, created_at')
    .eq('funnel_id', funnelId)
    .order('version_number', { ascending: false })
    .limit(20)
  return (data ?? []) as FunnelVersion[]
}

export async function restoreVersion(
  funnelId: string,
  versionId: string
): Promise<{ success: boolean; snapshot?: VersionSnapshot; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)
    const admin = createAdminClient()

    const { data: version } = await admin
      .from('funnel_versions')
      .select('snapshot, funnel_id')
      .eq('id', versionId)
      .single()

    if (!version) return { success: false, error: 'Versão não encontrada' }

    const { data: funnel } = await admin
      .from('funnels')
      .select('id')
      .eq('id', funnelId)
      .eq('tenant_id', tenantId)
      .single()

    if (!funnel) return { success: false, error: 'Funil não encontrado' }

    return { success: true, snapshot: version.snapshot as VersionSnapshot }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}
