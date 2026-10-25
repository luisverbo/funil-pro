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
  /** "Veio do anúncio X (campanha Y)" — null = orgânico. */
  anuncio?: { ad_id: string; nome: string | null; conjunto: string | null; campanha: string | null; headline: string | null } | null
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
      anuncio: p.ad_id ? await (async () => {
        const { nomesDosAnuncios } = await import('@/lib/estudio/anuncios-servidor')
        const a = (await nomesDosAnuncios(admin, tenantId, [String(p.ad_id)]).catch(() => new Map())).get(String(p.ad_id))
        return { ad_id: String(p.ad_id), nome: a?.nome ?? null, conjunto: a?.conjunto ?? null, campanha: a?.campanha ?? null, headline: a?.headline ?? null }
      })() : null,
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
      const r = await (await producao()).entrarNaFila(admin, id, { forcar: true })
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

// ── Avisos e fila (Painel) ──────────────────────────────────────────────────

export interface AvisoLinha { id: string; canal: string; destino: string | null; texto: string | null; status: string; erro: string | null; pedido_id: string | null; criado_em: string }

export async function listarAvisosEstudio(): Promise<{ avisos: AvisoLinha[]; na_fila: number; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const [{ data, error }, { count }] = await Promise.all([
      admin.from('estudio_avisos').select('id, canal, destino, texto, status, erro, pedido_id, criado_em').eq('tenant_id', tenantId).order('criado_em', { ascending: false }).limit(40),
      admin.from('estudio_pedidos').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ['aguardando_producao', 'gerando', 'ajuste']),
    ])
    if (error) return { avisos: [], na_fila: count ?? 0, error: /estudio_avisos|does not exist/i.test(error.message) ? 'Falta rodar o SQL 20261030000000_estudio_ia_humano.sql no Supabase.' : error.message }
    return { avisos: (data ?? []) as AvisoLinha[], na_fila: count ?? 0 }
  } catch (e) { return { avisos: [], na_fila: 0, error: String(e) } }
}

// ── Fotos recebidas: trocar qual é rosto / corpo (um clique) ────────────────

export async function fotosRecebidasDoPedido(id: string): Promise<{ fotos: { path: string; url: string | null; tipo: string; motivo: string | null; em: string | null; papel: 'rosto' | 'corpo' | null }[]; rosto_recortado: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data: p } = await admin.from('estudio_pedidos').select('contato_id, rosto_origem, corpo_origem, rosto_recortado, fotos_recebidas').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
    if (!p) return { fotos: [], rosto_recortado: false, error: 'Pedido não encontrado.' }
    const { data: c } = p.contato_id ? await admin.from('estudio_contatos').select('fotos_recebidas').eq('id', p.contato_id).maybeSingle() : { data: null }
    const lista = ((c?.fotos_recebidas as unknown[]) ?? (p.fotos_recebidas as unknown[]) ?? []) as { path: string; tipo: string; motivo?: string | null; em?: string }[]
    const fotos = await Promise.all(lista.map(async f => ({
      path: f.path, tipo: f.tipo, motivo: f.motivo ?? null, em: f.em ?? null,
      url: (await admin.storage.from(BUCKET_CLIENTES).createSignedUrl(f.path, 3600)).data?.signedUrl ?? null,
      papel: (f.path === p.rosto_origem ? 'rosto' : f.path === p.corpo_origem ? 'corpo' : null) as 'rosto' | 'corpo' | null,
    })))
    return { fotos, rosto_recortado: !!p.rosto_recortado }
  } catch (e) { return { fotos: [], rosto_recortado: false, error: String(e) } }
}

