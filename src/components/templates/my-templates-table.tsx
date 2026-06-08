'use client'

import { useState, useTransition } from 'react'
import { deleteTemplate, toggleTemplatePublic } from '@/app/actions/templates'
import EditTemplateModal from './edit-template-modal'
import type { FunnelTemplate } from '@/types'

const CATEGORY_LABELS: Record<string, string> = {
  captacao: 'Captação',
  lancamento: 'Lançamento',
  mentoria: 'Mentoria',
  cart_abandoned: 'Carrinho Abandonado',
  produto_fisico: 'Produto Físico',
  pos_venda: 'Pós-venda',
  reengajamento: 'Reengajamento',
}

interface Props { initialTemplates: FunnelTemplate[] }

export default function MyTemplatesTable({ initialTemplates }: Props) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [editingTemplate, setEditingTemplate] = useState<FunnelTemplate | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir template "${name}"? Esta ação não pode ser desfeita.`)) return
    startTransition(async () => {
      const result = await deleteTemplate(id)
      if (result.success) setTemplates(prev => prev.filter(t => t.id !== id))
    })
  }

  function handleTogglePublic(template: FunnelTemplate) {
    startTransition(async () => {
      const result = await toggleTemplatePublic(template.id, !template.is_public)
      if (result.success) setTemplates(prev => prev.map(t => t.id === template.id ? { ...t, is_public: !t.is_public } : t))
    })
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto mb-4 text-3xl">📋</div>
        <p className="text-gray-800 font-semibold text-base">Você ainda não criou nenhum template</p>
        <p className="text-sm text-gray-400 mt-1.5 max-w-sm mx-auto">
          Transforme seus melhores funis em templates e compartilhe com outros usuários do FunilPro
        </p>
        <a
          href="/templates"
          className="inline-flex items-center gap-1.5 mt-5 px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4"><path d="M12 5v14M5 12h14"/></svg>
          Criar meu primeiro template
        </a>
      </div>
    )
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoria</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Visibilidade</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usos</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Receita</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {templates.map(t => {
              const revenue = t.downloads_count * t.price_cents
              return (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900 text-sm">{t.name}</div>
                    {t.description && <div className="text-xs text-gray-400 mt-0.5 line-clamp-1">{t.description}</div>}
                  </td>
                  <td className="px-6 py-4">
                    {t.category
                      ? <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{CATEGORY_LABELS[t.category] ?? t.category}</span>
                      : <span className="text-gray-400 text-sm">—</span>}
                  </td>
                  <td className="px-6 py-4">
                    {t.is_public
                      ? <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">Público</span>
                      : <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Privado</span>}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">{t.downloads_count}</td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {t.price_cents > 0 ? `R$ ${(revenue / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setEditingTemplate(t)} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:text-indigo-600 hover:border-indigo-400 transition">Editar</button>
                      <button onClick={() => handleTogglePublic(t)} disabled={isPending} className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:text-indigo-600 hover:border-indigo-400 transition disabled:opacity-50">
                        {t.is_public ? 'Despublicar' : 'Publicar'}
                      </button>
                      <button onClick={() => handleDelete(t.id, t.name)} disabled={isPending} className="text-xs px-3 py-1.5 border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition disabled:opacity-50">Excluir</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {editingTemplate && <EditTemplateModal template={editingTemplate} onClose={() => setEditingTemplate(null)} />}
    </>
  )
}
