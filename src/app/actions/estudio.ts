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
import {
  normalizarWhatsApp, statusDoNumero, registrarNumero, appsInscritos, inscreverApp, limparErro,
  webhookDoNumero, apontarWebhookDoNumero,
  type StatusDoNumero, type AppInscrito, type WebhookDoNumero,
} from '@/lib/estudio/whatsapp'
import { novoVerifyToken, URL_WEBHOOK_ESTUDIO } from '@/lib/estudio/assinatura'

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

// ── Fase 2: conexão do WhatsApp do estúdio ──────────────────────────────────
// O TOKEN nunca volta para a tela: só "tem token: sim/não".

export interface ConfigEstudioTela {
  waba_id: string | null
  phone_number_id: string | null
  display_number: string | null
  whatsapp_avisos: string | null
  resposta_teste: string | null
  ativo: boolean
  temToken: boolean
  temAppSecret: boolean
  verificado_em: string | null
}

async function configCompleta(tenantId: string) {
  const { data, error } = await createAdminClient().from('estudio_config')
    .select('waba_id, phone_number_id, display_number, whatsapp_avisos, resposta_teste, ativo, access_token, verificado_em, app_secret, verify_token')
    .eq('tenant_id', tenantId).maybeSingle()
  if (error && /app_secret|verify_token/.test(error.message)) {
    throw new Error('Falta rodar o SQL da Fase 2b (20261025000000_estudio_ia_webhook_override.sql) no Supabase.')
  }
  if (error) throw new Error(avisoDeTabela(error.message).replace('20261023000000_estudio_ia_fase1', '20261024000000_estudio_ia_fase2'))
  return data
}

export async function lerConfigEstudio(): Promise<{ config: ConfigEstudioTela | null; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const c = await configCompleta(tenantId)
    if (!c) return { config: null }
    const { access_token, app_secret, verify_token: _vt, ...resto } = c
    void _vt
    return { config: { ...resto, ativo: !!resto.ativo, temToken: !!access_token, temAppSecret: !!app_secret } as ConfigEstudioTela }
  } catch (err) { return { config: null, error: err instanceof Error ? err.message : String(err) } }
}

export async function salvarConfigEstudio(patch: {
  waba_id?: string; phone_number_id?: string; display_number?: string; whatsapp_avisos?: string
  resposta_teste?: string; access_token?: string; app_secret?: string; ativo?: boolean
}): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const upd: Record<string, unknown> = { tenant_id: tenantId, atualizado_em: new Date().toISOString() }
    const digitos = (v?: string) => (v ?? '').replace(/\D/g, '')
    if (patch.waba_id !== undefined) upd.waba_id = digitos(patch.waba_id) || null
    if (patch.phone_number_id !== undefined) {
      const id = digitos(patch.phone_number_id)
      if (id) {
        // O número do estúdio não pode estar ao mesmo tempo no inbox normal.
        const { data: noInbox } = await createAdminClient().from('wa_accounts').select('id').eq('phone_number_id', id).maybeSingle()
        if (noInbox) return { success: false, error: 'Esse número já está conectado na aba WhatsApp (inbox). Remova de lá antes: o número do estúdio tem que ser exclusivo.' }
      }
      upd.phone_number_id = id || null
    }
    if (patch.display_number !== undefined) upd.display_number = patch.display_number.trim() || null
    if (patch.whatsapp_avisos !== undefined) {
      const n = normalizarWhatsApp(patch.whatsapp_avisos)
      if (patch.whatsapp_avisos.trim() && !n) return { success: false, error: 'WhatsApp para avisos inválido. Use DDD + número.' }
      upd.whatsapp_avisos = n
    }
    if (patch.resposta_teste !== undefined) upd.resposta_teste = patch.resposta_teste.trim().slice(0, 1000) || null
    if (patch.access_token !== undefined && patch.access_token.trim()) upd.access_token = patch.access_token.trim()
    if (patch.app_secret !== undefined && patch.app_secret.trim()) {
      const sec = patch.app_secret.trim()
      if (!/^[a-f0-9]{32}$/i.test(sec)) return { success: false, error: 'O App Secret tem 32 caracteres (letras a–f e números). Copie de developers.facebook.com → app Cobrazap → Configurações → Básico.' }
      upd.app_secret = sec
    }
    if (patch.ativo !== undefined) upd.ativo = !!patch.ativo
    const { error } = await createAdminClient().from('estudio_config').upsert(upd, { onConflict: 'tenant_id' })
    if (error) return { success: false, error: avisoDeTabela(error.message) }
    revalidatePath('/estudio-ia'); revalidatePath('/estudio/catalogo')
    return { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

async function exigirConexao(tenantId: string) {
  const c = await configCompleta(tenantId)
  if (!c?.phone_number_id || !c.access_token) throw new Error('Preencha o phone_number_id e cole o token antes.')
  return c as typeof c & { phone_number_id: string; access_token: string }
}

/** Pergunta à Meta o estado do número (nome, verificação, registro, qualidade). */
export async function testarConexaoEstudio(): Promise<{ status?: StatusDoNumero; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const c = await exigirConexao(tenantId)
    const status = await statusDoNumero(c.phone_number_id, c.access_token)
    await createAdminClient().from('estudio_config').update({ verificado_em: new Date().toISOString() }).eq('tenant_id', tenantId)
    return { status }
  } catch (err) { return { error: err instanceof Error ? err.message : String(err) } }
}

