'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncMetaAdMetrics } from '@/lib/meta/sync'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

async function getTenantId(): Promise<string> {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!data) redirect('/login')
  return data.tenant_id
}

export async function saveMetaConfig(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()

    const meta_access_token = (formData.get('meta_access_token') as string)?.trim() || null
    let meta_ad_account_id = (formData.get('meta_ad_account_id') as string)?.trim() || null
    const meta_pixel_id = (formData.get('meta_pixel_id') as string)?.trim() || null

    // Auto-remove "act_" prefix — stored without it, URL uses "act_${id}"
    if (meta_ad_account_id?.startsWith('act_')) {
      meta_ad_account_id = meta_ad_account_id.slice(4)
    }

    const { error } = await admin
      .from('tenants')
      .update({ meta_access_token, meta_ad_account_id, meta_pixel_id })
      .eq('id', tenantId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/integrations')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function testMetaConnection(
  accessToken: string
): Promise<{ success: boolean; name?: string; error?: string }> {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me?access_token=${encodeURIComponent(accessToken)}`,
      { cache: 'no-store' }
    )
    const json = await res.json()
    if (!res.ok || json.error) {
      return { success: false, error: json.error?.message ?? 'Token inválido' }
    }
    return { success: true, name: json.name }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function triggerMetaSync(): Promise<{ success: boolean; synced?: number; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const synced = await syncMetaAdMetrics(tenantId)
    revalidatePath('/metrics')
    return { success: true, synced }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
