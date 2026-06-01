'use client'

import React, { useMemo, useRef, useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Globe } from 'lucide-react'
import DeleteFunnelButton from './delete-funnel-button'
import SaveAsTemplateModal from '@/components/templates/save-as-template-modal'
import { pauseFunnel, resumeFunnel, duplicateFunnel, updateFunnelFolder } from '@/app/actions/funnels'
import type { Funnel } from '@/types'

const STATUS_CFG: Record<string, { label: string; badgeStyle: React.CSSProperties; gradient: string; iconColor: string }> = {
  published: {
    label: 'Publicado',
    badgeStyle: { backgroundColor: '#DCFCE7', color: '#16A34A' },
    gradient: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
    iconColor: 'rgba(255,255,255,0.85)',
  },
  paused: {
    label: 'Pausado',
    badgeStyle: { backgroundColor: '#FEF9C3', color: '#CA8A04' },
    gradient: 'linear-gradient(135deg, #64748B 0%, #94A3B8 100%)',
    iconColor: 'rgba(255,255,255,0.65)',
  },
  draft: {
    label: 'Rascunho',
    badgeStyle: { backgroundColor: '#F1F5F9', color: '#64748B' },
    gradient: 'linear-gradient(135deg, #E2E8F0 0%, #F1F5F9 100%)',
    iconColor: '#94A3B8',
  },
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m}min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

