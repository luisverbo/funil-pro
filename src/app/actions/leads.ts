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

async function getTenantId(): Promise<string> {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data, error } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (error || !data) redirect('/login')
  return data.tenant_id
}

export async function createLeadManual(
  name: string,
  phone: string,
  email: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { error } = await admin
      .from('leads')
      .insert({
        tenant_id: tenantId,
        name: name.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        status: 'active',
      })
    if (error) return { success: false, error: error.message }
    revalidatePath('/leads')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function bulkDeleteLeads(
  leadIds: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!leadIds.length) return { success: false, error: 'Nenhum lead selecionado' }
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { error } = await admin
      .from('leads')
      .delete()
      .in('id', leadIds)
      .eq('tenant_id', tenantId)
    if (error) return { success: false, error: error.message }
    revalidatePath('/leads')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function bulkAddTag(
  leadIds: string[],
  tag: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!leadIds.length || !tag.trim()) return { success: false, error: 'Parâmetros inválidos' }
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data: leadsData, error: fetchErr } = await admin
      .from('leads')
      .select('id, tags')
      .in('id', leadIds)
      .eq('tenant_id', tenantId)
    if (fetchErr) return { success: false, error: fetchErr.message }
    for (const lead of leadsData ?? []) {
      const existing = (lead.tags as string[] | null) ?? []
      if (!existing.includes(tag.trim())) {
        await admin.from('leads').update({ tags: [...existing, tag.trim()] }).eq('id', lead.id)
      }
    }
    revalidatePath('/leads')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function enrollLeadsInFunnel(
  leadIds: string[],
  funnelId: string,
  delayBetweenSeconds: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()

    const { data: allBlocks } = await admin
      .from('funnel_blocks')
      .select('id, block_type')
      .eq('funnel_id', funnelId)
      .eq('tenant_id', tenantId)

    if (!allBlocks || allBlocks.length === 0) {
      return { success: false, error: 'Funil sem blocos' }
    }

    const { data: allEdges } = await admin
      .from('funnel_edges')
      .select('target_block_id')
      .eq('funnel_id', funnelId)

    const targetIds = new Set((allEdges ?? []).map((e: { target_block_id: string }) => e.target_block_id))
    const entryBlocks = allBlocks.filter((b: { id: string; block_type: string }) => !targetIds.has(b.id))

    const firstBlock = entryBlocks.find((b: { id: string; block_type: string }) => b.block_type === 'entry' || b.block_type === 'cart_abandoned')
      ?? entryBlocks[0]
      ?? allBlocks[0]

    const now = Date.now()

    for (let i = 0; i < leadIds.length; i++) {
      const leadId = leadIds[i]
      const scheduledFor = new Date(now + i * delayBetweenSeconds * 1000).toISOString()

      await admin
        .from('leads')
        .update({ funnel_id: funnelId, status: 'active' })
        .eq('id', leadId)
        .eq('tenant_id', tenantId)

      await admin.from('queue_jobs').insert({
        tenant_id: tenantId,
        lead_id: leadId,
        funnel_id: funnelId,
        block_id: firstBlock.id,
        status: 'pending',
        scheduled_for: scheduledFor,
      })
    }

    revalidatePath('/leads')
    return { success: true }
  } catch (err) {
    console.error('enrollLeadsInFunnel error:', err)
    return { success: false, error: String(err) }
  }
}

export async function sendBulkWhatsapp(
  leadIds: string[],
  message: string,
  instanceId: string
): Promise<{ success: boolean; sent: number; failed: number; error?: string }> {
  try {
    if (!leadIds.length || !message.trim() || !instanceId) {
      return { success: false, sent: 0, failed: 0, error: 'Parâmetros inválidos' }
    }

    const tenantId = await getTenantId()
    const admin = createAdminClient()

    const { data: instance } = await admin
      .from('whatsapp_instances')
      .select('instance_name')
      .eq('id', instanceId)
      .eq('tenant_id', tenantId)
      .single()

    if (!instance?.instance_name) return { success: false, sent: 0, failed: 0, error: 'Instância não encontrada' }

    const { data: leadsData } = await admin
      .from('leads')
      .select('id, name, phone, email')
      .in('id', leadIds)
      .eq('tenant_id', tenantId)

    const { sendTextMessage } = await import('@/lib/evolution')

    let sent = 0
    let failed = 0

    for (const lead of leadsData ?? []) {
      if (!lead.phone) { failed++; continue }
      const firstName = (lead.name as string | null)?.split(' ')[0] ?? ''
      const interpolated = message
        .replace(/{nome}/g, (lead.name as string) ?? '')
        .replace(/{primeiro_nome}/g, firstName)
        .replace(/{email}/g, (lead.email as string) ?? '')
        .replace(/{telefone}/g, (lead.phone as string) ?? '')
      try {
        await sendTextMessage(instance.instance_name, lead.phone as string, interpolated)
        sent++
        await new Promise(r => setTimeout(r, 2000))
      } catch { failed++ }
    }

    return { success: true, sent, failed }
  } catch (err) {
    return { success: false, sent: 0, failed: 0, error: String(err) }
  }
}
