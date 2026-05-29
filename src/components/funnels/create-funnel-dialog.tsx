'use client'

import { useState, useRef } from 'react'
import { createFunnel } from '@/app/actions/funnels'

interface Props {
  variant?: 'default' | 'cta'
}

export default function CreateFunnelDialog({ variant = 'default' }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const formData = new FormData(e.currentTarget)
    try {
      await createFunnel(formData)
    } catch (err) {
      setError(String(err))
      setLoading(false)
    }
  }

  const buttonClass =
    variant === 'cta'
      ? 'inline-flex items-center px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition'
      : 'inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition'

  return (
    <>
      <button onClick={() => setOpen(true)} className={buttonClass}>
        + Novo Funil
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Modal */}
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Novo Funil</h2>

            <form ref={formRef} onSubmit={handleSubmit}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nome do funil
              </label>
              <input
                name="name"
                type="text"
                placeholder="Ex: Funil de lançamento"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
                autoFocus
                required
              />

              {error && (
                <p className="text-sm text-red-600 mb-3">{error}</p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                >
                  {loading ? 'Criando…' : 'Criar Funil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
