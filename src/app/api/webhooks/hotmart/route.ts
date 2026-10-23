// ============================================================================
// Webhook da Hotmart do ESTÚDIO IA (pagamento internacional, USD) — Fase 7
// ----------------------------------------------------------------------------
// POST /api/webhooks/hotmart  (sem id: o tenant sai do hottok)
// Os funis continuam no /api/webhooks/hotmart/[tenantId] — rotas diferentes.
//   • X-HOTMART-HOTTOK tem que bater com estudio_config.hotmart_hottok → senão 401
//   • versão 2.0.0: PURCHASE_APPROVED/COMPLETE → pago; REFUNDED/CHARGEBACK/
//     CANCELED → estorno; DELAYED/PROTEST → registra e avisa
//   • responde 200 rápido; erro de banco → 500 (a Hotmart reenvia; o evento
//     repetido é barrado por transação)
// A lógica está em tratarWebhookHotmart (testada com banco falso).
// ============================================================================
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { tratarWebhookHotmart } from '@/lib/estudio/hotmart-servidor'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  let payload: unknown
  try { payload = await request.json() } catch { return NextResponse.json({ error: 'json inválido' }, { status: 400 }) }
  const r = await tratarWebhookHotmart(createAdminClient(), request.headers.get('x-hotmart-hottok'), payload)
  return NextResponse.json(r.corpo, { status: r.http })
}
