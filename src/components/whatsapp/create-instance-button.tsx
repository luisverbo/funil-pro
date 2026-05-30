'use client'

import React, { useTransition } from 'react'
import { createWhatsappInstance } from '@/app/actions/whatsapp'

export default function CreateInstanceButton() {
  const [isPending, startTransition] = useTransition()

  const handleCreate = () => {
    startTransition(async () => {
      const result = await createWhatsappInstance(new FormData())
      if (result.error) alert(result.error)
    })
  }

  return (
    <button
      onClick={handleCreate}
      disabled={isPending}
      className="flex items-center gap-2 bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50"
    >
      {isPending ? (
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      )}
      Nova Instância
    </button>
  )
}
