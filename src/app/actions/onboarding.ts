'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function createTenant(formData: FormData) {
  const supabase = await createClient()
  const admin = createAdminClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) redirect('/login')

  const businessName = (formData.get('business_name') as string).trim()
  const ownerName = (formData.get('owner_name') as string).trim()

  if (!businessName || !ownerName) {
    redirect('/onboarding?error=Preencha+todos+os+campos')
  }

  const baseSlug = slugify(businessName)

  // Try clean slug first, then add random suffix on collision
  let slug = baseSlug
  let { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({ name: businessName, slug, plan: 'starter' })
    .select('id')
    .single()

  if (tenantError && tenantError.code === '23505') {
    // Unique violation — add random suffix and retry
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`
    const retry = await admin
      .from('tenants')
      .insert({ name: businessName, slug, plan: 'starter' })
      .select('id')
      .single()
    tenant = retry.data
    tenantError = retry.error
  }

  if (tenantError || !tenant) {
    redirect(`/onboarding?error=${encodeURIComponent(tenantError?.message ?? 'Erro ao criar conta')}`)
  }

  const { error: utError } = await admin
    .from('users_tenants')
    .insert({ user_id: user!.id, tenant_id: tenant!.id, role: 'owner' })

  if (utError) {
    redirect(`/onboarding?error=${encodeURIComponent(utError.message)}`)
  }

  await supabase.auth.updateUser({ data: { full_name: ownerName } })

  redirect('/funnels')
}
