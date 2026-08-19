// ============================================================================
// Gravação da origem do lead (server-only)
// ----------------------------------------------------------------------------
// Ponto ÚNICO de escrita em `lead_sources`. Antes desta fase havia quatro
// lugares gravando com listas de campos diferentes — e o quiz não gravava
// nada, então quem entrava por quiz nascia sem origem.
//
// COMPATIBILIDADE COM A MIGRATION: as colunas novas (utm_medium, utm_term,
// fbclid, fbp, ip, user_agent, first_touch_at) só existem depois que a
// migration for aplicada no Supabase. Escrever uma coluna inexistente faria o
// INSERT INTEIRO falhar — e o lead ficaria SEM origem nenhuma, que é pior que
// o estado atual. Por isso a gravação tenta o conjunto completo e, se o banco
// recusar por coluna desconhecida, repete só com as colunas antigas.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { montarFbc, type TrackingParams } from './params'

/** Colunas que existem desde o schema inicial — sempre seguras. */
const COLUNAS_ANTIGAS = [
  'utm_source', 'utm_campaign', 'utm_campaign_id', 'utm_adset_id',
  'utm_ad_id', 'utm_content', 'referrer_url', 'landing_url',
] as const

/** Códigos do Postgres/PostgREST para "essa coluna não existe". */
function ehColunaDesconhecida(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  if (erro.code === '42703' || erro.code === 'PGRST204') return true
  return /column .* does not exist|could not find the .* column/i.test(erro.message ?? '')
}

export interface SalvarOrigemInput {
  leadId: string
  params: TrackingParams
  /** IP e user agent chegam do cabeçalho da requisição, nunca do corpo. */
  ip?: string | null
  userAgent?: string | null
}

/**
 * Grava a origem do lead. Idempotente por lead: se já existe origem, não
 * sobrescreve — a origem é do PRIMEIRO toque e é imutável, como o schema
 * original já previa.
 *
 * Nunca lança: rastreamento não pode derrubar a captura de um lead.
 */
export async function salvarOrigemDoLead(
  admin: SupabaseClient,
  { leadId, params, ip, userAgent }: SalvarOrigemInput,
): Promise<{ gravado: boolean; motivo?: string }> {
  if (!leadId) return { gravado: false, motivo: 'sem lead' }

  try {
    // Imutável: origem existente jamais é substituída.
    const { data: existente } = await admin
      .from('lead_sources').select('id').eq('lead_id', leadId).limit(1).maybeSingle()
    if (existente) return { gravado: false, motivo: 'origem já registrada' }

    const completo: Record<string, unknown> = {
      lead_id: leadId,
      utm_source: params.utm_source ?? null,
      utm_campaign: params.utm_campaign ?? null,
      utm_campaign_id: params.utm_campaign_id ?? null,
      utm_adset_id: params.utm_adset_id ?? null,
      utm_ad_id: params.utm_ad_id ?? null,
      utm_content: params.utm_content ?? null,
      referrer_url: params.referrer_url ?? null,
      landing_url: params.landing_url ?? null,
      // Colunas da migration desta fase:
      utm_medium: params.utm_medium ?? null,
      utm_term: params.utm_term ?? null,
      fbclid: params.fbclid ?? null,
      fbp: montarFbc(params.fbclid) ?? null,
      ip: ip ?? null,
      user_agent: userAgent ? String(userAgent).slice(0, 400) : null,
      first_touch_at: params.first_touch_at ?? new Date().toISOString(),
    }

    const { error } = await admin.from('lead_sources').insert(completo)
    if (!error) return { gravado: true }

    if (!ehColunaDesconhecida(error)) return { gravado: false, motivo: error.message }

    // Migration ainda não aplicada: grava o que o schema atual aceita, para o
    // lead não ficar órfão de origem.
    const reduzido: Record<string, unknown> = { lead_id: leadId }
    for (const c of COLUNAS_ANTIGAS) reduzido[c] = completo[c] ?? null

    const { error: erro2 } = await admin.from('lead_sources').insert(reduzido)
    return erro2
      ? { gravado: false, motivo: erro2.message }
      : { gravado: true, motivo: 'migration pendente: campos novos não gravados' }
  } catch (err) {
    return { gravado: false, motivo: err instanceof Error ? err.message : 'erro' }
  }
}

/** IP real atrás do proxy da Vercel, sem confiar em cabeçalho arbitrário. */
export function ipDaRequisicao(headers: Headers): string | null {
  const encaminhado = headers.get('x-forwarded-for')
  if (encaminhado) {
    // O primeiro da lista é o cliente; o resto são proxies.
    const primeiro = encaminhado.split(',')[0]?.trim()
    if (primeiro) return primeiro.slice(0, 45)
  }
  return headers.get('x-real-ip')?.slice(0, 45) ?? null
}
