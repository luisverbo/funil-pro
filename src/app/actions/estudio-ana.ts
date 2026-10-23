'use server'
// ============================================================================
// Estúdio IA — Fase 3: textos da Ana por idioma, mídias (áudios A1–A6, menu,
// PDFs do catálogo) e inscrição do celular no Web Push.
//
// ATENÇÃO: NÃO re-exportar tipos daqui (`export type { … }`) — vide quiz-leads.
// ============================================================================
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUCKET_CATALOGO, urlPublicaDoCatalogo } from '@/lib/estudio/catalogo'
import { TEXTOS, IDIOMAS, CHAVES_AUDIO, type IdiomaAna } from '@/lib/estudio/ana/textos'
import { chavesDoTenant, endpointValido, avisarAparelhos } from '@/lib/estudio/push'

async function getTenantId(): Promise<string> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

const aviso = (m: string) => /estudio_textos|estudio_push|vapid|column|does not exist|schema cache/i.test(m)
  ? 'Falta rodar o SQL da Fase 3 (20261027000000_estudio_ia_ana.sql) no Supabase.' : m
const idiomaOk = (i: unknown): i is IdiomaAna => (IDIOMAS as readonly string[]).includes(String(i))
const SUPA = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

// ── Textos ──────────────────────────────────────────────────────────────────

export interface LinhaTexto { chave: string; idioma: IdiomaAna; padrao: string; texto: string | null; audio_url: string | null; ehAudio: boolean }

export async function listarTextosAna(): Promise<{ linhas: LinhaTexto[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('estudio_textos').select('chave, idioma, texto, audio_path').eq('tenant_id', tenantId)
    if (error) return { linhas: [], error: aviso(error.message) }
    const mapa = new Map((data ?? []).map(r => [`${r.chave}|${r.idioma}`, r]))
    const linhas: LinhaTexto[] = []
    for (const chave of Object.keys(TEXTOS)) for (const idioma of IDIOMAS) {
      const r = mapa.get(`${chave}|${idioma}`)
      linhas.push({
        chave, idioma, padrao: TEXTOS[chave][idioma], texto: r?.texto ?? null,
        audio_url: r?.audio_path ? urlPublicaDoCatalogo(r.audio_path, SUPA()) : null,
        ehAudio: (CHAVES_AUDIO as readonly string[]).includes(chave),
      })
    }
    return { linhas }
  } catch (err) { return { linhas: [], error: String(err) } }
}

export async function salvarTextoAna(chave: string, idioma: string, texto: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!TEXTOS[chave] || !idiomaOk(idioma)) return { success: false, error: 'Chave ou idioma inválido.' }
    const t = String(texto ?? '').slice(0, 2000)
    const { error } = await createAdminClient().from('estudio_textos').upsert(
      { tenant_id: tenantId, chave, idioma, texto: t.trim() ? t : null, atualizado_em: new Date().toISOString() },
      { onConflict: 'tenant_id,chave,idioma' })
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

// ── Mídias: áudios A1–A6 por idioma, imagem do menu, PDFs ───────────────────

/** Link para o navegador subir o arquivo direto no bucket público do catálogo. */
export async function urlUploadMidiaAna(tipo: 'audio' | 'menu', chave: string | null, idioma: string | null, mime: string): Promise<{ path?: string; token?: string; error?: string }> {
  try {
    await getTenantId()
    let path: string
    if (tipo === 'menu') {
      if (!/^image\/(jpeg|png)$/.test(mime)) return { error: 'A imagem do menu precisa ser JPG ou PNG.' }
      path = 'midias/menu.jpg'
    } else {
      if (!chave || !(CHAVES_AUDIO as readonly string[]).includes(chave) || !idiomaOk(idioma)) return { error: 'Áudio ou idioma inválido.' }
      if (!/^audio\/(ogg|mpeg|mp4|aac|amr)/.test(mime)) return { error: 'Use áudio .ogg (melhor: vira nota de voz) ou .mp3.' }
      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') ? 'm4a' : mime.includes('aac') ? 'aac' : 'amr'
      path = `midias/${idioma}/${chave}.${ext}`
    }
    const admin = createAdminClient()
    await admin.storage.from(BUCKET_CATALOGO).remove([path]).catch(() => {})
    const { data, error } = await admin.storage.from(BUCKET_CATALOGO).createSignedUploadUrl(path)
    if (error || !data) return { error: error?.message ?? 'não deu para preparar o upload' }
    return { path, token: data.token }
  } catch (err) { return { error: String(err) } }
}

export async function salvarAudioAna(chave: string, idioma: string, path: string | null): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!(CHAVES_AUDIO as readonly string[]).includes(chave) || !idiomaOk(idioma)) return { success: false, error: 'inválido' }
    if (path && !path.startsWith(`midias/${idioma}/${chave}.`)) return { success: false, error: 'caminho inválido' }
    const admin = createAdminClient()
    const { data: atual } = await admin.from('estudio_textos').select('texto').eq('tenant_id', tenantId).eq('chave', chave).eq('idioma', idioma).maybeSingle()
    const { error } = await admin.from('estudio_textos').upsert(
      { tenant_id: tenantId, chave, idioma, texto: atual?.texto ?? null, audio_path: path, atualizado_em: new Date().toISOString() },
      { onConflict: 'tenant_id,chave,idioma' })
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

/** O que já existe: imagem do menu e PDF de cada tema ativo. */
export async function statusMidiasAna(): Promise<{ menu: string | null; pdfs: { slug: string; nome: string; url: string | null }[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const existe = async (path: string) => {
      const url = urlPublicaDoCatalogo(path, SUPA())
      if (!url) return null
      try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); return r.ok ? url : null } catch { return null }
    }
    const { data: temas } = await admin.from('estudio_temas').select('slug, nome').eq('tenant_id', tenantId).eq('ativo', true).order('ordem')
    const pdfs = await Promise.all((temas ?? []).map(async t => ({ slug: t.slug, nome: t.nome, url: await existe(`${t.slug}/catalogo-${t.slug}.pdf`) })))
    return { menu: await existe('midias/menu.jpg'), pdfs }
  } catch (err) { return { menu: null, pdfs: [], error: String(err) } }
}

// ── Web Push ────────────────────────────────────────────────────────────────

export async function chavePushEstudio(): Promise<{ publica?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const v = await chavesDoTenant(createAdminClient(), tenantId)
    return v ? { publica: v.publica } : { error: 'Conecte o número do estúdio e rode o SQL da Fase 3 primeiro.' }
  } catch (err) { return { error: aviso(String(err)) } }
}

export async function inscreverPushEstudio(endpoint: string, aparelho?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!endpointValido(endpoint)) return { success: false, error: 'Inscrição de push inválida.' }
    const { error } = await createAdminClient().from('estudio_push').upsert(
      { tenant_id: tenantId, endpoint, aparelho: String(aparelho ?? '').slice(0, 120) || null }, { onConflict: 'endpoint' })
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

export async function testarPushEstudio(): Promise<{ enviados: number; error?: string }> {
  try {
    const tenantId = await getTenantId()
    return { enviados: await avisarAparelhos(createAdminClient(), tenantId) }
  } catch (err) { return { enviados: 0, error: String(err) } }
}
