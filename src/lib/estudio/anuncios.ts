// ============================================================================
// Estúdio IA — origem por anúncio (Click-to-WhatsApp) e eventos para a Meta
// (Conversions API for Business Messaging) — puro, sem rede
// ----------------------------------------------------------------------------
// referral (1ª mensagem vinda do anúncio):
//   { source_type: "ad", source_id: <ad_id>, source_url, headline, body,
//     media_type, image_url | video_url, ctwa_clid }
// Regra: orgânico nunca apaga a origem; anúncio NOVO vira o "último clique"
// e o primeiro fica guardado nas colunas *_primeiro.
// ============================================================================

export interface AnuncioDoReferral {
  ad_id: string; ctwa_clid: string | null; headline: string | null; body: string | null; media_url: string | null
}

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

export function anuncioDoReferral(referral: unknown): AnuncioDoReferral | null {
  if (!referral || typeof referral !== 'object') return null
  const r = referral as Record<string, unknown>
  const adId = s(r.source_id)
  if (!adId || (r.source_type !== undefined && String(r.source_type).toLowerCase() !== 'ad')) return null
  return { ad_id: adId, ctwa_clid: s(r.ctwa_clid), headline: s(r.headline), body: s(r.body), media_url: s(r.image_url) ?? s(r.video_url) ?? s(r.thumbnail_url) }
}

export interface OrigemDoContato {
  origem?: string | null; ad_id?: string | null; ctwa_clid?: string | null
  ad_id_primeiro?: string | null; ctwa_clid_primeiro?: string | null; origem_primeiro_em?: string | null
}

/**
 * O que gravar no contato para esta mensagem. null = nada muda (orgânica,
 * ou o MESMO clique repetido). Último clique ganha; o primeiro fica guardado.
 */
export function atualizacaoDeOrigem(atual: OrigemDoContato | null, anuncio: AnuncioDoReferral | null, agoraIso: string): Record<string, string | null> | null {
  if (!anuncio) return null
  if (atual?.ad_id === anuncio.ad_id && (atual?.ctwa_clid === anuncio.ctwa_clid || !anuncio.ctwa_clid)) return null
  const patch: Record<string, string | null> = {
    origem: 'anuncio', ad_id: anuncio.ad_id, ctwa_clid: anuncio.ctwa_clid ?? atual?.ctwa_clid ?? null,
    ad_headline: anuncio.headline, ad_body: anuncio.body, ad_media_url: anuncio.media_url, origem_em: agoraIso,
  }
  if (!atual?.ad_id_primeiro) {
    patch.ad_id_primeiro = anuncio.ad_id; patch.ctwa_clid_primeiro = anuncio.ctwa_clid; patch.origem_primeiro_em = agoraIso
  }
  return patch
}

// ── Eventos (CAPI para mensagens) ───────────────────────────────────────────

export type TipoEvento = 'LeadSubmitted' | 'Purchase'

export interface PedidoParaEvento {
  id: string; ctwa_clid: string | null; valor_cents: number | null; valor_pago_cents?: number | null; moeda?: string | null
  tema_nome?: string | null; pacote_qtd?: number | null; tipo?: string | null
  criado_em?: string | null; pago_em?: string | null
  meta_lead_enviado_em?: string | null; meta_purchase_enviado_em?: string | null
}

/** Só pedido que veio de anúncio (tem ctwa_clid) e que ainda não mandou esse evento. Prévia grátis não conta. */
export function deveEnviar(p: PedidoParaEvento, tipo: TipoEvento): boolean {
  if (!p.ctwa_clid || p.tipo === 'previa') return false
  return tipo === 'Purchase' ? !p.meta_purchase_enviado_em : !p.meta_lead_enviado_em
}

/** event_id fixo por pedido: a Meta deduplica e nunca conta 2×. */
export const eventIdDe = (pedidoId: string, tipo: TipoEvento) => `${pedidoId}-${tipo === 'Purchase' ? 'purchase' : 'lead'}`

