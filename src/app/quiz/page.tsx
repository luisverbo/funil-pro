// ============================================================================
// /quiz — landing pública de venda do Quiz avulso
// ----------------------------------------------------------------------------
// Servidor: lê a configuração de venda (Stripe pronto? preço?) e entrega ao
// cliente SÓ o que é público. Nenhuma chave desce para o navegador.
// ============================================================================
import type { Metadata } from 'next'
import { carregarConfigVendaQuiz, configPublica } from '@/lib/billing/config'
import { destinoDoCta, precoExibido } from '@/lib/billing/quiz-venda'
import QuizLanding from './quiz-landing'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Quiz que qualifica e vende — FunilPro Quiz',
  description:
    'Crie quizzes interativos com design premium, lógica por resposta, pixel por etapa e entrega do lead quente no WhatsApp. Publique em minutos.',
  openGraph: {
    title: 'FunilPro Quiz — o quiz que transforma cliques em leads quentes',
    description: 'Design premium, ramificação por resposta, pixel por etapa, portal para o cliente e WhatsApp. Tudo em um só lugar.',
    type: 'website',
  },
}

interface Props {
  searchParams: Promise<{ cancelado?: string; erro?: string; pagar?: string }>
}

export default async function QuizLandingPage({ searchParams }: Props) {
  const sp = await searchParams
  const cfg = await carregarConfigVendaQuiz()
  const pub = configPublica(cfg)
  const cta = destinoDoCta(cfg)
  const preco = precoExibido(pub.preco)

  const aviso = sp.pagar
    ? 'Para criar sua conta do Quiz, conclua o pagamento abaixo.'
    : sp.cancelado
      ? 'Pagamento cancelado. Quando quiser, é só continuar de onde parou.'
      : sp.erro === 'checkout'
        ? 'Não conseguimos abrir o pagamento agora. Tente de novo em instantes.'
        : null

  return <QuizLanding cta={cta} preco={preco} aviso={aviso} />
}
