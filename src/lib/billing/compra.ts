// Liga a compra do quiz (registrada pelo webhook) ao tenant criado no
// onboarding. Se o webhook ainda não chegou (corrida de segundos), busca a
// sessão na Stripe e registra a compra aqui mesmo — o comprador nunca fica
// com plano sem vencimento.
import type { SupabaseClient } from '@supabase/supabase-js'
import { carregarConfigVendaQuiz } from './config'
import { buscarSessaoCheckout, buscarAssinatura, emailDaSessao, fimDoPeriodo, idDeSessaoValido, sessaoPaga } from './stripe'

interface Pista { checkoutSessionId?: unknown; email?: string | null }

export async function ligarCompraAoTenant(admin: SupabaseClient, tenantId: string, pista: Pista): Promise<void> {
  try {
    const cs = idDeSessaoValido(pista.checkoutSessionId) ? pista.checkoutSessionId : null
    let compra: { stripe_customer_id: string | null; stripe_subscription_id: string | null; current_period_end: string | null } | null = null

    if (cs) {
      const { data } = await admin.from('quiz_purchases')
        .select('stripe_customer_id, stripe_subscription_id, current_period_end')
        .eq('checkout_session_id', cs).maybeSingle()
      compra = data ?? null
      if (!compra) {
        // Webhook ainda não chegou: confirma direto na Stripe.
        const cfg = await carregarConfigVendaQuiz()
        if (cfg.stripe_secret_key) {
          const s = await buscarSessaoCheckout(cfg.stripe_secret_key, cs)
          if (sessaoPaga(s)) {
            let periodo: string | null = null
            if (s.subscription) {
              try { periodo = fimDoPeriodo(await buscarAssinatura(cfg.stripe_secret_key, s.subscription)) } catch { /* segue */ }
            }
            compra = { stripe_customer_id: s.customer ?? null, stripe_subscription_id: s.subscription ?? null, current_period_end: periodo }
            await admin.from('quiz_purchases').upsert({
              checkout_session_id: s.id,
              stripe_customer_id: compra.stripe_customer_id,
              stripe_subscription_id: compra.stripe_subscription_id,
              email: emailDaSessao(s),
              amount_cents: s.amount_total ?? null,
              currency: s.currency ?? null,
              status: 'paid',
              current_period_end: periodo,
              raw: s as unknown as Record<string, unknown>,
            }, { onConflict: 'checkout_session_id' })
          }
        }
      }
      if (compra) await admin.from('quiz_purchases').update({ tenant_id: tenantId }).eq('checkout_session_id', cs)
    } else if (pista.email) {
      // Sem sessão na mão (link antigo): tenta casar pelo e-mail da compra.
      const { data } = await admin.from('quiz_purchases')
        .select('checkout_session_id, stripe_customer_id, stripe_subscription_id, current_period_end')
        .ilike('email', pista.email).is('tenant_id', null).eq('status', 'paid')
        .order('created_at', { ascending: false }).limit(1).maybeSingle()
      if (data) {
        compra = data
        await admin.from('quiz_purchases').update({ tenant_id: tenantId }).eq('checkout_session_id', data.checkout_session_id)
      }
    }

    if (!compra) return
    await admin.from('tenants').update({
      stripe_customer_id: compra.stripe_customer_id,
      stripe_subscription_id: compra.stripe_subscription_id,
      plan_expires_at: compra.current_period_end,
    }).eq('id', tenantId)
  } catch (e) {
    console.error('[billing/compra] não consegui ligar a compra ao tenant:', e instanceof Error ? e.message : e)
  }
}
