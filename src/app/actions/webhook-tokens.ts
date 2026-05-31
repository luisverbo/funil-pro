'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'

export async function saveWebhookToken(platform: string, token: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: ut } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()
  if (!ut) throw new Error('Tenant não encontrado')

  const admin = createAdminClient()
  const { data: tenant } = await admin.from('tenants').select('webhook_tokens').eq('id', ut.tenant_id).single()
  const current = (tenant?.webhook_tokens as Record<string, string>) ?? {}

  await admin
    .from('tenants')
    .update({ webhook_tokens: { ...current, [platform]: token } })
    .eq('id', ut.tenant_id)

  revalidatePath('/integrations')
}
