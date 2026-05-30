'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteLead } from '@/app/actions/funnels'

interface Props {
  leadId: string
  leadName: string | null
  redirectAfter?: string
}

export default function DeleteLeadButton({ leadId, leadName, redirectAfter }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteLead(leadId)
      if (result.success) {
        setOpen(false)
        if (redirectAfter) router.push(redirectAfter)
        else router.refresh()
      } else {
        alert(`Erro ao deletar: ${result.error}`)
      }
    })
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors font-medium"
        title="Deletar lead"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
          <polyline points="3,6 5,6 21,6" />
          <path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6" />
          <path d="M10,11v6M14,11v6" />
          <path d="M9,6V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1V6" />
        </svg>
        Deletar
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Deletar lead?</h2>
            <p className="text-sm text-gray-500 mb-6">
              Deletar <strong>{leadName ?? 'este lead'}</strong>? Todos os eventos e dados serão removidos permanentemente.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="flex-1 px-4 py-2 text-sm font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="flex-1 px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isPending ? 'Deletando…' : 'Deletar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
