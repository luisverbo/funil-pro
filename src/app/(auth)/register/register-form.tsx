'use client'

import { useState } from 'react'
import { register } from '@/app/actions/auth'

export function RegisterForm() {
  const [clientError, setClientError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget)
    const password = fd.get('password') as string
    const confirm = fd.get('confirm_password') as string
    if (password.length < 6) {
      e.preventDefault()
      setClientError('A senha deve ter no mínimo 6 caracteres.')
      return
    }
    if (password !== confirm) {
      e.preventDefault()
      setClientError('As senhas não coincidem.')
      return
    }
    setClientError(null)
  }

  return (
    <form action={register} onSubmit={handleSubmit} className="space-y-4">
      {clientError && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
          {clientError}
        </div>
      )}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
          Nome
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Seu nome completo"
        />
      </div>
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
          autoComplete="new-password"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Mínimo 6 caracteres"
        />
      </div>
      <div>
        <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700 mb-1">
          Confirmar senha
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Repita a senha"
        />
      </div>
      <button
        type="submit"
        className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 text-sm transition-colors"
      >
        Criar conta
      </button>
    </form>
  )
}
