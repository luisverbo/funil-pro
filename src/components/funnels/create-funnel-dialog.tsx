'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { createFunnel } from '@/app/actions/funnels'
import { useTemplate } from '@/app/actions/templates'
import type { FunnelTemplate } from '@/types'

interface Props {
  variant?: 'default' | 'cta'
  popularTemplates?: FunnelTemplate[]
}

const CATEGORY_LABELS: Record<string, string> = {
  captacao: 'Captação',
  lancamento: 'Lançamento',
  mentoria: 'Mentoria',
  produto_fisico: 'Produto Físico',
  cart_abandoned: 'Carr. Abandonado',
}

export default function CreateFunnelDialog({ variant = 'default', popularTemplates = [] }: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'blank' | 'template'>('blank')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

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

  function handleUseTemplate(templateId: string) {
    startTransition(async () => {
      await useTemplate(templateId)
    })
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
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Novo Funil</h2>

            <div className="flex border border-gray-200 rounded-lg p-1 mb-5 gap-1">
              <button
                onClick={() => setTab('blank')}
                className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-colors ${tab === 'blank' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Funil em branco
              </button>
              <button
                onClick={() => setTab('template')}
                className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-colors ${tab === 'template' ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                Usar template
              </button>
            </div>

            {tab === 'blank' ? (
              <form onSubmit={handleSubmit}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome do funil</label>
                <input
                  name="name"
                  type="text"
                  placeholder="Ex: Funil de lançamento"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
                  autoFocus
                  required
                />
                {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition">
                    Cancelar
                  </button>
                  <button type="submit" disabled={loading} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition">
                    {loading ? 'Criando…' : 'Criar Funil'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                {popularTemplates.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">Nenhum template disponível.</p>
                ) : (
                  <div className="space-y-2 mb-4">
                    {popularTemplates.map((tpl) => (
                      <div key={tpl.id} className="flex items-center justify-between gap-3 p-3 border border-gray-200 rounded-xl hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-semibold text-gray-800 truncate">{tpl.name}</p>
                            {tpl.tenant_id === null && (
                              <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-1.5 py-0.5 rounded shrink-0">Oficial</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400 truncate">{tpl.description}</p>
                        </div>
                        <button
                          onClick={() => handleUseTemplate(tpl.id)}
                          disabled={isPending}
                          className="shrink-0 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition"
                        >
                          {isPending ? '…' : 'Usar'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <Link href="/templates" className="block text-center text-sm text-indigo-600 hover:text-indigo-800 font-medium" onClick={() => setOpen(false)}>
                  Ver todos os templates →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
