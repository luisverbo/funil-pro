'use server'
// ============================================================================
// Estúdio IA — Fase 5: subaba Pedidos (fila de produção) e o cartão
// "Motor de produção" em Configurações.
//
// ATENÇÃO: NÃO re-exportar tipos daqui (`export type { … }`) — vide quiz-leads.
// ============================================================================
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { BUCKET_CLIENTES, BUCKET_ENTREGAS } from '@/lib/estudio/catalogo'
// Produção carregada sob demanda: o painel nunca cai por causa do motor de imagem.
const producao = () => import('@/lib/estudio/producao-servidor')

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

const aviso = (m: string) => /motor|gemini|prazo_min|ajustes_gratis|upsell|fila_em|entrega_|api_|ajuste_|envio_path|enviada_em|column|does not exist|schema cache/i.test(m)
  ? 'Falta rodar o SQL da Fase 5 (20261029000000_estudio_ia_producao.sql) no Supabase.' : m

// ── Motor de produção (Configurações) ──────────────────────────────────────

export interface ProducaoConfig {
  motor: 'chatgpt_site' | 'api_gemini'; aprovacao_manual: boolean; tem_chave_gemini: boolean; chave_no_servidor: boolean
  prazo_min: number; ajustes_gratis: number; upsell_qtd: number; upsell_desconto_pct: number; error?: string
}

export async function lerProducaoConfig(): Promise<ProducaoConfig> {
  const vazio: ProducaoConfig = { motor: 'chatgpt_site', aprovacao_manual: false, tem_chave_gemini: false, chave_no_servidor: !!process.env.GEMINI_API_KEY, prazo_min: 60, ajustes_gratis: 1, upsell_qtd: 5, upsell_desconto_pct: 20 }
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('estudio_config')
      .select('motor, aprovacao_manual, gemini_api_key, prazo_min, ajustes_gratis, upsell_qtd, upsell_desconto_pct').eq('tenant_id', tenantId).maybeSingle()
    if (error) return { ...vazio, error: aviso(error.message) }
    if (!data) return vazio
    return {
      motor: data.motor === 'api_gemini' ? 'api_gemini' : 'chatgpt_site', aprovacao_manual: !!data.aprovacao_manual,
      tem_chave_gemini: !!process.env.GEMINI_API_KEY || !!data.gemini_api_key, chave_no_servidor: !!process.env.GEMINI_API_KEY,
      prazo_min: data.prazo_min ?? 60, ajustes_gratis: data.ajustes_gratis ?? 1, upsell_qtd: data.upsell_qtd ?? 5, upsell_desconto_pct: data.upsell_desconto_pct ?? 20,
    }
  } catch (e) { return { ...vazio, error: String(e) } }
}

/** A chave do Gemini é só de escrita: nunca volta para a tela. */
export async function salvarProducaoConfig(v: {
  motor: string; aprovacao_manual: boolean; prazo_min: number; ajustes_gratis: number; upsell_qtd: number; upsell_desconto_pct: number; gemini_api_key?: string | null
}): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!['chatgpt_site', 'api_gemini'].includes(v.motor)) return { success: false, error: 'Motor inválido.' }
    const n = (x: unknown, min: number, max: number, padrao: number) => { const k = Math.round(Number(x)); return Number.isFinite(k) ? Math.max(min, Math.min(max, k)) : padrao }
    const linha: Record<string, unknown> = {
      motor: v.motor, aprovacao_manual: !!v.aprovacao_manual, prazo_min: n(v.prazo_min, 10, 1440, 60), ajustes_gratis: n(v.ajustes_gratis, 0, 5, 1),
      upsell_qtd: n(v.upsell_qtd, 1, 30, 5), upsell_desconto_pct: n(v.upsell_desconto_pct, 0, 90, 20),
    }
    const chave = String(v.gemini_api_key ?? '').trim()
    if (chave) linha.gemini_api_key = chave.slice(0, 200)
    const { error } = await createAdminClient().from('estudio_config').update(linha).eq('tenant_id', tenantId)
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

