'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createInstance, deleteInstance, setInstanceWebhook } from '@/lib/evolution'

async function getTenantId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  return data?.tenant_id ?? null
}

// createWhatsappInstance — creates in Evolution API + DB
export async function createWhatsappInstance(formData: FormData) {
  void formData
  const tenantId = await getTenantId()
  if (!tenantId) return { error: 'Não autenticado' }

  const instanceName = `tenant_${tenantId.slice(0, 8)}_${Date.now()}`

  try {
    // Create in Evolution API
    const evoUrl = process.env.EVOLUTION_API_URL
    const evoKey = process.env.EVOLUTION_API_KEY
    console.log('[whatsapp] EVOLUTION_API_URL:', evoUrl)
    console.log('[whatsapp] EVOLUTION_API_KEY set:', !!evoKey)

    await createInstance(instanceName)

    // Save to DB
    const admin = createAdminClient()
    const { data: instance, error } = await admin
      .from('whatsapp_instances')
      .insert({
        tenant_id: tenantId,
        instance_name: instanceName,
        status: 'connecting',
      })
      .select('id')
      .single()

    if (error || !instance) return { error: 'Erro ao criar instância no banco' }

    // Set webhook on Evolution API pointing to our endpoint
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.funil.pro'
    try {
      await setInstanceWebhook(instanceName, `${appUrl}/api/webhooks/evolution/${instance.id}`)
    } catch {
      console.warn('[whatsapp] Falha ao configurar webhook, continuando...')
    }

    revalidatePath('/integrations')
    return { success: true, instanceId: instance.id, instanceName }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[whatsapp] Erro ao criar instância:', msg)
    return { error: `Erro: ${msg}` }
  }
}

// deleteWhatsappInstance
export async function deleteWhatsappInstance(instanceId: string) {
  const tenantId = await getTenantId()
  if (!tenantId) return { error: 'Não autenticado' }

  const admin = createAdminClient()

  // Verify ownership
  const { data: instance } = await admin
    .from('whatsapp_instances')
    .select('instance_name, tenant_id')
    .eq('id', instanceId)
    .single()

  if (!instance || instance.tenant_id !== tenantId) return { error: 'Instância não encontrada' }

  // Delete from Evolution API (best effort)
  try { await deleteInstance(instance.instance_name) } catch {}

  // Delete from DB
  await admin.from('whatsapp_instances').delete().eq('id', instanceId)

  revalidatePath('/integrations')
  return { success: true }
}
