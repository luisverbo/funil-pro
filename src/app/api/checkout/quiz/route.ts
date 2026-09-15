// ============================================================================
// Checkout do Quiz — cria a sessão na Stripe e leva o comprador para lá
// ----------------------------------------------------------------------------
// Público (a landing chama por formulário). Sem Stripe configurado, cai no
// cadastro gratuito — a landing nunca fica com botão morto.
// ============================================================================
import { NextRequest, NextResponse } from 'next/server'
import { carregarConfigVendaQuiz } from '@/lib/billing/config'
import { criarCheckoutQuiz } from '@/lib/billing/stripe'
import { CADASTRO_QUIZ, LANDING_QUIZ, stripeConfigurado, urlsDeRetorno } from '@/lib/billing/quiz-venda'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const origem = request.nextUrl.origin
  const cfg = await carregarConfigVendaQuiz()
  if (!stripeConfigurado(cfg)) {
    return NextResponse.redirect(new URL(CADASTRO_QUIZ, origem), 303)
  }

  let email: string | undefined
  try {
    const fd = await request.formData()
    const e = fd.get('email')
    if (typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) email = e.trim().toLowerCase()
  } catch { /* sem body — segue sem e-mail */ }

  try {
    const { successUrl, cancelUrl } = urlsDeRetorno(origem)
    const sessao = await criarCheckoutQuiz(cfg.stripe_secret_key!, {
      priceId: cfg.stripe_quiz_price_id!,
      successUrl,
      cancelUrl,
      email,
    })
    return NextResponse.redirect(sessao.url, 303)
  } catch (e) {
    console.error('[checkout/quiz] falha ao criar sessão:', e instanceof Error ? e.message : e)
    return NextResponse.redirect(new URL(`${LANDING_QUIZ}?erro=checkout`, origem), 303)
  }
}
