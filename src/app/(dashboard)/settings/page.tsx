import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import SettingsClient from './settings-client'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userTenant } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!userTenant) redirect('/onboarding')

  const admin = createAdminClient()
  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, slug, plan, email_quota_used, email_quota_limit')
    .eq('id', userTenant.tenant_id)
    .single()

  const { data: pixelRow } = await admin
    .from('tenants')
    .select('meta_pixel_id')
    .eq('id', userTenant.tenant_id)
    .single()

  const { data: waInstances } = await admin
    .from('whatsapp_instances')
    .select('id')
    .eq('tenant_id', userTenant.tenant_id)

  const planLimits: Record<string, { wa: number; email: number }> = {
    starter: { wa: 1, email: 1000 },
    pro: { wa: 1, email: 10000 },
    scale: { wa: 3, email: 50000 },
  }

  const plan = (tenant?.plan ?? 'starter') as string
  const limits = planLimits[plan] ?? planLimits.starter

  return (
    <SettingsClient
      user={{
        id: user.id,
        email: user.email ?? '',
        name: (user.user_metadata?.full_name as string) ?? (user.user_metadata?.display_name as string) ?? '',
      }}
      tenant={{
        id: tenant?.id ?? '',
        name: tenant?.name ?? '',
        slug: tenant?.slug ?? '',
        plan,
        emailQuotaUsed: tenant?.email_quota_used ?? 0,
        emailQuotaLimit: tenant?.email_quota_limit ?? limits.email,
      }}
      metaPixelId={(pixelRow as unknown as { meta_pixel_id?: string } | null)?.meta_pixel_id ?? ''}
      waInstancesCount={waInstances?.length ?? 0}
      waInstancesLimit={limits.wa}
    />
  )
}
