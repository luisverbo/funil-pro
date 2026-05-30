'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Globe } from 'lucide-react'
import DeleteFunnelButton from './delete-funnel-button'
import SaveAsTemplateModal from '@/components/templates/save-as-template-modal'
import type { Funnel } from '@/types'

const statusConfig: Record<string, { label: string; badgeClass: string; areaBg: string; iconColor: string }> = {
  draft:     { label: 'Rascunho',  badgeClass: 'bg-gray-100 text-gray-600',    areaBg: '#F3F4F6', iconColor: '#9ca3af' },
  published: { label: 'Publicado', badgeClass: 'bg-indigo-50 text-indigo-700', areaBg: '#EEF2FF', iconColor: '#6366f1' },
  paused:    { label: 'Pausado',   badgeClass: 'bg-amber-50 text-amber-700',   areaBg: '#FFFBEB', iconColor: '#f59e0b' },
}

export default function FunnelsGrid({ initialFunnels }: { initialFunnels: Funnel[] }) {
  const [funnels, setFunnels] = useState(initialFunnels)
  const [templateFunnel, setTemplateFunnel] = useState<Funnel | null>(null)

  if (funnels.length === 0) {
    return (
      <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
        <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-indigo-400">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </div>
        <p className="text-gray-700 font-semibold text-base mb-1">Nenhum funil criado</p>
        <p className="text-gray-400 text-sm">Comece criando seu primeiro funil de vendas.</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {funnels.map((funnel) => {
          const st = statusConfig[funnel.status] ?? statusConfig.draft
          return (
            <div
              key={funnel.id}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-center h-24" style={{ backgroundColor: st.areaBg }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10" style={{ color: st.iconColor }}>
                  <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                </svg>
              </div>

              <div className="p-4 flex-1 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-gray-900 text-base leading-snug">{funnel.name}</h2>
                  <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${st.badgeClass}`}>
                    {st.label}
                  </span>
                </div>
                <p className="text-xs text-gray-400">
                  Criado em {new Date(funnel.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </div>

              <div className="px-4 pb-4 flex items-center gap-2">
                <Link
                  href={`/funnels/${funnel.id}/builder`}
                  className="flex-1 text-center px-3 py-2 border border-indigo-600 text-indigo-600 text-sm font-medium rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  Abrir Builder
                </Link>
                <button
                  onClick={() => setTemplateFunnel(funnel)}
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  title="Salvar como template"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14,2 14,8 20,8" />
                    <line x1="12" y1="18" x2="12" y2="12" />
                    <line x1="9" y1="15" x2="15" y2="15" />
                  </svg>
                </button>
                <Link
                  href={`/funnels/${funnel.id}/links`}
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                  title="Links do funil"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                  </svg>
                </Link>
                {funnel.page_config ? (
                  <a
                    href={`/p/${funnel.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 hover:bg-green-50 rounded-lg transition-colors"
                    title="Página de captura configurada"
                  >
                    <Globe className="w-4 h-4 text-green-500" />
                  </a>
                ) : (
                  <Link
                    href={`/funnels/${funnel.id}/builder`}
                    className="p-2 text-gray-300 hover:text-gray-400 hover:bg-gray-50 rounded-lg transition-colors"
                    title="Nenhuma página de captura"
                  >
                    <Globe className="w-4 h-4" />
                  </Link>
                )}
                <DeleteFunnelButton
                  funnelId={funnel.id}
                  funnelName={funnel.name}
                  isPublished={funnel.status === 'published'}
                  onDeleted={() => setFunnels((prev) => prev.filter((f) => f.id !== funnel.id))}
                />
              </div>
            </div>
          )
        })}
      </div>

      {templateFunnel && (
        <SaveAsTemplateModal
          funnelId={templateFunnel.id}
          funnelName={templateFunnel.name}
          onClose={() => setTemplateFunnel(null)}
        />
      )}
    </>
  )
}
