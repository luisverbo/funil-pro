// Painel compartilhado de leads — página pública, protegida por senha.
// O servidor não valida nada aqui: quem valida é a rota /api/quiz-share,
// a cada consulta. Esta casca só renderiza o formulário de senha.

import type { Metadata } from 'next'
import SharePanelClient from './share-panel-client'

export const metadata: Metadata = {
  title: 'Painel de leads',
  robots: { index: false, follow: false },   // link privado não vai para busca
}

export default async function QuizSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <SharePanelClient token={token} />
}
