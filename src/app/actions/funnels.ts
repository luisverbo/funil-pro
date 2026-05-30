'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import type { BlockDTO, EdgeDTO } from '@/types'

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

async function getTenantId(supabase: Awaited<ReturnType<typeof getSupabase>>): Promise<string> {
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

export async function createFunnel(formData: FormData) {
  const supabase = await getSupabase()
  const tenantId = await getTenantId(supabase)

  const name = formData.get('name') as string
  if (!name?.trim()) throw new Error('Nome do funil é obrigatório')

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('funnels')
    .insert({ name: name.trim(), tenant_id: tenantId, status: 'draft' })
    .select('id')
    .single()

  if (error || !data) throw new Error('Erro ao criar funil')
  redirect(`/funnels/${data.id}/builder`)
}

export async function saveFunnel(
  funnelId: string,
  blocks: BlockDTO[],
  edges: EdgeDTO[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)

    // Verify ownership
    const { data: funnel } = await supabase
      .from('funnels')
      .select('id')
      .eq('id', funnelId)
      .eq('tenant_id', tenantId)
      .single()

    if (!funnel) return { success: false, error: 'Funil não encontrado' }

    const admin = createAdminClient()

    // Delete edges first (FK constraint), then blocks
    await admin.from('funnel_edges').delete().eq('funnel_id', funnelId)
    await admin.from('funnel_blocks').delete().eq('funnel_id', funnelId)

    // Insert blocks
    if (blocks.length > 0) {
      const { error: blocksError } = await admin.from('funnel_blocks').insert(
        blocks.map((b) => ({
          id: b.id,
          funnel_id: funnelId,
          block_type: b.block_type,
          label: b.label,
          config: b.config,
          position_x: b.position_x,
          position_y: b.position_y,
        }))
      )
      if (blocksError) return { success: false, error: blocksError.message }
    }

    // Insert edges
    if (edges.length > 0) {
      const { error: edgesError } = await admin.from('funnel_edges').insert(
        edges.map((e) => ({
          id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(e.id) ? e.id : crypto.randomUUID(),
          funnel_id: funnelId,
          source_block_id: e.source_block_id,
          target_block_id: e.target_block_id,
          condition: e.condition,
        }))
      )
      if (edgesError) return { success: false, error: edgesError.message }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function publishFunnel(funnelId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)

    const { data: funnel } = await supabase
      .from('funnels')
      .select('id')
      .eq('id', funnelId)
      .eq('tenant_id', tenantId)
      .single()

    if (!funnel) return { success: false, error: 'Funil não encontrado' }

    const admin = createAdminClient()
    const { error } = await admin
      .from('funnels')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', funnelId)

    if (error) return { success: false, error: error.message }
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function saveCapturePageConfig(
  funnelId: string,
  config: { template: string; page_config: Record<string, unknown> }
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)

    const { data: funnel } = await supabase
      .from('funnels')
      .select('id')
      .eq('id', funnelId)
      .eq('tenant_id', tenantId)
      .single()

    if (!funnel) return { success: false, error: 'Funil não encontrado' }

    const admin = createAdminClient()
    const { error } = await admin
      .from('funnels')
      .update({ page_template: config.template, page_config: config.page_config })
      .eq('id', funnelId)

    if (error) return { success: false, error: error.message }
    revalidatePath(`/funnels/${funnelId}/builder`)
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function getCapturePageConfig(funnelId: string): Promise<{ page_template: string | null; page_config: Record<string, unknown> | null } | null> {
  const supabase = await getSupabase()
  const { data } = await supabase.from('funnels').select('page_template, page_config').eq('id', funnelId).single()
  return data as { page_template: string | null; page_config: Record<string, unknown> | null } | null
}

export async function clearCapturePageConfig(funnelId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', success: false }
  await supabase.from('funnels').update({ page_template: null, page_config: null }).eq('id', funnelId)
  revalidatePath('/capture-pages')
  return { success: true }
}

export async function deleteFunnel(funnelId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await getSupabase()
  const tenantId = await getTenantId(supabase)

  const admin = createAdminClient()

  const { data: funnel } = await admin
    .from('funnels')
    .select('id')
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
