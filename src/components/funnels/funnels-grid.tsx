'use client'

import React, { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'
import DeleteFunnelButton from './delete-funnel-button'
import SaveAsTemplateModal from '@/components/templates/save-as-template-modal'
import { pauseFunnel, resumeFunnel, duplicateFunnel, updateFunnelFolder } from '@/app/actions/funnels'
import type { Funnel } from '@/types'

const statusConfig: Record<string, { label: string; badgeClass: string; areaBg: string; iconColor: string }> = {
  draft:     { label: 'Rascunho',  badgeClass: 'bg-gray-100 text-gray-600',    areaBg: '#F3F4F6', iconColor: '#9ca3af' },
  published: { label: 'Publicado', badgeClass: 'bg-indigo-50 text-indigo-700', areaBg: '#EEF2FF', iconColor: '#6366f1' },
  paused:    { label: 'Pausado',   badgeClass: 'bg-amber-50 text-amber-700',   areaBg: '#FFFBEB', iconColor: '#f59e0b' },
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  return `há ${d}d`
}

function fmtRevenue(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

interface Props {
  initialFunnels: Funnel[]
  waMap?: Record<string, { instance_name: string; status: string }>
  leadsCountMap?: Record<string, number>
  salesCountMap?: Record<string, number>
  lastActivityMap?: Record<string, string>
  revenueMap?: Record<string, number>
  activeLeadsMap?: Record<string, number>
}

export default function FunnelsGrid({
  initialFunnels,
  waMap = {},
  leadsCountMap = {},
  salesCountMap = {},
  lastActivityMap = {},
  revenueMap = {},
  activeLeadsMap = {},
}: Props) {
  const router = useRouter()
  const [funnels, setFunnels] = useState(initialFunnels)
  const [templateFunnel, setTemplateFunnel] = useState<Funnel | null>(null)
  const [isPending, startTransition] = useTransition()

  // Search & filter state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sort, setSort] = useState<'recent' | 'leads' | 'name'>('recent')

  // Folder state
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null)
  const [newFolderInputId, setNewFolderInputId] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')

  const filtered = useMemo(() => {
    let list = funnels
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((f) => f.name.toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') {
      list = list.filter((f) => f.status === statusFilter)
    }
    if (sort === 'recent') {
      list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
    } else if (sort === 'leads') {
      list = [...list].sort((a, b) => (leadsCountMap[b.id] ?? 0) - (leadsCountMap[a.id] ?? 0))
    } else if (sort === 'name') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt'))
    }
    return list
  }, [funnels, search, statusFilter, sort, leadsCountMap])

  const grouped = useMemo(() => {
    const map: Record<string, Funnel[]> = {}
    for (const f of filtered) {
      const key = f.folder ?? ''
      if (!map[key]) map[key] = []
      map[key].push(f)
    }
    return map
  }, [filtered])

  const existingFolders = useMemo(() => {
    return [...new Set(funnels.map((f) => f.folder).filter((f): f is string => !!f))]
  }, [funnels])

  const folderKeys = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => {
      if (a === '' && b !== '') return 1
      if (b === '' && a !== '') return -1
      return a.localeCompare(b, 'pt')
    })
  }, [grouped])

  const showFolderGroups = folderKeys.length > 1 || (folderKeys.length === 1 && folderKeys[0] !== '')

  const handlePause = (funnelId: string) => {
    startTransition(async () => {
      await pauseFunnel(funnelId)
      setFunnels((prev) => prev.map((f) => f.id === funnelId ? { ...f, status: 'paused' } : f))
    })
  }

  const handleResume = (funnelId: string) => {
    startTransition(async () => {
      await resumeFunnel(funnelId)
      setFunnels((prev) => prev.map((f) => f.id === funnelId ? { ...f, status: 'published' } : f))
    })
  }

  const handleDuplicate = (funnelId: string) => {
    startTransition(async () => {
      const result = await duplicateFunnel(funnelId)
      if (result.success && result.newId) {
        router.push(`/funnels/${result.newId}/builder`)
      }
    })
  }

  const handleMoveFolder = (funnelId: string, folder: string | null) => {
    startTransition(async () => {
      await updateFunnelFolder(funnelId, folder)
      setFunnels((prev) => prev.map((f) => f.id === funnelId ? { ...f, folder: folder } : f))
    })
    setFolderMenuId(null)
    setNewFolderInputId(null)
  }

  const handleNewFolder = (funnelId: string) => {
    if (!newFolderName.trim()) return
    handleMoveFolder(funnelId, newFolderName.trim())
    setNewFolderName('')
  }

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
      {/* Search & Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative flex-1 min-w-[180px]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar funis..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-indigo-400 bg-white"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'draft', 'published', 'paused'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-2 rounded-xl font-medium transition-colors border ${
                statusFilter === s
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {s === 'all' ? 'Todos' : s === 'draft' ? 'Rascunho' : s === 'published' ? 'Publicado' : 'Pausado'}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-white outline-none focus:border-indigo-400"
        >
          <option value="recent">Mais recentes</option>
          <option value="leads">Mais leads</option>
          <option value="name">Nome A-Z</option>
        </select>
        <span className="text-xs text-gray-400 ml-1">{filtered.length} funil{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400 text-sm">Nenhum funil encontrado para os filtros atuais.</div>
      )}

      {folderKeys.map((folderKey) => (
        <div key={folderKey} className="mb-6">
          {showFolderGroups && (
            <button
              onClick={() => setCollapsedFolders((prev) => {
                const next = new Set(prev)
                if (next.has(folderKey)) next.delete(folderKey)
                else next.add(folderKey)
                return next
              })}
              className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700 hover:text-indigo-600 transition-colors"
            >
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                className={`w-4 h-4 transition-transform ${collapsedFolders.has(folderKey) ? '-rotate-90' : ''}`}
              >
                <polyline points="6,9 12,15 18,9" />
              </svg>
              <span>{folderKey === '' ? '📂 Sem pasta' : `📁 ${folderKey}`}</span>
              <span className="text-xs font-normal text-gray-400">({grouped[folderKey].length})</span>
            </button>
          )}

          {!collapsedFolders.has(folderKey) && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {grouped[folderKey].map((funnel) => {
                const st = statusConfig[funnel.status] ?? statusConfig.draft
                const waInst = funnel.whatsapp_instance_id ? (waMap[funnel.whatsapp_instance_id] ?? null) : null
                const leads = leadsCountMap[funnel.id] ?? 0
                const sales = salesCountMap[funnel.id] ?? 0
                const lastActivity = lastActivityMap[funnel.id] ?? null
                const revenue = revenueMap[funnel.id] ?? 0
                const activeLeads = activeLeadsMap[funnel.id] ?? 0
                const convRate = leads > 0 ? Math.round((sales / leads) * 100) : 0
                return (
                  <div
                    key={funnel.id}
                    className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col"
                  >
                    <div className="flex items-center justify-center h-16 rounded-t-2xl" style={{ backgroundColor: st.areaBg }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8" style={{ color: st.iconColor }}>
                        <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                      </svg>
                    </div>

                    <div className="p-4 flex-1 flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="font-semibold text-gray-900 text-sm leading-snug">{funnel.name}</h2>
                        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${st.badgeClass}`}>
                          {st.label}
                        </span>
                      </div>

                      {/* Metrics row */}
                      <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                        <span className="flex items-center gap-1">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 text-indigo-400">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                          </svg>
                          {leads} lead{leads !== 1 ? 's' : ''}
                        </span>
                        {activeLeads > 0 && (
                          <span className="flex items-center gap-1 text-blue-600">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            {activeLeads} ativos
                          </span>
                        )}
                        {sales > 0 && (
                          <span className="flex items-center gap-1 text-emerald-600">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                              <line x1="12" y1="1" x2="12" y2="23" />
                              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                            </svg>
                            {sales} ({convRate}%)
                          </span>
                        )}
                        {revenue > 0 && (
                          <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                            {fmtRevenue(revenue)}
                          </span>
                        )}
                        {lastActivity && (
                          <span className="flex items-center gap-1 ml-auto">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 text-gray-400">
                              <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
                            </svg>
                            {timeAgo(lastActivity)}
                          </span>
                        )}
                      </div>

                      {funnel.trigger_type && funnel.trigger_type !== 'manual' && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-gray-500">
                            {funnel.trigger_type === 'purchase' ? '💰 Compra' :
                             funnel.trigger_type === 'abandoned_cart' ? '🛒 Carrinho abandonado' :
                             funnel.trigger_type === 'webhook' ? '🔗 Webhook' : '📝 Formulário'}
                          </span>
                        </div>
                      )}

                      {waInst ? (
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${waInst.status === 'connected' ? 'bg-green-500' : 'bg-red-400'}`} />
                          <span className="text-xs text-gray-500">{waInst.instance_name}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 text-amber-400">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                          </svg>
                          <span className="text-xs text-amber-500">Sem WhatsApp</span>
                        </div>
                      )}
                    </div>

                    <div className="px-4 pb-4 flex items-center gap-1.5">
                      <Link
                        href={`/funnels/${funnel.id}/builder`}
                        className="flex-1 text-center px-3 py-2 border border-indigo-600 text-indigo-600 text-xs font-medium rounded-lg hover:bg-indigo-50 transition-colors"
                      >
                        Abrir Builder
                      </Link>

                      {/* Duplicate */}
                      <button
                        onClick={() => handleDuplicate(funnel.id)}
                        disabled={isPending}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Duplicar funil"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>

                      {/* Pause / Resume */}
                      {funnel.status === 'published' && (
                        <button
                          onClick={() => handlePause(funnel.id)}
                          disabled={isPending}
                          className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Pausar funil"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                            <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                          </svg>
                        </button>
                      )}
                      {funnel.status === 'paused' && (
                        <button
                          onClick={() => handleResume(funnel.id)}
                          disabled={isPending}
                          className="p-2 text-amber-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Retomar funil"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                            <polygon points="5,3 19,12 5,21 5,3" />
                          </svg>
                        </button>
                      )}

                      {/* Folder */}
                      <div className="relative">
                        <button
                          onClick={() => setFolderMenuId(folderMenuId === funnel.id ? null : funnel.id)}
                          className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Mover para pasta"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                        </button>
                        {folderMenuId === funnel.id && (
                          <div className="absolute bottom-full right-0 mb-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                            <button
                              onClick={() => handleMoveFolder(funnel.id, null)}
                              className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50 transition-colors text-gray-500"
                            >
                              📂 Sem pasta
                            </button>
                            {existingFolders.map((folder) => (
                              <button
                                key={folder}
                                onClick={() => handleMoveFolder(funnel.id, folder)}
                                className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50 transition-colors text-gray-700"
                              >
                                📁 {folder}
                              </button>
                            ))}
                            {newFolderInputId === funnel.id ? (
                              <div className="px-2 py-2 flex gap-1">
                                <input
                                  autoFocus
                                  value={newFolderName}
                                  onChange={(e) => setNewFolderName(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') handleNewFolder(funnel.id); if (e.key === 'Escape') setNewFolderInputId(null) }}
                                  placeholder="Nome da pasta"
                                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none"
                                />
                                <button onClick={() => handleNewFolder(funnel.id)} className="text-xs px-2 py-1 bg-indigo-600 text-white rounded-lg">✓</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setNewFolderInputId(funnel.id); setNewFolderName('') }}
                                className="w-full text-left text-xs px-3 py-2 hover:bg-gray-50 text-indigo-600 border-t border-gray-100 transition-colors"
                              >
                                + Nova pasta
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Template save */}
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

                      {/* Globe */}
                      {funnel.page_config ? (
                        <a
                          href={`/p/${funnel.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 hover:bg-green-50 rounded-lg transition-colors"
                          title="Página de captura"
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
          )}
        </div>
      ))}

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