export async function usarFotoComoEstudio(id: string, path: string, papel: 'rosto' | 'corpo'): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (papel !== 'rosto' && papel !== 'corpo') return { success: false, error: 'Papel inválido.' }
    const admin = createAdminClient()
    const { data: p } = await admin.from('estudio_pedidos').select('contato_id, rosto_origem, corpo_origem').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
    if (!p?.contato_id) return { success: false, error: 'Pedido não encontrado.' }
    if ((papel === 'rosto' ? p.corpo_origem : p.rosto_origem) === path) return { success: false, error: 'Essa foto já é a do outro papel — rosto e corpo nunca podem ser o mesmo arquivo.' }
    const { data: c } = await admin.from('estudio_contatos').select('fotos_recebidas').eq('id', p.contato_id).single()
    const lista = (c?.fotos_recebidas ?? []) as import('@/lib/estudio/ana/fotos').FotoRecebida[]
    if (!lista.some(f => f.path === path)) return { success: false, error: 'Foto não é desta conversa.' }
    // Escolha manual: vira a "origem" e a cópia rosto.jpg/corpo.jpg é refeita.
    await admin.from('estudio_pedidos').update(papel === 'rosto' ? { rosto_origem: path, rosto_recortado: false } : { corpo_origem: path }).eq('id', id)
    const { aplicarEscolhaDeFotos } = await import('@/lib/estudio/ana/executor')
    await aplicarEscolhaDeFotos(admin, id, lista)
    await admin.from('estudio_eventos').insert({ pedido_id: id, tipo: 'foto_trocada', detalhe: { papel, path } })
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

// ── De onde vem a venda (por anúncio) ───────────────────────────────────────

export interface LinhaOrigemTela {
  ad_id: string | null; nome: string | null; conjunto: string | null; campanha: string | null; headline: string | null
  conversas: number; pedidos: number; vendas: number; faturamento: Record<string, number>; taxa: number | null
}

export async function origemDasVendas(de: string, ate: string): Promise<{ linhas: LinhaOrigemTela[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return { linhas: [], error: 'Período inválido.' }
    const ini = new Date(`${de}T00:00:00-03:00`).toISOString(), fim = new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 86400e3).toISOString()
    const admin = createAdminClient()
    const [ct, pd] = await Promise.all([
      admin.from('estudio_contatos').select('ad_id, ad_id_primeiro, origem').eq('tenant_id', tenantId).gte('primeira_msg_em', ini).lt('primeira_msg_em', fim).limit(20000),
      admin.from('estudio_pedidos').select('ad_id, status, pago_em, valor_pago_cents, moeda, tipo, criado_em').eq('tenant_id', tenantId).gte('criado_em', ini).lt('criado_em', fim).neq('tipo', 'previa').limit(20000),
    ])
    if (ct.error) return { linhas: [], error: /ad_id|column/i.test(ct.error.message) ? 'Falta rodar o SQL 20261101000000_estudio_ia_anuncios.sql no Supabase.' : ct.error.message }
    const { agruparPorAnuncio } = await import('@/lib/estudio/anuncios')
    // A conversa conta para o anúncio que a TROUXE (primeiro clique); o pedido, para o último clique.
    const linhas = agruparPorAnuncio(
      (ct.data ?? []).map(c => ({ ad_id: (c.ad_id_primeiro ?? c.ad_id) || null })),
      (pd.data ?? []).map(p => ({ ad_id: p.ad_id || null, status: p.status, pago: !!p.pago_em, valor_pago_cents: p.valor_pago_cents, moeda: p.moeda })),
    )
    const { nomesDosAnuncios } = await import('@/lib/estudio/anuncios-servidor')
    const nomes = await nomesDosAnuncios(admin, tenantId, linhas.map(l => l.ad_id).filter((x): x is string => !!x))
    return { linhas: linhas.map(l => { const n = l.ad_id ? nomes.get(l.ad_id) : undefined; return { ...l, nome: n?.nome ?? null, conjunto: n?.conjunto ?? null, campanha: n?.campanha ?? null, headline: n?.headline ?? null } }) }
  } catch (e) { return { linhas: [], error: String(e) } }
}

// ── Meta (CAPI para mensagens): dataset, erro, código de teste ──────────────

