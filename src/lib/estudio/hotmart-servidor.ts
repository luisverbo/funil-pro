// ============================================================================
// Estúdio IA — Fase 7: webhook da Hotmart no servidor (banco + avisos)
// ----------------------------------------------------------------------------
// 1) acha o pedido: sck (= pedido_id) → telefone do comprador (wa_id) →
//    e-mail já visto numa compra anterior; sem pedido → registra e avisa
// 2) evento repetido (a Hotmart reenvia): nunca conta 2× — estudio_eventos +
//    estudio_pedidos.hotmart_transacao UNIQUE
// 3) confere produto, oferta do pacote, valor e moeda; bateu → marcarPago
//    (mesmo caminho do Pix: fila de produção + "💰 Novo pedido para produzir")
//    e a Ana confirma no idioma da cliente; não bateu → conferência manual
// 4) reembolso/chargeback/cancelamento → 'reembolsado'/'cancelado' + aviso
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'
import { acaoDoEvento, conferirCompra, lerCompraHotmart, mesmoTelefone, ofertaDoLink, sckEhPedido, valorPagoNaMoeda, produtosAceitos, type CompraHotmart } from './hotmart'
import { marcarPago } from './pix-servidor'
import { avisarLuis, falarComCliente, type Conexao } from './ana/executor'

const APP_URL = () => (process.env.NEXT_PUBLIC_APP_URL || 'https://funil-pro.vercel.app').replace(/\/+$/, '')

export interface ConfigHotmart { tenant_id: string; hotmart_produto_id?: string | null; con: Conexao | null }

export type ResultadoHotmart =
  | { status: 'pago'; pedido_id: string }
  | { status: 'repetido'; pedido_id?: string | null }
  | { status: 'conferencia'; pedido_id: string; motivos: string[] }
  | { status: 'sem_pedido' }
  | { status: 'estorno'; pedido_id: string }
  | { status: 'registrado'; pedido_id?: string | null }
  | { status: 'ignorado' }

interface PedidoAchado { id: string; contato_id: string | null; status: string; pacote_qtd: number | null; valor_cents: number | null; moeda: string | null; hotmart_transacao: string | null; cliente_nome: string | null; pais: string | null }
const CAMPOS = 'id, contato_id, status, pacote_qtd, valor_cents, moeda, hotmart_transacao, cliente_nome, pais'

async function acharPedido(admin: SupabaseClient, tenantId: string, c: CompraHotmart): Promise<{ pedido: PedidoAchado | null; por: 'sck' | 'telefone' | 'email' | null }> {
  if (sckEhPedido(c.sck)) {
    const { data } = await admin.from('estudio_pedidos').select(CAMPOS).eq('id', c.sck).eq('tenant_id', tenantId).maybeSingle()
    if (data) return { pedido: data as PedidoAchado, por: 'sck' }
  }
  if (c.telefone) {
    const final = c.telefone.replace(/\D/g, '').slice(-8)
    const { data: contatos } = final.length === 8 ? await admin.from('estudio_contatos').select('id, wa_id, pedido_atual_id').eq('tenant_id', tenantId).like('wa_id', `%${final}`).limit(5) : { data: [] }
    const contato = (contatos ?? []).find(x => mesmoTelefone(x.wa_id, c.telefone))
    if (contato) {
      const { data } = await admin.from('estudio_pedidos').select(CAMPOS).eq('tenant_id', tenantId).eq('contato_id', contato.id)
        .in('status', ['aguardando_pagamento', 'aguardando_conferencia', 'novo']).order('criado_em', { ascending: false }).limit(1).maybeSingle()
      if (data) return { pedido: data as PedidoAchado, por: 'telefone' }
    }
  }
  if (c.email) {
    // Não guardamos e-mail da cliente: vale o que já apareceu numa compra anterior ligada a um pedido.
    const { data: ev } = await admin.from('estudio_eventos').select('pedido_id').like('tipo', 'hotmart_%').eq('detalhe->>email', c.email).not('pedido_id', 'is', null).limit(1).maybeSingle()
    if (ev?.pedido_id) {
      const { data } = await admin.from('estudio_pedidos').select('contato_id').eq('id', ev.pedido_id).eq('tenant_id', tenantId).maybeSingle()
      if (data?.contato_id) {
        const { data: p } = await admin.from('estudio_pedidos').select(CAMPOS).eq('tenant_id', tenantId).eq('contato_id', data.contato_id)
          .in('status', ['aguardando_pagamento', 'aguardando_conferencia', 'novo']).order('criado_em', { ascending: false }).limit(1).maybeSingle()
        if (p) return { pedido: p as PedidoAchado, por: 'email' }
      }
    }
  }
  return { pedido: null, por: null }
}

