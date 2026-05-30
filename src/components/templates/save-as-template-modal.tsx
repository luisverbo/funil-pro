'use client'

import { useState, useTransition } from 'react'
import { saveAsTemplate } from '@/app/actions/templates'

const CATEGORIES = [
  { value: 'captacao', label: 'Captação' },
  { value: 'lancamento', label: 'Lançamento' },
  { value: 'mentoria', label: 'Mentoria' },
  { value: 'cart_abandoned', label: 'Carrinho Abandonado' },
  { value: 'produto_fisico', label: 'Produto Físico' },
]

interface Props {
  funnelId: string
  funnelName: string
  onClose: () => void
}

export default function SaveAsTemplateModal({ funnelId, funnelName, onClose }: Props) {
  const [isPending, startTransition] = useTransition()
  const [isPublic, setIsPublic] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    formData.set('is_public', String(isPublic))
    startTransition(async () => {
      const result = await saveAsTemplate(funnelId, formData)
      if (result.success) {
        setSuccess(true)
        setTimeout(onClose, 1500)
      } else {
        setError(result.error ?? 'Erro ao salvar template')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Salvar como Template</h2>

        {success ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6 text-green-600">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-green-700 font-semibold">Template salvo!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
              <input
                name="name"
                type="text"
                defaultValue={funnelName}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
              <textarea
                name="description"
                rows={2}
                placeholder="Descreva brevemente o que este template faz..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
              <select
                name="category"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Selecione uma categoria</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsPublic((v) => !v)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isPublic ? 'bg-indigo-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isPublic ? 'translate-x-4' : 'translate-x-1'}`} />
              </button>
              <span className="text-sm text-gray-700">Publicar no Marketplace</span>
            </div>

            {isPublic && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Preço (R$)</label>
                <input
                  name="price_cents"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0,00 para gratuito"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
              >
                {isPending ? 'Salvando…' : 'Salvar Template'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
