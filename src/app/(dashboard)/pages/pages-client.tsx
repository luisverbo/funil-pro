'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPage, deletePage, duplicatePage } from '@/app/actions/pages'
import { captureTemplate, vslTemplate, deliveryTemplate } from '@/lib/page-templates'

const TEMPLATE_JSON: Record<string, object> = {
  capture: captureTemplate,
  vsl: vslTemplate,
  delivery: deliveryTemplate,
}

type PageType = 'capture' | 'vsl' | 'delivery' | 'thankyou' | 'sales'

const PAGE_TYPES: { type: PageType; label: string; icon: string; description: string; color: string }[] = [
  { type: 'capture', label: 'Captura', icon: '📝', description: 'Formulário para coletar leads', color: 'indigo' },
  { type: 'vsl', label: 'VSL', icon: '🎬', description: 'Carta de vendas em vídeo', color: 'purple' },
  { type: 'delivery', label: 'Entrega', icon: '🎁', description: 'Acesso ao produto adquirido', color: 'emerald' },
  { type: 'thankyou', label: 'Obrigado', icon: '🙏', description: 'Confirmação após conversão', color: 'green' },
  { type: 'sales', label: 'Vendas', icon: '💰', description: 'Carta de vendas longa', color: 'orange' },
]

const TYPE_COLORS: Record<string, string> = {
  capture: 'bg-indigo-100 text-indigo-700',
  vsl: 'bg-purple-100 text-purple-700',
  delivery: 'bg-emerald-100 text-emerald-700',
  thankyou: 'bg-green-100 text-green-700',
  sales: 'bg-orange-100 text-orange-700',
}

