// ============================================================================
// Diagnóstico como passo do cron (Fase 1, item 1.14)
// ----------------------------------------------------------------------------
// Fica separado de `diagnose.ts` de propósito: lá são regras puras, testáveis
// com dados de mentira; aqui é o passo que lê o banco e grava o histórico.
//
// O histórico existe para uma pergunta que o painel sozinho não responde:
// "isto começou quando?". A tela mostra o estado de agora; `traffic_diagnoses`
// guarda o que estava valendo em cada leitura.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { intervaloPadrao } from '@/lib/meta/sync-v2'
import { calcularRoasReal } from './roas'
import { diagnosticar, salvarDiagnosticos } from './diagnose'

/**
 * Analisa e grava os achados de cada tenant que acabou de sincronizar.
 *
 * Nunca lança: o diagnóstico vem DEPOIS da leitura, e falhar aqui não pode
 * apagar a sincronização que já deu certo.
 */
export async function diagnosticarTenants(
  admin: SupabaseClient,
  tenantIds: string[],
  dias = 7,
): Promise<{ tenants: number; achados: number; gravados: number }> {
  const periodo = intervaloPadrao(dias)
  let achados = 0
  let gravados = 0
  let tenants = 0

  for (const tenantId of tenantIds) {
    try {
      const { resumo, indisponivel } = await calcularRoasReal(admin, tenantId, periodo, 'campaign')
      if (indisponivel || !resumo) continue
      tenants++

      const lista = diagnosticar(resumo)
      achados += lista.length
      const r = await salvarDiagnosticos(admin, {
        tenantId,
        adAccountId: null,
        periodo,
        diagnosticos: lista,
      })
      gravados += r.gravados
      if (r.motivo) console.warn(`[trafego/diagnose] tenant ${tenantId}: ${r.motivo}`)
    } catch (err) {
      console.error(`[trafego/diagnose] tenant ${tenantId} falhou:`, String(err))
    }
  }

  return { tenants, achados, gravados }
}
