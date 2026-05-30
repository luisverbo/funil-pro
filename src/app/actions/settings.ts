'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
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

async function getUser(supabase: Awaited<ReturnType<typeof getSupabase>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return user
}

async function getTenantId(supabase: Awaited<ReturnType<typeof getSupabase>>): Promise<string> {
  const user = await getUser(supabase)
  const { data } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()
  if (!data) redirect('/login')
  return data.tenant_id
}

export async function updateProfile(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const user = await getUser(supabase)
    const displayName = formData.get('display_name') as string

    const admin = createAdminClient()
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { display_name: displayName },
    })

    if (error) return { success: false, error: error.message }
    revalidatePath('/settings')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function updateTenant(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)
    const name = formData.get('name') as string

    const admin = createAdminClient()
    const { error } = await admin
      .from('tenants')
      .update({ name: name.trim() })
      .eq('id', tenantId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/settings')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function updateMetaPixel(
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)
    const pixelId = formData.get('meta_pixel_id') as string

    const admin = createAdminClient()
    const { error } = await admin
      .from('tenants')
      .update({ meta_pixel_id: pixelId.trim() || null } as Record<string, unknown>)
      .eq('id', tenantId)

    if (error) return { success: false, error: error.message }
    revalidatePath('/settings')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