function fmtRevenue(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

function CardMenu({ funnelId, funnelName, status, onDuplicate, onPause, onResume, onTemplate, onDeleted }: {
  funnelId: string; funnelName: string; status: string
  onDuplicate: () => void; onPause: () => void; onResume: () => void
  onTemplate: () => void; onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function h(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const menuItemClass = "w-full text-left flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition-colors"
  const menuItemStyle: React.CSSProperties = { color: '#334155' }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="p-2 rounded-lg transition-colors"
        style={{ border: '1px solid #E2E8F0', color: '#64748B', backgroundColor: open ? '#F8FAFC' : 'transparent' }}
        title="Mais opções"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
          <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          className="animate-modal-in absolute bottom-full right-0 mb-1.5 rounded-xl overflow-hidden z-50"
          style={{ width: 180, backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', boxShadow: '0 10px 30px rgba(0,0,0,0.10)' }}
        >
          <button
            className={menuItemClass}
            style={menuItemStyle}
            onClick={() => { onDuplicate(); setOpen(false) }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-400 shrink-0">
              <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Duplicar
          </button>

          {status === 'published' && (
            <button
              className={menuItemClass}
              style={menuItemStyle}
              onClick={() => { onPause(); setOpen(false) }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-400 shrink-0">
                <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
              </svg>
              Pausar
            </button>
          )}
          {status === 'paused' && (
            <button
              className={menuItemClass}
              style={menuItemStyle}
              onClick={() => { onResume(); setOpen(false) }}
              onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'}
              onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-400 shrink-0">
                <polygon points="5,3 19,12 5,21 5,3" />
              </svg>
              Retomar
            </button>
          )}

          <button
            className={menuItemClass}
            style={menuItemStyle}
            onClick={() => { onTemplate(); setOpen(false) }}
            onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'}
            onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-400 shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
            </svg>
            Salvar como template
          </button>

          <div style={{ height: 1, backgroundColor: '#F1F5F9', margin: '2px 0' }} />

          <DeleteFunnelButton
            funnelId={funnelId}
            funnelName={funnelName}
            isPublished={status === 'published'}
            onDeleted={() => { onDeleted(); setOpen(false) }}
            inline
          />
        </div>
      )}
    </div>
  )
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
}: Props) {
  const router = useRouter()
  const [funnels, setFunnels] = useState(initialFunnels)
  const [templateFunnel, setTemplateFunnel] = useState<Funnel | null>(null)
  const [, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sort, setSort] = useState<'recent' | 'leads' | 'name'>('recent')
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
    if (statusFilter !== 'all') list = list.filter((f) => f.status === statusFilter)
    if (sort === 'recent') list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
    else if (sort === 'leads') list = [...list].sort((a, b) => (leadsCountMap[b.id] ?? 0) - (leadsCountMap[a.id] ?? 0))
    else if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'pt'))
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

  const existingFolders = useMemo(() =>
    [...new Set(funnels.map((f) => f.folder).filter((f): f is string => !!f))],
    [funnels]
  )

  const folderKeys = useMemo(() =>
    Object.keys(grouped).sort((a, b) => {
      if (a === '' && b !== '') return 1
      if (b === '' && a !== '') return -1
      return a.localeCompare(b, 'pt')
    }),
    [grouped]
  )

  const showFolderGroups = folderKeys.length > 1 || (folderKeys.length === 1 && folderKeys[0] !== '')

  const handlePause = (id: string) => {
    startTransition(async () => {
      await pauseFunnel(id)
      setFunnels((prev) => prev.map((f) => f.id === id ? { ...f, status: 'paused' } : f))
    })
  }
  const handleResume = (id: string) => {
    startTransition(async () => {
      await resumeFunnel(id)
      setFunnels((prev) => prev.map((f) => f.id === id ? { ...f, status: 'published' } : f))
    })
  }
  const handleDuplicate = (id: string) => {
    startTransition(async () => {
      const result = await duplicateFunnel(id)
      if (result.success && result.newId) router.push(`/funnels/${result.newId}/builder`)
    })
  }
  const handleMoveFolder = (id: string, folder: string | null) => {
    startTransition(async () => {
      await updateFunnelFolder(id, folder)
      setFunnels((prev) => prev.map((f) => f.id === id ? { ...f, folder } : f))
    })
    setFolderMenuId(null)
    setNewFolderInputId(null)
  }
  const handleNewFolder = (id: string) => {
    if (!newFolderName.trim()) return
    handleMoveFolder(id, newFolderName.trim())
    setNewFolderName('')
  }

  if (funnels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24" style={{ border: '2px dashed #E2E8F0', borderRadius: 16, backgroundColor: '#FFFFFF' }}>
        <div className="mb-6">
          <svg viewBox="0 0 120 100" fill="none" className="w-28 h-24">
            <rect x="10" y="10" width="100" height="80" rx="12" stroke="#E2E8F0" strokeWidth="2" />
            <path d="M30 32h60" stroke="#CBD5E1" strokeWidth="2" strokeLinecap="round" />
            <path d="M30 32l20 24v18l-8-4V56L30 32z" stroke="#CBD5E1" strokeWidth="2" strokeLinejoin="round" />
            <path d="M90 32L70 56v18l8-4V56L90 32z" stroke="#CBD5E1" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="90" cy="72" r="14" fill="#6366F1" />
            <line x1="90" y1="66" x2="90" y2="78" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="84" y1="72" x2="96" y2="72" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
        <h3 className="font-semibold text-[17px] mb-1.5" style={{ color: '#0F172A' }}>Crie seu primeiro funil</h3>
        <p className="text-[14px] text-center max-w-xs leading-relaxed" style={{ color: '#64748B' }}>
          Automatize suas vendas e acompanhe cada lead da entrada à compra.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <div className="relative flex-1 min-w-[180px]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#94A3B8' }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar funis..."
            className="w-full pl-9 pr-3 h-10 text-[14px] rounded-lg outline-none transition-colors"
            style={{ border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', color: '#334155' }}
            onFocus={(e) => (e.target.style.borderColor = '#6366F1')}
            onBlur={(e) => (e.target.style.borderColor = '#E2E8F0')}
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg" style={{ backgroundColor: '#F1F5F9' }}>
          {(['all', 'published', 'paused', 'draft'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className="text-[13px] px-3 py-1.5 rounded-md font-medium transition-all"
              style={{
                backgroundColor: statusFilter === s ? '#FFFFFF' : 'transparent',
                color: statusFilter === s ? '#1E293B' : '#64748B',
                boxShadow: statusFilter === s ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              }}
            >
              {s === 'all' ? 'Todos' : s === 'published' ? 'Publicado' : s === 'paused' ? 'Pausado' : 'Rascunho'}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="h-10 text-[13px] rounded-lg px-3 outline-none"
          style={{ border: '1px solid #E2E8F0', backgroundColor: '#FFFFFF', color: '#334155' }}
        >
          <option value="recent">Mais recentes</option>
          <option value="leads">Mais leads</option>
          <option value="name">Nome A-Z</option>
        </select>
        <span className="text-[13px]" style={{ color: '#94A3B8' }}>{filtered.length} funil{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-[14px]" style={{ color: '#94A3B8' }}>
          Nenhum funil encontrado para os filtros selecionados.
        </div>
      )}

      {folderKeys.map((folderKey) => (
        <div key={folderKey} className="mb-8">
          {showFolderGroups && (
            <button
              onClick={() => setCollapsedFolders((prev) => {
                const next = new Set(prev)
                if (next.has(folderKey)) next.delete(folderKey)
                else next.add(folderKey)
                return next
              })}
              className="flex items-center gap-2 mb-4 transition-colors hover:opacity-80"
              style={{ color: '#475569' }}
            >
              <svg
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                className={`w-4 h-4 transition-transform ${collapsedFolders.has(folderKey) ? '-rotate-90' : ''}`}
              >
                <polyline points="6,9 12,15 18,9" />
              </svg>
              <span className="text-[14px] font-semibold">
                {folderKey === '' ? '📂 Sem pasta' : `📁 ${folderKey}`}
              </span>
              <span className="text-[13px] font-normal" style={{ color: '#94A3B8' }}>({grouped[folderKey].length})</span>
            </button>
          )}

          {!collapsedFolders.has(folderKey) && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {grouped[folderKey].map((funnel) => {
                const cfg = STATUS_CFG[funnel.status] ?? STATUS_CFG.draft
                const waInst = funnel.whatsapp_instance_id ? (waMap[funnel.whatsapp_instance_id] ?? null) : null
                const leads = leadsCountMap[funnel.id] ?? 0
                const sales = salesCountMap[funnel.id] ?? 0
                const revenue = revenueMap[funnel.id] ?? 0
                const lastActivity = lastActivityMap[funnel.id] ?? null
                const convRate = leads > 0 ? Math.round((sales / leads) * 100) : 0

                return (
                  <div
                    key={funnel.id}
                    className="rounded-xl flex flex-col"
                    style={{
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      transition: 'transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease',
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLElement
                      el.style.borderColor = '#CBD5E1'
                      el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.07)'
                      el.style.transform = 'translateY(-1px)'
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLElement
                      el.style.borderColor = '#E2E8F0'
                      el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'
                      el.style.transform = 'translateY(0)'
                    }}
                  >
                    {/* Thumbnail */}
                    <div
                      className="relative flex items-center justify-center rounded-t-xl overflow-hidden"
                      style={{ height: 110, background: cfg.gradient }}
                    >
                      <svg viewBox="0 0 40 40" fill="none" className="w-11 h-11" style={{ color: cfg.iconColor }}>
                        <path d="M4 8h32l-12 14.4V32l-8-4V22.4L4 8z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                      </svg>
                      <span
                        className="absolute top-3 right-3 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                        style={{ ...cfg.badgeStyle, letterSpacing: '0.2px' }}
                      >
                        {cfg.label}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="px-4 pt-3.5 pb-3 flex-1 flex flex-col gap-2">
                      <div>
                        <h2 className="font-semibold text-[14px] leading-snug truncate" style={{ color: '#0F172A' }}>
                          {funnel.name}
                        </h2>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {waInst ? (
                            <>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${waInst.status === 'connected' ? 'bg-green-500' : 'bg-red-400'}`} />
                              <span className="text-[12px] truncate" style={{ color: '#64748B' }}>{waInst.instance_name}</span>
                            </>
                          ) : (
                            <span className="text-[12px]" style={{ color: '#94A3B8' }}>Sem WhatsApp</span>
                          )}
                          {lastActivity && (
                            <>
                              <span style={{ color: '#CBD5E1' }}>·</span>
                              <span className="text-[12px]" style={{ color: '#94A3B8' }}>{timeAgo(lastActivity)}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Metrics */}
                      <div className="flex items-center gap-2.5 flex-wrap" style={{ fontSize: 13, color: '#475569', fontWeight: 500 }}>
                        <span className="flex items-center gap-1">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5" style={{ color: '#6366F1' }}>
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                          </svg>
                          {leads}
                        </span>
                        {sales > 0 && (
                          <>
                            <span style={{ color: '#E2E8F0' }}>·</span>
                            <span className="flex items-center gap-1" style={{ color: '#16A34A' }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                                <line x1="12" y1="1" x2="12" y2="23" />
                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                              </svg>
                              {sales} ({convRate}%)
                            </span>
                          </>
                        )}
                        {revenue > 0 && (
                          <>
                            <span style={{ color: '#E2E8F0' }}>·</span>
                            <span className="font-semibold" style={{ color: '#16A34A' }}>{fmtRevenue(revenue)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div
                      className="px-4 pb-4 flex items-center gap-2"
                      style={{ borderTop: '1px solid #F8FAFC', paddingTop: 12 }}
                    >
                      <Link
                        href={`/funnels/${funnel.id}/builder`}
                        className="flex-1 text-center text-[13px] font-medium py-2 rounded-lg transition-colors"
                        style={{ border: '1px solid #6366F1', color: '#6366F1' }}
                        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#EEF2FF'}
                        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                      >
                        Abrir Builder
                      </Link>

                      {/* Folder btn */}
                      <div className="relative">
                        <button
                          onClick={() => setFolderMenuId(folderMenuId === funnel.id ? null : funnel.id)}
                          className="p-2 rounded-lg transition-colors"
                          style={{ border: '1px solid #E2E8F0', color: '#64748B' }}
                          title="Mover para pasta"
                          onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'}
                          onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                        </button>
                        {folderMenuId === funnel.id && (
                          <div
                            className="animate-modal-in absolute bottom-full right-0 mb-1.5 rounded-xl overflow-hidden z-50"
                            style={{ width: 176, backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0', boxShadow: '0 10px 30px rgba(0,0,0,0.10)' }}
                          >
                            <button onClick={() => handleMoveFolder(funnel.id, null)} className="w-full text-left text-[13px] px-3.5 py-2.5 hover:bg-gray-50 transition-colors" style={{ color: '#64748B' }}>
                              📂 Sem pasta
                            </button>
                            {existingFolders.map((folder) => (
                              <button key={folder} onClick={() => handleMoveFolder(funnel.id, folder)} className="w-full text-left text-[13px] px-3.5 py-2.5 hover:bg-gray-50 transition-colors" style={{ color: '#334155' }}>
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
                                  className="flex-1 text-[13px] rounded-lg px-2 py-1 outline-none"
                                  style={{ border: '1px solid #E2E8F0' }}
                                />
                                <button onClick={() => handleNewFolder(funnel.id)} className="text-[12px] px-2 py-1 rounded-lg text-white" style={{ backgroundColor: '#6366F1' }}>✓</button>
                              </div>
                            ) : (
                              <button onClick={() => { setNewFolderInputId(funnel.id); setNewFolderName('') }} className="w-full text-left text-[13px] px-3.5 py-2.5 hover:bg-gray-50 transition-colors" style={{ color: '#6366F1', borderTop: '1px solid #F1F5F9' }}>
                                + Nova pasta
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Globe */}
                      {funnel.page_config && (
                        <a
                          href={`/p/${funnel.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-lg transition-colors"
                          style={{ border: '1px solid #E2E8F0', color: '#16A34A' }}
                          title="Página de captura"
                          onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#F0FDF4'}
                          onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                        >
                          <Globe className="w-4 h-4" />
                        </a>
                      )}

                      {/* ⋯ menu */}
                      <CardMenu
                        funnelId={funnel.id}
                        funnelName={funnel.name}
                        status={funnel.status}
                        onDuplicate={() => handleDuplicate(funnel.id)}
                        onPause={() => handlePause(funnel.id)}
                        onResume={() => handleResume(funnel.id)}
                        onTemplate={() => setTemplateFunnel(funnel)}
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