export async function estadoMetaCapi(): Promise<{ waba_id: string | null; dataset_id: string | null; erro: string | null; erro_em: string | null; codigo_teste: string | null; pendentes: number; error?: string }> {
  const vazio = { waba_id: null, dataset_id: null, erro: null, erro_em: null, codigo_teste: null, pendentes: 0 }
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data, error } = await admin.from('estudio_config').select('waba_id, meta_dataset_id, meta_capi_erro, meta_capi_erro_em, meta_test_event_code').eq('tenant_id', tenantId).maybeSingle()
    if (error) return { ...vazio, error: /meta_|column/i.test(error.message) ? 'Falta rodar o SQL 20261101000000_estudio_ia_anuncios.sql no Supabase.' : error.message }
    const { count } = await admin.from('estudio_pedidos').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).not('meta_erro', 'is', null)
    return { waba_id: data?.waba_id ?? null, dataset_id: data?.meta_dataset_id ?? null, erro: data?.meta_capi_erro ?? null, erro_em: data?.meta_capi_erro_em ?? null, codigo_teste: data?.meta_test_event_code ?? null, pendentes: count ?? 0 }
  } catch (e) { return { ...vazio, error: String(e) } }
}

export async function obterDatasetMeta(): Promise<{ success: boolean; dataset_id?: string | null; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { obterDataset } = await import('@/lib/estudio/anuncios-servidor')
    const r = await obterDataset(createAdminClient(), tenantId)
    return r.dataset_id ? { success: true, dataset_id: r.dataset_id } : { success: false, error: r.erro }
  } catch (e) { return { success: false, error: String(e) } }
}

/** Código do "Testar eventos" do Gerenciador de Eventos (vazio = produção). */
export async function salvarCodigoTesteMeta(codigo: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const c = String(codigo ?? '').trim().slice(0, 40) || null
    const { error } = await createAdminClient().from('estudio_config').update({ meta_test_event_code: c }).eq('tenant_id', tenantId)
    return error ? { success: false, error: error.message } : { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

// ── Painel de resultado: lucro, custos, anúncios, países ────────────────────

type KpisTela = import('@/lib/estudio/painel').Kpis
type PaisTela = import('@/lib/estudio/painel').LinhaPais
type AnuncioTela = import('@/lib/estudio/painel').LinhaAnuncio & { nome: string | null; conjunto: string | null; campanha: string | null }

export async function painelEstudio(de: string, ate: string): Promise<{
  atual: KpisTela | null; anterior: KpisTela | null; paises: PaisTela[]; anuncios: AnuncioTela[]
  cotacao_usd: number; gasto_sincronizado: boolean; avisos: string[]; error?: string
}> {
  const vazio = { atual: null, anterior: null, paises: [], anuncios: [], cotacao_usd: 0, gasto_sincronizado: false, avisos: [] }
  try {
    const tenantId = await getTenantId()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate) || de > ate) return { ...vazio, error: 'Período inválido.' }
    const P = await import('@/lib/estudio/painel')
    const admin = createAdminClient()
    const ant = P.periodoAnterior(de, ate)
    const { data: cfg } = await admin.from('estudio_config').select('cotacoes').eq('tenant_id', tenantId).maybeSingle()
    const cot: Record<string, number> = { BRL: 1, USD: 5.5, EUR: 6, ...((cfg?.cotacoes ?? {}) as Record<string, number>) }
    const avisos: string[] = []

    const carregar = async (d0: string, d1: string) => {
      const ini = new Date(`${d0}T00:00:00-03:00`).toISOString(), fim = new Date(new Date(`${d1}T00:00:00-03:00`).getTime() + 86400e3).toISOString()
      let ct = await admin.from('estudio_contatos').select('pais, ad_id, ad_id_primeiro').eq('tenant_id', tenantId).gte('primeira_msg_em', ini).lt('primeira_msg_em', fim).limit(20000)
      if (ct.error) {
        if (!avisos.includes('anuncios')) avisos.push('anuncios')
        ct = await admin.from('estudio_contatos').select('pais').eq('tenant_id', tenantId).gte('primeira_msg_em', ini).lt('primeira_msg_em', fim).limit(20000) as typeof ct
      }
      const [pd, uso] = await Promise.all([
        admin.from('estudio_pedidos').select('pais, ad_id, contato_id, valor_pago_cents, moeda, status, tipo').eq('tenant_id', tenantId).gte('pago_em', ini).lt('pago_em', fim).neq('tipo', 'previa').limit(20000),
        admin.from('estudio_ia_uso').select('finalidade, custo_usd').eq('tenant_id', tenantId).gte('criado_em', ini).lt('criado_em', fim).limit(50000),
      ])
      const contatos = (ct.data ?? []).map((c: Record<string, unknown>) => ({ pais: (c.pais as string) ?? null, ad_id: ((c.ad_id_primeiro ?? c.ad_id) as string) || null }))
      const vendas = (pd.data ?? []).map(p => ({ pais: p.pais ?? null, ad_id: p.ad_id || null, contato_id: p.contato_id, valor_pago_cents: p.valor_pago_cents, moeda: p.moeda, status: p.status }))
      // Gasto: anúncios que trouxeram conversa ou venda ao estúdio, pela sincronização da aba Tráfego.
      const ads = [...new Set([...contatos, ...vendas].map(x => x.ad_id).filter((x): x is string => !!x))]
      let gastos: { ad_id: string; spend_cents: number; currency: string | null }[] = []
      if (ads.length) {
        const { data: ins } = await admin.from('ad_insights').select('external_id, spend_cents, currency').eq('tenant_id', tenantId).eq('level', 'ad').is('hour', null).in('external_id', ads).gte('date', d0).lte('date', d1).limit(20000)
        gastos = (ins ?? []).map(i => ({ ad_id: i.external_id, spend_cents: i.spend_cents ?? 0, currency: i.currency }))
      }
      return { contatos, vendas, usos: (uso.data ?? []).map(u => ({ finalidade: u.finalidade, custo_usd: Number(u.custo_usd ?? 0) })), gastos, temAds: ads.length > 0 }
    }

    const [a, b] = await Promise.all([carregar(de, ate), carregar(ant.de, ant.ate)])
    const linhasAd = P.porAnuncio(a, cot)
    const { nomesDosAnuncios } = await import('@/lib/estudio/anuncios-servidor')
    const mapa = await nomesDosAnuncios(admin, tenantId, linhasAd.map(l => l.ad_id).filter((x): x is string => !!x)).catch(() => new Map<string, { nome: string | null; conjunto: string | null; campanha: string | null }>())
    const anuncios = linhasAd.map(l => { const n = l.ad_id ? mapa.get(l.ad_id) : undefined; return { ...l, nome: n?.nome ?? null, conjunto: n?.conjunto ?? null, campanha: n?.campanha ?? null } })
    return {
      atual: P.calcularKpis(a, cot), anterior: P.calcularKpis(b, cot), paises: P.porPais(a, cot), anuncios,
      cotacao_usd: Number(cot.USD) || 0, gasto_sincronizado: !a.temAds || a.gastos.length > 0, avisos,
    }
  } catch (e) { return { ...vazio, error: String(e) } }
}

