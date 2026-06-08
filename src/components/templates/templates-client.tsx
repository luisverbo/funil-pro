'use client'

import React, { useState, useMemo, useTransition, useCallback } from 'react'
import { useTemplate } from '@/app/actions/templates'
import type { FunnelTemplate } from '@/types'

const CATEGORIES = [
  { value: '', label: 'Todos' },
  { value: 'captacao', label: 'Captação' },
  { value: 'lancamento', label: 'Lançamento' },
  { value: 'mentoria', label: 'Mentoria' },
  { value: 'cart_abandoned', label: 'Carrinho Abandonado' },
  { value: 'produto_fisico', label: 'Produto Físico' },
  { value: 'pos_venda', label: 'Pós-venda' },
  { value: 'reengajamento', label: 'Reengajamento' },
]

const CATEGORY_GRADIENTS: Record<string, string> = {
  captacao:      'linear-gradient(135deg, #6366F1, #8B5CF6)',
  lancamento:    'linear-gradient(135deg, #0EA5E9, #6366F1)',
  cart_abandoned:'linear-gradient(135deg, #F59E0B, #EF4444)',
  mentoria:      'linear-gradient(135deg, #10B981, #0EA5E9)',
  produto_fisico:'linear-gradient(135deg, #F97316, #EF4444)',
  pos_venda:     'linear-gradient(135deg, #EC4899, #8B5CF6)',
  reengajamento: 'linear-gradient(135deg, #14B8A6, #6366F1)',
  default:       'linear-gradient(135deg, #6366F1, #8B5CF6)',
}

const BLOCK_COLORS: Record<string, string> = {
  entry: '#6366f1', message: '#22c55e', condition: '#f59e0b',
  delay: '#8b5cf6', tag: '#06b6d4', sale: '#ec4899',
  cart_abandoned: '#6366f1', form: '#14b8a6', page: '#f97316',
}

const BLOCK_ICONS: Record<string, string> = {
  entry: '🚪', message: '💬', condition: '🔀', delay: '⏱️',
  tag: '🏷️', sale: '💰', cart_abandoned: '🛒', form: '📋', page: '📄',
}

const BLOCK_LABELS: Record<string, string> = {
  entry: 'Entrada', message: 'Mensagem', condition: 'Condição',
  delay: 'Aguardar', tag: 'Tag', sale: 'Venda',
  cart_abandoned: 'Carrinho', form: 'Formulário', page: 'Página',
}

const USE_STEPS = ['Copiando template…', 'Configurando blocos…', 'Pronto!']

interface Block { block_type: string }
interface Props {
  initialTemplates: FunnelTemplate[]
}

function ThumbnailPreview({ template, blocks }: { template: FunnelTemplate; blocks: Block[] }) {
  const gradient = CATEGORY_GRADIENTS[template.category ?? ''] ?? CATEGORY_GRADIENTS.default
  const visibleBlocks = blocks.slice(0, 5)

  return (
    <div className="relative w-full h-40 rounded-t-2xl overflow-hidden flex items-center justify-center" style={{ background: gradient }}>
      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
      <div className="flex items-center gap-1.5 z-10">
        {visibleBlocks.map((b, i) => (
          <React.Fragment key={i}>
            <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center text-sm shadow-sm border border-white/30">
              {BLOCK_ICONS[b.block_type] ?? '📦'}
            </div>
            {i < visibleBlocks.length - 1 && (
              <div className="w-3 h-0.5 bg-white/40" />
            )}
          </React.Fragment>
        ))}
        {blocks.length > 5 && (
          <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-sm flex items-center justify-center text-xs text-white font-bold border border-white/30">
            +{blocks.length - 5}
          </div>
        )}
      </div>
      {template.category && (
        <div className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm text-white text-xs font-medium border border-white/20">
          {CATEGORIES.find(c => c.value === template.category)?.label ?? template.category}
        </div>
      )}
      {template.tenant_id === null && (
        <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-amber-400/90 text-white text-xs font-semibold flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Oficial
        </div>
      )}
    </div>
  )
}

