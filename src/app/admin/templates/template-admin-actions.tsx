'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toggleTemplatePublic, deleteOfficialTemplate } from '@/app/actions/admin'

interface Props {
  templateId: string
  isPublic: boolean
}

export default function TemplateAdminActions({ templateId, isPublic }: Props) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleToggle() {
    startTransition(async () => {
      await toggleTemplatePublic(templateId, !isPublic)
      router.refresh()
    })
  }

  function handleDelete() {
    if (!confirm('Tem certeza que deseja excluir este template?')) return
    startTransition(async () => {
      await deleteOfficialTemplate(templateId)
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleToggle}
        disabled={isPending}
        className="text-xs border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 text-gray-700 disabled:opacity-50 transition-colors"
      >
        {isPublic ? 'Despublicar' : 'Publicar'}
      </button>
      <button
        onClick={handleDelete}
        disabled={isPending}
        className="text-xs border border-red-200 text-red-600 rounded px-2 py-1 hover:bg-red-50 disabled:opacity-50 transition-colors"
      >
        Excluir
      </button>
    </div>
  )
}
