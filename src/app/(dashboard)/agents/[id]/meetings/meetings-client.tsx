'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { cancelMeeting, type AgentMeeting } from '@/app/actions/ai-agents'

const STATUS_LABELS: Record<string, string> = { confirmed: 'Confirmada', cancelled: 'Cancelada', done: 'Realizada' }
const STATUS_CLS: Record<string, string> = {
  confirmed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-50 text-red-600',
  done: 'bg-gray-100 text-gray-600',
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function gcalLink(m: AgentMeeting, title: string, location: string): string {
  const start = new Date(m.scheduled_at)
  const end = new Date(start.getTime() + m.duration_minutes * 60_000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const q = new URLSearchParams({
    action: 'TEMPLATE', text: title,
    dates: `${fmt(start)}/${fmt(end)}`, ctz: 'America/Sao_Paulo',
  })
  if (location) q.set('location', location)
  const details = [m.topic, m.lead_name && `Lead: ${m.lead_name}`, m.lead_phone && `WhatsApp: ${m.lead_phone}`, m.lead_email && `E-mail: ${m.lead_email}`].filter(Boolean).join('\n')
  if (details) q.set('details', details)
  return `https://calendar.google.com/calendar/render?${q.toString()}`
}

interface Props {
  agentId: string; agentName: string
  initialMeetings: AgentMeeting[]
  meetingTitle: string; meetingLocation: string
}

export default function MeetingsClient({ agentName, initialMeetings, meetingTitle, meetingLocation }: Props) {
  const [meetings, setMeetings] = useState(initialMeetings)
  const [busy, setBusy] = useState(false)
  const [showCancelled, setShowCancelled] = useState(false)

  const upcoming = meetings.filter(m => m.status === 'confirmed' && new Date(m.scheduled_at).getTime() > Date.now())
  // Canceladas somem da lista por padrão (toggle para rever se precisar)
  const visible = showCancelled ? meetings : meetings.filter(m => m.status !== 'cancelled')
  const cancelledCount = meetings.filter(m => m.status === 'cancelled').length

  async function cancel(id: string) {
    if (!confirm('Cancelar esta reunião? O horário volta a ficar disponível.')) return
    setBusy(true)
    await cancelMeeting(id)
    setMeetings(ms => ms.map(m => m.id === id ? { ...m, status: 'cancelled' } : m))
    setBusy(false)
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Link href="/agents" className="text-sm text-indigo-600 hover:underline">← Voltar</Link>
      </div>
      <div className="flex items-end justify-between mb-5 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Reuniões de {agentName}</h1>
          <p className="text-sm text-gray-500">{upcoming.length} reunião(ões) confirmada(s) daqui pra frente</p>
        </div>
        {cancelledCount > 0 && (
          <button onClick={() => setShowCancelled(v => !v)} className="text-xs text-gray-400 hover:text-gray-600 underline">
            {showCancelled ? 'ocultar canceladas' : `mostrar canceladas (${cancelledCount})`}
          </button>
        )}
      </div>

      <div className="border rounded-xl overflow-hidden bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Quando</th>
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-4 py-2 font-medium">Contato</th>
              <th className="px-4 py-2 font-medium">Assunto</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                Nenhuma reunião ainda. Ative o agendamento no passo &quot;Objetivo&quot; do agente e ele começa a marcar sozinho. 📅
              </td></tr>
            ) : visible.map(m => (
              <tr key={m.id} className={`border-t ${m.status === 'cancelled' ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2.5 font-medium text-gray-800">{fmtDate(m.scheduled_at)} <span className="text-xs text-gray-400">({m.duration_minutes}min)</span></td>
                <td className="px-4 py-2.5">{m.lead_name ?? 'Anônimo'}</td>
                <td className="px-4 py-2.5 text-gray-500 text-xs">{[m.lead_phone, m.lead_email].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-4 py-2.5 text-gray-600">{m.topic ?? '—'}</td>
                <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_CLS[m.status] ?? 'bg-gray-100'}`}>{STATUS_LABELS[m.status] ?? m.status}</span></td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {m.status === 'confirmed' && (
                    <>
                      <a href={gcalLink(m, meetingTitle, meetingLocation)} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-indigo-600 hover:underline mr-3">+ Google Agenda</a>
                      <button onClick={() => cancel(m.id)} disabled={busy}
                        className="text-xs text-red-500 hover:underline disabled:opacity-50">Cancelar</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
