'use client'

import { useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { clearCapturePageConfig } from '@/app/actions/funnels'

interface Props {
  funnelId: string
  funnelName: string
}

export default function ClearCapturePageButton({ funnelId, funnelName }: Props) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (!confirm(`Desvincular página de captura de "${funnelName}"?`)) return
    startTransition(async () => {
      await clearCapturePageConfig(funnelId)
    })
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      title="Desvincular página"
      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  )
}