/** Oferta (código) e preço esperados do pacote do pedido, pela tabela do país (ou INT). */
async function esperadoDoPedido(admin: SupabaseClient, tenantId: string, p: PedidoAchado) {
  const { data } = await admin.from('estudio_precos').select('pais, pacote_qtd, valor_cents, moeda, link_pagamento').eq('tenant_id', tenantId).eq('pacote_qtd', p.pacote_qtd ?? -1)
  const linhas = data ?? []
  const linha = linhas.find(l => l.pais === p.pais) ?? linhas.find(l => l.pais === 'INT') ?? linhas.find(l => l.link_pagamento)
  return { oferta: ofertaDoLink(linha?.link_pagamento ?? null), valor_cents: p.valor_cents ?? linha?.valor_cents ?? null, moeda: (p.moeda ?? linha?.moeda ?? 'USD').toUpperCase() }
}

export async function processarHotmart(admin: SupabaseClient, cfg: ConfigHotmart, c: CompraHotmart, bruto: unknown): Promise<ResultadoHotmart> {
  const acao = acaoDoEvento(c.evento)
  const tipo = `hotmart_${(c.evento || 'desconhecido').toLowerCase()}`
  const avisar = async (msg: string, pedidoId?: string | null) => { if (cfg.con) await avisarLuis(admin, cfg.con, msg, pedidoId ?? null) }

  // Evento repetido (a Hotmart reenvia até receber 200): mesmo tipo + mesma transação.
  if (c.transacao) {
    const { data: ja } = await admin.from('estudio_eventos').select('id, pedido_id').eq('tipo', tipo).eq('detalhe->>transacao', c.transacao).limit(1).maybeSingle()
    if (ja) return { status: 'repetido', pedido_id: ja.pedido_id }
  }

  const { pedido, por } = acao === 'ignorar' ? { pedido: null, por: null } : await acharPedido(admin, cfg.tenant_id, c)
  await admin.from('estudio_eventos').insert({
    pedido_id: pedido?.id ?? null, tipo,
    detalhe: { transacao: c.transacao, email: c.email, telefone: c.telefone, sck: c.sck, oferta: c.oferta, achado_por: por, payload: bruto },
  })
  if (acao === 'ignorar') return { status: 'ignorado' }

  const quem = `${c.nome ?? 'sem nome'} · ${c.email ?? 'sem e-mail'} · ${c.telefone ?? 'sem telefone'}`
  const valor = c.valor_oferta_cents !== null ? `${(c.valor_oferta_cents / 100).toFixed(2)} ${c.moeda_oferta ?? ''}` : c.valor_cents !== null ? `${(c.valor_cents / 100).toFixed(2)} ${c.moeda ?? ''}` : '?'

  if (!pedido) {
    if (acao === 'pago') await avisar(`🌎 Venda na Hotmart SEM pedido ligado (transação ${c.transacao ?? '?'} · oferta ${c.oferta ?? '?'} · ${valor}).\n👤 ${quem}\nFale com a cliente e crie/ligue o pedido na mão: ${APP_URL()}/estudio-ia?aba=pedidos`)
    else await avisar(`🌎 Hotmart ${c.evento} sem pedido ligado (transação ${c.transacao ?? '?'}).\n👤 ${quem}`)
    return { status: 'sem_pedido' }
  }

  if (acao === 'estorno') {
    const novo = c.evento === 'PURCHASE_CANCELED' ? 'cancelado' : 'reembolsado'
    await admin.from('estudio_pedidos').update({ status: novo, cancelado_em: new Date().toISOString(), cancelado_motivo: `Hotmart: ${c.evento}` }).eq('id', pedido.id)
    await avisar(`↩️ Hotmart ${c.evento === 'PURCHASE_CHARGEBACK' ? 'CHARGEBACK' : c.evento === 'PURCHASE_REFUNDED' ? 'REEMBOLSO' : 'cancelamento'}: ${pedido.cliente_nome ?? quem} · ${valor} · transação ${c.transacao ?? '?'}\nPedido ${pedido.id} marcado como "${novo}".`, pedido.id)
    return { status: 'estorno', pedido_id: pedido.id }
  }

  if (acao === 'registrar') {
    await avisar(`⚠️ Hotmart ${c.evento === 'PURCHASE_PROTEST' ? 'RECLAMAÇÃO (protesto)' : 'pagamento ATRASADO'}: ${pedido.cliente_nome ?? quem} · ${valor} · pedido ${pedido.id}`, pedido.id)
    return { status: 'registrado', pedido_id: pedido.id }
  }

  // ── Pago ───────────────────────────────────────────────────────────────
  if (pedido.hotmart_transacao && pedido.hotmart_transacao === c.transacao) return { status: 'repetido', pedido_id: pedido.id }
  if (['pago', 'aguardando_producao', 'gerando', 'pronto', 'entregue', 'finalizado'].includes(pedido.status)) {
    await avisar(`🌎 Hotmart aprovou de novo um pedido que já estava pago (${pedido.id}, transação ${c.transacao ?? '?'}). Confira se foi compra em dobro.`, pedido.id)
    return { status: 'repetido', pedido_id: pedido.id }
  }
  const esperado = await esperadoDoPedido(admin, cfg.tenant_id, pedido)
  const motivos = conferirCompra(c, { produto_id: produtosAceitos(cfg.hotmart_produto_id), oferta: esperado.oferta, valor_cents: esperado.valor_cents, moeda: esperado.moeda })
  if (motivos.length) {
    await admin.from('estudio_pedidos').update({ status: 'aguardando_conferencia', forma_pagamento: 'hotmart', conferencia_motivo: `Hotmart: ${motivos.join('; ')}`.slice(0, 500) }).eq('id', pedido.id)
    await avisar(`🧾 Hotmart aprovou, mas não bate com o pedido ${pedido.id}: ${motivos.join('; ')}\n👤 ${quem}\nConfira e aprove/recuse: ${APP_URL()}/estudio-ia?aba=painel`, pedido.id)
    return { status: 'conferencia', pedido_id: pedido.id, motivos }
  }
  const r = await marcarPago(admin, pedido.id, {
    pago_por: 'hotmart', forma_pagamento: 'hotmart', valor_pago_cents: valorPagoNaMoeda(c, esperado.moeda) ?? c.valor_cents,
    moeda: esperado.moeda, pago_em: c.aprovada_em, hotmart_transacao: c.transacao,
  })
  if (r.duplicado) return { status: 'repetido', pedido_id: pedido.id }
  if (r.error) throw new Error(r.error)   // 500 → a Hotmart reenvia
  if (pedido.contato_id) await falarComCliente(admin, cfg.tenant_id, pedido.contato_id, 'pago_ok', 'pago').catch(() => {})
  return { status: 'pago', pedido_id: pedido.id }
}

