// ============================================================================
// Webhook da Stripe — venda do Quiz
// ----------------------------------------------------------------------------
//   checkout.session.completed → registra a compra (idempotente por sessão)
//   invoice.paid               → renova plan_expires_at do tenant do cliente
//   customer.subscription.deleted → marca compra cancelada e encerra o plano
//
// A assinatura é verificada com o webhook secret guardado em platform_settings.
// Sem secret configurado, o webhook RECUSA (não dá para confiar no payload).
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { carregarConfigVendaQuiz } from '@/lib/billing/config'
import {
  verificarAssinaturaStripe, lerEventoStripe, buscarAssinatura, fimDoPeriodo,
  emailDaSessao, sessaoPaga, type SessaoCheckout,
} from '@/lib/billing/stripe'
import { acaoParaEvento } from '@/lib/billing/quiz-venda'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const cfg = await carregarConfigVendaQuiz()
  const secret = cfg.stripe_webhook_secret?.trim() ?? ''
  if (!secret) {
    return NextResponse.json({ error: 'webhook secret não configurado' }, { status: 503 })
  }
  if (!verificarAssinaturaStripe(raw, request.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ error: 'assinatura inválida' }, { status: 401 })
  }
  const evento = lerEventoStripe(raw)
  if (!evento) return NextResponse.json({ error: 'payload inválido' }, { status: 400 })

  const admin = createAdminClient()
  const obj = evento.data.object as Record<string, unknown>
  const agora = new Date().toISOString()

  try {
    switch (acaoParaEvento(evento.type).acao) {
      case 'registrar_compra': {
        const s = obj as unknown as SessaoCheckout
        if (!sessaoPaga(s)) break
        let periodo: string | null = null
        if (s.subscription && cfg.stripe_secret_key) {
          try { periodo = fimDoPeriodo(await buscarAssinatura(cfg.stripe_secret_key, s.subscription)) } catch { /* segue sem */ }
        }
        await admin.from('quiz_purchases').upsert({
          checkout_session_id: s.id,
          stripe_customer_id: s.customer ?? null,
          stripe_subscription_id: s.subscription ?? null,
          email: emailDaSessao(s),
          amount_cents: s.amount_total ?? null,
          currency: s.currency ?? null,
          status: 'paid',
          current_period_end: periodo,
          raw: obj,
          updated_at: agora,
        }, { onConflict: 'checkout_session_id' })
        break
      }
      case 'renovar': {
        const customer = typeof obj.customer === 'string' ? obj.customer : null
        const subscription = typeof obj.subscription === 'string' ? obj.subscription : null
        if (!customer) break
        let periodo: string | null = null
        if (subscription && cfg.stripe_secret_key) {
          try { periodo = fimDoPeriodo(await buscarAssinatura(cfg.stripe_secret_key, subscription)) } catch { /* segue sem */ }
        }
        if (!periodo) {
          const d = new Date(); d.setDate(d.getDate() + 31); periodo = d.toISOString()
        }
        await admin.from('tenants').update({ plan_expires_at: periodo }).eq('stripe_customer_id', customer)
        await admin.from('quiz_purchases').update({ status: 'paid', current_period_end: periodo, updated_at: agora }).eq('stripe_customer_id', customer)
        break
      }
      case 'cancelar': {
        const customer = typeof obj.customer === 'string' ? obj.customer : null
        if (!customer) break
        await admin.from('quiz_purchases').update({ status: 'canceled', updated_at: agora }).eq('stripe_customer_id', customer)
        await admin.from('tenants').update({ plan_expires_at: agora }).eq('stripe_customer_id', customer)
        break
      }
      default: break
    }
  } catch (e) {
    console.error('[webhooks/stripe] erro ao processar', evento.type, e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'erro interno' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
