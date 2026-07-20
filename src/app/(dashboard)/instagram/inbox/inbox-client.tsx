'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { listIgThreads, getIgThreadMessages, setIgThreadHumanMode, sendIgHumanReply, type IgThread, type IgDmMessage } from '@/app/actions/ig-inbox'
import EmojiPicker from '@/components/ui/emoji-picker'

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const SOURCE_LABEL: Record<string, string> = {
  agent: '🤖 IA', automation: '⚡ Automação', human: '🙋 Você', gate: '🔒 Gate',
}

export default function InboxClient({ initialThreads }: { initialThreads: IgThread[] }) {
  const [threads, setThreads] = useState(initialThreads)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<IgDmMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const active = threads.find(t => t.id === activeId) ?? null

  const refreshThreads = useCallback(async () => {
    const { threads: t } = await listIgThreads()
    setThreads(t)
  }, [])

  const refreshMessages = useCallback(async (id: string) => {
    const { messages: m } = await getIgThreadMessages(id)
    setMessages(m)
  }, [])

  // Polling: lista a cada 8s; conversa aberta a cada 5s
  useEffect(() => {
    const t = setInterval(refreshThreads, 8000)
    return () => clearInterval(t)
  }, [refreshThreads])

  useEffect(() => {
    if (!activeId) return
    refreshMessages(activeId)
    const t = setInterval(() => refreshMessages(activeId), 5000)
    return () => clearInterval(t)
  }, [activeId, refreshMessages])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  async function open(id: string) {
    setActiveId(id)
    setSendError(null)
    setThreads(list => list.map(t => t.id === id ? { ...t, unread: false } : t))
  }

  async function toggleHuman() {
    if (!active) return
    const on = !active.human_mode
    setThreads(list => list.map(t => t.id === active.id ? { ...t, human_mode: on } : t))
    await setIgThreadHumanMode(active.id, on)
  }

  async function send() {
    if (!active || !input.trim() || sending) return
    setSending(true); setSendError(null)
    const text = input.trim()
    setInput('')
    // Se ainda não assumiu, assumir automaticamente ao responder
    if (!active.human_mode) {
      setThreads(list => list.map(t => t.id === active.id ? { ...t, human_mode: true } : t))
      await setIgThreadHumanMode(active.id, true)
    }
    const { success, error } = await sendIgHumanReply(active.id, text)
    if (!success) { setSendError(error ?? 'Erro ao enviar'); setInput(text) }
    else await refreshMessages(active.id)
    setSending(false)
  }

  return (
    <div className="fixed inset-0 md:left-0 flex flex-col bg-gray-50" style={{ zIndex: 30 }}>
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b shrink-0">
        <Link href="/instagram" className="text-sm text-indigo-600 hover:underline">← Automações</Link>
        <h1 className="font-semibold text-gray-900">📥 Inbox do Instagram</h1>
        <span className="text-xs text-gray-400 ml-auto">atualiza sozinho a cada poucos segundos</span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Lista de conversas */}
        <div className={`w-full sm:w-80 shrink-0 bg-white border-r overflow-y-auto ${activeId ? 'hidden sm:block' : ''}`}>
          {threads.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">
              <p className="text-3xl mb-2">📭</p>
              Nenhuma conversa ainda.<br />Quando alguém mandar DM ou disparar uma automação, aparece aqui.
            </div>
          ) : threads.map(t => (
            <button key={t.id} onClick={() => open(t.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 border-b border-gray-50 text-left hover:bg-gray-50 ${activeId === t.id ? 'bg-indigo-50/60' : ''}`}>
              {t.profile_pic
                ? <img src={t.profile_pic} alt="" className="w-11 h-11 rounded-full object-cover shrink-0" />
                : <div className="w-11 h-11 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 text-white flex items-center justify-center font-bold shrink-0">
                    {(t.name ?? t.username ?? '?').charAt(0).toUpperCase()}
                  </div>}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-gray-900 text-sm truncate">{t.name ?? (t.username ? `@${t.username}` : 'Contato')}</p>
                  <span className="text-[10px] text-gray-400 shrink-0">{fmtTime(t.last_message_at)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {t.human_mode && <span className="text-[10px] text-amber-600 font-semibold shrink-0">🙋</span>}
                  <p className="text-xs text-gray-500 truncate">{t.last_message_text ?? ''}</p>
                  {t.unread && <span className="ml-auto w-2 h-2 rounded-full bg-pink-500 shrink-0" />}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Conversa */}
        <div className={`flex-1 flex flex-col min-w-0 ${activeId ? '' : 'hidden sm:flex'}`}>
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-gray-300 text-sm">Selecione uma conversa 👈</div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b shrink-0">
                <button onClick={() => setActiveId(null)} className="sm:hidden text-indigo-600">←</button>
                {active.profile_pic
                  ? <img src={active.profile_pic} alt="" className="w-9 h-9 rounded-full object-cover" />
                  : <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 text-white flex items-center justify-center font-bold text-sm">
                      {(active.name ?? active.username ?? '?').charAt(0).toUpperCase()}
                    </div>}
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 text-sm truncate">{active.name ?? (active.username ? `@${active.username}` : 'Contato')}</p>
                  {active.username && <p className="text-[11px] text-gray-400">@{active.username}</p>}
                </div>
                <button onClick={toggleHuman}
                  className={`ml-auto text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${active.human_mode ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                  {active.human_mode ? '🙋 Você no comando · devolver pra IA' : '🤖 IA no comando · assumir'}
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-1.5 bg-[#efeae2]/50">
                {messages.map(m => (
                  <div key={m.id} className={`max-w-[75%] ${m.direction === 'in' ? 'self-start' : 'self-end'}`}>
                    <div className={`px-3.5 py-2 text-sm whitespace-pre-wrap ${
                      m.direction === 'in'
                        ? 'bg-white text-gray-800 rounded-2xl rounded-bl-md border border-gray-100'
                        : 'bg-gradient-to-r from-pink-500 to-purple-600 text-white rounded-2xl rounded-br-md'
                    }`} style={{ overflowWrap: 'anywhere' }}>
                      {m.text}
                    </div>
                    <p className={`text-[10px] text-gray-400 mt-0.5 ${m.direction === 'in' ? '' : 'text-right'}`}>
                      {m.direction === 'out' && m.source ? `${SOURCE_LABEL[m.source] ?? m.source} · ` : ''}{fmtTime(m.created_at)}
                    </p>
                  </div>
                ))}
                {messages.length === 0 && <p className="text-center text-sm text-gray-400 mt-8">Sem mensagens registradas ainda</p>}
              </div>

              {sendError && <p className="text-xs text-red-600 px-4 py-1 bg-red-50">{sendError}</p>}
              <div className="px-3 py-3 bg-white border-t flex items-center gap-2 shrink-0">
                <EmojiPicker onPick={e => setInput(v => v + e)} />
                <input value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') send() }}
                  placeholder={active.human_mode ? 'Digite sua resposta…' : 'Responder assume a conversa (IA pausa)…'}
                  className="flex-1 min-w-0 px-4 py-2.5 rounded-full border border-gray-200 outline-none text-sm focus:ring-2 focus:ring-purple-200" />
                <button onClick={send} disabled={sending || !input.trim()}
                  className="w-10 h-10 rounded-full bg-gradient-to-r from-pink-500 to-purple-600 text-white flex items-center justify-center disabled:opacity-50 shrink-0">➤</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
