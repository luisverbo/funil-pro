'use client'

import { useTransition } from 'react'
import { useTemplate } from '@/app/actions/templates'

interface Props {
  templateId: string
  priceCents: number
  className?: string
  label?: string
}

export default function UseTemplateButton({ templateId, priceCents, className, label }: Props) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (priceCents > 0) return // Paid templates not yet supported
    startTransition(() => useTemplate(templateId))
  }

  if (priceCents > 0) {
    return (
      <button
        disabled
        className="w-full px-3 py-2 text-sm font-medium rounded-lg bg-blue-50 text-blue-700 border border-blue-200 cursor-not-allowed opacity-75"
        title="Compra de templates pagos disponível em breve"
      >
        Comprar R$ {(priceCents / 100).toFixed(2).replace('.', ',')}
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className={className ?? 'w-full px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition'}
    >
      {isPending ? 'Carregando…' : (label ?? 'Usar template')}
    </button>
  )
}
