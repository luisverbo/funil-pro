'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

async function getTenantId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthenticated')
  const { data: ut } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!ut) throw new Error('Tenant not found')
  return ut.tenant_id as string
}

export async function saveFunnelProductTriggers(
  funnelId: string,
  triggers: { platform: string; product_name: string; trigger_event: 'purchase' | 'abandoned_cart' }[]
) {
  const tenantId = await getTenantId()
  const admin = createAdminClient()

  await admin.from('funnel_product_triggers').delete().eq('funnel_id', funnelId).eq('tenant_id', tenantId)

  if (triggers.length > 0) {
    await admin.from('funnel_product_triggers').insert(
      triggers.map((t) => ({
        tenant_id: tenantId,
        funnel_id: funnelId,
        platform: t.platform.toLowerCase(),
        product_name: t.product_name,
        trigger_event: t.trigger_event,
        is_active: true,
      }))
    )
  }

  revalidatePath(`/funnels/${funnelId}/builder`)
}

export async function getFunnelTriggers(funnelId: string) {
  const tenantId = await getTenantId()
  const admin = createAdminClient()
  const { data } = await admin
    .from('funnel_product_triggers')
    .select('id, platform, product_name, trigger_event')
    .eq('funnel_id', funnelId)
    .eq('tenant_id', tenantId)
    .order('created_at')
  return (data ?? []) as { id: string; platform: string; product_name: string; trigger_event: 'purchase' | 'abandoned_cart' }[]
}

export async function getTenantProducts() {
  const tenantId = await getTenantId()
  const admin = createAdminClient()
  const { data } = await admin.from('products').select('*').eq('tenant_id', tenantId).order('platform').order('name')
  return data ?? []
}

export async function getFunnelsForProduct(tenantId: string, platform: string, productName: string, event: 'purchase' | 'abandoned_cart') {
  const admin = createAdminClient()
  const { data } = await admin
    .from('funnel_product_triggers')
    .select('funnel_id, funnels(id, status, whatsapp_instance_id)')
    .eq('tenant_id', tenantId)
    .eq('platform', platform.toLowerCase())
    .eq('trigger_event', event)
    .eq('is_active', true)
    .ilike('product_name', `%${productName}%`)
  return data ?? []
}