function PreviewModal({ template, blocks, isTop3, isNew, onClose, onUse }: {
  template: FunnelTemplate
  blocks: Block[]
  isTop3: boolean
  isNew: boolean
  onClose: () => void
  onUse: () => void
}) {
  const blockTypeCounts: Record<string, number> = {}
  blocks.forEach(b => { blockTypeCounts[b.block_type] = (blockTypeCounts[b.block_type] ?? 0) + 1 })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col" style={{ animation: 'fadeInUp 0.2s ease both' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <h2 className="font-bold text-gray-900 text-lg">{template.name}</h2>
            {template.category && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                {CATEGORIES.find(c => c.value === template.category)?.label ?? template.category}
              </span>
            )}
            {template.tenant_id === null && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200 flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                Oficial
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onUse} className="px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
              Usar este template →
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden flex">
          <div className="w-2/5 p-6 overflow-y-auto border-r border-gray-100 space-y-5">
            {template.description && (
              <div>
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Descrição</h4>
                <p className="text-sm text-gray-700 leading-relaxed">{template.description}</p>
              </div>
            )}
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">O que está incluído</h4>
              <div className="space-y-1.5">
                {Object.entries(blockTypeCounts).map(([type, count]) => (
                  <div key={type} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="text-base">{BLOCK_ICONS[type] ?? '📦'}</span>
                    <span>{count}x {BLOCK_LABELS[type] ?? type}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Métricas</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{template.downloads_count}</p>
                  <p className="text-xs text-gray-500 mt-0.5">usos</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{blocks.length}</p>
                  <p className="text-xs text-gray-500 mt-0.5">blocos</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {template.price_cents === 0
                ? <span className="font-semibold text-green-600">🆓 Gratuito</span>
                : <span className="font-semibold text-blue-600">R$ {(template.price_cents / 100).toFixed(2).replace('.', ',')}</span>
              }
            </p>
          </div>
          <div className="flex-1 overflow-auto bg-gray-50 p-6 flex flex-col gap-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Fluxo do funil</h4>
            <div className="flex flex-col gap-2">
              {blocks.map((b, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: BLOCK_COLORS[b.block_type] ?? '#6b7280' }}
                  >
                    {BLOCK_ICONS[b.block_type] ?? '?'}
                  </div>
                  <div className="flex-1 bg-white rounded-xl px-3 py-2 border border-gray-100 shadow-sm">
                    <span className="text-xs font-medium text-gray-700">{BLOCK_LABELS[b.block_type] ?? b.block_type}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function UseModal({ template, onClose }: { template: FunnelTemplate; onClose: () => void }) {
  const [name, setName] = useState(template.name)
  const [step, setStep] = useState(0)
  const [isPending, startTransition] = useTransition()

  const handleUse = () => {
    setStep(1)
    const tick = () => {
      setStep(s => {
        if (s < USE_STEPS.length - 1) { setTimeout(tick, 700); return s + 1 }
        return s
      })
    }
    setTimeout(tick, 700)
    startTransition(() => useTemplate(template.id))
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !isPending && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" style={{ animation: 'fadeInUp 0.2s ease both' }}>
        {step === 0 ? (
          <>
            <h3 className="font-bold text-gray-900 text-base mb-1">Usar template</h3>
            <p className="text-sm text-gray-500 mb-5">Será criado um novo funil baseado neste template.</p>
            <div className="mb-5">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome do seu funil</label>
              <input
                autoFocus
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 transition-colors">Cancelar</button>
              <button
                onClick={handleUse}
                disabled={!name.trim()}
                className="flex-1 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                Criar funil a partir deste template
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center">
              <svg className="animate-spin w-7 h-7 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            </div>
            <p className="text-gray-700 font-medium">{USE_STEPS[Math.min(step - 1, USE_STEPS.length - 1)]}</p>
            <div className="flex gap-1.5">
              {USE_STEPS.map((_, i) => (
                <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i < step ? 'bg-indigo-500' : 'bg-gray-200'}`} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TemplatesClient({ initialTemplates }: Props) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [onlyFree, setOnlyFree] = useState(false)
  const [sort, setSort] = useState<'downloads' | 'recent'>('downloads')
  const [previewTemplate, setPreviewTemplate] = useState<FunnelTemplate | null>(null)
  const [useTemplate2, setUseTemplate2] = useState<FunnelTemplate | null>(null)

  const filtered = useMemo(() => {
    let list = [...initialTemplates]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t => t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
    }
    if (category) list = list.filter(t => t.category === category)
    if (onlyFree) list = list.filter(t => t.price_cents === 0)
    list.sort((a, b) =>
      sort === 'downloads'
        ? b.downloads_count - a.downloads_count
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    return list
  }, [initialTemplates, search, category, onlyFree, sort])

  const topIds = useMemo(() =>
    [...initialTemplates]
      .sort((a, b) => b.downloads_count - a.downloads_count)
      .slice(0, 3)
      .map(t => t.id),
    [initialTemplates]
  )

  const now = Date.now()

  const openUse = useCallback((t: FunnelTemplate) => {
    setPreviewTemplate(null)
    setUseTemplate2(t)
  }, [])

  return (
    <>
      <div className="relative mb-4">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar templates…"
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                category === c.value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setOnlyFree(v => !v)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${onlyFree ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            Gratuitos
          </button>
          <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
            {(['downloads', 'recent'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${sort === s ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {s === 'downloads' ? 'Mais usados' : 'Recentes'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-24">
          <p className="text-gray-400">Nenhum template encontrado com esses filtros.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((tmpl, i) => {
            const funnelJson = tmpl.funnel_json as { blocks?: Block[] }
            const blocks = funnelJson?.blocks ?? []
            const isTop = topIds.includes(tmpl.id)
            const isNew = (now - new Date(tmpl.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000
            const blockTypeCounts: Record<string, number> = {}
            blocks.forEach(b => { blockTypeCounts[b.block_type] = (blockTypeCounts[b.block_type] ?? 0) + 1 })

            return (
              <div
                key={tmpl.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 flex flex-col overflow-hidden"
                style={{ animation: `fadeInUp 0.3s ease ${i * 40}ms both` }}
              >
                <ThumbnailPreview template={tmpl} blocks={blocks} />
                <div className="p-4 flex-1 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 text-sm leading-snug flex-1">{tmpl.name}</h3>
                    <div className="flex gap-1 shrink-0">
                      {isNew && <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-600">Novo</span>}
                      {isTop && !isNew && <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-orange-50 text-orange-600">Popular</span>}
                    </div>
                  </div>
                  {tmpl.description && (
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">{tmpl.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(blockTypeCounts).map(([type, count]) => (
                      <span
                        key={type}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                        style={{ backgroundColor: `${BLOCK_COLORS[type] ?? '#6b7280'}18`, color: BLOCK_COLORS[type] ?? '#6b7280' }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: BLOCK_COLORS[type] ?? '#6b7280' }} />
                        {count}x {BLOCK_LABELS[type] ?? type}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 mt-auto pt-2 border-t border-gray-50">
                    <span>👥 {tmpl.downloads_count} usos</span>
                    {tmpl.price_cents === 0
                      ? <span className="text-green-600 font-semibold">🆓 Gratuito</span>
                      : <span className="text-blue-600 font-semibold">R$ {(tmpl.price_cents / 100).toFixed(2).replace('.', ',')}</span>
                    }
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPreviewTemplate(tmpl)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                      </svg>
                      Preview
                    </button>
                    <button
                      onClick={() => openUse(tmpl)}
                      disabled={tmpl.price_cents > 0}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Usar →
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {previewTemplate && (() => {
        const blocks = (previewTemplate.funnel_json as { blocks?: Block[] })?.blocks ?? []
        const isTop = topIds.includes(previewTemplate.id)
        const isNew = (now - new Date(previewTemplate.created_at).getTime()) < 7 * 24 * 60 * 60 * 1000
        return (
          <PreviewModal
            template={previewTemplate}
            blocks={blocks}
            isTop3={isTop}
            isNew={isNew}
            onClose={() => setPreviewTemplate(null)}
            onUse={() => openUse(previewTemplate)}
          />
        )
      })()}

      {useTemplate2 && (
        <UseModal template={useTemplate2} onClose={() => setUseTemplate2(null)} />
      )}

      <style jsx>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}
