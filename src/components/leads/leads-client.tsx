'use client'

import { useState, useTransition, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, ChevronDown, X, Users } from 'lucide-react'
import { enrollLeadsInFunnel, sendBulkWhatsapp, bulkDeleteLeads, bulkAddTag } from '@/app/actions/leads'
import DeleteLeadButton from '@/components/leads/delete-lead-button'

interface Lead {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  status: string
  tags: string[] | null
  funnel_id: string | null
  funnel_name: string | null
  created_at: string
  isPurchaser: boolean
  metadata?: Record<string, unknown> | null
}

interface Props {
  leads: Lead[]
  funnels: { id: string; name: string }[]
  tenantId: string
  waInstances?: { id: string; name: string }[]
}

const statusConfig: Record<string, { label: string; className: string }> = {
  active:       { label: 'Ativo',         className: 'bg-indigo-50 text-indigo-700' },
  converted:    { label: 'Convertido',    className: 'bg-emerald-50 text-emerald-700' },
  unsubscribed: { label: 'Descadastrado', className: 'bg-gray-100 text-gray-600' },
  lost:         { label: 'Perdido',       className: 'bg-red-50 text-red-700' },
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase()
}

function TagDropdown({ allTags, selectedTags, onChange }: {
  allTags: string[]
  selectedTags: Set<string>
  onChange: (tags: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const label = selectedTags.size === 0
    ? 'Todas as tags'
    : `Tags (${selectedTags.size})`

  function toggle(tag: string) {
    const next = new Set(selectedTags)
    next.has(tag) ? next.delete(tag) : next.add(tag)
    onChange(next)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => allTags.length > 0 && setOpen(v => !v)}
        className={`flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 text-xs font-medium border rounded-full transition ${
          selectedTags.size > 0
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
            : allTags.length === 0
              ? 'border-gray-200 bg-white text-gray-400 cursor-default'
              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
        }`}
      >
        {label}
        {selectedTags.size > 0 ? (
          <span
            onClick={e => { e.stopPropagation(); onChange(new Set()) }}
            className="ml-0.5 hover:text-indigo-900"
          >
            <X className="w-3 h-3" />
          </span>
        ) : (
          <ChevronDown className="w-3 h-3 text-gray-400" />
        )}
      </button>
      {open && allTags.length > 0 && (
        <div className="absolute top-full mt-1 left-0 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 min-w-[160px] max-h-56 overflow-y-auto">
          {allTags.map(tag => (
            <label key={tag} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedTags.has(tag)}
                onChange={() => toggle(tag)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
              />
              <span className="text-xs text-gray-700">{tag}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LeadsClient({ leads, funnels, tenantId: _tenantId, waInstances = [] }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [purchaserFilter, setPurchaserFilter] = useState(false)
  const [funnelFilter, setFunnelFilter] = useState<string>('all')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Enroll modal
  const [showEnrollModal, setShowEnrollModal] = useState(false)
  const [enrollFunnelId, setEnrollFunnelId] = useState('')
  const [enrollDelay, setEnrollDelay] = useState('30')
  const [enrollDelayUnit, setEnrollDelayUnit] = useState<'seconds' | 'minutes'>('seconds')
  const [enrollResult, setEnrollResult] = useState<{ success?: boolean; error?: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  // WA modal
  const [showMessageModal, setShowMessageModal] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [messageInstanceId, setMessageInstanceId] = useState('')
  const [messagePending, setMessagePending] = useState(false)
  const [messageResult, setMessageResult] = useState<{ success?: boolean; sent?: number; failed?: number; error?: string } | null>(null)
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Add tag modal
  const [showTagModal, setShowTagModal] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [tagResult, setTagResult] = useState<{ success?: boolean; error?: string } | null>(null)
  const [tagPending, setTagPending] = useState(false)

  // Delete confirm modal
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [deleteResult, setDeleteResult] = useState<{ success?: boolean; error?: string } | null>(null)

  const allTags = useMemo(() => {
    const s = new Set<string>()
    leads.forEach(l => l.tags?.forEach(t => s.add(t)))
    return Array.from(s).sort()
  }, [leads])

  const filtered = useMemo(() => {
    return leads.filter(lead => {
      if (search) {
        const q = search.toLowerCase()
        const match = (lead.name ?? '').toLowerCase().includes(q)
          || (lead.phone ?? '').toLowerCase().includes(q)
          || (lead.email ?? '').toLowerCase().includes(q)
        if (!match) return false
      }
      if (statusFilter !== 'all' && lead.status !== statusFilter) return false
      if (purchaserFilter && !lead.isPurchaser) return false
      if (funnelFilter !== 'all' && lead.funnel_id !== funnelFilter) return false
      if (selectedTags.size > 0) {
        const lt = lead.tags ?? []
        if (!Array.from(selectedTags).some(t => lt.includes(t))) return false
      }
      return true
    })
  }, [leads, search, statusFilter, purchaserFilter, funnelFilter, selectedTags])

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(l => l.id)))
    }
  }

  function insertVariable(variable: string) {
    const el = messageTextareaRef.current
    if (!el) { setMessageText(t => t + variable); return }
    const start = el.selectionStart ?? messageText.length
    const end = el.selectionEnd ?? messageText.length
    const next = messageText.slice(0, start) + variable + messageText.slice(end)
    setMessageText(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + variable.length
      el.setSelectionRange(pos, pos)
    })
  }

  function openMessageModal() {
    setMessageInstanceId(waInstances[0]?.id ?? '')
    setMessageText('')
    setMessageResult(null)
    setShowMessageModal(true)
  }

  async function handleSendMessage() {
    if (!messageText.trim() || !messageInstanceId) return
    setMessagePending(true)
    setMessageResult(null)
    try {
      const result = await sendBulkWhatsapp(Array.from(selected), messageText, messageInstanceId)
      setMessageResult(result)
      if (result.success) {
        setTimeout(() => { setShowMessageModal(false); setMessageResult(null) }, 2000)
      }
    } finally {
      setMessagePending(false)
    }
  }

  function openEnrollModal() {
    setEnrollFunnelId(funnels[0]?.id ?? '')
    setEnrollResult(null)
    setShowEnrollModal(true)
  }

  function handleEnroll() {
    const delaySeconds = enrollDelayUnit === 'minutes'
      ? Number(enrollDelay) * 60
      : Number(enrollDelay)
    startTransition(async () => {
      const result = await enrollLeadsInFunnel(Array.from(selected), enrollFunnelId, delaySeconds)
      setEnrollResult(result)
      if (result.success) {
        setSelected(new Set())
        setTimeout(() => { setShowEnrollModal(false); setEnrollResult(null); router.refresh() }, 1500)
      }
    })
  }

  async function handleAddTag() {
    if (!newTag.trim()) return
    setTagPending(true)
    setTagResult(null)
    try {
      const result = await bulkAddTag(Array.from(selected), newTag.trim())
      setTagResult(result)
      if (result.success) {
        setTimeout(() => { setShowTagModal(false); setNewTag(''); setTagResult(null); router.refresh() }, 1200)
      }
    } finally {
      setTagPending(false)
    }
  }

  async function handleDelete() {
    setDeletePending(true)
    setDeleteResult(null)
    try {
      const result = await bulkDeleteLeads(Array.from(selected))
      setDeleteResult(result)
      if (result.success) {
        setSelected(new Set())
        setTimeout(() => { setShowDeleteModal(false); setDeleteResult(null); router.refresh() }, 1200)
      }
    } finally {
      setDeletePending(false)
    }
  }

  const hasActiveFilters = statusFilter !== 'all' || purchaserFilter || funnelFilter !== 'all' || selectedTags.size > 0 || search
  const allSelected = filtered.length > 0 && selected.size === filtered.length
  const someSelected = selected.size > 0

  return (
    <div className="max-w-6xl mx-auto pb-32">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} de {leads.length} leads</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou e-mail…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white transition"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Status */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="appearance-none pl-3 pr-7 py-1.5 text-xs font-medium border border-gray-200 rounded-full bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer"
            >
              <option value="all">Todos os status</option>
              <option value="active">Ativo</option>
              <option value="converted">Convertido</option>
              <option value="lost">Perdido</option>
              <option value="unsubscribed">Descadastrado</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
          </div>
          {/* Funil */}
          {funnels.length > 0 && (
            <div className="relative">
              <select
                value={funnelFilter}
                onChange={e => setFunnelFilter(e.target.value)}
                className="appearance-none pl-3 pr-7 py-1.5 text-xs font-medium border border-gray-200 rounded-full bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300 cursor-pointer"
              >
                <option value="all">Todos os funis</option>
                {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
            </div>
          )}
          {/* Tags — always visible */}
          <TagDropdown allTags={allTags} selectedTags={selectedTags} onChange={setSelectedTags} />
          {/* Compradores */}
          <button
            onClick={() => setPurchaserFilter(v => !v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
              purchaserFilter ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            🔥 Compradores
          </button>
          {/* Clear */}
          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(''); setStatusFilter('all'); setPurchaserFilter(false); setFunnelFilter('all'); setSelectedTags(new Set()) }}
              className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-full border border-gray-200 hover:border-gray-300 flex items-center gap-1 transition"
            >
              <X className="w-3 h-3" /> Limpar filtros
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-indigo-400" />
          </div>
          <p className="text-gray-700 font-semibold text-base mb-1">{leads.length === 0 ? 'Nenhum lead ainda' : 'Nenhum lead encontrado'}</p>
          <p className="text-gray-400 text-sm">{leads.length === 0 ? 'Os leads aparecerão aqui quando alguém entrar no funil.' : 'Tente ajustar os filtros de busca.'}</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map(lead => {
              const st = statusConfig[lead.status] ?? statusConfig.active
              const isSelected = selected.has(lead.id)
              return (
                <div key={lead.id} className={`bg-white rounded-xl border p-4 transition ${isSelected ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-gray-200'}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(lead.id)} className="mt-1 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                    {typeof lead.metadata?.ig_profile_pic === 'string' ? <img src={lead.metadata.ig_profile_pic as string} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" /> : <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center shrink-0 text-indigo-700 font-bold text-xs">{getInitials(lead.name)}</div>}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 text-sm truncate">{lead.name ?? '—'}</p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.className}`}>{st.label}</span>
                        {lead.isPurchaser && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">🔥 Comprador</span>}
                      </div>
                      {lead.phone && <p className="text-xs text-gray-500 mt-0.5">{lead.phone}</p>}
                      {lead.funnel_name && <span className="mt-1 inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{lead.funnel_name}</span>}
                      {(lead.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {(lead.tags ?? []).slice(0, 2).map(tag => <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{tag}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                    <span className="text-xs text-gray-400">{new Date(lead.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
                    <div className="flex items-center gap-2">
                      <Link href={`/leads/${lead.id}`} className="text-xs font-medium text-indigo-600 hover:underline">Ver detalhes →</Link>
                      <DeleteLeadButton leadId={lead.id} leadName={lead.name} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3.5 w-10"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" /></th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lead</th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Funil</th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tags</th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Criado</th>
                  <th className="px-4 py-3.5 w-28"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(lead => {
                  const st = statusConfig[lead.status] ?? statusConfig.active
                  const isSelected = selected.has(lead.id)
                  return (
                    <tr key={lead.id} className={`transition-colors ${isSelected ? 'bg-indigo-50/40' : 'hover:bg-gray-50'}`}>
                      <td className="px-4 py-3.5"><input type="checkbox" checked={isSelected} onChange={() => toggleSelect(lead.id)} className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" /></td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          {typeof lead.metadata?.ig_profile_pic === 'string'
                            ? <img src={lead.metadata.ig_profile_pic as string} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                            : <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center shrink-0 text-indigo-700 font-bold text-xs select-none">{getInitials(lead.name)}</div>}
                          <div>
                            <p className="font-medium text-gray-900 leading-none mb-0.5">
                              {lead.name ?? '—'}
                              {lead.metadata?.source === 'instagram' && <span className="ml-1.5 text-[10px] font-semibold text-pink-500">IG</span>}
                            </p>
                            <p className="text-xs text-gray-400">{lead.phone ?? lead.email ?? (typeof lead.metadata?.ig_username === 'string' ? `@${lead.metadata.ig_username}` : '')}</p>
                          </div>
                          {lead.isPurchaser && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">🔥</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">{lead.funnel_name ? <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{lead.funnel_name}</span> : <span className="text-gray-300 text-xs">—</span>}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {(lead.tags ?? []).slice(0, 2).map(tag => <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{tag}</span>)}
                          {(lead.tags ?? []).length > 2 && <span className="text-xs text-gray-400">+{(lead.tags ?? []).length - 2}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5"><span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${st.className}`}>{st.label}</span></td>
                      <td className="px-4 py-3.5 text-xs text-gray-400">{new Date(lead.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/leads/${lead.id}`} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline whitespace-nowrap">Ver detalhes →</Link>
                          <DeleteLeadButton leadId={lead.id} leadName={lead.name} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-gray-900 text-white px-4 md:px-6 py-3.5 flex items-center justify-between shadow-2xl">
          <span className="text-sm font-medium shrink-0">{selected.size} lead{selected.size !== 1 ? 's' : ''} selecionado{selected.size !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {waInstances.length > 0 && (
              <button onClick={openMessageModal} className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 rounded-lg transition whitespace-nowrap">💬 Enviar mensagem WA</button>
            )}
            <button onClick={openEnrollModal} className="px-3.5 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 rounded-lg transition whitespace-nowrap">🔀 Adicionar ao funil</button>
            <button onClick={() => { setNewTag(''); setTagResult(null); setShowTagModal(true) }} className="px-3.5 py-2 text-xs font-semibold bg-gray-700 hover:bg-gray-600 rounded-lg transition whitespace-nowrap">🏷 Adicionar tag</button>
            <button onClick={() => { setDeleteResult(null); setShowDeleteModal(true) }} className="px-3.5 py-2 text-xs font-semibold bg-red-600 hover:bg-red-500 rounded-lg transition whitespace-nowrap">🗑 Deletar</button>
            <button onClick={() => setSelected(new Set())} className="px-3 py-2 text-xs font-medium text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* WA Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Enviar WhatsApp em massa</h2>
              <button onClick={() => setShowMessageModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {messageResult?.success ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-emerald-600 text-xl">✓</span></div>
                <p className="font-semibold text-gray-900">Mensagens enviadas!</p>
                <p className="text-sm text-gray-500 mt-1">{messageResult.sent} enviadas · {messageResult.failed} falhas</p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  {waInstances.length > 1 && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">Instância WhatsApp</label>
                      <div className="relative">
                        <select value={messageInstanceId} onChange={e => setMessageInstanceId(e.target.value)} className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                          {waInstances.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Mensagem</label>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {['{nome}', '{primeiro_nome}', '{telefone}', '{email}'].map(v => (
                        <button
                          key={v}
                          onClick={() => insertVariable(v)}
                          className="px-2 py-0.5 text-xs font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 transition"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                    <textarea
                      ref={messageTextareaRef}
                      value={messageText}
                      onChange={e => setMessageText(e.target.value)}
                      rows={4}
                      placeholder={`Olá {primeiro_nome}! Temos uma oferta especial para você…`}
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none"
                    />
                  </div>
                  {messageText && (
                    <div className="bg-[#ECE5DD] rounded-xl p-3">
                      <p className="text-xs font-semibold text-gray-500 mb-2">Pré-visualização</p>
                      <div className="bg-[#DCF8C6] rounded-xl rounded-tl-none px-3 py-2 text-sm text-gray-800 inline-block max-w-full whitespace-pre-wrap break-words shadow-sm">
                        {messageText}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                    Enviar para <strong>{selected.size} lead{selected.size !== 1 ? 's' : ''}</strong> · intervalo 2s entre envios
                  </p>
                  {messageResult?.error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">Erro: {messageResult.error}</div>}
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setShowMessageModal(false)} disabled={messagePending} className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition disabled:opacity-50">Cancelar</button>
                  <button onClick={handleSendMessage} disabled={messagePending || !messageText.trim() || !messageInstanceId} className="flex-1 px-4 py-2.5 text-sm font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition disabled:opacity-50">{messagePending ? 'Enviando…' : 'Enviar'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Enroll Modal */}
      {showEnrollModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Adicionar ao Funil</h2>
              <button onClick={() => setShowEnrollModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {enrollResult?.success ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-emerald-600 text-xl">✓</span></div>
                <p className="font-semibold text-gray-900">Leads adicionados!</p>
                <p className="text-sm text-gray-500 mt-1">{selected.size} leads foram enfileirados no funil.</p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Funil de destino</label>
                    <div className="relative">
                      <select value={enrollFunnelId} onChange={e => setEnrollFunnelId(e.target.value)} className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                        {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Intervalo entre leads</label>
                    <div className="flex gap-2">
                      <input type="number" min="0" value={enrollDelay} onChange={e => setEnrollDelay(e.target.value)} className="flex-1 px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                      <div className="relative">
                        <select value={enrollDelayUnit} onChange={e => setEnrollDelayUnit(e.target.value as 'seconds' | 'minutes')} className="appearance-none pl-3 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                          <option value="seconds">segundos</option>
                          <option value="minutes">minutos</option>
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">
                      Os <strong>{selected.size}</strong> leads serão adicionados com <strong>{enrollDelay} {enrollDelayUnit === 'seconds' ? 'segundo(s)' : 'minuto(s)'}</strong> de intervalo.
                    </p>
                  </div>
                  <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                    Adicionar <strong>{selected.size} lead{selected.size !== 1 ? 's' : ''}</strong> ao funil{' '}
                    <strong>{funnels.find(f => f.id === enrollFunnelId)?.name}</strong>?
                  </p>
                  {enrollResult?.error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">Erro: {enrollResult.error}</div>}
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setShowEnrollModal(false)} disabled={isPending} className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition disabled:opacity-50">Cancelar</button>
                  <button onClick={handleEnroll} disabled={isPending || !enrollFunnelId} className="flex-1 px-4 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-50">{isPending ? 'Adicionando…' : 'Confirmar'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Tag Modal */}
      {showTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Adicionar tag</h2>
              <button onClick={() => setShowTagModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {tagResult?.success ? (
              <div className="text-center py-4">
                <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2"><span className="text-emerald-600">✓</span></div>
                <p className="font-semibold text-gray-900 text-sm">Tag adicionada!</p>
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newTag}
                    onChange={e => setNewTag(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                    placeholder="Ex: quente, interessado, follow-up…"
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    autoFocus
                  />
                  {allTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {allTags.map(t => (
                        <button key={t} onClick={() => setNewTag(t)} className={`px-2.5 py-1 text-xs rounded-full border transition ${
                          newTag === t ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}>{t}</button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-gray-500">Será adicionada a <strong>{selected.size} lead{selected.size !== 1 ? 's' : ''}</strong>.</p>
                  {tagResult?.error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{tagResult.error}</div>}
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setShowTagModal(false)} disabled={tagPending} className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition disabled:opacity-50">Cancelar</button>
                  <button onClick={handleAddTag} disabled={tagPending || !newTag.trim()} className="flex-1 px-4 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-50">{tagPending ? 'Salvando…' : 'Adicionar'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">Confirmar exclusão</h2>
              <button onClick={() => setShowDeleteModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {deleteResult?.success ? (
              <div className="text-center py-4">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-2"><span className="text-red-600">✓</span></div>
                <p className="font-semibold text-gray-900 text-sm">Leads excluídos.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-1">
                  Tem certeza que deseja excluir <strong>{selected.size} lead{selected.size !== 1 ? 's' : ''}</strong>?
                </p>
                <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-5">Esta ação é irreversível. Os dados e histórico serão perdidos permanentemente.</p>
                {deleteResult?.error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 mb-3">{deleteResult.error}</div>}
                <div className="flex gap-3">
                  <button onClick={() => setShowDeleteModal(false)} disabled={deletePending} className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition disabled:opacity-50">Cancelar</button>
                  <button onClick={handleDelete} disabled={deletePending} className="flex-1 px-4 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-xl hover:bg-red-700 transition disabled:opacity-50">{deletePending ? 'Excluindo…' : 'Excluir'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