// ── Supervisor da Ana ───────────────────────────────────────────────────────

const avisoSupervisor = (m: string) => /estudio_revisoes|estudio_achados|revisado_ate|does not exist|schema cache/i.test(m)
  ? 'Falta rodar o SQL 20261108000000_estudio_ia_supervisor.sql no Supabase.' : m

export interface AchadoTela {
  id: string; contato_id: string; contato_nome: string | null; pais: string | null; gravidade: string; tipo: string
  trecho: string | null; problema: string; deveria: string | null; correcao: { destino: string; pergunta: string | null; texto: string }
  status: string; criado_em: string
}

export async function painelSupervisor(dias = 7): Promise<{
  achados: AchadoTela[]; revisoes: number; nota_media: number | null; vendeu: number; perdeu: number
  por_tipo: Record<string, number>; custo_usd: number; para_claude: string; error?: string
}> {
  const vazio = { achados: [], revisoes: 0, nota_media: null, vendeu: 0, perdeu: 0, por_tipo: {}, custo_usd: 0, para_claude: '' }
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const desde = new Date(Date.now() - Math.max(1, Math.min(90, dias)) * 86400e3).toISOString()
    const [rv, ac] = await Promise.all([
      admin.from('estudio_revisoes').select('nota, venda, custo_usd').eq('tenant_id', tenantId).gte('criado_em', desde).limit(5000),
      admin.from('estudio_achados').select('id, contato_id, gravidade, tipo, trecho, problema, deveria, correcao, status, criado_em').eq('tenant_id', tenantId).eq('status', 'novo').order('criado_em', { ascending: false }).limit(300),
    ])
    if (rv.error) return { ...vazio, error: avisoSupervisor(rv.error.message) }
    const ids = [...new Set((ac.data ?? []).map(a => a.contato_id))]
    const { data: cts } = ids.length ? await admin.from('estudio_contatos').select('id, nome, pais').in('id', ids) : { data: [] }
    const nomes = new Map((cts ?? []).map(c => [c.id, c]))
    const ordem = { alta: 0, media: 1, baixa: 2 } as Record<string, number>
    const achados = (ac.data ?? []).map(a => ({ ...a, contato_nome: nomes.get(a.contato_id)?.nome ?? null, pais: nomes.get(a.contato_id)?.pais ?? null }) as AchadoTela)
      .sort((a, b) => (ordem[a.gravidade] ?? 3) - (ordem[b.gravidade] ?? 3))
    const notas = (rv.data ?? []).map(r => r.nota).filter((n): n is number => typeof n === 'number')
    const por_tipo: Record<string, number> = {}
    for (const a of achados) por_tipo[a.tipo] = (por_tipo[a.tipo] ?? 0) + 1
    const { textoParaClaude } = await import('@/lib/estudio/supervisor')
    return {
      achados, revisoes: (rv.data ?? []).length, nota_media: notas.length ? Math.round(notas.reduce((s, n) => s + n, 0) / notas.length * 10) / 10 : null,
      vendeu: (rv.data ?? []).filter(r => r.venda === 'vendeu').length, perdeu: (rv.data ?? []).filter(r => r.venda === 'perdeu').length,
      por_tipo, custo_usd: Math.round((rv.data ?? []).reduce((s, r) => s + Number(r.custo_usd ?? 0), 0) * 100) / 100,
      para_claude: textoParaClaude(achados.filter(a => a.correcao?.destino === 'codigo')),
    }
  } catch (e) { return { ...vazio, error: String(e) } }
}

