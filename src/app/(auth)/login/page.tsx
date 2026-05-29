import Link from 'next/link'
import { login } from '@/app/actions/auth'

interface Props {
  searchParams: Promise<{ error?: string }>
}

export default async function LoginPage({ searchParams }: Props) {
  const { error } = await searchParams

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Entrar no FunilPro</h1>
        <p className="mt-1 text-sm text-gray-500">Acesse sua conta para gerenciar seus funis</p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {decodeURIComponent(error)}
        </div>
      )}

      <form action={login} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="seu@email.com"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="••••••"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 text-sm transition-colors"
        >
          Entrar
        </button>
      </form>

      <p className="text-center text-sm text-gray-500">
        Não tem conta?{' '}
        <Link href="/register" className="text-indigo-600 hover:underline font-medium">
          Criar conta gratuita
        </Link>
      </p>
    </div>
  )
}
