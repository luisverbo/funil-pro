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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
}

export async function createWhatsappInstance(formData: FormData) {
  const tenantId = await getTenantId()
  if (!tenantId) return { error: 'Não autenticado' }

  const displayName = (formData.get('name') as string | null)?.trim() || 'Instância'
  const description = (formData.get('description') as string | null)?.trim() || null
  const phoneDisplay = (formData.get('phone') as string | null)?.trim() || null

  const instanceName = `t${tenantId.slice(0, 6)}_${slugify(displayName)}_${Date.now().toString(36)}`

  try {
    await createInstance(instanceName)

    const admin = createAdminClient()
    const { data: instance, error } = await admin
      .from('whatsapp_instances')
      .insert({
        tenant_id: tenantId,
        instance_name: instanceName,
        display_name: displayName,
        description,
        phone_number_display: phoneDisplay,
        status: 'connecting',
      } as Record<string, unknown>)
      .select('id')
      .single()

    if (error) {
      console.error('[whatsapp] DB insert error:', error.message, error.details)
      return { error: `Erro ao salvar: ${error.message}` }
    }
    if (!instance) return { error: 'Erro ao criar instância no banco' }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://funil-pro.vercel.app'
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

export async function deleteWhatsappInstance(instanceId: string) {
  const tenantId = await getTenantId()
  if (!tenantId) return { error: 'Não autenticado' }

  const admin = createAdminClient()

  const { data: instance } = await admin
    .from('whatsapp_instances')
    .select('instance_name, tenant_id')
    .eq('id', instanceId)
    .single()

  if (!instance || instance.tenant_id !== tenantId) return { error: 'Instância não encontrada' }

  try {
    await deleteInstance(instance.instance_name)
  } catch (err) {
    console.warn('[whatsapp] Evolution API delete failed (continuing):', err instanceof Error ? err.message : err)
  }

  await admin.from('whatsapp_instances').delete().eq('id', instanceId)

  revalidatePath('/integrations')
  return { success: true }
}

export async function deleteFunnel(funnelId: string): Promise<{ success: boolean; error?: string }> {
  const tenantId = await getTenantId()
  if (!tenantId) return { success: false, error: 'Não autenticado' }

  const admin = createAdminClient()

  const { data: funnel } = await admin
    .from('funnels')
    .select('id, tenant_id')
    .eq('id', funnelId)
    .eq('tenant_id', tenantId)
    .single()

  if (!funnel) return { success: false, error: 'Funil não encontrado' }

  await admin.from('funnel_edges').delete().eq('funnel_id', funnelId)
  await admin.from('funnel_blocks').delete().eq('funnel_id', funnelId)
  const { error } = await admin.from('funnels').delete().eq('id', funnelId)

  if (error) return { success: false, error: error.message }

  revalidatePath('/funnels')
  return { success: true }
}