/** "Aplicar": regra/FAQ/não dizer vira item da Base de conhecimento (a Ana usa na próxima mensagem). */
export async function aplicarAchado(id: string, textoEditado?: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const { data: a, error } = await admin.from('estudio_achados').select('id, correcao, status').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
    if (error) return { success: false, error: avisoSupervisor(error.message) }
    if (!a) return { success: false, error: 'Não encontrado.' }
    const { linhaDaBase } = await import('@/lib/estudio/supervisor')
    const corr = { ...(a.correcao as { destino: 'regra' | 'faq' | 'nao_dizer' | 'codigo'; pergunta: string | null; texto: string }) }
    if (textoEditado?.trim()) corr.texto = textoEditado.trim()
    const linha = linhaDaBase(corr)
    if (!linha) return { success: false, error: 'Este é de código: copie em "Levar para o Claude Code".' }
    const { error: e2 } = await admin.from('estudio_conhecimento').insert({ tenant_id: tenantId, ...linha, ativo: true, ordem: 0 })
    if (e2) return { success: false, error: e2.message }
    await admin.from('estudio_achados').update({ status: 'aplicado', aplicado_em: new Date().toISOString(), correcao: corr }).eq('id', id)
    return { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

export async function ignorarAchado(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { error } = await createAdminClient().from('estudio_achados').update({ status: 'ignorado' }).eq('id', id).eq('tenant_id', tenantId)
    return error ? { success: false, error: avisoSupervisor(error.message) } : { success: true }
  } catch (e) { return { success: false, error: String(e) } }
}

/** Revisa agora (sem esperar a hora cheia). Com contatoId, revisa só aquela conversa. */
export async function revisarAgoraSupervisor(contatoId?: string): Promise<{ success: boolean; revisadas: number; achados: number; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { revisarConversas } = await import('@/lib/estudio/supervisor-servidor')
    const r = await revisarConversas(createAdminClient(), { tenantId, contatoId: contatoId || undefined, limite: contatoId ? 1 : 10, orcamentoMs: 240e3 })
    return { success: r.erros.length === 0 || r.revisadas > 0, revisadas: r.revisadas, achados: r.achados, error: r.erros.length ? r.erros.slice(0, 3).join(' · ') : undefined }
  } catch (e) { return { success: false, revisadas: 0, achados: 0, error: String(e) } }
}
