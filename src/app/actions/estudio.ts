'use server'
// ============================================================================
// Estúdio IA — ações do painel (Fase 1: catálogo)
// ----------------------------------------------------------------------------
// Chamadas pela tela via /api/estudio (despachante HTTP de lista fechada).
// Sessão + tenant conferidos em toda função; escrita com service role SEMPRE
// filtrada pelo tenant.
//
// ATENÇÃO: NÃO re-exportar tipos daqui (`export type { … }`) — vide quiz-leads.
// ============================================================================
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { lerPosesJson, normalizarNumero, BUCKET_CATALOGO, caminhoExemplo, type Tema, type Pose } from '@/lib/estudio/catalogo'
import posesPadrao from '@/lib/estudio/dados/poses.json'

async function getTenantId(): Promise<string> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
    } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

function avisoDeTabela(msg: string): string {
  return /estudio_|relation .* does not exist|schema cache/i.test(msg)
    ? 'As tabelas do Estúdio IA ainda não existem. Aplique a migration 20261023000000_estudio_ia_fase1.sql no Supabase.'
    : msg
}

// ── Leitura ─────────────────────────────────────────────────────────────────

export async function listarCatalogo(): Promise<{ temas: Tema[]; poses: Pose[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data: temas, error } = await admin.from('estudio_temas')
      .select('id, slug, nome, sujeito, capa_url, ativo, ordem').eq('tenant_id', tenantId).order('ordem')
    if (error) return { temas: [], poses: [], error: avisoDeTabela(error.message) }
    // Paginado: o PostgREST corta em 1000 linhas.
    const poses: Pose[] = []
    for (let de = 0; ; de += 1000) {
      const { data, error: e2 } = await admin.from('estudio_poses')
        .select('id, tema_slug, numero, cena, prompt_catalogo, prompt_cliente, foto_exemplo_path, ativa')
        .eq('tenant_id', tenantId).order('tema_slug').order('numero').range(de, de + 999)
      if (e2) return { temas: (temas ?? []) as Tema[], poses, error: avisoDeTabela(e2.message) }
      poses.push(...((data ?? []) as Pose[]))
      if (!data || data.length < 1000) break
    }
    return { temas: (temas ?? []) as Tema[], poses }
  } catch (err) { return { temas: [], poses: [], error: String(err) } }
}

// ── Importação ──────────────────────────────────────────────────────────────

/**
 * Importa o poses.json (o que veio com o projeto, ou um colado na tela).
 * Upsert por slug e por (tema_slug, numero): atualiza nome/cena/prompts e
 * NÃO mexe em foto_exemplo_path, ativa, capa nem ordem já ajustados.
 */
export async function importarPoses(jsonTexto?: string): Promise<{
  success: boolean; temas?: number; poses?: number; avisos?: string[]; error?: string
}> {
  try {
    const tenantId = await getTenantId()
    let fonte: unknown = posesPadrao
    if (jsonTexto && jsonTexto.trim()) {
      try { fonte = JSON.parse(jsonTexto) } catch { return { success: false, error: 'O texto colado não é um JSON válido.' } }
    }
    const { temas, poses, erros } = lerPosesJson(fonte)
    if (temas.length === 0) return { success: false, error: erros[0] ?? 'Nenhum tema no arquivo.' }

    const admin = createAdminClient()
    const { data: existentes, error: eTemas } = await admin.from('estudio_temas').select('slug, tenant_id')
    if (eTemas) return { success: false, error: avisoDeTabela(eTemas.message) }
    const deOutro = (existentes ?? []).filter(e => e.tenant_id !== tenantId).map(e => e.slug)
    const jaTem = new Set((existentes ?? []).filter(e => e.tenant_id === tenantId).map(e => e.slug))

    // Tema novo entra completo; tema existente só atualiza nome e sujeito.
    for (const t of temas) {
      if (deOutro.includes(t.slug)) { erros.push(`tema "${t.slug}" já existe em outro espaço — ignorado`); continue }
      const q = jaTem.has(t.slug)
        ? admin.from('estudio_temas').update({ nome: t.nome, sujeito: t.sujeito }).eq('slug', t.slug).eq('tenant_id', tenantId)
        : admin.from('estudio_temas').insert({ ...t, tenant_id: tenantId })
      const { error } = await q
      if (error) return { success: false, error: avisoDeTabela(error.message) }
    }

    const validas = poses.filter(p => !deOutro.includes(p.tema_slug))
    for (let i = 0; i < validas.length; i += 200) {
      const { error } = await admin.from('estudio_poses')
        .upsert(validas.slice(i, i + 200).map(p => ({ ...p, tenant_id: tenantId })), { onConflict: 'tema_slug,numero' })
      if (error) return { success: false, error: avisoDeTabela(error.message) }
    }
    revalidatePath('/estudio-ia'); revalidatePath('/estudio/catalogo')
    return { success: true, temas: temas.length, poses: validas.length, avisos: erros }
  } catch (err) { return { success: false, error: String(err) } }
}

