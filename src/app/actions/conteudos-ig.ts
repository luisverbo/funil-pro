'use server'
// ============================================================================
// Conteúdos Instagram — ações do painel /conteudos
// ----------------------------------------------------------------------------
// Chamadas pela tela via despachante HTTP (/api/conteudos), não como server
// action direta — mesma defesa do painel do quiz contra o id de build embutido.
// Cada função confere sessão + tenant por conta própria.
//
// ATENÇÃO: NÃO re-exportar tipos daqui (`export type { … }`) — vide quiz-leads.
// ============================================================================
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  podeFazer, statusValido, tipoValido, deInputLocalParaIso, MAX_LEGENDA, normalizarHashtags,
  type Conteudo, type StatusConteudo, type TipoConteudo,
} from '@/lib/conteudos-ig/regras'
import { publicarConteudo } from '@/lib/conteudos-ig/publicador'
import { getConnectedAccount } from '@/lib/instagram'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
    } },
  )
}

async function getTenantId(): Promise<string> {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

const COLS = '*'

// ── Leitura ─────────────────────────────────────────────────────────────────

export async function listarConteudos(
  filtro?: { status?: StatusConteudo[]; de?: string; ate?: string },
): Promise<{ itens: Conteudo[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    let q = admin.from('conteudos_instagram').select(COLS).eq('tenant_id', tenantId)
    if (filtro?.status?.length) q = q.in('status', filtro.status.filter(statusValido))
    if (filtro?.de) q = q.gte('data_agendada', filtro.de)
    if (filtro?.ate) q = q.lt('data_agendada', filtro.ate)
    const { data, error } = await q.order('data_agendada', { ascending: true }).range(0, 999)
    if (error) return { itens: [], error: error.message }
    return { itens: (data ?? []) as Conteudo[] }
  } catch (err) {
    return { itens: [], error: String(err) }
  }
}

export async function contagemPorStatus(): Promise<Record<StatusConteudo, number>> {
  const zero: Record<StatusConteudo, number> = { pendente: 0, agendado: 0, publicando: 0, publicado: 0, erro: 0, descartado: 0 }
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data } = await admin.from('conteudos_instagram').select('status').eq('tenant_id', tenantId).range(0, 4999)
    for (const r of data ?? []) if (statusValido(r.status)) zero[r.status]++
    return zero
  } catch { return zero }
}

export async function conexaoInstagram(): Promise<{ connected: boolean; username?: string; accountId?: string; error?: string }> {
  try { await getTenantId(); return await getConnectedAccount() }
  catch (err) { return { connected: false, error: String(err) } }
}

// ── Mutação de um item (sempre com checagem de status) ──────────────────────

async function carregarDoTenant(id: string, tenantId: string): Promise<Conteudo | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('conteudos_instagram').select(COLS).eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  return (data as Conteudo | null) ?? null
}

export async function aprovarConteudo(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const item = await carregarDoTenant(id, tenantId)
    if (!item) return { success: false, error: 'Conteúdo não encontrado' }
    if (!podeFazer(item.status, 'aprovar')) return { success: false, error: `Não dá para aprovar um item ${item.status}` }
    const { error } = await createAdminClient().from('conteudos_instagram')
      .update({ status: 'agendado', aprovado_em: new Date().toISOString(), erro: null })
      .eq('id', id).eq('tenant_id', tenantId)
    return error ? { success: false, error: error.message } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

export async function aprovarTodosPendentes(): Promise<{ success: boolean; aprovados?: number; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('conteudos_instagram')
      .update({ status: 'agendado', aprovado_em: new Date().toISOString(), erro: null })
      .eq('tenant_id', tenantId).eq('status', 'pendente').select('id')
    if (error) return { success: false, error: error.message }
    return { success: true, aprovados: (data ?? []).length }
  } catch (err) { return { success: false, error: String(err) } }
}

export async function descartarConteudo(
  id: string,
  opcoes?: { puxarFila?: boolean },
): Promise<{ success: boolean; puxados?: number; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const item = await carregarDoTenant(id, tenantId)
    if (!item) return { success: false, error: 'Conteúdo não encontrado' }
    if (!podeFazer(item.status, 'descartar')) return { success: false, error: `Não dá para descartar um item ${item.status}` }
    const admin = createAdminClient()
    const { error } = await admin.from('conteudos_instagram').update({ status: 'descartado' }).eq('id', id).eq('tenant_id', tenantId)
    if (error) return { success: false, error: error.message }
    let puxados = 0
    if (opcoes?.puxarFila) {
      const { data, error: e2 } = await admin.rpc('puxar_fila', { p_tenant_id: tenantId, p_tipo: item.tipo, p_a_partir_de: item.data_agendada })
      if (e2) return { success: true, puxados: 0, error: `Descartado, mas a fila não andou: ${e2.message}` }
      puxados = Number(data ?? 0)
    }
    return { success: true, puxados }
  } catch (err) { return { success: false, error: String(err) } }
}