// ── Fila de pedidos ─────────────────────────────────────────────────────────

export interface PedidoLista {
  id: string; status: string; tipo: string; cliente_nome: string | null; wa_id: string | null; tema_slug: string | null
  pacote_qtd: number | null; valor_pago_cents: number | null; valor_cents: number | null; moeda: string; motor: string
  criado_em: string; pago_em: string | null; fila_em: string | null; entregue_em: string | null; ajustes_usados: number
  entrega_erro: string | null; api_erro: string | null; atraso_avisado_em: string | null
}

const CAMPOS_LISTA = 'id, status, tipo, cliente_nome, wa_id, tema_slug, pacote_qtd, valor_pago_cents, valor_cents, moeda, motor, criado_em, pago_em, fila_em, entregue_em, ajustes_usados, entrega_erro, api_erro, atraso_avisado_em'

export async function listarPedidosEstudio(filtro: string): Promise<{ pedidos: PedidoLista[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    let q = createAdminClient().from('estudio_pedidos').select(CAMPOS_LISTA).eq('tenant_id', tenantId)
    if (filtro === 'fila') q = q.in('status', ['pago', 'aguardando_fotos', 'aguardando_producao', 'gerando', 'ajuste', 'pronto', 'aguardando_aprovacao'])
    else if (filtro && filtro !== 'todos') q = q.eq('status', filtro)
    const { data, error } = await q.order('criado_em', { ascending: false }).limit(200)
    if (error) return { pedidos: [], error: aviso(error.message) }
    return { pedidos: (data ?? []) as PedidoLista[] }
  } catch (e) { return { pedidos: [], error: String(e) } }
}

export interface PedidoDetalhe {
  pedido: Record<string, unknown>
  fotos: { rosto: string | null; corpo: string | null; comprovante: string | null }
  entregas: { id: string; pose_numero: string; status: string; nota_rosto: number | null; motor: string | null; url: string | null; enviada_em: string | null }[]
  eventos: { tipo: string; detalhe: unknown; criado_em: string }[]
  error?: string
}

export async function abrirPedidoEstudio(id: string): Promise<PedidoDetalhe> {
  const vazio: PedidoDetalhe = { pedido: {}, fotos: { rosto: null, corpo: null, comprovante: null }, entregas: [], eventos: [] }
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data: p, error } = await admin.from('estudio_pedidos').select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
    if (error) return { ...vazio, error: aviso(error.message) }
    if (!p) return { ...vazio, error: 'Pedido não encontrado.' }
    const assinar = async (bucket: string, path: unknown) => path ? (await admin.storage.from(bucket).createSignedUrl(String(path), 3600)).data?.signedUrl ?? null : null
    const { data: ents } = await admin.from('estudio_entregas').select('id, pose_numero, foto_path, status, nota_rosto, motor, enviada_em').eq('pedido_id', id).order('pose_numero').order('criado_em')
    const { data: evs } = await admin.from('estudio_eventos').select('tipo, detalhe, criado_em').eq('pedido_id', id).order('criado_em', { ascending: false }).limit(50)
    const { gemini_api_key: _x, ...semSegredo } = p as Record<string, unknown>
    void _x
    return {
      pedido: semSegredo,
      fotos: { rosto: await assinar(BUCKET_CLIENTES, p.foto_rosto_path), corpo: await assinar(BUCKET_CLIENTES, p.foto_corpo_path), comprovante: await assinar(BUCKET_CLIENTES, p.comprovante_path) },
      entregas: await Promise.all((ents ?? []).map(async e => ({
        id: e.id, pose_numero: e.pose_numero, status: e.status, nota_rosto: e.nota_rosto === null ? null : Number(e.nota_rosto), motor: e.motor ?? null,
        enviada_em: e.enviada_em ?? null, url: await assinar(BUCKET_ENTREGAS, e.foto_path),
      }))),
      eventos: (evs ?? []) as PedidoDetalhe['eventos'],
    }
  } catch (e) { return { ...vazio, error: String(e) } }
}

