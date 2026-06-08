'use client'

import { useState, useTransition, useMemo, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, X, Users, ChevronDown, Tag } from 'lucide-react'
import { enrollLeadsInFunnel, sendBulkWhatsapp, createLeadManual, bulkDeleteLeads, bulkAddTag } from '@/app/actions/leads'
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
  lastEvent?: { event_type: string; created_at: string } | null
}

interface Props {
  leads: Lead[]
  funnels: { id: string; name: string }[]
  tenantId: string
  waInstances?: { id: string; name: string }[]
}

const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700', 'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700', 'bg-orange-100 text-orange-700',
  'bg-pink-100 text-pink-700', 'bg-teal-100 text-teal-700',
  'bg-amber-100 text-amber-700', 'bg-cyan-100 text-cyan-700',
]

function getAvatarColor(name: string | null): string {
  if (!name) return 'bg-gray-100 text-gray-500'
  const code = name.charCodeAt(0) + (name.charCodeAt(name.length - 1) || 0)
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}

function getInitials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].slice(0, 2).toUpperCase()
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `há ${days}d`
  return `há ${Math.floor(days / 30)}m`
}

function interpolate(msg: string, name: string | null): string {
  const firstName = (name ?? '').split(' ')[0]
  return msg.replace(/{nome}/g, name ?? '').replace(/{primeiro_nome}/g, firstName)
}

const EVENT_LABELS: Record<string, string> = {
  entered_funnel: 'Entrou no funil',
  message_sent: 'Mensagem enviada',
  message_opened: 'Mensagem aberta',
  message_clicked: 'Link clicado',
  replied: 'Respondeu',
  purchased: 'Compra realizada',
  purchased_order_bump: 'Order Bump',
  purchased_upsell: 'Upsell',
  delay_scheduled: 'Atraso agendado',
  tag_added: 'Tag adicionada',
  agent_activated: 'Agente IA ativado',
  funnel_completed: 'Funil concluído',
  cart_abandoned: 'Carrinho abandonado',
  page_viewed: 'Página visualizada',
  page_button_clicked: 'Botão clicado',
  unsubscribed: 'Descadastrou',
}

const STATUS_OPTIONS = [
  { value: 'all',         label: 'Todos os status' },
  { value: 'active',      label: 'Ativo' },
  { value: 'converted',   label: 'Convertido' },
  { value: 'lost',        label: 'Perdido' },
  { value: 'unsubscribed',label: 'Descadastrado' },
]

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active:       { label: 'Ativo',         className: 'bg-[#EEF2FF] text-[#4F46E5]' },
  converted:    { label: 'Convertido',    className: 'bg-[#DCFCE7] text-[#16A34A]' },
  unsubscribed: { label: 'Descadastrado', className: 'bg-[#F1F5F9] text-[#64748B]' },
  lost:         { label: 'Perdido',       className: 'bg-[#FEE2E2] text-[#DC2626]' },
}

