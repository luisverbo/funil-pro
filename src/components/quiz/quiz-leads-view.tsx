'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  getQuizLeads, getQuizStats, resetQuizLeads, exportLeadsCSV,
  type QuizLead, type QuizLeadWithEvents,
} from '@/app/actions/quiz-leads'
import type { QuizPage } from '@/app/actions/quiz-v2'

type Period = '24h' | '7d' | '30d' | 'all'

function shortId(id: string) { return id.slice(0, 6).toUpperCase() }
function fmtDate(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function statusBadge(status: QuizLead['status']) {
  const map = {
    completed:   'bg-emerald-100 text-emerald-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    abandoned:   'bg-gray-100 text-gray-500',
  }
  const labels = { completed: 'Concluído', in_progress: 'Em andamento', abandoned: 'Abandonou' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${map[status]}`}>
      {labels[status]}
    </span>
  )
}

// Derive what happened on a given page for a lead
function pageCellValue(lead: QuizLeadWithEvents, pageId: string): { state: 'none' | 'visited' | 'answered'; summary: string } {
  const pageEvents = lead.events.filter(e => e.page_id === pageId)
  if (pageEvents.length === 0) return { state: 'none', summary: '' }

  const answered = pageEvents.filter(e =>
    ['choice_selected','text_entered','button_clicked','form_submitted','quiz_completed'].includes(e.event_type)
  )
  if (answered.length === 0) return { state: 'visited', summary: 'Visitou' }

  const last = answered[answered.length - 1]
  let summary = ''
  if (last.event_type === 'choice_selected') {
    const choices = last.value as { selected?: unknown }
    summary = String(choices.selected ?? '').slice(0, 30)
  } else if (last.event_type === 'text_entered') {
    summary = String((last.value as { text?: unknown }).text ?? '').slice(0, 30)
  } else if (last.event_type === 'button_clicked') {
    summary = 'Clicou'
  } else if (last.event_type === 'form_submitted') {
    summary = 'Formulário'
  } else if (last.event_type === 'quiz_completed') {
    summary = '✓ Fim'
  }
  return { state: 'answered', summary }
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function LeadDetailPanel({ lead, pages, onClose }: { lead: QuizLeadWithEvents; pages: QuizPage[]; onClose: () => void }) {
  const pageMap = new Map(pages.map((p, i) => [p.id, { title: p.title, index: i }]))

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
        <div>
          <p className="text-sm font-bold text-gray-900">Lead #{shortId(lead.id)}</p>
          <p className="text-xs text-gray-400">{fmtDate(lead.started_at)}</p>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition text-xl leading-none">×</button>
      </div>

      {/* Contact info */}
      <div className="px-5 py-3 border-b border-gray-100 shrink-0">
        <div className="grid grid-cols-1 gap-1.5">
          {lead.name  && <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 w-14 shrink-0">Nome</span><span className="font-medium text-gray-800">{lead.name}</span></div>}
          {lead.email && <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 w-14 shrink-0">E-mail</span><span className="font-medium text-gray-800">{lead.email}</span></div>}
          {lead.phone && <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 w-14 shrink-0">Telefone</span><span className="font-medium text-gray-800">{lead.phone}</span></div>}
        </div>
        <div className="flex items-center gap-3 mt-2">
          {statusBadge(lead.status)}
          {lead.score > 0 && (
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
              {lead.score} pts
            </span>
          )}
          {lead.result_shown && (
            <span className="text-xs text-gray-500 truncate max-w-[120px]">→ {lead.result_shown}</span>
          )}
        </div>
      </div>

      {/* Event timeline */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Jornada</p>
        {lead.events.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhuma interação registrada</p>
        ) : (
          <div className="space-y-2">
            {lead.events.map((ev, i) => {
              const pageInfo = pageMap.get(ev.page_id)
              const eventLabels: Record<string, string> = {
                page_viewed: 'Visualizou',
                choice_selected: 'Escolheu',
                text_entered: 'Digitou',
                button_clicked: 'Clicou',
                form_submitted: 'Enviou formulário',
                quiz_completed: 'Concluiu',
              }
              const isKey = ev.event_type !== 'page_viewed'

              let valueStr = ''
              if (ev.event_type === 'choice_selected') valueStr = String((ev.value as { selected?: unknown }).selected ?? '')
              if (ev.event_type === 'text_entered') valueStr = String((ev.value as { text?: unknown }).text ?? '')

              return (
                <div key={i} className={`flex gap-2.5 ${isKey ? '' : 'opacity-60'}`}>
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`w-2 h-2 rounded-full mt-1 ${isKey ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                    {i < lead.events.length - 1 && <div className="w-px flex-1 bg-gray-100 mt-0.5" />}
                  </div>
                  <div className="pb-2 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-medium text-gray-700 truncate">
                        {eventLabels[ev.event_type] ?? ev.event_type}
                        {pageInfo && <span className="font-normal text-gray-400 ml-1">· pg. {pageInfo.index + 1} {pageInfo.title}</span>}
                      </p>
                      <span className="text-[10px] text-gray-400 shrink-0">{fmtDate(ev.created_at)}</span>
                    </div>
                    {valueStr && <p className="text-xs text-gray-500 truncate mt-0.5">"{valueStr}"</p>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ quizId, pages }: { quizId: string; pages: QuizPage[] }) {
  const [stats, setStats] = useState<{
    total: number; completed: number; inProgress: number; completionRate: number; topDropOffPageId: string | null
  } | null>(null)

  useEffect(() => {
    getQuizStats(quizId).then(r => {
      if ('total' in r) setStats(r)
    })
  }, [quizId])

  if (!stats) return <div className="h-20 bg-white rounded-xl border border-gray-200 animate-pulse mb-4" />

  const dropOffPage = stats.topDropOffPageId ? pages.find(p => p.id === stats.topDropOffPageId) : null

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {[
        { label: 'Total iniciado', value: stats.total, color: 'text-gray-900' },
        { label: 'Concluíram', value: stats.completed, color: 'text-emerald-600' },
        { label: 'Taxa de conclusão', value: `${Math.round(stats.completionRate)}%`, color: 'text-indigo-600' },
        { label: 'Maior abandono', value: dropOffPage ? dropOffPage.title : '—', color: 'text-amber-600' },
      ].map(s => (
        <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">{s.label}</p>
          <p className={`text-xl font-bold ${s.color} truncate`}>{s.value}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QuizLeadsView({ quizId, pages }: { quizId: string; pages: QuizPage[] }) {
  const [leads, setLeads] = useState<QuizLeadWithEvents[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<Period>('all')
  const [loading, setLoading] = useState(true)
  const [selectedLead, setSelectedLead] = useState<QuizLeadWithEvents | null>(null)
  const [resetting, setResetting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [searchInput, setSearchInput] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const result = await getQuizLeads(quizId, { search, period, page, pageSize })
    if ('leads' in result) {
      setLeads(result.leads)
      setTotal(result.total)
    }
    setLoading(false)
  }, [quizId, search, period, page, pageSize])

  useEffect(() => { load() }, [load])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  async function handleExport() {
    setExporting(true)
    const result = await exportLeadsCSV(quizId)
    if ('csv' in result) {
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `quiz-leads-${quizId.slice(0, 6)}.csv`; a.click()
      URL.revokeObjectURL(url)
    }
    setExporting(false)
  }

  async function handleReset() {
    if (!confirm('Tem certeza? Todos os dados de leads deste quiz serão apagados permanentemente.')) return
    setResetting(true)
    await resetQuizLeads(quizId)
    setResetting(false)
    load()
  }

  // Build per-page drop rate (leads that reached each page / total)
  const reachCount: Record<string, number> = {}
  for (const lead of leads) {
    const visitedPages = new Set(lead.events.map(e => e.page_id))
    for (const pid of visitedPages) reachCount[pid] = (reachCount[pid] ?? 0) + 1
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-50">
      {/* Toolbar */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-48 max-w-72">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Buscar por nome, e-mail, telefone..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          {/* Period filter */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs font-medium shrink-0">
            {(['24h','7d','30d','all'] as Period[]).map(p => (
              <button key={p} onClick={() => { setPeriod(p); setPage(1) }}
                className={`px-3 py-1.5 transition ${period === p ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {p === 'all' ? 'Todos' : p}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Refresh */}
          <button onClick={load} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition" title="Atualizar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
          </button>

          {/* Export */}
          <button onClick={handleExport} disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition disabled:opacity-50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {exporting ? 'Exportando…' : 'Exportar CSV'}
          </button>

          {/* Reset */}
          <button onClick={handleReset} disabled={resetting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition disabled:opacity-50">
            {resetting ? 'Resetando…' : 'Resetar dados'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {/* Stats */}
        <StatsBar quizId={quizId} pages={pages} />

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <svg className="animate-spin w-6 h-6 text-indigo-400" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/>
              </svg>
            </div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <p className="text-4xl mb-2">📭</p>
              <p className="text-sm font-medium">Nenhum lead encontrado</p>
              <p className="text-xs mt-1">Publique o quiz e compartilhe o link para começar a capturar dados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 font-semibold text-gray-500 whitespace-nowrap sticky left-0 bg-gray-50 z-10 w-28">
                      Lead / Data
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 whitespace-nowrap w-24">Status</th>
                    {pages.map(p => {
                      const reached = reachCount[p.id] ?? 0
                      const rate = total > 0 ? Math.round((reached / total) * 100) : 0
                      return (
                        <th key={p.id} className="text-left px-3 py-3 font-semibold text-gray-500 min-w-[120px]">
                          <div className="truncate max-w-[140px]" title={p.title}>{p.title}</div>
                          <div className="mt-0.5">
                            <div className="flex items-center gap-1">
                              <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-indigo-400" style={{ width: `${rate}%` }} />
                              </div>
                              <span className="text-[9px] text-gray-400 shrink-0">{rate}%</span>
                            </div>
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {leads.map(lead => (
                    <tr
                      key={lead.id}
                      className="hover:bg-indigo-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedLead(lead)}
                    >
                      <td className="px-4 py-3 sticky left-0 bg-white hover:bg-indigo-50 z-10">
                        <p className="font-bold text-gray-800 font-mono">#{shortId(lead.id)}</p>
                        <p className="text-[10px] text-gray-400">{fmtDate(lead.started_at)}</p>
                        {(lead.name || lead.email) && (
                          <p className="text-[10px] text-indigo-600 truncate max-w-[96px]">{lead.name || lead.email}</p>
                        )}
                      </td>
                      <td className="px-3 py-3">{statusBadge(lead.status)}</td>
                      {pages.map(p => {
                        const cell = pageCellValue(lead, p.id)
                        return (
                          <td key={p.id} className="px-3 py-3">
                            {cell.state === 'none' ? (
                              <span className="text-gray-200">—</span>
                            ) : cell.state === 'visited' ? (
                              <span className="flex items-center gap-1 text-amber-500">
                                <span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-[9px]">!</span>
                                <span className="text-gray-400">Visitou</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-emerald-600">
                                <span className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"/></svg>
                                </span>
                                <span className="text-gray-600 truncate max-w-[100px]" title={cell.summary}>{cell.summary}</span>
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-xs text-gray-500">
            <span>Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total} leads</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Próxima →</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selectedLead && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedLead(null)} />
          <LeadDetailPanel lead={selectedLead} pages={pages} onClose={() => setSelectedLead(null)} />
        </>
      )}
    </div>
  )
}
