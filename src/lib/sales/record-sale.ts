// ============================================================================
// Venda como ENTIDADE, com atribuição congelada (Fase 1 — itens 1.6 e 1.7)
// ----------------------------------------------------------------------------
// Antes desta fase, uma venda era apenas uma linha em `lead_events`. Três
// consequências reais disso:
//
//   1. Webhook repetido (a Hotmart reenvia quando não recebe 200) duplicava
//      receita — não havia id de transação para deduplicar.
//   2. Reembolso e chargeback não tinham onde ser registrados como MUDANÇA de
//      estado da mesma venda; viravam eventos soltos, e o faturamento nunca
//      diminuía.
//   3. A atribuição era recalculada depois, dentro da sincronização de
//      métricas. Se a origem do lead mudasse, o histórico financeiro se
//      reescrevia sozinho.
//
// Aqui a venda vira linha em `sales`, com a atribuição CONGELADA no instante
// da compra. É o que permite dizer, meses depois: "esta venda de R$97 veio do
// anúncio X" — e essa frase nunca mudar.
//
// COMPATIBILIDADE: a tabela `sales` só existe depois da migration da Fase 1.
// Enquanto ela não for aplicada, esta gravação é ignorada em silêncio — o
// webhook NÃO pode quebrar por causa disso, porque é ele que dispara o funil
// e a mensagem para o comprador.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export type SaleStatus = 'approved' | 'refunded' | 'chargeback' | 'pending' | 'canceled'

export interface AtribuicaoCongelada {
  attr_ad_id: string | null
  attr_adset_id: string | null
  attr_campaign_id: string | null
  attr_utm_source: string | null
  attr_model: string
}

/** Nenhuma origem conhecida — venda direta, orgânica ou lead sem rastreio. */
const SEM_ATRIBUICAO: AtribuicaoCongelada = {
  attr_ad_id: null,
  attr_adset_id: null,
  attr_campaign_id: null,
  attr_utm_source: null,
  attr_model: 'first_touch',
}

/** Tabela ainda não criada (migration pendente). */
function ehTabelaAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  if (erro.code === '42P01' || erro.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(erro.message ?? '')
}

/**
 * Lê a origem IMUTÁVEL do lead e devolve a atribuição a ser congelada.
 *
 * Modelo: PRIMEIRO TOQUE — `lead_sources` é gravado uma única vez, na
 * entrada. É a mesma regra que o rastreamento no navegador aplica, então o
 * número do painel bate com o que aconteceu de verdade.
 */
export async function resolverAtribuicao(
  admin: SupabaseClient,
  leadId: string | null,
): Promise<AtribuicaoCongelada> {
  if (!leadId) return SEM_ATRIBUICAO
  try {
    const { data } = await admin
      .from('lead_sources')
      .select('utm_ad_id, utm_adset_id, utm_campaign_id, utm_source')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!data) return SEM_ATRIBUICAO
    return {
      attr_ad_id: data.utm_ad_id ?? null,
      attr_adset_id: data.utm_adset_id ?? null,
      attr_campaign_id: data.utm_campaign_id ?? null,
      attr_utm_source: data.utm_source ?? null,
      attr_model: 'first_touch',
    }
  } catch {
    return SEM_ATRIBUICAO
  }
}

/**
 * Identificador da transação na plataforma.
 *
 * É a chave de deduplicação: sem ela, o mesmo webhook reenviado viraria duas
 * vendas. Cada plataforma põe o número num lugar diferente do payload; quando
 * nenhum é encontrado, cai numa chave derivada do comprador e do valor — pior
 * que o id real, mas ainda melhor que duplicar sem critério.
 */
export function extrairIdExterno(platform: string, raw: unknown, fallback: {
  email?: string | null; revenueCents: number; productName?: string | null
}): string {
  const p = (raw ?? {}) as Record<string, unknown>
  const d = (p.data ?? p) as Record<string, unknown>
  const compra = (d.purchase ?? d.order ?? d) as Record<string, unknown>

  const candidatos = [
    compra.transaction, compra.transaction_id, compra.id, compra.code,
    compra.order_id, compra.order_ref, d.transaction, d.id, p.id,
  ]
  for (const c of candidatos) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 120)
    if (typeof c === 'number' && Number.isFinite(c)) return String(c)
  }

  // Sem id da plataforma: chave estável derivada do que temos.
  const base = `${platform}:${fallback.email ?? 'sem-email'}:${fallback.revenueCents}:${fallback.productName ?? ''}`
  return `derivado:${base.slice(0, 110)}`
}

export interface RegistrarVendaInput {
  tenantId: string
  leadId: string | null
  platform: string
  externalId: string
  status: SaleStatus
  revenueCents: number
  productName?: string | null
  buyerEmail?: string | null
  buyerPhone?: string | null
  occurredAt?: string
}

/**
 * Grava (ou atualiza) a venda.
 *
 * Aprovação insere; reembolso/chargeback ATUALIZAM a mesma linha, preservando
 * a atribuição original — o dinheiro sai do faturamento sem apagar de onde a
 * venda veio.
 *
 * Nunca lança.
 */
export async function registrarVenda(
  admin: SupabaseClient,
  entrada: RegistrarVendaInput,
): Promise<{ gravado: boolean; motivo?: string }> {
  try {
    const atribuicao = entrada.status === 'approved'
      ? await resolverAtribuicao(admin, entrada.leadId)
      : null

    const linha: Record<string, unknown> = {
      tenant_id: entrada.tenantId,
      lead_id: entrada.leadId,
      platform: entrada.platform,
      external_id: entrada.externalId,
      status: entrada.status,
      revenue_cents: entrada.revenueCents,
      product_name: entrada.productName ?? null,
      buyer_email: entrada.buyerEmail ?? null,
      buyer_phone: entrada.buyerPhone ?? null,
      occurred_at: entrada.occurredAt ?? new Date().toISOString(),
      ...(atribuicao ?? {}),
    }

    // onConflict pela transação: reenvio do mesmo webhook atualiza, não duplica.
    const { error } = await admin
      .from('sales')
      .upsert(linha, { onConflict: 'tenant_id,platform,external_id' })

    if (!error) return { gravado: true }
    if (ehTabelaAusente(error)) return { gravado: false, motivo: 'migration da Fase 1 pendente' }
    return { gravado: false, motivo: error.message }
  } catch (err) {
    return { gravado: false, motivo: err instanceof Error ? err.message : 'erro' }
  }
}

/** Tradução do evento do webhook para o estado da venda. */
export function statusDoEvento(evento: string): SaleStatus {
  if (evento === 'purchased') return 'approved'
  if (evento === 'refunded') return 'refunded'
  if (evento === 'chargeback') return 'chargeback'
  if (evento === 'canceled') return 'canceled'
  return 'pending'
}
