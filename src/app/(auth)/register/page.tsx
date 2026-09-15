import Link from 'next/link'
import { redirect } from 'next/navigation'
import { RegisterForm } from './register-form'
import { carregarConfigVendaQuiz } from '@/lib/billing/config'
import { buscarSessaoCheckout, emailDaSessao, idDeSessaoValido, type SessaoCheckout } from '@/lib/billing/stripe'
import { cadastroQuizLiberado, LANDING_QUIZ, stripeConfigurado } from '@/lib/billing/quiz-venda'

interface Props {
  searchParams: Promise<{ error?: string; plano?: string; cs?: string }>
}

export default async function RegisterPage({ searchParams }: Props) {
  const { error, plano, cs } = await searchParams
  // Link de venda do quiz avulso: /register?plano=quiz — e, quando a compra
  // veio pela Stripe, &cs=<sessão do checkout>.
  const planoQuiz = plano === 'quiz'

  let sessao: SessaoCheckout | null = null
  let emailPago: string | null = null
  if (planoQuiz) {
    const cfg = await carregarConfigVendaQuiz()
    if (idDeSessaoValido(cs) && stripeConfigurado(cfg)) {
      try { sessao = await buscarSessaoCheckout(cfg.stripe_secret_key!, cs) } catch { sessao = null }
    }
    // Dono exige pagamento e a sessão não está paga → volta para a landing.
    if (!cadastroQuizLiberado(cfg, sessao)) redirect(`${LANDING_QUIZ}?pagar=1`)
    emailPago = emailDaSessao(sessao)
  }
  const pago = !!sessao

  return (
    <div className="space-y-6">
      <div>
        {pago && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-xs font-semibold text-emerald-700">
            ✓ Pagamento confirmado
          </div>
        )}
        <h1 className="text-2xl font-bold text-gray-900">{planoQuiz ? 'Criar sua conta do Quiz' : 'Criar conta'}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {planoQuiz
            ? (pago ? 'Falta só criar seu acesso — seu painel já vem com o Quiz liberado.' : 'Seu painel vem pronto só com o Quiz — direto ao ponto.')
            : 'Comece gratuitamente, sem cartão'}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}

      <RegisterForm plano={planoQuiz ? 'quiz' : undefined} cs={pago ? sessao!.id : undefined} emailInicial={emailPago ?? undefined} />

      <p className="text-center text-sm text-gray-500">
        Já tem conta?{' '}
        <Link href="/login" className="text-indigo-600 hover:underline font-medium">
          Entrar
        </Link>
      </p>
    </div>
  )
}
