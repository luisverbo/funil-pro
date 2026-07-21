'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

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

async function getTenantId(supabase: ReturnType<typeof createServerClient>): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()
  if (!data) redirect('/login')
  return data.tenant_id
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    + '-' + Math.random().toString(36).slice(2, 7)
}

export async function createPage(data: { name: string; page_type: string; funnel_id?: string; craft_json?: object }) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const slug = generateSlug(data.name)
  const { data: page, error } = await supabase
    .from('pages')
    .insert({
      tenant_id,
      title: data.name,
      page_type: data.page_type,
      funnel_id: data.funnel_id ?? null,
      slug,
      craft_json: data.craft_json ?? {},
      published: false,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  revalidatePath('/pages')
  return page
}

export async function savePage(id: string, craft_json: object) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const { error } = await supabase
    .from('pages')
    .update({ craft_json })
    .eq('id', id)
    .eq('tenant_id', tenant_id)
  if (error) throw new Error(error.message)
  revalidatePath('/pages')
}

/** Configurações da página: SEO, slug e funil conectado */
export async function savePageSettings(id: string, s: {
  title?: string; slug?: string; meta_title?: string | null; meta_description?: string | null;
  og_image_url?: string | null; funnel_id?: string | null
}) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const patch: Record<string, unknown> = {}
  if (s.title !== undefined) patch.title = s.title.trim() || 'Página'
  if (s.meta_title !== undefined) patch.meta_title = s.meta_title?.trim() || null
  if (s.meta_description !== undefined) patch.meta_description = s.meta_description?.trim() || null
  if (s.og_image_url !== undefined) patch.og_image_url = s.og_image_url?.trim() || null
  if (s.funnel_id !== undefined) patch.funnel_id = s.funnel_id || null
  if (s.slug !== undefined && s.slug.trim()) {
    const slug = s.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (slug) {
      // garante unicidade do slug
      const { data: clash } = await supabase.from('pages').select('id').eq('slug', slug).neq('id', id).limit(1)
      if (clash && clash.length > 0) return { error: 'Este slug já está em uso' }
      patch.slug = slug
    }
  }
  const { error } = await supabase.from('pages').update(patch).eq('id', id).eq('tenant_id', tenant_id)
  if (error) return { error: error.message }
  revalidatePath('/pages')
  return { ok: true }
}

/** Cliques por botão de uma Bio Link */
export async function getBioClicks(pageId: string): Promise<Record<string, number>> {
  const supabase = await getSupabase()
  await getTenantId(supabase)
  const { data } = await supabase.from('bio_clicks').select('button_id, clicks').eq('page_id', pageId)
  const out: Record<string, number> = {}
  for (const r of data ?? []) out[r.button_id as string] = r.clicks as number
  return out
}

/** Funis do tenant (pro seletor de funil das configurações da página) */
export async function listTenantFunnels() {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const { data } = await supabase.from('funnels').select('id, name').eq('tenant_id', tenant_id).order('name')
  return data ?? []
}

export async function publishPage(id: string) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const { data: existing } = await supabase
    .from('pages')
    .select('slug, title')
    .eq('id', id)
    .eq('tenant_id', tenant_id)
    .single()
  const slug = existing?.slug || generateSlug(existing?.title || 'pagina')
  const { error } = await supabase
    .from('pages')
    .update({ published: true, slug })
    .eq('id', id)
    .eq('tenant_id', tenant_id)
  if (error) throw new Error(error.message)
  revalidatePath('/pages')
  return slug
}

export async function unpublishPage(id: string) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const { error } = await supabase
    .from('pages')
    .update({ published: false })
    .eq('id', id)
    .eq('tenant_id', tenant_id)
  if (error) throw new Error(error.message)
  revalidatePath('/pages')
}

export async function deletePage(id: string) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const { error } = await supabase
    .from('pages')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant_id)
  if (error) throw new Error(error.message)
  revalidatePath('/pages')
}

export async function duplicatePage(id: string) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const { data: original } = await supabase
    .from('pages')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenant_id)
    .single()
  if (!original) throw new Error('Page not found')
  const { data: copy, error } = await supabase
    .from('pages')
    .insert({
      tenant_id,
      title: `Cópia de ${original.title}`,
      page_type: original.page_type,
      funnel_id: original.funnel_id,
      slug: generateSlug(`copia-${original.title}`),
      craft_json: original.craft_json,
      published: false,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  revalidatePath('/pages')
  return copy
}

export async function getPages() {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const { data, error } = await supabase
    .from('pages')
    .select('*')
    .eq('tenant_id', tenant_id)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getPage(id: string) {
  const supabase = await getSupabase()
  const tenant_id = await getTenantId(supabase)
  const { data, error } = await supabase
    .from('pages')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenant_id)
    .single()
  if (error) throw new Error(error.message)
  return data
}
