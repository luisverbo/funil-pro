'use client'

import React, { useState, useMemo, useTransition, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Globe } from 'lucide-react'
import DeleteFunnelButton from './delete-funnel-button'
import SaveAsTemplateModal from '@/components/templates/save-as-template-modal'
import type { Funnel } from '@/types'
import { duplicateFunnel, pauseFunnel, resumeFunnel, updateFunnelFolder } from '@/app/actions/funnels'

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
  return `há ${Math.floor(h / 24)}d`
}

function fmtRevenue(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
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
  const [funnels, setFunnels] = useState(initialFunnels)
  const [templateFunnel, setTemplateFunnel] = useState<Funnel | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'paused' | 'draft'>('all')
  const [sort, setSort] = useState<'recent' | 'leads' | 'name'>('recent')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null)
  const [newFolderInputId, setNewFolderInputId] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [isPending, startTransition] = useTransition()
  void isPending
  const folderMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenuId(null)
        setNewFolderInputId(null)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const existingFolders = useMemo(() =>
    [...new Set(funnels.map((f) => f.folder).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  , [funnels])

  const filtered = useMemo(() => {
    let result = funnels.filter((f) => {
      const matchSearch = f.name.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'all' || f.status === statusFilter
      return matchSearch && matchStatus
    })
    if (sort === 'name') result = [...result].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    else if (sort === 'leads') result = [...result].sort((a, b) => (leadsCountMap[b.id] ?? 0) - (leadsCountMap[a.id] ?? 0))
    else result = [...result].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return result
  }, [funnels, search, statusFilter, sort, leadsCountMap])

  const grouped = useMemo(() => {
    const g: Record<string, Funnel[]> = {}
    for (const f of filtered) {
      const key = f.folder ?? ''
      if (!g[key]) g[key] = []
      g[key].push(f)
    }
    return g
  }, [filtered])

  const folderKeys = useMemo(() =>
    Object.keys(grouped).sort((a, b) => {
      if (!a && b) return 1
      if (a && !b) return -1
      return a.localeCompare(b, 'pt-BR')
    })
  , [grouped])

  const hasFolders = existingFolders.length > 0 || funnels.some((f) => f.folder)
  const showFolderGroups = hasFolders && folderKeys.length > 1

  const handlePause = (funnelId: string) => {
    startTransition(async () => {
      const r = await pauseFunnel(funnelId)
      if (r.success) setFunnels((p) => p.map((f) => f.id === funnelId ? { ...f, status: 'paused' } : f))
    })
  }

  const handleResume = (funnelId: string) => {
    startTransition(async () => {
      const r = await resumeFunnel(funnelId)
      if (r.success) setFunnels((p) => p.map((f) => f.id === funnelId ? { ...f, status: 'published' } : f))
    })
  }

  const handleDuplicate = (funnelId: string) => {
    startTransition(async () => { await duplicateFunnel(funnelId) })
  }

  const handleSetFolder = (funnelId: string, folder: string | null) => {
    const trimmed = folder?.trim() || null
    startTransition(async () => {
      const r = await updateFunnelFolder(funnelId, trimmed)
      if (r.success) setFunnels((p) => p.map((f) => f.id === funnelId ? { ...f, folder: trimmed } : f))
    })
    setFolderMenuId(null)
    setNewFolderInputId(null)
    setNewFolderName('')
  }

  const renderCard = (funnel: Funnel) => {
    const st = statusConfig[funnel.status] ?? statusConfig.draft
    const waInst = funnel.whatsapp_instance_id ? (waMap[funnel.whatsapp_instance_id] ?? null) : null
    const leads = leadsCountMap[funnel.id] ?? 0
    const sales = salesCountMap[funnel.id] ?? 0
    const revenue = revenueMap[funnel.id] ?? 0
    const active = activeLeadsMap[funnel.id] ?? 0
    const lastActivity = lastActivityMap[funnel.id] ?? null
    const convRate = leads > 0 ? Math.round((sales / leads) * 100) : 0

    return (
      <div key={funnel.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow flex flex-col">
        {/* Top banner */}
        <div className="rounded-t-2xl h-16 flex items-center justify-center relative" style={{ backgroundColor: st.areaBg }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8" style={{ color: st.iconColor }}>
            <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
          </svg>
          {/* Folder button */}
          <div className="absolute top-2 right-2" ref={folderMenuId === funnel.id ? folderMenuRef : undefined}>
            <button
              onClick={(e) => { e.stopPropagation(); setFolderMenuId(folderMenuId === funnel.id ? null : funnel.id); setNewFolderInputId(null) }}
              title="Mover para pasta"
              className="w-6 h-6 flex items-center justify-center rounded-md bg-white/80 hover:bg-white text-gray-500 hover:text-indigo-600 transition-colors text-xs"
            >
              📁
            </button>
            {folderMenuId === funnel.id && (
              <div className="absolute top-7 right-0 z-50 w-44 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                <button onClick={() => handleSetFolder(funnel.id, null)} className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 flex items-center gap-2">
                  <span className="opacity-50">📁</span> Sem pasta
                </button>
                {existingFolders.map((f) => (
                  <button key={f} onClick={() => handleSetFolder(funnel.id, f)} className={`w-full text-left px-3 py-2 text-xs hover:bg-indigo-50 flex items-center gap-2 ${funnel.folder === f ? 'font-semibold text-indigo-600' : 'text-gray-700'}`}>
                    <span>📁</span> {f}
                  </button>
                ))}
                <div className="border-t border-gray-100 p-2">
                  {newFolderInputId === funnel.id ? (
                    <div className="flex gap-1">
                      <input
                        autoFocus
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && newFolderName.trim() && handleSetFolder(funnel.id, newFolderName)}
                        className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-indigo-400"
                        placeholder="Nome..."
                      />
                      <button
                        onClick={() => newFolderName.trim() && handleSetFolder(funnel.id, newFolderName)}
                        className="text-xs px-2 py-1 bg-indigo-600 text-white rounded font-medium"
                      >✓</button>
                    </div>
                  ) : (
                    <button onClick={() => { setNewFolderInputId(funnel.id); setNewFolderName('') }} className="w-full text-left text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                      + Nova pasta...
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 flex-1 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold text-gray-900 text-base leading-snug">{funnel.name}</h2>
            <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${st.badgeClass}`}>{st.label}</span>
          </div>

          {/* Metrics row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 text-indigo-400">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              </svg>
              {leads} lead{leads !== 1 ? 's' : ''}
            </span>
            {sales > 0 && (
              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                {sales} ({convRate}%)
              </span>
            )}
            {revenue > 0 && (
              <span className="text-emerald-700 font-semibold">{fmtRevenue(revenue)}</span>
            )}
            {active > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                {active} ativo{active !== 1 ? 's' : ''}
              </span>
            )}
            {lastActivity && (
              <span className="flex items-center gap-1 text-gray-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                  <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
                </svg>
                {timeAgo(lastActivity)}
              </span>
            )}
          </div>

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
            className="flex-1 text-center px-3 py-2 border border-indigo-600 text-indigo-600 text-sm font-medium rounded-lg hover:bg-indigo-50 transition-colors"
          >
            Abrir
          </Link>

          {/* Duplicate */}
          <button
            onClick={() => handleDuplicate(funnel.id)}
            title="Duplicar funil"
            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
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
              title="Pausar funil"
              className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
            </button>
          )}
          {funnel.status === 'paused' && (
            <button
              onClick={() => handleResume(funnel.id)}
              title="Retomar funil"
              className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <polygon points="5,3 19,12 5,21 5,3" />
              </svg>
            </button>
          )}

          {/* Template */}
          <button
            onClick={() => setTemplateFunnel(funnel)}
            title="Salvar como template"
            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </button>

          {/* Links */}
          <Link href={`/funnels/${funnel.id}/links`} title="Links do funil" className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </Link>

          {funnel.page_config ? (
            <a href={`/p/${funnel.id}`} target="_blank" rel="noopener noreferrer" title="Página de captura" className="p-2 hover:bg-green-50 rounded-lg transition-colors">
              <Globe className="w-4 h-4 text-green-500" />
            </a>
          ) : (
            <Link href={`/funnels/${funnel.id}/builder`} title="Sem página de captura" className="p-2 text-gray-300 hover:text-gray-400 hover:bg-gray-50 rounded-lg transition-colors">
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
      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar funis..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(['all', 'published', 'paused', 'draft'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-full font-medium border transition-colors ${
                statusFilter === s
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {s === 'all' ? 'Todos' : s === 'published' ? 'Publicado' : s === 'paused' ? 'Pausado' : 'Rascunho'}
            </button>
          ))}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 text-gray-600"
          >
            <option value="recent">Mais recente</option>
            <option value="leads">Mais leads</option>
            <option value="name">Nome A-Z</option>
          </select>
        </div>
      </div>

      <p className="text-xs text-gray-400 mb-4">{filtered.length} funil{filtered.length !== 1 ? 's' : ''} encontrado{filtered.length !== 1 ? 's' : ''}</p>

      {filtered.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
          <p className="text-gray-500 text-sm">Nenhum funil encontrado para os filtros selecionados.</p>
        </div>
      ) : showFolderGroups ? (
        <div className="space-y-6">
          {folderKeys.map((folder) => {
            const isCollapsed = collapsedFolders.has(folder)
            const label = folder || 'Sem pasta'
            return (
              <div key={folder}>
                <button
                  onClick={() => setCollapsedFolders((prev) => {
                    const next = new Set(prev)
                    next.has(folder) ? next.delete(folder) : next.add(folder)
                    return next
                  })}
                  className="flex items-center gap-2 mb-3 text-sm font-semibold text-gray-700 hover:text-gray-900 transition-colors group"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>
                    <polyline points="6,9 12,15 18,9" />
                  </svg>
                  <span className="text-base">📁</span>
                  {label}
                  <span className="text-xs font-normal text-gray-400">({grouped[folder].length})</span>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {grouped[folder].map(renderCard)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(renderCard)}
        </div>
      )}

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
