'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { listConversations, getConversation, setMessageFeedback, addCorrection, deleteConversations } from '@/app/actions/ai-agents'

type Conversation = {
  id: string; status: string; qualification_score: number | null
  message_count: number; started_at: string; ended_at: string | null; lead_name: string | null
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativa', qualified: 'Qualificado', disqualified: 'Desqualificado',
  sold: 'Vendido', routed_to_funnel: 'Roteado', handed_to_human: 'Humano', abandoned: 'Abandonado', scheduled: 'Reunião marcada',
}
const STATUS_CLS: Record<string, string> = {
  active: 'bg-blue-100 text-blue-700', qualified: 'bg-emerald-100 text-emerald-700',
  disqualified: 'bg-gray-100 text-gray-600', sold: 'bg-green-100 text-green-700',
  routed_to_funnel: 'bg-indigo-100 text-indigo-700', handed_to_human: 'bg-amber-100 text-amber-700', scheduled: 'bg-teal-100 text-teal-700',
  abandoned: 'bg-red-50 text-red-600',
}
const FILTERS = ['', 'active', 'qualified', 'sold', 'scheduled', 'routed_to_funnel', 'handed_to_human', 'abandoned']

function fmtDuration(start: string, end: string | null): string {
  if (!end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  const min = Math.round(ms / 60000)
  return min < 60 ? `${min}min` : `${Math.round(min / 60)}h`
}

interface Props {
  agentId: string; agentName: string
  initialConversations: Conversation[]; total: number
  funnel?: { total: number; withContact: number; qualified: number; scheduled: number; sold: number }
}

export default function ConversationsClient({ agentId, agentName, initialConversations, total, funnel }: Props) {
  const [conversations, setConversations] = useState(initialConversations)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [drawer, setDrawer] = useState<{ id: string; status: string; lead_name: string | null; score: number | null; summary: string | null } | null>(null)
  const [messages, setMessages] = useState<{ id: string; role: string; content: string; feedback?: string | null }[]>([])
  const [correcting, setCorrecting] = useState<{ msgId: string; context: string; original: string } | null>(null)
  const [correctionText, setCorrectionText] = useState('')
  const [savingCorrection, setSavingCorrection] = useState(false)

  async function markBad(msgId: string, idx: number) {
    let context = ''
    for (let i = idx - 1; i >= 0; i--) { if (messages[i].role === 'lead') { context = messages[i].content; break } }
    await setMessageFeedback(msgId, 'bad')
    setMessages(m => m.map(x => x.id === msgId ? { ...x, feedback: 'bad' } : x))
    setCorrecting({ msgId, context, original: messages[idx].content })
    setCorrectionText('')
  }

  async function saveCorrection() {
    if (!correcting || !correctionText.trim()) return
    setSavingCorrection(true)
    await addCorrection(agentId, correcting.context, correctionText)
    setSavingCorrection(false)
    setCorrecting(null)
  }

  async function applyFilter(f: string) {
    setFilter(f)
    setSelected(new Set())
    const { conversations: c } = await listConversations(agentId, { status: f || undefined, page: 0, pageSize: 50 })
    setConversations(c)
  }

  async function openConversation(id: string) {
    const { conversation, messages: m } = await getConversation(id)
    if (conversation) {
      setDrawer({ id: conversation.id, status: conversation.status, lead_name: conversation.lead_name, score: conversation.qualification_score, summary: conversation.outcome_summary })
      setMessages(m ?? [])
    }
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === conversations.length) setSelected(new Set())
    else setSelected(new Set(conversations.map(c => c.id)))
  }

  async function deleteSelected() {
    if (!selected.size) return
    if (!confirm(`Excluir ${selected.size} conversa(s)? Esta ação não pode ser desfeita.`)) return
    setDeleting(true)
    await deleteConversations([...selected])
    setConversations(c => c.filter(x => !selected.has(x.id)))
    setSelected(new Set())
    setDeleting(false)
  }

  async function deleteOne(id: string) {
    if (!confirm('Excluir esta conversa? Esta ação não pode ser desfeita.')) return
    setDeleting(true)
    await deleteConversations([id])
    setConversations(c => c.filter(x => x.id !== id))
    setDrawer(null)
    setDeleting(false)
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Link href="/agents" className="text-sm text-indigo-600 hover:underline">← Voltar</Link>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Conversas de {agentName}</h1>

      {funnel && funnel.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
          {[
            { label: 'Conversas', value: funnel.total, pct: 100 },
            { label: 'Com contato', value: funnel.withContact, pct: funnel.total ? Math.round(funnel.withContact / funnel.total * 100) : 0 },
            { label: 'Qualificados', value: funnel.qualified, pct: funnel.total ? Math.round(funnel.qualified / funnel.total * 100) : 0 },
            { label: 'Reuniões', value: funnel.scheduled, pct: funnel.total ? Math.round(funnel.scheduled / funnel.total * 100) : 0 },
            { label: 'Vendas', value: funnel.sold, pct: funnel.total ? Math.round(funnel.sold / funnel.total * 100) : 0 },
          ].map((s, i) => (
            <div key={s.label} className="rounded-xl bg-white border border-gray-100 shadow-sm px-3 py-2.5">
              <p className="text-xl font-bold text-gray-900 leading-tight">{s.value}</p>
              <p className="text-[11px] text-gray-500">{s.label}{i > 0 ? ` · ${s.pct}%` : ''}</p>
              <div className="h-1 mt-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${s.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {FILTERS.map(f => (
          <button key={f || 'all'} onClick={() => applyFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full ${filter === f ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f ? STATUS_LABELS[f] : `Todas (${total})`}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
          <span className="text-sm text-red-700 font-medium">{selected.size} selecionada(s)</span>
          <button onClick={deleteSelected} disabled={deleting}
            className="ml-auto text-sm px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
            {deleting ? 'Excluindo…' : '🗑 Excluir selecionadas'}
          </button>
        </div>
      )}

      <div className="border rounded-xl overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-left">
            <tr>
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={conversations.length > 0 && selected.size === conversations.length}
                  onChange={toggleAll} className="w-4 h-4 accent-indigo-600" />
              </th>
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Score</th>
              <th className="px-4 py-2 font-medium">Mensagens</th>
              <th className="px-4 py-2 font-medium">Duração</th>
              <th className="px-4 py-2 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {conversations.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">Nenhuma conversa</td></tr>
            ) : conversations.map(c => (
              <tr key={c.id} onClick={() => openConversation(c.id)} className="border-t hover:bg-gray-50 cursor-pointer">
                <td className="px-3 py-2.5" onClick={e => toggleSelect(c.id, e)}>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => {}} className="w-4 h-4 accent-indigo-600" />
                </td>
                <td className="px-4 py-2.5">{c.lead_name ?? 'Anônimo'}</td>
                <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLS[c.status] ?? 'bg-gray-100'}`}>{STATUS_LABELS[c.status] ?? c.status}</span></td>
                <td className="px-4 py-2.5">{c.qualification_score ?? '—'}</td>
                <td className="px-4 py-2.5">{c.message_count}</td>
                <td className="px-4 py-2.5">{fmtDuration(c.started_at, c.ended_at)}</td>
                <td className="px-4 py-2.5 text-gray-500">{new Date(c.started_at).toLocaleDateString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setDrawer(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-md bg-white h-full flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="font-semibold">{drawer.lead_name ?? 'Anônimo'}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLS[drawer.status] ?? 'bg-gray-100'}`}>{STATUS_LABELS[drawer.status] ?? drawer.status}</span>
                {drawer.score != null && <span className="ml-2 text-xs text-gray-500">Score: {drawer.score}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => deleteOne(drawer.id)} disabled={deleting}
                  className="text-sm px-3 py-1.5 text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50">
                  🗑 Excluir
                </button>
                <button onClick={() => setDrawer(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
              </div>
            </div>
            {drawer.summary && <div className="px-5 py-2 bg-gray-50 text-xs text-gray-600 border-b">{drawer.summary}</div>}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 bg-gray-50">
              {messages.map((m, idx) => (
                <div key={m.id} className={`flex flex-col ${m.role === 'lead' ? 'self-end items-end' : 'self-start items-start'} max-w-[85%]`}>
                  <div className={`px-3 py-2 rounded-2xl text-sm ${
                    m.role === 'lead' ? 'bg-indigo-600 text-white rounded-br-sm' : 'bg-white border text-gray-800 rounded-bl-sm'
                  } ${m.feedback === 'bad' ? 'ring-2 ring-red-300' : ''}`}>
                    {m.content}
                    {m.role === 'agent' && (
                      // ✓✓ estilo WhatsApp: azul = lead respondeu depois (viu); cinza = ainda não
                      <span className={`ml-1.5 text-[11px] align-bottom select-none ${
                        messages.slice(idx + 1).some(x => x.role === 'lead') ? 'text-sky-500' : 'text-gray-400'
                      }`}>✓✓</span>
                    )}
                  </div>
                  {m.role === 'agent' && (
                    <button onClick={() => markBad(m.id, idx)}
                      className={`text-[11px] mt-0.5 ${m.feedback === 'bad' ? 'text-red-500 font-medium' : 'text-gray-400 hover:text-red-500'}`}>
                      {m.feedback === 'bad' ? '👎 marcada como ruim' : '👎 marcar resposta ruim'}
                    </button>
                  )}
                </div>
              ))}
              {messages.length === 0 && <p className="text-center text-sm text-gray-400">Sem mensagens</p>}
            </div>
          </div>
        </div>
      )}

      {correcting && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => setCorrecting(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-900 mb-1">Ensinar a resposta certa</h3>
            <p className="text-xs text-gray-500 mb-3">Isso vira uma correção que o agente vai seguir sempre em situações parecidas.</p>
            {correcting.context && (
              <div className="text-xs bg-gray-50 border rounded-lg px-3 py-2 mb-2">
                <span className="text-gray-400">O lead disse:</span> <span className="text-gray-700">{correcting.context}</span>
              </div>
            )}
            <div className="text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
              <span className="text-red-400">Resposta ruim:</span> <span className="text-gray-700">{correcting.original}</span>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">O que ele deveria ter dito?</label>
            <textarea value={correctionText} onChange={e => setCorrectionText(e.target.value)}
              className="w-full h-24 px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200"
              placeholder="Escreva a resposta ideal…" />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setCorrecting(null)} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
              <button onClick={saveCorrection} disabled={!correctionText.trim() || savingCorrection}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-indigo-700">
                {savingCorrection ? 'Salvando…' : 'Salvar correção'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
