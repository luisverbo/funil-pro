'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function verifyAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: ut } = await supabase
    .from('users_tenants')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!ut || ut.role !== 'admin') throw new Error('Forbidden')
  return user
}

export async function saveAdminSettings(formData: FormData) {
  await verifyAdmin()
  const admin = createAdminClient()

  const entries = Array.from(formData.entries())
  for (const [key, value] of entries) {
    await admin
      .from('platform_settings')
      .update({ value: value as string, updated_at: new Date().toISOString() })
      .eq('key', key)
  }

  revalidatePath('/admin/settings')
}

export async function changeTenantPlan(tenantId: string, plan: string) {
  await verifyAdmin()
  const admin = createAdminClient()

  await admin.from('tenants').update({ plan }).eq('id', tenantId)
  revalidatePath('/admin/tenants')
}

export async function deleteTenantAccount(tenantId: string) {
  await verifyAdmin()
  const admin = createAdminClient()

  // Cascade: delete leads, funnels, etc. via FK constraints
  await admin.from('tenants').delete().eq('id', tenantId)
  revalidatePath('/admin/tenants')
}

export async function createOfficialTemplate(formData: FormData) {
  await verifyAdmin()
  const admin = createAdminClient()

  const name = formData.get('name') as string
  const description = formData.get('description') as string
  const category = formData.get('category') as string

  await admin.from('funnel_templates').insert({
    tenant_id: null,
    name,
    description: description || null,
    category: category || null,
    funnel_json: {},
    is_public: true,
    price_cents: 0,
    downloads_count: 0,
  })

  revalidatePath('/admin/templates')
}

export async function toggleTemplatePublic(templateId: string, isPublic: boolean) {
  await verifyAdmin()
  const admin = createAdminClient()

  await admin.from('funnel_templates').update({ is_public: isPublic }).eq('id', templateId)
  revalidatePath('/admin/templates')
}

export async function deleteOfficialTemplate(templateId: string) {
  await verifyAdmin()
  const admin = createAdminClient()

  await admin.from('funnel_templates').delete().eq('id', templateId)
  revalidatePath('/admin/templates')
}