export function corpoDoEvento(p: PedidoParaEvento, tipo: TipoEvento, wabaId: string, agora = new Date()) {
  const quando = tipo === 'Purchase' ? (p.pago_em ?? null) : (p.criado_em ?? null)
  // A Meta aceita até 7 dias para trás; evento "do futuro" vira agora.
  const t = quando ? Math.min(Math.floor(new Date(quando).getTime() / 1000), Math.floor(agora.getTime() / 1000)) : Math.floor(agora.getTime() / 1000)
  const valorCents = tipo === 'Purchase' ? (p.valor_pago_cents ?? p.valor_cents ?? 0) : (p.valor_cents ?? 0)
  return {
    event_name: tipo,
    event_time: t,
    action_source: 'business_messaging',
    messaging_channel: 'whatsapp',
    event_id: eventIdDe(p.id, tipo),
    user_data: { whatsapp_business_account_id: wabaId, ctwa_clid: p.ctwa_clid },
    custom_data: {
      currency: (p.moeda ?? 'BRL').toUpperCase(),
      value: Math.round(valorCents) / 100,
      content_name: `Ensaio ${p.tema_nome ?? ''} ${p.pacote_qtd ?? ''} fotos`.replace(/\s+/g, ' ').trim(),
    },
  }
}

/** Erro da Meta em português, dizendo o que fazer quando é falta de permissão. */
export function explicarErroMeta(msg: string | null | undefined): string {
  const m = String(msg ?? '')
  if (/permission|permiss|#10\b|#200\b|\(#100\).*(permission|scope)|whatsapp_business_manage_events|not authorized|OAuthException.*(scope|permission)/i.test(m)) {
    return `Token sem permissão para eventos do WhatsApp. Gere um token novo do usuário do sistema com whatsapp_business_management + whatsapp_business_manage_events e cole em Configurações. (Meta: ${m.slice(0, 160)})`
  }
  if (/expired|session has expired|#190|invalid.*token/i.test(m)) return `Token vencido ou inválido — gere um novo e cole em Configurações. (Meta: ${m.slice(0, 160)})`
  return m.slice(0, 300) || 'erro desconhecido da Meta'
}

/** Resposta do GET/POST /{WABA}/dataset → id do dataset (os dois formatos). */
export function idDoDataset(j: unknown): string | null {
  const o = (j ?? {}) as { id?: unknown; data?: { id?: unknown; dataset_id?: unknown }[]; dataset_id?: unknown }
  const v = o.id ?? o.dataset_id ?? o.data?.[0]?.id ?? o.data?.[0]?.dataset_id
  return v ? String(v) : null
}

// ── Painel "de onde vem a venda" ────────────────────────────────────────────

export interface LinhaOrigem {
  ad_id: string | null           // null = Orgânico
  conversas: number; pedidos: number; vendas: number
  faturamento: Record<string, number>   // por moeda, centavos (nunca soma moedas)
  taxa: number | null            // vendas / conversas
}

export function agruparPorAnuncio(
  contatos: { ad_id: string | null }[],
  pedidos: { ad_id: string | null; status: string; pago: boolean; valor_pago_cents: number | null; moeda: string | null }[],
): LinhaOrigem[] {
  const m = new Map<string, LinhaOrigem>()
  const linha = (ad: string | null) => {
    const k = ad ?? '__organico'
    if (!m.has(k)) m.set(k, { ad_id: ad, conversas: 0, pedidos: 0, vendas: 0, faturamento: {}, taxa: null })
    return m.get(k)!
  }
  for (const c of contatos) linha(c.ad_id).conversas++
  for (const p of pedidos) {
    const l = linha(p.ad_id)
    l.pedidos++
    if (p.pago && !['cancelado', 'reembolsado'].includes(p.status)) {
      l.vendas++
      const moeda = (p.moeda ?? 'BRL').toUpperCase()
      l.faturamento[moeda] = (l.faturamento[moeda] ?? 0) + (p.valor_pago_cents ?? 0)
    }
  }
  const out = [...m.values()].map(l => ({ ...l, taxa: l.conversas ? l.vendas / l.conversas : null }))
  // Anúncios por vendas (desc), Orgânico sempre por último.
  return out.sort((a, b) => (a.ad_id === null ? 1 : b.ad_id === null ? -1 : b.vendas - a.vendas || b.conversas - a.conversas))
}
