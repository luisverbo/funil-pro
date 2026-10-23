// ============================================================================
// Estúdio IA — Fase 7: Hotmart (pagamento internacional em USD) — puro
// ----------------------------------------------------------------------------
// Webhook versão 2.0.0: { event, data: { product, purchase, buyer } }.
// O link da oferta vai com &sck=<pedido_id>; a Hotmart devolve o sck em
// data.purchase.origin.sck — é assim que sabemos QUEM pagou.
// ============================================================================

export const PRODUTO_HOTMART_PADRAO = '8794754'

export type AcaoHotmart = 'pago' | 'estorno' | 'registrar' | 'ignorar'

export function acaoDoEvento(evento: string): AcaoHotmart {
  switch ((evento ?? '').toUpperCase()) {
    case 'PURCHASE_APPROVED': case 'PURCHASE_COMPLETE': return 'pago'
    case 'PURCHASE_REFUNDED': case 'PURCHASE_CHARGEBACK': case 'PURCHASE_CANCELED': return 'estorno'
    case 'PURCHASE_DELAYED': case 'PURCHASE_PROTEST': return 'registrar'
    default: return 'ignorar'
  }
}

export interface CompraHotmart {
  evento: string
  transacao: string | null
  produto_id: string | null
  oferta: string | null
  valor_cents: number | null       // o que o comprador pagou (pode ser na moeda local)
  moeda: string | null
  /** Preço da oferta na moeda da oferta (USD) — o que gravamos e conferimos. */
  valor_oferta_cents: number | null
  moeda_oferta: string | null
  sck: string | null
  telefone: string | null
  email: string | null
  nome: string | null
  aprovada_em: string | null
  hottok_corpo: string | null      // versões antigas mandam o hottok no corpo
}

type J = Record<string, unknown>
const obj = (v: unknown): J => (v && typeof v === 'object' ? v as J : {})
const txt = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export function lerCompraHotmart(payload: unknown): CompraHotmart {
  const p = obj(payload); const d = obj(p.data)
  const purchase = obj(d.purchase); const price = obj(purchase.price); const offer = obj(purchase.offer); const origin = obj(purchase.origin)
  const buyer = obj(d.buyer); const product = obj(d.product)
  const valor = Number(price.value)
  const oferta = obj(purchase.original_offer_price)
  const vOferta = Number(oferta.value)
  const ap = Number(purchase.approved_date)
  return {
    evento: String(p.event ?? '').toUpperCase(),
    transacao: txt(purchase.transaction),
    produto_id: txt(product.id),
    oferta: txt(offer.code),
    valor_cents: Number.isFinite(valor) ? Math.round(valor * 100) : null,
    moeda: txt(price.currency_value)?.toUpperCase() ?? null,
    valor_oferta_cents: Number.isFinite(vOferta) && vOferta > 0 ? Math.round(vOferta * 100) : null,
    moeda_oferta: txt(oferta.currency_value)?.toUpperCase() ?? null,
    sck: txt(origin.sck),
    telefone: txt(buyer.checkout_phone) ?? txt(buyer.phone),
    email: txt(buyer.email)?.toLowerCase() ?? null,
    nome: txt(buyer.name),
    aprovada_em: Number.isFinite(ap) && ap > 0 ? new Date(ap).toISOString() : null,
    hottok_corpo: txt(p.hottok),
  }
}

/** Código da oferta no link do pacote ("…?off=c5bjv7m1" → "c5bjv7m1"). */
export function ofertaDoLink(link: string | null | undefined): string | null {
  const m = (link ?? '').match(/[?&]off=([^&#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

/** Link do checkout com o pedido no sck (a Hotmart devolve no webhook). */
export function linkComPedido(link: string, pedidoId: string): string {
  const sem = link.replace(/([?&])sck=[^&#]*&?/, '$1').replace(/[?&]$/, '')
  return `${sem}${sem.includes('?') ? '&' : '?'}sck=${encodeURIComponent(pedidoId)}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const sckEhPedido = (sck: string | null): sck is string => !!sck && UUID.test(sck)

/**
 * Confere a compra com o pedido: produto, oferta do pacote, valor e moeda.
 * Lista vazia = bate e pode aprovar sozinho.
 */
export function conferirCompra(c: CompraHotmart, esperado: { produto_id: string; oferta: string | null; valor_cents: number | null; moeda: string | null }): string[] {
  const motivos: string[] = []
  if (c.produto_id !== esperado.produto_id) motivos.push(`produto ${c.produto_id ?? '?'} ≠ ${esperado.produto_id}`)
  if (esperado.oferta && c.oferta && c.oferta !== esperado.oferta) motivos.push(`oferta ${c.oferta} não é a do pacote (${esperado.oferta})`)
  if (!c.oferta && esperado.oferta) motivos.push('compra sem código de oferta')
  const moeda = (esperado.moeda ?? 'USD').toUpperCase()
  // A Hotmart converte para a moeda local do comprador: compara na MESMA moeda
  // (o preço da oferta em USD, ou o valor pago se veio em USD).
  const usd = valorNaMoeda(c, moeda)
  if (esperado.valor_cents !== null && usd !== null && usd < esperado.valor_cents) {
    motivos.push(`valor ${(usd / 100).toFixed(2)} ${moeda} menor que ${(esperado.valor_cents / 100).toFixed(2)} do pacote`)
  }
  return motivos
}

/** Mesmo celular com ou sem "+", espaços, DDI — compara só os dígitos (final igual). */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').replace(/\D/g, ''); const y = (b ?? '').replace(/\D/g, '')
  if (x.length < 8 || y.length < 8) return false
  return x === y || x.endsWith(y) || y.endsWith(x)
}

/** Valor da compra na moeda pedida (USD): oferta original ou o pago, se for a mesma moeda. */
export function valorNaMoeda(c: CompraHotmart, moeda: string): number | null {
  if (c.moeda_oferta === moeda && c.valor_oferta_cents !== null) return c.valor_oferta_cents
  if (c.moeda === moeda && c.valor_cents !== null) return c.valor_cents
  return null
}
