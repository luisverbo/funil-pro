'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Product } from '@/types'

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

export async function addProduct(formData: FormData): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()

    const name = (formData.get('name') as string)?.trim()
    const platform = formData.get('platform') as string
    const product_id_external = (formData.get('product_id_external') as string)?.trim()
    const price_cents = Math.round(parseFloat((formData.get('price_cents') as string) ?? '0') * 100)
    const type = (formData.get('type') as string) || 'main'

    if (!name || !platform || !product_id_external) {
      return { success: false, error: 'Nome, plataforma e ID externo são obrigatórios' }
    }

    const { error } = await admin.from('products').upsert({
      tenant_id: tenantId,
      platform,
      product_id_external,
      name,
      price_cents,
      type,
    }, { onConflict: 'tenant_id,platform,product_id_external' })

    if (error) return { success: false, error: error.message }

    revalidatePath('/integrations')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function deleteProduct(productId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()

    const { error } = await admin
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/integrations')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function getProducts(platform: string): Promise<Product[]> {
  const tenantId = await getTenantId()
  const admin = createAdminClient()

  const { data } = await admin
    .from('products')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('platform', platform)
    .order('created_at', { ascending: false })

  return (data as Product[]) ?? []
}
