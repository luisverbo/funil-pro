// ============================================================================
// Estúdio IA — Meta: dataset do WhatsApp, eventos LeadSubmitted / Purchase
// (CAPI para mensagens) e nome do anúncio/conjunto/campanha em cache.
// ----------------------------------------------------------------------------
// • só pedido com ctwa_clid (veio de anúncio); orgânico não envia
// • event_id fixo por pedido + meta_*_enviado_em → nunca conta 2×
// • falhou → meta_erro + meta_tentativas; o robô da produção reenvia até 3×;
//   o último erro (ex.: falta de permissão) fica em estudio_config e no painel
// • nome do anúncio: se o token não tiver permissão de anúncios, guarda o erro
//   e o painel mostra só o ID/headline — nunca quebra o fluxo
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { corpoDoEvento, deveEnviar, explicarErroMeta, idDoDataset, type PedidoParaEvento, type TipoEvento } from './anuncios'
import { nomeDoTema } from './ana/textos'

export const GRAPH_CAPI = 'https://graph.facebook.com/v23.0'
type Fetch = typeof fetch

interface CfgMeta { tenant_id: string; waba_id: string | null; access_token: string | null; meta_dataset_id: string | null; meta_test_event_code: string | null }

async function cfgMeta(admin: SupabaseClient, tenantId: string): Promise<CfgMeta | null> {
  const { data } = await admin.from('estudio_config').select('tenant_id, waba_id, access_token, meta_dataset_id, meta_test_event_code').eq('tenant_id', tenantId).maybeSingle()
  return (data as CfgMeta | null) ?? null
}

async function erroNoPainel(admin: SupabaseClient, tenantId: string, erro: string | null) {
  await admin.from('estudio_config').update({ meta_capi_erro: erro, meta_capi_erro_em: erro ? new Date().toISOString() : null }).eq('tenant_id', tenantId).then(() => {}, () => {})
}