async function pedidoDoTenant(tenantId: string, id: string) {
  const { data } = await createAdminClient().from('estudio_pedidos').select('id, status, poses').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!data) throw new Error('Pedido não encontrado.')
  return data
}

/** "Gerar por API agora": o robô (pg_cron, 1 min) pega o pedido e entrega sozinho. */
export async function gerarPorApiAgora(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const p = await pedidoDoTenant(tenantId, id)
    if (!['pago', 'aguardando_fotos', 'aguardando_producao', 'gerando', 'ajuste'].includes(p.status)) return { success: false, error: `Pedido está "${p.status}".` }
    const admin = createAdminClient()
    if (p.status === 'pago' || p.status === 'aguardando_fotos') {
      const r = await (await producao()).entrarNaFila(admin, id)
      if (!r.ok) return { success: false, error: `Falta: ${(r.falta ?? []).join(', ')}` }
    }
    const { error } = await admin.from('estudio_pedidos').update({
      motor: 'api_gemini', api_iniciada_em: null, api_erro: null, ...(p.status === 'gerando' ? { status: 'aguardando_producao' } : {}),
    }).eq('id', id)
    return error ? { success: false, error: aviso(error.message) } : { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

/** Aprovação manual (só quando a opção estiver ligada): aprova e entrega. */
export async function aprovarEntregaEstudio(id: string): Promise<{ success: boolean; enviadas?: number; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const p = await pedidoDoTenant(tenantId, id)
    if (p.status !== 'aguardando_aprovacao') return { success: false, error: `Pedido está "${p.status}".` }
    const admin = createAdminClient()
    await admin.from('estudio_entregas').update({ status: 'aprovada' }).eq('pedido_id', id).eq('status', 'aguardando_aprovacao')
    await admin.from('estudio_pedidos').update({ status: 'pronto', entrega_iniciada_em: null }).eq('id', id)
    await admin.from('estudio_eventos').insert({ pedido_id: id, tipo: 'aprovado', detalhe: { por: 'luis' } })
    const r = await (await producao()).entregarPedido(admin, id)
    return r.erro ? { success: false, error: r.erro } : { success: true, enviadas: r.enviadas }
  } catch (e) { return { success: false, error: String(e) } }
}

/** REFAZER (Luís): volta para a fila com a observação, sem gastar o ajuste da cliente. */
export async function refazerPedidoEstudio(id: string, poses: string[], obs: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const p = await pedidoDoTenant(tenantId, id)
    if (['cancelado', 'novo', 'aguardando_pagamento', 'aguardando_conferencia'].includes(p.status)) return { success: false, error: `Pedido está "${p.status}".` }
    const alvo = (poses ?? []).filter(n => (p.poses ?? []).includes(n))
    const r = await (await producao()).registrarAjuste(createAdminClient(), id, alvo.length ? alvo : (p.poses ?? []), String(obs ?? '').slice(0, 500) || 'refazer', false)
    return r.ok ? { success: true } : { success: false, error: aviso(r.erro ?? 'falhou') }
  } catch (e) { return { success: false, error: String(e) } }
}

/** Entrega travada (janela fechada, WhatsApp recusou): tenta de novo agora. */
export async function reenviarEntregaEstudio(id: string): Promise<{ success: boolean; enviadas?: number; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const p = await pedidoDoTenant(tenantId, id)
    if (p.status !== 'pronto') return { success: false, error: `Só dá para reenviar pedido "pronto" (este está "${p.status}").` }
    const admin = createAdminClient()
    await admin.from('estudio_pedidos').update({ entrega_iniciada_em: null, entrega_erro: null }).eq('id', id)
    const r = await (await producao()).entregarPedido(admin, id)
    return r.erro ? { success: false, error: r.erro } : { success: true, enviadas: r.enviadas }
  } catch (e) { return { success: false, error: String(e) } }
}
