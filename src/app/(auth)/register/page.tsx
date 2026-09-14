import Link from 'next/link'
import { RegisterForm } from './register-form'

interface Props {
  searchParams: Promise<{ error?: string; plano?: string }>
}

export default async function RegisterPage({ searchParams }: Props) {
  const { error, plano } = await searchParams
  // Link de venda do quiz avulso: /register?plano=quiz
  const planoQuiz = plano === 'quiz'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{planoQuiz ? 'Criar sua conta do Quiz' : 'Criar conta'}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {planoQuiz ? 'Seu painel vem pronto só com o Quiz — direto ao ponto.' : 'Comece gratuitamente, sem cartão'}
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}

      <RegisterForm plano={planoQuiz ? 'quiz' : undefined} />

      <p className="text-center text-sm text-gray-500">
        Já tem conta?{' '}
        <Link href="/login" className="text-indigo-600 hover:underline font-medium">
          Entrar
        </Link>
      </p>
    </div>
  )
}
