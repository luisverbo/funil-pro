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

export async function saveAsTemplate(
  funnelId: string,
  formData: FormData
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)

    // Verify funnel ownership
    const { data: funnel } = await supabase
      .from('funnels')
      .select('id, name')
      .eq('id', funnelId)
      .eq('tenant_id', tenantId)
      .single()

    if (!funnel) return { success: false, error: 'Funil não encontrado' }

    const admin = createAdminClient()

    // Fetch blocks and edges
    const [{ data: blocks }, { data: edges }] = await Promise.all([
      admin.from('funnel_blocks').select('*').eq('funnel_id', funnelId),
      admin.from('funnel_edges').select('*').eq('funnel_id', funnelId),
    ])

    const cleanBlocks = (blocks ?? []).map((b) => ({
      id: b.id,
      block_type: b.block_type,
      label: b.label,
      config: b.config,
      position_x: b.position_x,
      position_y: b.position_y,
    }))

    const cleanEdges = (edges ?? []).map((e) => ({
      id: e.id,
      source_block_id: e.source_block_id,
      target_block_id: e.target_block_id,
      condition: e.condition,
    }))

    const name = (formData.get('name') as string)?.trim() || funnel.name
    const description = (formData.get('description') as string)?.trim() || null
    const category = (formData.get('category') as string)?.trim() || null
    const isPublic = formData.get('is_public') === 'true'
    const priceCentsRaw = formData.get('price_cents')
    const priceCents = priceCentsRaw ? Math.round(parseFloat(String(priceCentsRaw)) * 100) : 0

    const { data: tmpl, error } = await admin
      .from('funnel_templates')
      .insert({
        tenant_id: tenantId,
        name,
        description,
        category,
        funnel_json: { blocks: cleanBlocks, edges: cleanEdges },
        is_public: isPublic,
        price_cents: priceCents,
        downloads_count: 0,
      })
      .select('id')
      .single()

    if (error || !tmpl) return { success: false, error: error?.message ?? 'Erro ao salvar' }

    revalidatePath('/templates/my')
    return { success: true, id: tmpl.id }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function useTemplate(templateId: string): Promise<void> {
  const supabase = await getSupabase()
  const tenantId = await getTenantId(supabase)
  const admin = createAdminClient()

  // Fetch template (must be public or owned by tenant)
  const { data: template } = await admin
    .from('funnel_templates')
    .select('*')
    .eq('id', templateId)
    .single()

  if (!template) redirect('/templates')
  if (!template.is_public && template.tenant_id !== tenantId) redirect('/templates')

  const funnelJson = template.funnel_json as {
    blocks: Array<{
      id: string
      block_type: string
      label: string
      config: Record<string, unknown>
      position_x: number
      position_y: number
    }>
    edges: Array<{
      id: string
      source_block_id: string
      target_block_id: string
      condition: string
    }>
  }

  // Create new funnel
  const { data: newFunnel, error: funnelError } = await admin
    .from('funnels')
    .insert({ name: template.name, tenant_id: tenantId, status: 'draft' })
    .select('id')
    .single()

  if (funnelError || !newFunnel) redirect('/templates')

  const newFunnelId = newFunnel.id

  // Map old block IDs to new UUIDs
  const idMap: Record<string, string> = {}
  const blocks = funnelJson.blocks ?? []
  const edges = funnelJson.edges ?? []

  blocks.forEach((b) => { idMap[b.id] = crypto.randomUUID() })

  if (blocks.length > 0) {
    await admin.from('funnel_blocks').insert(
      blocks.map((b) => ({
        id: idMap[b.id],
        funnel_id: newFunnelId,
        block_type: b.block_type,
        label: b.label,
        config: b.config,
        position_x: b.position_x,
        position_y: b.position_y,
      }))
    )
  }

  if (edges.length > 0) {
    await admin.from('funnel_edges').insert(
      edges.map((e) => ({
        id: crypto.randomUUID(),
        funnel_id: newFunnelId,
        source_block_id: idMap[e.source_block_id] ?? e.source_block_id,
        target_block_id: idMap[e.target_block_id] ?? e.target_block_id,
        condition: e.condition,
      }))
    )
  }

  // Increment downloads_count
  await admin
    .from('funnel_templates')
    .update({ downloads_count: (template.downloads_count ?? 0) + 1 })
    .eq('id', templateId)

  redirect(`/funnels/${newFunnelId}/builder`)
}

export async function deleteTemplate(templateId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)
    const admin = createAdminClient()

    const { error } = await admin
      .from('funnel_templates')
      .delete()
      .eq('id', templateId)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/templates/my')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function updateTemplate(
  templateId: string,
  formData: FormData
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)
    const admin = createAdminClient()

    const name = (formData.get('name') as string)?.trim()
    const description = (formData.get('description') as string)?.trim() || null
    const category = (formData.get('category') as string)?.trim() || null
    const isPublic = formData.get('is_public') === 'true'
    const priceCentsRaw = formData.get('price_cents')
    const priceCents = priceCentsRaw ? Math.round(parseFloat(String(priceCentsRaw)) * 100) : 0

    const { error } = await admin
      .from('funnel_templates')
      .update({ name, description, category, is_public: isPublic, price_cents: priceCents })
      .eq('id', templateId)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/templates/my')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function toggleTemplatePublic(
  templateId: string,
  isPublic: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase()
    const tenantId = await getTenantId(supabase)
    const admin = createAdminClient()

    const { error } = await admin
      .from('funnel_templates')
      .update({ is_public: isPublic })
      .eq('id', templateId)
      .eq('tenant_id', tenantId)

    if (error) return { success: false, error: error.message }

    revalidatePath('/templates/my')
    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