export async function voltarParaPendente(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const item = await carregarDoTenant(id, tenantId)
    if (!item) return { success: false, error: 'Conteúdo não encontrado' }
    if (!podeFazer(item.status, 'voltar_para_pendente')) return { success: false, error: `Não dá para voltar um item ${item.status}` }
    const { error } = await createAdminClient().from('conteudos_instagram')
      .update({ status: 'pendente', aprovado_em: null }).eq('id', id).eq('tenant_id', tenantId)
    return error ? { success: false, error: error.message } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

export async function editarConteudo(
  id: string,
  patch: { descricao?: string; alt_text?: string | null; hashtags?: string[]; palavra_chave?: string | null; data_local?: string },
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const item = await carregarDoTenant(id, tenantId)
    if (!item) return { success: false, error: 'Conteúdo não encontrado' }
    if (!podeFazer(item.status, 'editar')) return { success: false, error: `Não dá para editar um item ${item.status}` }

    const upd: Record<string, unknown> = {}
    if (patch.descricao !== undefined) upd.descricao = String(patch.descricao).slice(0, MAX_LEGENDA)
    if (patch.alt_text !== undefined) upd.alt_text = patch.alt_text ? String(patch.alt_text).slice(0, 1000) : null
    if (patch.hashtags !== undefined) upd.hashtags = normalizarHashtags(patch.hashtags)
    if (patch.palavra_chave !== undefined) upd.palavra_chave = patch.palavra_chave ? String(patch.palavra_chave).slice(0, 120) : null
    if (patch.data_local !== undefined) {
      const iso = deInputLocalParaIso(patch.data_local)
      if (!iso) return { success: false, error: 'Data inválida' }
      upd.data_agendada = iso
    }
    if (Object.keys(upd).length === 0) return { success: true }

    const { error } = await createAdminClient().from('conteudos_instagram').update(upd).eq('id', id).eq('tenant_id', tenantId)
    return error ? { success: false, error: error.message } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

/** Erro → volta para a fila (zera tentativas). */
export async function tentarDeNovo(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const item = await carregarDoTenant(id, tenantId)
    if (!item) return { success: false, error: 'Conteúdo não encontrado' }
    if (!podeFazer(item.status, 'tentar_de_novo')) return { success: false, error: `Não dá para tentar de novo um item ${item.status}` }
    const { error } = await createAdminClient().from('conteudos_instagram')
      .update({ status: 'agendado', tentativas: 0, erro: null }).eq('id', id).eq('tenant_id', tenantId)
    return error ? { success: false, error: error.message } : { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

/**
 * MODO DE TESTE: publica agora, sem esperar o horário. Reserva o item de forma
 * atômica (só se ainda não estiver publicando/publicado) e roda o MESMO
 * publicador do cron. Serve para conferir a integração com um item real.
 */
export async function publicarAgora(id: string): Promise<{ success: boolean; permalink?: string | null; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const item = await carregarDoTenant(id, tenantId)
    if (!item) return { success: false, error: 'Conteúdo não encontrado' }
    if (!podeFazer(item.status, 'publicar_agora')) return { success: false, error: `Não dá para publicar um item ${item.status}` }

    const token = process.env.IG_ACCESS_TOKEN
    if (!token) return { success: false, error: 'Instagram não conectado (token ausente na plataforma)' }

    const admin = createAdminClient()
    const { data: reservado, error } = await admin.from('conteudos_instagram')
      .update({ status: 'publicando', erro: null })
      .eq('id', id).eq('tenant_id', tenantId).in('status', ['pendente', 'agendado', 'erro'])
      .select(COLS).maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!reservado) return { success: false, error: 'Este item já está sendo publicado' }

    const r = await publicarConteudo(admin, reservado as Conteudo, { token })
    return r.ok ? { success: true, permalink: r.permalink } : { success: false, error: r.erro }
  } catch (err) { return { success: false, error: String(err) } }
}

/** Para a tela pedir uma data livre ao mesmo SQL que as skills usam. */
export async function proximaDataLivre(tipo: TipoConteudo): Promise<{ iso?: string; error?: string }> {
  try {
    if (!tipoValido(tipo)) return { error: 'tipo inválido' }
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().rpc('proxima_data_livre', { p_tenant_id: tenantId, p_tipo: tipo })
    if (error) return { error: error.message }
    return { iso: String(data) }
  } catch (err) { return { error: String(err) } }
}