async function graph(url: string, token: string, init: { method?: string; body?: unknown } = {}, f: Fetch = fetch): Promise<{ ok: boolean; json: Record<string, unknown> | null; erro?: string }> {
  try {
    const r = await f(url, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    })
    const json = await r.json().catch(() => null) as Record<string, unknown> | null
    if (!r.ok) {
      const e = (json?.error ?? {}) as { message?: string; code?: number; error_user_msg?: string }
      return { ok: false, json, erro: `${e.message ?? `HTTP ${r.status}`}${e.code ? ` (#${e.code})` : ''}${e.error_user_msg ? ` — ${e.error_user_msg}` : ''}` }
    }
    return { ok: true, json }
  } catch (err) { return { ok: false, json: null, erro: String(err) } }
}

/** Dataset ligado ao WABA: GET /{WABA}/dataset; se não houver, POST cria. Guarda em estudio_config. */
export async function obterDataset(admin: SupabaseClient, tenantId: string, f?: Fetch): Promise<{ dataset_id: string | null; erro?: string }> {
  const cfg = await cfgMeta(admin, tenantId)
  if (!cfg) return { dataset_id: null, erro: 'Estúdio não conectado.' }
  if (cfg.meta_dataset_id) return { dataset_id: cfg.meta_dataset_id }
  if (!cfg.waba_id || !cfg.access_token) return { dataset_id: null, erro: 'Falta o WABA ID ou o token do estúdio em Configurações.' }
  let r = await graph(`${GRAPH_CAPI}/${cfg.waba_id}/dataset`, cfg.access_token, {}, f)
  let id = r.ok ? idDoDataset(r.json) : null
  if (r.ok && !id) { r = await graph(`${GRAPH_CAPI}/${cfg.waba_id}/dataset`, cfg.access_token, { method: 'POST' }, f); id = r.ok ? idDoDataset(r.json) : null }
  if (!id) {
    const erro = explicarErroMeta(r.erro ?? 'a Meta não devolveu o dataset')
    await erroNoPainel(admin, tenantId, erro)
    return { dataset_id: null, erro }
  }
  await admin.from('estudio_config').update({ meta_dataset_id: id }).eq('tenant_id', tenantId)
  return { dataset_id: id }
}

/**
 * Manda LeadSubmitted (pedido registrado) ou Purchase (pagamento confirmado).
 * Devolve 'enviado' | 'pulado' (orgânico/já enviado/prévia) | 'erro'.
 */
export async function enviarEventoPedido(admin: SupabaseClient, pedidoId: string, tipo: TipoEvento, f?: Fetch): Promise<{ resultado: 'enviado' | 'pulado' | 'erro'; erro?: string }> {
  const { data: p } = await admin.from('estudio_pedidos')
    .select('id, tenant_id, ctwa_clid, valor_cents, valor_pago_cents, moeda, tema_slug, pacote_qtd, tipo, criado_em, pago_em, meta_lead_enviado_em, meta_purchase_enviado_em, meta_tentativas')
    .eq('id', pedidoId).maybeSingle()
  if (!p) return { resultado: 'pulado' }
  const ped = { ...(p as PedidoParaEvento & { tenant_id: string; tema_slug: string | null; meta_tentativas: number | null }) }
  ped.tema_nome = nomeDoTema(ped.tema_slug, 'pt-BR')
  if (!deveEnviar(ped, tipo)) return { resultado: 'pulado' }
  const cfg = await cfgMeta(admin, ped.tenant_id)
  const falhar = async (msg: string) => {
    const erro = explicarErroMeta(msg)
    await admin.from('estudio_pedidos').update({ meta_erro: `${tipo}: ${erro}`.slice(0, 500), meta_tentativas: Number(ped.meta_tentativas ?? 0) + 1 }).eq('id', pedidoId)
    await erroNoPainel(admin, ped.tenant_id, `${tipo} do pedido ${pedidoId.slice(0, 8)}: ${erro}`)
    return { resultado: 'erro' as const, erro }
  }
  if (!cfg?.waba_id || !cfg.access_token) return falhar('falta o WABA ID ou o token do estúdio')
  const ds = await obterDataset(admin, ped.tenant_id, f)
  if (!ds.dataset_id) return falhar(ds.erro ?? 'sem dataset')
  const corpo: Record<string, unknown> = { data: [corpoDoEvento(ped, tipo, cfg.waba_id)] }
  if (cfg.meta_test_event_code) corpo.test_event_code = cfg.meta_test_event_code
  const r = await graph(`${GRAPH_CAPI}/${ds.dataset_id}/events`, cfg.access_token, { method: 'POST', body: corpo }, f)
  if (!r.ok) return falhar(r.erro ?? 'falhou')
  await admin.from('estudio_pedidos').update({
    ...(tipo === 'Purchase' ? { meta_purchase_enviado_em: new Date().toISOString() } : { meta_lead_enviado_em: new Date().toISOString() }),
    meta_erro: null,
  }).eq('id', pedidoId)
  await erroNoPainel(admin, ped.tenant_id, null)
  await admin.from('estudio_eventos').insert({ pedido_id: pedidoId, tipo: `meta_${tipo.toLowerCase()}`, detalhe: { event_id: corpoDoEvento(ped, tipo, cfg.waba_id).event_id, resposta: r.json } }).then(() => {}, () => {})
  return { resultado: 'enviado' }
}

/** Reenvio pelo robô: pedido com erro e menos de 3 tentativas. */
export async function reenviarEventosPendentes(admin: SupabaseClient, f?: Fetch): Promise<number> {
  const { data } = await admin.from('estudio_pedidos').select('id, status, pago_em, meta_lead_enviado_em, meta_purchase_enviado_em')
    .not('ctwa_clid', 'is', null).not('meta_erro', 'is', null).lt('meta_tentativas', 3).limit(20)
  let n = 0
  for (const p of data ?? []) {
    if (!p.meta_lead_enviado_em) { const r = await enviarEventoPedido(admin, p.id, 'LeadSubmitted', f); if (r.resultado === 'enviado') n++ }
    if (p.pago_em && !p.meta_purchase_enviado_em && !['cancelado', 'reembolsado'].includes(p.status)) { const r = await enviarEventoPedido(admin, p.id, 'Purchase', f); if (r.resultado === 'enviado') n++ }
  }
  return n
}

/** Nome do anúncio, conjunto e campanha (cache de 7 dias). Sem permissão: guarda o erro e segue. */
export async function buscarAnuncio(admin: SupabaseClient, tenantId: string, adId: string, headline: string | null, f?: Fetch): Promise<void> {
  const { data: ja } = await admin.from('estudio_anuncios').select('nome, buscado_em, erro').eq('tenant_id', tenantId).eq('ad_id', adId).maybeSingle()
  if (ja && Date.now() - new Date(ja.buscado_em).getTime() < 7 * 86400e3 && (ja.nome || ja.erro)) return
  const cfg = await cfgMeta(admin, tenantId)
  const linha: Record<string, unknown> = { tenant_id: tenantId, ad_id: adId, headline, buscado_em: new Date().toISOString() }
  if (!cfg?.access_token) linha.erro = 'sem token do estúdio'
  else {
    const r = await graph(`${GRAPH_CAPI}/${adId}?fields=name,adset{name},campaign{name}`, cfg.access_token, {}, f)
    if (r.ok && r.json) {
      linha.nome = r.json.name ?? null
      linha.conjunto = (r.json.adset as { name?: string } | undefined)?.name ?? null
      linha.campanha = (r.json.campaign as { name?: string } | undefined)?.name ?? null
      linha.erro = null
    } else linha.erro = (r.erro ?? 'sem permissão de anúncios').slice(0, 300)
  }
  await admin.from('estudio_anuncios').upsert(linha, { onConflict: 'tenant_id,ad_id' }).then(() => {}, () => {})
}
