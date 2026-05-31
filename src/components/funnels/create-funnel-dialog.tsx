'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { createFunnel } from '@/app/actions/funnels'
import { useTemplate } from '@/app/actions/templates'
import type { FunnelTemplate } from '@/types'

interface Props {
  variant?: 'default' | 'cta'
  popularTemplates?: FunnelTemplate[]
  fab?: boolean
}

export default function CreateFunnelDialog({ variant = 'default', popularTemplates = [], fab = false }: Props) {
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

  if (fab) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition flex items-center justify-center text-2xl font-light"
          aria-label="Novo Funil"
        >
          +
        </button>
        <Dialog open={open} onClose={() => setOpen(false)} tab={tab} setTab={setTab} loading={loading} error={error} isPending={isPending} onSubmit={handleSubmit} onUseTemplate={handleUseTemplate} popularTemplates={popularTemplates} />
      </>
    )
  }

  const buttonClass =
    variant === 'cta'
      ? 'inline-flex items-center px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition'
      : 'inline-flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition min-h-[44px]'

  return (
    <>
      <button onClick={() => setOpen(true)} className={buttonClass}>
        + Novo Funil
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} tab={tab} setTab={setTab} loading={loading} error={error} isPending={isPending} onSubmit={handleSubmit} onUseTemplate={handleUseTemplate} popularTemplates={popularTemplates} />
    </>
  )
}

function Dialog({ open, onClose, tab, setTab, loading, error, isPending, onSubmit, onUseTemplate, popularTemplates }: {
  open: boolean
  onClose: () => void
  tab: 'blank' | 'template'
  setTab: (t: 'blank' | 'template') => void
  loading: boolean
  error: string
  isPending: boolean
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  onUseTemplate: (id: string) => void
  popularTemplates: FunnelTemplate[]
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full md:max-w-lg md:mx-4 rounded-t-2xl md:rounded-xl shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="md:hidden w-10 h-1 bg-gray-300 rounded-full mx-auto mb-4" />
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
          <form onSubmit={onSubmit}>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do funil</label>
            <input
              name="name"
              type="text"
              placeholder="Ex: Funil de lançamento"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
              style={{ fontSize: 16 }}
              autoFocus
              required
            />
            {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition min-h-[44px]">
                Cancelar
              </button>
              <button type="submit" disabled={loading} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition min-h-[44px]">
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
                      onClick={() => onUseTemplate(tpl.id)}
                      disabled={isPending}
                      className="shrink-0 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition min-h-[44px]"
                    >
                      {isPending ? '…' : 'Usar'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Link href="/templates" className="block text-center text-sm text-indigo-600 hover:text-indigo-800 font-medium" onClick={onClose}>
              Ver todos os templates →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