function exportCSV(leads: Lead[]) {
  const rows = [
    ['Nome', 'Telefone', 'Email', 'Funil', 'Status', 'Tags', 'Criado'],
    ...leads.map(l => [
      l.name ?? '', l.phone ?? '', l.email ?? '', l.funnel_name ?? '', l.status,
      (l.tags ?? []).join('; '),
      new Date(l.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    ]),
  ]
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `leads-${new Date().toISOString().split('T')[0]}.csv`; a.click()
  URL.revokeObjectURL(url)
}

// Multi-tag dropdown component
function TagDropdown({ allTags, selectedTags, onChange }: {
  allTags: string[]
  selectedTags: Set<string>
  onChange: (tags: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (allTags.length === 0) return null

  const count = selectedTags.size

  function toggle(tag: string) {
    const next = new Set(selectedTags)
    next.has(tag) ? next.delete(tag) : next.add(tag)
    onChange(next)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 text-xs font-medium border rounded-full transition ${
          count > 0
            ? 'bg-violet-600 text-white border-violet-600'
            : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
        }`}
      >
        <Tag className="w-3 h-3" />
        {count > 0 ? `Tags (${count})` : 'Todas as tags'}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-30 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[180px] py-1.5">
          {allTags.map(tag => (
            <label key={tag} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedTags.has(tag)}
                onChange={() => toggle(tag)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-violet-600 focus:ring-violet-400 cursor-pointer"
              />
              <span className="text-xs text-gray-700">{tag}</span>
            </label>
          ))}
          {count > 0 && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => { onChange(new Set()); setOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 flex items-center gap-1.5"
              >
                <X className="w-3 h-3" /> Limpar tags
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function LeadsClient({ leads, funnels, tenantId, waInstances = [] }: Props) {
  const router = useRouter()
  void tenantId

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [funnelFilter, setFunnelFilter] = useState('all')
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set())
  const [buyersOnly, setBuyersOnly] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Enroll modal
  const [showEnrollModal, setShowEnrollModal] = useState(false)
  const [enrollFunnelId, setEnrollFunnelId] = useState('')
  const [enrollResult, setEnrollResult] = useState<{ success?: boolean; error?: string } | null>(null)
  const [isPending, startTransition] = useTransition()

  // WA modal
  const [showMessageModal, setShowMessageModal] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [messageInstanceId, setMessageInstanceId] = useState('')
  const [messagePending, setMessagePending] = useState(false)
  const [messageResult, setMessageResult] = useState<{ success?: boolean; sent?: number; failed?: number; error?: string } | null>(null)

  // Add lead modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [addName, setAddName] = useState('')
  const [addPhone, setAddPhone] = useState('')
  const [addEmail, setAddEmail] = useState('')
  const [addPending, startAddTransition] = useTransition()
  const [addResult, setAddResult] = useState<{ success?: boolean; error?: string } | null>(null)

  // Add tag modal
  const [showTagModal, setShowTagModal] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tagPending, startTagTransition] = useTransition()
  const [tagResult, setTagResult] = useState<{ success?: boolean; error?: string } | null>(null)

  // Delete confirm
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletePending, startDeleteTransition] = useTransition()

  const allTags = useMemo(() => {
    const s = new Set<string>()
    leads.forEach(l => l.tags?.forEach(t => s.add(t)))
    return Array.from(s).sort()
  }, [leads])

  const filtered = useMemo(() => {
    return leads.filter(lead => {
      if (search) {
        const q = search.toLowerCase()
        if (!(lead.name ?? '').toLowerCase().includes(q) &&
            !(lead.phone ?? '').toLowerCase().includes(q) &&
            !(lead.email ?? '').toLowerCase().includes(q)) return false
      }
      if (buyersOnly && !lead.isPurchaser) return false
      if (statusFilter !== 'all' && lead.status !== statusFilter) return false
      if (funnelFilter !== 'all' && lead.funnel_id !== funnelFilter) return false
      if (selectedTags.size > 0) {
        const leadTags = lead.tags ?? []
        if (!Array.from(selectedTags).some(t => leadTags.includes(t))) return false
      }
      return true
    })
  }, [leads, search, statusFilter, funnelFilter, selectedTags, buyersOnly])

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAll() {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(l => l.id)))
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
      if (result.success) setTimeout(() => { setShowMessageModal(false); setMessageResult(null) }, 2500)
    } finally { setMessagePending(false) }
  }

  function handleEnroll() {
    startTransition(async () => {
      const result = await enrollLeadsInFunnel(Array.from(selected), enrollFunnelId, 2)
      setEnrollResult(result)
      if (result.success) {
        setSelected(new Set())
        setTimeout(() => { setShowEnrollModal(false); setEnrollResult(null); router.refresh() }, 1500)
      }
    })
  }

  function handleAddLead() {
    if (!addName.trim() && !addPhone.trim()) return
    startAddTransition(async () => {
      const result = await createLeadManual(addName, addPhone, addEmail)
      setAddResult(result)
      if (result.success) {
        setTimeout(() => { setShowAddModal(false); setAddResult(null); setAddName(''); setAddPhone(''); setAddEmail(''); router.refresh() }, 1200)
      }
    })
  }

  function handleAddTag() {
    if (!tagInput.trim()) return
    startTagTransition(async () => {
      const result = await bulkAddTag(Array.from(selected), tagInput.trim())
      setTagResult(result)
      if (result.success) {
        setTimeout(() => { setShowTagModal(false); setTagResult(null); setTagInput(''); router.refresh() }, 1200)
      }
    })
  }

  function handleBulkDelete() {
    startDeleteTransition(async () => {
      await bulkDeleteLeads(Array.from(selected))
      setSelected(new Set())
      setShowDeleteConfirm(false)
      router.refresh()
    })
  }

  const hasActiveFilters = statusFilter !== 'all' || funnelFilter !== 'all' || selectedTags.size > 0 || buyersOnly || !!search
  const allSelected = filtered.length > 0 && selected.size === filtered.length

  // Preview for first lead in selection
  const previewLead = leads.find(l => selected.has(l.id))
  const messagePreview = messageText ? interpolate(messageText, previewLead?.name ?? 'Lead') : ''

  return (
    <div className="max-w-6xl mx-auto pb-32">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <span className="px-2.5 py-0.5 rounded-full bg-violet-100 text-violet-700 text-xs font-bold">
            {filtered.length.toLocaleString('pt-BR')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => exportCSV(filtered)}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            Exportar CSV
          </button>
          <button
            onClick={() => { setAddName(''); setAddPhone(''); setAddEmail(''); setAddResult(null); setShowAddModal(true) }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Adicionar lead
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou e-mail…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full h-11 pl-10 pr-10 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:bg-white transition"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status dropdown */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className={`appearance-none pl-3 pr-7 py-1.5 text-xs font-medium border rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 transition ${
                statusFilter !== 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200'
              }`}
            >
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown className={`absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none ${statusFilter !== 'all' ? 'text-white' : 'text-gray-400'}`} />
          </div>

          {/* Funnel dropdown */}
          {funnels.length > 0 && (
            <div className="relative">
              <select
                value={funnelFilter}
                onChange={e => setFunnelFilter(e.target.value)}
                className={`appearance-none pl-3 pr-7 py-1.5 text-xs font-medium border rounded-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-300 transition ${
                  funnelFilter !== 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200'
                }`}
              >
                <option value="all">Todos os funis</option>
                {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <ChevronDown className={`absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none ${funnelFilter !== 'all' ? 'text-white' : 'text-gray-400'}`} />
            </div>
          )}

          {/* Multi-tag dropdown */}
          <TagDropdown allTags={allTags} selectedTags={selectedTags} onChange={setSelectedTags} />

          {/* Buyers toggle */}
          <button
            onClick={() => setBuyersOnly(b => !b)}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-full border transition ${
              buyersOnly ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}
          >
            🔥 Compradores
          </button>

          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(''); setStatusFilter('all'); setFunnelFilter('all'); setSelectedTags(new Set()); setBuyersOnly(false) }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 rounded-full border border-gray-200 hover:border-gray-300 transition"
            >
              <X className="w-3 h-3" /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Table / Empty state */}
      {filtered.length === 0 ? (
        <div className="text-center py-24 bg-white border border-gray-200 rounded-2xl">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-indigo-400" />
          </div>
          <p className="text-gray-700 font-semibold text-base mb-1">
            {leads.length === 0 ? 'Nenhum lead ainda' : 'Nenhum lead encontrado'}
          </p>
          <p className="text-gray-400 text-sm">
            {leads.length === 0 ? 'Os leads aparecerão aqui quando alguém entrar no funil.' : 'Tente ajustar os filtros de busca.'}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filtered.map(lead => {
              const st = STATUS_BADGE[lead.status] ?? STATUS_BADGE.active
              const isSelected = selected.has(lead.id)
              return (
                <div key={lead.id}
                  className={`bg-white rounded-xl border p-4 transition cursor-pointer ${isSelected ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-gray-200'}`}
                  onClick={() => router.push(`/leads/${lead.id}`)}
                >
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={isSelected}
                      onChange={e => { e.stopPropagation(); toggleSelect(lead.id) }}
                      onClick={e => e.stopPropagation()}
                      className="mt-1 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-xs select-none ${getAvatarColor(lead.name)}`}>
                      {getInitials(lead.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900 text-sm">{lead.name ?? '—'}</p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.className}`}>{st.label}</span>
                        {lead.isPurchaser && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#FEF3C7] text-[#D97706]">🔥 Comprador</span>}
                      </div>
                      {lead.phone && <p className="text-xs text-gray-500 mt-0.5">{lead.phone}</p>}
                      {lead.funnel_name && <span className="mt-1 inline-block text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{lead.funnel_name}</span>}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50">
                    <span className="text-xs text-gray-400">{new Date(lead.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      <Link href={`/leads/${lead.id}`} className="text-xs font-medium text-indigo-600 hover:underline">Ver →</Link>
                      <DeleteLeadButton leadId={lead.id} leadName={lead.name} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3.5 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                  </th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lead</th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Funil</th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tags</th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Último evento</th>
                  <th className="text-left px-4 py-3.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">Criado</th>
                  <th className="px-4 py-3.5 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(lead => {
                  const st = STATUS_BADGE[lead.status] ?? STATUS_BADGE.active
                  const isSelected = selected.has(lead.id)
                  return (
                    <tr key={lead.id}
                      className={`group transition-colors cursor-pointer ${isSelected ? 'bg-indigo-50/40' : 'hover:bg-gray-50/70'}`}
                      onClick={() => router.push(`/leads/${lead.id}`)}
                    >
                      <td className="px-4 py-3.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(lead.id)}
                          className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-xs select-none ${getAvatarColor(lead.name)}`}>
                            {getInitials(lead.name)}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 leading-tight text-[14px]">{lead.name ?? '—'}</p>
                            {lead.phone && <p className="text-xs text-gray-400 mt-0.5">{lead.phone}</p>}
                            {lead.email && !lead.phone && <p className="text-xs text-gray-400 mt-0.5">{lead.email}</p>}
                            {lead.email && lead.phone && <p className="text-xs text-gray-400">{lead.email}</p>}
                          </div>
                          {lead.isPurchaser && <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#D97706]">🔥</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        {lead.funnel_name
                          ? <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-600">{lead.funnel_name}</span>
                          : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {(lead.tags ?? []).slice(0, 2).map(tag => (
                            <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">{tag}</span>
                          ))}
                          {(lead.tags ?? []).length > 2 && <span className="text-xs text-gray-400">+{(lead.tags ?? []).length - 2}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${st.className}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        {lead.lastEvent ? (
                          <div>
                            <p className="text-xs text-gray-600">{EVENT_LABELS[lead.lastEvent.event_type] ?? lead.lastEvent.event_type}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">{relativeTime(lead.lastEvent.created_at)}</p>
                          </div>
                        ) : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-400">
                        {new Date(lead.created_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </td>
                      <td className="px-4 py-3.5 text-right opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/leads/${lead.id}`} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 whitespace-nowrap">Ver →</Link>
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
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-gray-900 text-white px-4 sm:px-6 py-3 flex items-center justify-between shadow-2xl gap-3">
          <span className="text-sm font-medium shrink-0">{selected.size} selecionado{selected.size !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {waInstances.length > 0 && (
              <button onClick={openMessageModal}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 rounded-lg transition">
                💬 Enviar WA
              </button>
            )}
            <button
              onClick={() => { setEnrollFunnelId(funnels[0]?.id ?? ''); setEnrollResult(null); setShowEnrollModal(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 rounded-lg transition">
              🔀 Adicionar ao funil
            </button>
            <button
              onClick={() => { setTagInput(''); setTagResult(null); setShowTagModal(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 rounded-lg transition">
              🏷 Adicionar tag
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-red-600 hover:bg-red-500 rounded-lg transition">
              🗑 Deletar
            </button>
            <button onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Add lead modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Adicionar Lead Manual</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {addResult?.success ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-emerald-600 text-xl">✓</span></div>
                <p className="font-semibold text-gray-900">Lead adicionado!</p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Nome</label>
                    <input type="text" value={addName} onChange={e => setAddName(e.target.value)} placeholder="Nome completo"
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
                  <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">Telefone</label>
                    <input type="tel" value={addPhone} onChange={e => setAddPhone(e.target.value)} placeholder="5511999999999"
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
                  <div><label className="block text-xs font-semibold text-gray-600 mb-1.5">E-mail</label>
                    <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="email@exemplo.com"
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300" /></div>
                  {addResult?.error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{addResult.error}</p>}
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition">Cancelar</button>
                  <button onClick={handleAddLead} disabled={addPending || (!addName.trim() && !addPhone.trim())}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition">
                    {addPending ? 'Salvando…' : 'Adicionar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* WA modal */}
      {showMessageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
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
                        <select value={messageInstanceId} onChange={e => setMessageInstanceId(e.target.value)}
                          className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                          {waInstances.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Mensagem</label>
                    <textarea value={messageText} onChange={e => setMessageText(e.target.value)} rows={4}
                      placeholder="Olá {primeiro_nome}! Temos uma oferta especial…"
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
                    <p className="text-xs text-gray-400 mt-1">Variáveis: <code className="bg-gray-100 px-1 rounded">{'{nome}'}</code> <code className="bg-gray-100 px-1 rounded">{'{primeiro_nome}'}</code></p>
                  </div>
                  {messagePreview && (
                    <div>
                      <p className="text-xs font-semibold text-gray-500 mb-1.5">Preview (1º lead selecionado)</p>
                      <div className="bg-[#DCF8C6] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-gray-800 whitespace-pre-wrap max-h-28 overflow-y-auto">
                        {messagePreview}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <p className="text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                      Enviar para <strong>{selected.size} lead{selected.size !== 1 ? 's' : ''}</strong> · intervalo 2s entre envios
                    </p>
                  </div>
                  {messageResult?.error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">Erro: {messageResult.error}</div>}
                </div>
                <div className="flex gap-3 mt-5">
                  <button onClick={() => setShowMessageModal(false)} disabled={messagePending}
                    className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition disabled:opacity-50">Cancelar</button>
                  <button onClick={handleSendMessage} disabled={messagePending || !messageText.trim() || !messageInstanceId}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition disabled:opacity-50">
                    {messagePending ? 'Enviando…' : `Enviar agora`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Enroll modal */}
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
                <p className="text-sm text-gray-500 mt-1">{selected.size} leads enfileirados.</p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Funil de destino</label>
                    <div className="relative">
                      <select value={enrollFunnelId} onChange={e => setEnrollFunnelId(e.target.value)}
                        className="w-full appearance-none pl-3 pr-8 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white">
                        {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-3">
                    Adicionar <strong>{selected.size} lead{selected.size !== 1 ? 's' : ''}</strong> ao funil{enrollFunnelId ? ` "${funnels.find(f => f.id === enrollFunnelId)?.name ?? ''}"` : ''}?
                  </p>
                  {enrollResult?.error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">Erro: {enrollResult.error}</div>}
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setShowEnrollModal(false)} disabled={isPending}
                    className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition disabled:opacity-50">Cancelar</button>
                  <button onClick={handleEnroll} disabled={isPending || !enrollFunnelId}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition disabled:opacity-50">
                    {isPending ? 'Adicionando…' : 'Confirmar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add tag modal */}
      {showTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Adicionar tag</h2>
              <button onClick={() => setShowTagModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            {tagResult?.success ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-emerald-600 text-xl">✓</span></div>
                <p className="font-semibold text-gray-900">Tag adicionada a {selected.size} lead{selected.size !== 1 ? 's' : ''}!</p>
              </div>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Nome da tag</label>
                    <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)}
                      placeholder="ex: cliente-vip"
                      onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                      className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-300" />
                  </div>
                  {allTags.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">Tags existentes:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {allTags.map(t => (
                          <button key={t} onClick={() => setTagInput(t)}
                            className={`text-xs px-2 py-0.5 rounded-full border transition ${
                              tagInput === t ? 'bg-violet-600 text-white border-violet-600' : 'bg-violet-50 text-violet-700 border-violet-100 hover:border-violet-300'
                            }`}>{t}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {tagResult?.error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{tagResult.error}</p>}
                </div>
                <div className="flex gap-3 mt-6">
                  <button onClick={() => setShowTagModal(false)} className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition">Cancelar</button>
                  <button onClick={handleAddTag} disabled={tagPending || !tagInput.trim()}
                    className="flex-1 px-4 py-2.5 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50 transition">
                    {tagPending ? 'Salvando…' : 'Adicionar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex flex-col items-center text-center gap-3 mb-5">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <span className="text-red-600 text-xl">🗑</span>
              </div>
              <h2 className="text-base font-bold text-gray-900">Deletar {selected.size} lead{selected.size !== 1 ? 's' : ''}?</h2>
              <p className="text-sm text-gray-500">Esta ação não pode ser desfeita. Todos os dados e eventos desses leads serão excluídos.</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 px-4 py-2.5 text-sm font-medium border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition">Cancelar</button>
              <button onClick={handleBulkDelete} disabled={deletePending}
                className="flex-1 px-4 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 transition">
                {deletePending ? 'Deletando…' : 'Confirmar exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