const TEMPLATE_OPTIONS = [
  { id: 'blank', label: 'Em branco', description: 'Comece do zero', icon: '⬜' },
  { id: 'capture', label: 'Captura Minimalista', description: 'Hero + Formulário', icon: '📝' },
  { id: 'vsl', label: 'VSL Clássica', description: 'Hero + Vídeo + CTA', icon: '🎬' },
  { id: 'delivery', label: 'Entrega Simples', description: 'Hero + Card de acesso', icon: '🎁' },
]

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    + '-' + Math.random().toString(36).slice(2, 7)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function PagesClient({ pages, tenantId }: { pages: any[]; tenantId: string }) {
  const router = useRouter()
  const [filter, setFilter] = useState<string>('all')
  const [showModal, setShowModal] = useState(false)
  const [step, setStep] = useState(1)
  const [selectedType, setSelectedType] = useState<PageType>('capture')
  const [selectedTemplate, setSelectedTemplate] = useState('blank')
  const [pageName, setPageName] = useState('')
  const [pageSlug, setPageSlug] = useState('')
  const [isPending, startTransition] = useTransition()

  const filtered = filter === 'all' ? pages : pages.filter((p) => p.page_type === filter)

  const handleOpen = () => {
    setStep(1); setSelectedType('capture'); setSelectedTemplate('blank')
    setPageName(''); setPageSlug(''); setShowModal(true)
  }

  const handleNameChange = (name: string) => {
    setPageName(name)
    setPageSlug(generateSlug(name))
  }

  const handleCreate = () => {
    if (!pageName.trim()) return
    startTransition(async () => {
      const craftJson = selectedTemplate !== 'blank' ? (TEMPLATE_JSON[selectedTemplate] ?? {}) : {}
      const page = await createPage({ name: pageName, page_type: selectedType, craft_json: craftJson })
      setShowModal(false)
      router.push(`/page-editor/${page.id}`)
    })
  }

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Excluir "${name}"?`)) return
    startTransition(async () => { await deletePage(id); router.refresh() })
  }

  const handleDuplicate = (id: string) => {
    startTransition(async () => {
      const copy = await duplicatePage(id)
      router.push(`/page-editor/${copy.id}`)
    })
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Minhas Páginas</h1>
          <p className="text-sm text-gray-500 mt-1">Crie e gerencie suas páginas de funil</p>
        </div>
        <button onClick={handleOpen} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 5v14M5 12h14"/></svg>
          Nova Página
        </button>
      </div>

      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {['all', 'capture', 'vsl', 'delivery', 'thankyou', 'sales'].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${filter === f ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:border-indigo-300'}`}>
            {f === 'all' ? 'Todos' : PAGE_TYPES.find((t) => t.type === f)?.label ?? f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4 text-3xl">📄</div>
          <p className="text-gray-700 font-semibold text-base mb-1">Nenhuma página encontrada</p>
          <p className="text-gray-400 text-sm mb-4">Crie sua primeira página com o builder visual.</p>
          <button onClick={handleOpen} className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">Criar primeira página</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((page) => (
            <div key={page.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
              <div className="h-32 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                <span className="text-4xl">{PAGE_TYPES.find((t) => t.type === page.page_type)?.icon ?? '📄'}</span>
              </div>
              <div className="p-4 flex-1 flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-gray-900 text-base leading-snug">{page.title}</h2>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${TYPE_COLORS[page.page_type] ?? 'bg-gray-100 text-gray-600'}`}>
                    {PAGE_TYPES.find((t) => t.type === page.page_type)?.label ?? page.page_type}
                  </span>
                </div>
                {page.slug && <p className="text-xs text-gray-400 font-mono">/pg/{page.slug}</p>}
                <div className="flex items-center gap-1.5 mt-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${page.published ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <span className={`text-xs font-medium ${page.published ? 'text-green-600' : 'text-gray-400'}`}>{page.published ? 'Publicada' : 'Rascunho'}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                  <span>👁 {page.views_count ?? 0}</span>
                  <span>🖱 {page.clicks_count ?? 0}</span>
                  <span>✅ {page.conversions_count ?? 0}</span>
                </div>
              </div>
              <div className="px-4 pb-4 flex items-center gap-2">
                <button onClick={() => router.push(`/page-editor/${page.id}`)} className="flex-1 text-center px-3 py-2 border border-indigo-600 text-indigo-600 text-sm font-medium rounded-lg hover:bg-indigo-50 transition-colors">Editar</button>
                <button onClick={() => handleDuplicate(page.id)} className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors" title="Duplicar">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                </button>
                {page.published && page.slug && (
                  <a href={`/pg/${page.slug}`} target="_blank" rel="noopener noreferrer" className="px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors" title="Ver página">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </a>
                )}
                <button onClick={() => handleDelete(page.id, page.title)} className="px-3 py-2 border border-red-100 text-red-400 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors" title="Excluir">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Nova Página</h2>
                <p className="text-sm text-gray-500">Passo {step} de 3</p>
              </div>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 text-gray-500"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {step === 1 && (
              <div className="p-6">
                <p className="text-sm font-medium text-gray-700 mb-4">Qual tipo de página você quer criar?</p>
                <div className="grid grid-cols-2 gap-3">
                  {PAGE_TYPES.map(({ type, label, icon, description }) => (
                    <button key={type} onClick={() => setSelectedType(type)} className={`p-4 rounded-xl border-2 text-left transition-all ${selectedType === type ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <span className="text-2xl">{icon}</span>
                      <p className="font-semibold text-gray-900 mt-2">{label}</p>
                      <p className="text-xs text-gray-500">{description}</p>
                    </button>
                  ))}
                </div>
                <button onClick={() => setStep(2)} className="mt-6 w-full py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors">Continuar →</button>
              </div>
            )}

            {step === 2 && (
              <div className="p-6">
                <p className="text-sm font-medium text-gray-700 mb-4">Escolha um template inicial</p>
                <div className="grid grid-cols-2 gap-3">
                  {TEMPLATE_OPTIONS.map(({ id, label, description, icon }) => (
                    <button key={id} onClick={() => setSelectedTemplate(id)} className={`p-4 rounded-xl border-2 text-left transition-all ${selectedTemplate === id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <span className="text-2xl">{icon}</span>
                      <p className="font-semibold text-gray-900 mt-2 text-sm">{label}</p>
                      <p className="text-xs text-gray-500">{description}</p>
                    </button>
                  ))}
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setStep(1)} className="flex-1 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50">← Voltar</button>
                  <button onClick={() => setStep(3)} className="flex-1 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700">Continuar →</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="p-6">
                <p className="text-sm font-medium text-gray-700 mb-4">Dê um nome para a página</p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Nome da página</label>
                    <input className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Ex: Página de Captura - Produto X" value={pageName} onChange={(e) => handleNameChange(e.target.value)} autoFocus />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Slug (URL)</label>
                    <div className="flex items-center border border-gray-300 rounded-xl overflow-hidden">
                      <span className="px-3 py-3 bg-gray-50 text-gray-400 text-xs border-r border-gray-300">/pg/</span>
                      <input className="flex-1 px-3 py-3 text-sm focus:outline-none" value={pageSlug} onChange={(e) => setPageSlug(e.target.value)} />
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setStep(2)} className="flex-1 py-3 border border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50">← Voltar</button>
                  <button onClick={handleCreate} disabled={!pageName.trim() || isPending} className="flex-1 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                    {isPending ? 'Criando...' : 'Criar Página'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