/** POST /{phone_number_id}/register com o PIN de 6 dígitos escolhido pelo dono. O PIN não é guardado. */
export async function registrarNumeroEstudio(pin: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const c = await exigirConexao(tenantId)
    await registrarNumero(c.phone_number_id, c.access_token, String(pin ?? '').trim())
    return { success: true }
  } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
}

export async function appsDaWaba(): Promise<{ apps?: AppInscrito[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const c = await exigirConexao(tenantId)
    if (!c.waba_id) return { error: 'Preencha o WABA id.' }
    return { apps: await appsInscritos(c.waba_id, c.access_token) }
  } catch (err) { return { error: err instanceof Error ? err.message : String(err) } }
}

export async function inscreverAppNaWaba(): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const c = await exigirConexao(tenantId)
    if (!c.waba_id) return { success: false, error: 'Preencha o WABA id.' }
    await inscreverApp(c.waba_id, c.access_token)
    return { success: true }
  } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
}

/**
 * Manda um texto de teste para o WhatsApp dos avisos. Pela regra da Meta só
 * sai se esse número falou com o estúdio nas últimas 24h.
 */
export async function enviarTesteAvisos(): Promise<{ success: boolean; error?: string; detalhe?: string }> {
  try {
    const tenantId = await getTenantId()
    const c = await exigirConexao(tenantId)
    if (!c.whatsapp_avisos) return { success: false, error: 'Preencha o seu WhatsApp para avisos.' }
    // Mesmo caminho dos avisos de verdade (WhatsApp → modelo → push), registrado no Painel.
    const { avisarLuisRegistrado } = await import('@/lib/estudio/avisos')
    const r = await avisarLuisRegistrado(createAdminClient(), { tenant_id: tenantId, phone_number_id: c.phone_number_id, access_token: c.access_token, whatsapp_avisos: c.whatsapp_avisos },
      '✅ Teste do Estúdio IA: os avisos de novo pedido vão chegar aqui.\n💰 Novo pedido para produzir … gera o pedido <id>', null)
    const detalhe = `WhatsApp: ${r.whatsapp ? 'enviado' : 'não'}${r.modelo ? ' · modelo: enviado' : ''} · push: ${r.push} celular(es)`
    if (r.whatsapp || r.modelo) return { success: true, detalhe }
    const fora = /24|window|re-engage|131047/i.test(r.erro ?? '')
    return { success: false, detalhe, error: fora
      ? 'A Meta só deixa o estúdio te escrever se você mandou mensagem para o número do estúdio nas últimas 24h (ou com o modelo aprovado "novo_pedido"). Mande um "oi" do seu WhatsApp para o estúdio e tente de novo.'
      : limparErro(r.erro ?? 'falhou') }
  } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
}

export interface ConversaResumo { id: string; wa_id: string; nome: string | null; origem: string; ultima_msg_em: string; janela_ate: string | null; ultima: string | null; direcao: string | null }

/** Últimas conversas do número do estúdio — para conferir o teste da Fase 2. */
export async function ultimasConversasEstudio(): Promise<{ conversas: ConversaResumo[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data: contatos, error } = await admin.from('estudio_contatos')
      .select('id, wa_id, nome, origem, ultima_msg_em, janela_ate').eq('tenant_id', tenantId)
      .order('ultima_msg_em', { ascending: false }).limit(20)
    if (error) return { conversas: [], error: avisoDeTabela(error.message) }
    const conversas: ConversaResumo[] = []
    for (const c of contatos ?? []) {
      const { data: m } = await admin.from('estudio_mensagens').select('texto, direcao')
        .eq('contato_id', c.id).order('criado_em', { ascending: false }).limit(1).maybeSingle()
      conversas.push({ ...(c as Omit<ConversaResumo, 'ultima' | 'direcao'>), ultima: m?.texto ?? null, direcao: m?.direcao ?? null })
    }
    return { conversas }
  } catch (err) { return { conversas: [], error: String(err) } }
}

/** Onde as mensagens deste número caem hoje (webhook do app × override do número). */
export async function webhookDoNumeroEstudio(): Promise<{ webhook?: WebhookDoNumero; nosso?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const c = await exigirConexao(tenantId)
    return { webhook: await webhookDoNumero(c.phone_number_id, c.access_token), nosso: URL_WEBHOOK_ESTUDIO }
  } catch (err) { return { error: err instanceof Error ? err.message : String(err) } }
}

/**
 * Aponta SÓ o número do estúdio para o FunilPro (override_callback_uri). O
 * webhook do app Cobrazap continua indo para o CobrarZap. Exige o App Secret
 * salvo antes: sem ele os POSTs assinados pelo Cobrazap seriam recusados.
 */
export async function apontarWebhookEstudio(): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const c = await exigirConexao(tenantId)
    if (!c.app_secret) return { success: false, error: 'Salve antes o App Secret do app Cobrazap — sem ele o FunilPro recusaria as mensagens assinadas por esse app.' }
    let verify = c.verify_token as string | null
    if (!verify) {
      verify = novoVerifyToken()
      const { error } = await createAdminClient().from('estudio_config').update({ verify_token: verify }).eq('tenant_id', tenantId)
      if (error) return { success: false, error: error.message }
    }
    await apontarWebhookDoNumero(c.phone_number_id, c.access_token, URL_WEBHOOK_ESTUDIO, verify)
    return { success: true }
  } catch (err) { return { success: false, error: err instanceof Error ? err.message : String(err) } }
}