const igual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * A rota inteira, sem o Next: hottok → tenant (401 se não bater), processa e
 * devolve o status HTTP. Testável com um banco falso.
 */
export async function tratarWebhookHotmart(admin: SupabaseClient, hottokHeader: string | null, payload: unknown): Promise<{ http: number; corpo: Record<string, unknown> }> {
  const compra = lerCompraHotmart(payload)
  const hottok = (hottokHeader ?? compra.hottok_corpo ?? '').trim()
  if (!hottok) return { http: 401, corpo: { error: 'hottok ausente' } }
  const { data: cfgs, error } = await admin.from('estudio_config')
    .select('tenant_id, hotmart_hottok, hotmart_produto_id, phone_number_id, access_token, whatsapp_avisos').not('hotmart_hottok', 'is', null)
  if (error) { console.error('[hotmart/estudio] config:', error.message); return { http: 500, corpo: { error: 'configuração indisponível' } } }
  const cfg = ((cfgs ?? []) as { tenant_id: string; hotmart_hottok: string | null; hotmart_produto_id: string | null; phone_number_id: string | null; access_token: string | null; whatsapp_avisos: string | null }[])
    .find(c => c.hotmart_hottok && igual(String(c.hotmart_hottok).trim(), hottok))
  if (!cfg) return { http: 401, corpo: { error: 'hottok inválido' } }
  try {
    const r = await processarHotmart(admin, {
      tenant_id: cfg.tenant_id, hotmart_produto_id: cfg.hotmart_produto_id,
      con: cfg.access_token && cfg.phone_number_id ? { tenant_id: cfg.tenant_id, phone_number_id: String(cfg.phone_number_id), access_token: String(cfg.access_token), whatsapp_avisos: cfg.whatsapp_avisos ?? null } : null,
    }, compra, payload)
    console.log('[hotmart/estudio]', compra.evento, compra.transacao, r.status)
    return { http: 200, corpo: { ok: true, ...r } }
  } catch (err) {
    console.error('[hotmart/estudio] falhou:', String(err).slice(0, 300))
    return { http: 500, corpo: { error: 'falhou' } }   // a Hotmart reenvia; o repetido é barrado
  }
}
