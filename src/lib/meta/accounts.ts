// ============================================================================
// Contas de anúncio do tenant — VÁRIAS por tenant (Fase 1, item 1.8)
// ============================================================================
// O schema original guardava UMA conta por tenant, em duas colunas de
// `tenants` (meta_ad_account_id, meta_access_token). A Fase 1 introduz a
// tabela `ad_accounts`, que aceita quantas o cliente tiver — cada uma com
// token próprio, porque contas diferentes podem vir de logins diferentes.
//
// COMPATIBILIDADE: enquanto a migration não é aplicada, a leitura cai de volta
// nas colunas de `tenants`. Nenhum cliente perde a sincronização durante a
// transição, e nada precisa ser desligado para migrar.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ContaDeAnuncio {
  id: string | null            // null = veio do modo antigo (colunas de tenants)
  tenantId: string
  externalId: string           // ID sem o prefixo "act_"
  accessToken: string
  name: string | null
  currency: string | null
  timezone: string | null
  status: string
  origem: 'ad_accounts' | 'tenants'
}

function ehTabelaAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false
  if (erro.code === '42P01' || erro.code === 'PGRST205') return true
  return /relation .* does not exist|could not find the table/i.test(erro.message ?? '')
}

/** O código guarda o id SEM "act_"; a URL da Graph o recoloca. */
export function normalizarIdConta(bruto: string): string {
  const s = bruto.trim()
  return s.startsWith('act_') ? s.slice(4) : s
}

/**
 * Todas as contas ATIVAS do tenant, prontas para sincronizar.
 *
 * Conta sem token não é devolvida: sincronizar sem credencial só produziria
 * erro repetido a cada execução do cron.
 */
export async function listarContasDeAnuncio(
  admin: SupabaseClient,
  tenantId: string,
): Promise<ContaDeAnuncio[]> {
  const { data, error } = await admin
    .from('ad_accounts')
    .select('id, tenant_id, external_id, access_token, name, currency, timezone_name, status')
    .eq('tenant_id', tenantId)
    .eq('provider', 'meta')
    .order('created_at', { ascending: true })

  if (!error && data) {
    return data
      .filter(c => c.status === 'active' && typeof c.access_token === 'string' && c.access_token.length > 0)
      .map(c => ({
        id: String(c.id),
        tenantId,
        externalId: normalizarIdConta(String(c.external_id)),
        accessToken: String(c.access_token),
        name: c.name ?? null,
        currency: c.currency ?? null,
        timezone: c.timezone_name ?? null,
        status: String(c.status),
        origem: 'ad_accounts' as const,
      }))
  }

  if (!ehTabelaAusente(error)) return []

  // Migration pendente: modo antigo, uma conta por tenant.
  const { data: t } = await admin
    .from('tenants')
    .select('meta_ad_account_id, meta_access_token')
    .eq('id', tenantId)
    .maybeSingle()

  if (!t?.meta_ad_account_id || !t?.meta_access_token) return []
  return [{
    id: null,
    tenantId,
    externalId: normalizarIdConta(String(t.meta_ad_account_id)),
    accessToken: String(t.meta_access_token),
    name: null,
    currency: null,
    timezone: null,
    status: 'active',
    origem: 'tenants',
  }]
}

/** Marca o resultado da última sincronização — some no modo antigo. */
export async function registrarSincronizacao(
  admin: SupabaseClient,
  conta: ContaDeAnuncio,
  resultado: { ok: boolean; erro?: string; status?: string },
): Promise<void> {
  if (!conta.id) return
  try {
    await admin.from('ad_accounts').update({
      last_sync_at: new Date().toISOString(),
      last_error: resultado.ok ? null : (resultado.erro ?? 'erro').slice(0, 300),
      ...(resultado.status ? { status: resultado.status } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', conta.id)
  } catch { /* registrar status nunca derruba a sincronização */ }
}
