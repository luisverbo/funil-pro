'use client'

import React, { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { deleteFunnel } from '@/app/actions/funnels'
import { Trash2, AlertTriangle } from 'lucide-react'

interface Props {
  funnelId: string
  funnelName: string
  isPublished: boolean
  onDeleted: () => void
  inline?: boolean
}

export default function DeleteFunnelButton({ funnelId, funnelName, isPublished, onDeleted, inline }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleDelete = () => {
    setError(null)
    startTransition(async () => {
      const result = await deleteFunnel(funnelId)
      if (result.success) {
        window.location.href = '/funnels'
      } else {
        setError(result.error ?? 'Erro ao excluir')
      }
    })
  }

  return (
    <>
      {inline ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full text-left flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition-colors"
          style={{ color: '#ef4444' }}
          onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#FEF2F2'}
          onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
        >
          <Trash2 size={15} />
          Excluir
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="p-2 rounded-lg transition-colors"
          style={{ border: '1px solid #E2E8F0', color: '#ef4444' }}
          title="Excluir funil"
          onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#FEF2F2'}
          onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
        >
          <Trash2 size={15} />
        </button>
      )}

      {open && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => !isPending && setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-modal-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-red-500" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Excluir funil</h2>
                <p className="text-sm text-gray-500">Esta ação não pode ser desfeita</p>
              </div>
            </div>

            <p className="text-sm text-gray-700 mb-3">
              Tem certeza que deseja excluir <span className="font-semibold">"{funnelName}"</span>?
              Todos os blocos, conexões e configurações serão removidos permanentemente.
            </p>

            {isPublished && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-4">
                <p className="text-xs text-amber-700 font-medium">
                  ⚠️ Este funil está publicado e pode ter leads em execução. Excluí-lo interromperá o fluxo desses leads.
                </p>
              </div>
            )}

            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isPending}
                className="flex-1 px-4 py-2.5 bg-red-500 text-white text-sm font-medium rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                ) : (
                  <Trash2 size={14} />
                )}
                Excluir
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