// ── Edição ──────────────────────────────────────────────────────────────────

export async function salvarTema(slug: string, patch: { nome?: string; ativo?: boolean; ordem?: number; capa_url?: string | null }): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const upd: Record<string, unknown> = {}
    if (patch.nome !== undefined) { const n = String(patch.nome).trim(); if (!n) return { success: false, error: 'Nome vazio.' }; upd.nome = n.slice(0, 120) }
    if (patch.ativo !== undefined) upd.ativo = !!patch.ativo
    if (patch.ordem !== undefined && Number.isFinite(Number(patch.ordem))) upd.ordem = Math.round(Number(patch.ordem))
    if (patch.capa_url !== undefined) upd.capa_url = patch.capa_url ? String(patch.capa_url).trim().slice(0, 1000) : null
    const { error } = await createAdminClient().from('estudio_temas').update(upd).eq('slug', slug).eq('tenant_id', tenantId)
    revalidatePath('/estudio/catalogo')
    return error ? { success: false, error: error.message } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

export async function salvarPose(
  temaSlug: string, numero: string,
  patch: { cena?: string; prompt_catalogo?: string; prompt_cliente?: string; ativa?: boolean; foto_exemplo_path?: string | null },
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const n = normalizarNumero(numero)
    if (!n) return { success: false, error: 'Número inválido.' }
    const upd: Record<string, unknown> = {}
    for (const k of ['cena', 'prompt_catalogo', 'prompt_cliente'] as const) if (patch[k] !== undefined) upd[k] = String(patch[k]).slice(0, 8000)
    if (patch.ativa !== undefined) upd.ativa = !!patch.ativa
    if (patch.foto_exemplo_path !== undefined) upd.foto_exemplo_path = patch.foto_exemplo_path ? String(patch.foto_exemplo_path).trim() : null
    const { error } = await createAdminClient().from('estudio_poses').update(upd)
      .eq('tema_slug', temaSlug).eq('numero', n).eq('tenant_id', tenantId)
    revalidatePath('/estudio/catalogo')
    return error ? { success: false, error: error.message } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

/** Sobe a foto de exemplo de uma pose em estudio-catalogo/<slug>/<numero>.jpg. */
export async function subirFotoExemplo(temaSlug: string, numero: string, base64: string, contentType: string): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const n = normalizarNumero(numero)
    if (!n) return { success: false, error: 'Número inválido.' }
    if (!/^image\/(jpeg|png|webp)$/.test(contentType)) return { success: false, error: 'Use JPG, PNG ou WEBP.' }
    const bytes = Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64')
    if (bytes.length > 8 * 1024 * 1024) return { success: false, error: 'Imagem acima de 8 MB.' }
    const admin = createAdminClient()
    const { data: pose } = await admin.from('estudio_poses').select('id').eq('tema_slug', temaSlug).eq('numero', n).eq('tenant_id', tenantId).maybeSingle()
    if (!pose) return { success: false, error: 'Pose não encontrada.' }
    const path = caminhoExemplo(temaSlug, n)
    const { error } = await admin.storage.from(BUCKET_CATALOGO).upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
    if (error) return { success: false, error: error.message }
    await admin.from('estudio_poses').update({ foto_exemplo_path: path }).eq('id', pose.id)
    revalidatePath('/estudio/catalogo')
    return { success: true, path }
  } catch (err) { return { success: false, error: String(err) } }
}
