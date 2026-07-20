'use client'

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
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

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
}

const SOURCE_LABEL: Record<string, string> = {
  agent: '🤖 IA', automation: '⚡ Automação', human: '🙋 Você', gate: '🔒 Filtro',
}

function Avatar({ src, name, size = 44 }: { src: string | null; name: string; size?: number }) {
  const initial = (name || '?').charAt(0).toUpperCase()
  if (src) return <img src={src} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  return (
    <div className="rounded-full bg-gradient-to-br from-pink-400 via-fuchsia-500 to-purple-600 text-white flex items-center justify-center font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}>{initial}</div>
  )
}

export default function InboxClient({ initialThreads }: { initialThreads: IgThread[] }) {
  const [threads, setThreads] = useState(initialThreads)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<IgDmMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const active = threads.find(t => t.id === activeId) ?? null
  const unreadCount = threads.filter(t => t.unread).length

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return threads
    return threads.filter(t => (t.name ?? '').toLowerCase().includes(q) || (t.username ?? '').toLowerCase().includes(q))
  }, [threads, search])

  const refreshThreads = useCallback(async () => {
    const { threads: t } = await listIgThreads()
    setThreads(t)
  }, [])

  const refreshMessages = useCallback(async (id: string) => {
    const { messages: m } = await getIgThreadMessages(id)
    setMessages(m)
  }, [])

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

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages])

  async function open(id: string) {
    setActiveId(id); setSendError(null)
    setThreads(list => list.map(t => t.id === id ? { ...t, unread: false } : t))
    setTimeout(() => inputRef.current?.focus(), 100)
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
    const text = input.trim(); setInput('')
    if (!active.human_mode) {
      setThreads(list => list.map(t => t.id === active.id ? { ...t, human_mode: true } : t))
      await setIgThreadHumanMode(active.id, true)
    }
    const { success, error } = await sendIgHumanReply(active.id, text)
    if (!success) { setSendError(error ?? 'Erro ao enviar'); setInput(text) }
    else await refreshMessages(active.id)
    setSending(false)
    inputRef.current?.focus()
  }

  return (
    <div className="fixed inset-0 md:left-0 flex flex-col bg-gradient-to-br from-gray-50 to-gray-100" style={{ zIndex: 30 }}>
      {/* Topbar */}
      <div className="flex items-center gap-3 px-5 py-3 bg-white/80 backdrop-blur border-b border-gray-100 shrink-0">
        <Link href="/instagram" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <span className="text-lg">←</span> Automações
        </Link>
        <div className="flex items-center gap-2 ml-1">
          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center text-white text-sm shadow-sm shadow-pink-200">📥</span>
          <h1 className="font-bold text-gray-900">Inbox do Instagram</h1>
          {unreadCount > 0 && <span className="text-[11px] font-bold text-white bg-pink-500 rounded-full px-2 py-0.5">{unreadCount} nova{unreadCount > 1 ? 's' : ''}</span>}
        </div>
        <span className="text-xs text-gray-300 ml-auto flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> ao vivo
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Lista de conversas */}
        <div className={`w-full sm:w-[340px] shrink-0 bg-white border-r border-gray-100 flex flex-col ${activeId ? 'hidden sm:flex' : 'flex'}`}>
          <div className="p-3 border-b border-gray-50">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-sm">🔍</span>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar conversa…"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 border border-transparent focus:border-purple-200 focus:bg-white outline-none text-sm transition-colors" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-10 text-center text-gray-400 text-sm">
                <p className="text-4xl mb-3">📭</p>
                {search ? 'Nenhuma conversa encontrada.' : <>Nenhuma conversa ainda.<br />Quando alguém mandar DM ou disparar uma automação, aparece aqui.</>}
              </div>
            ) : filtered.map(t => (
              <button key={t.id} onClick={() => open(t.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 text-left transition-colors relative ${activeId === t.id ? 'bg-gradient-to-r from-purple-50 to-transparent' : 'hover:bg-gray-50'}`}>
                {activeId === t.id && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-gradient-to-b from-pink-500 to-purple-600" />}
                <div className="relative shrink-0">
                  <Avatar src={t.profile_pic} name={t.name ?? t.username ?? '?'} />
                  {t.human_mode && <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center text-[9px]">🙋</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm truncate ${t.unread ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>{t.name ?? (t.username ? `@${t.username}` : 'Contato')}</p>
                    <span className="text-[10px] text-gray-400 shrink-0">{fmtTime(t.last_message_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <p className={`text-xs truncate flex-1 ${t.unread ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>{t.last_message_text ?? '—'}</p>
                    {t.unread && <span className="w-2 h-2 rounded-full bg-pink-500 shrink-0" />}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Conversa */}
        <div className={`flex-1 flex flex-col min-w-0 ${activeId ? 'flex' : 'hidden sm:flex'}`}>
          {!active ? (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 gap-3">
              <span className="w-16 h-16 rounded-2xl bg-white shadow-sm flex items-center justify-center text-3xl">💬</span>
              <p className="text-sm">Selecione uma conversa para começar</p>
            </div>
          ) : (
            <>
              {/* Header da conversa */}
              <div className="flex items-center gap-3 px-4 py-2.5 bg-white/80 backdrop-blur border-b border-gray-100 shrink-0">
                <button onClick={() => setActiveId(null)} className="sm:hidden text-gray-500 text-lg pr-1">←</button>
                <div className="ring-2 ring-purple-100 rounded-full"><Avatar src={active.profile_pic} name={active.name ?? active.username ?? '?'} size={40} /></div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate leading-tight">{active.name ?? (active.username ? `@${active.username}` : 'Contato')}</p>
                  {active.username && <a href={`https://instagram.com/${active.username}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-purple-500 hover:underline">@{active.username}</a>}
                </div>
                <button onClick={toggleHuman}
                  className={`ml-auto text-xs font-semibold px-3.5 py-2 rounded-full transition-all shadow-sm ${active.human_mode ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                  {active.human_mode ? '🙋 Você no comando' : '🤖 IA no comando'}
                </button>
              </div>

              {active.human_mode && (
                <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700 text-center">
                  Você assumiu esta conversa — a IA e as automações estão pausadas. Toque em <strong>🙋 Você no comando</strong> para devolver pra IA.
                </div>
              )}

              {/* Mensagens */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-1"
                style={{ background: 'linear-gradient(180deg, #faf9fb 0%, #f4f2f7 100%)' }}>
                {messages.map((m, i) => {
                  const prev = messages[i - 1]
                  const showDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at)
                  return (
                    <React.Fragment key={m.id}>
                      {showDay && (
                        <div className="flex justify-center my-3">
                          <span className="text-[10px] font-medium text-gray-400 bg-white/80 rounded-full px-3 py-1 shadow-sm">{dayLabel(m.created_at)}</span>
                        </div>
                      )}
                      <div className={`max-w-[72%] ${m.direction === 'in' ? 'self-start' : 'self-end'}`}>
                        <div className={`px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm ${
                          m.direction === 'in'
                            ? 'bg-white text-gray-800 rounded-3xl rounded-bl-lg'
                            : 'bg-gradient-to-br from-pink-500 to-purple-600 text-white rounded-3xl rounded-br-lg'
                        }`} style={{ overflowWrap: 'anywhere' }}>{m.text}</div>
                        <p className={`text-[10px] text-gray-400 mt-1 px-1 ${m.direction === 'in' ? '' : 'text-right'}`}>
                          {m.direction === 'out' && m.source ? `${SOURCE_LABEL[m.source] ?? m.source} · ` : ''}{fmtTime(m.created_at)}
                        </p>
                      </div>
                    </React.Fragment>
                  )
                })}
                {messages.length === 0 && <p className="text-center text-sm text-gray-400 mt-10">Sem mensagens registradas ainda</p>}
              </div>

              {sendError && (
                <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600 flex items-center gap-2">
                  <span>⚠️</span>{sendError}
                </div>
              )}

              {/* Composer */}
              <div className="px-3 py-3 bg-white border-t border-gray-100 flex items-center gap-2 shrink-0">
                <EmojiPicker onPick={e => setInput(v => v + e)} up align="left" />
                <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') send() }}
                  placeholder={active.human_mode ? 'Escreva sua resposta…' : 'Responder assume a conversa (a IA pausa)…'}
                  className="flex-1 min-w-0 px-4 py-3 rounded-full bg-gray-50 border border-transparent focus:border-purple-200 focus:bg-white outline-none text-sm transition-colors" />
                <button onClick={send} disabled={sending || !input.trim()}
                  className="w-11 h-11 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 text-white flex items-center justify-center disabled:opacity-40 shadow-md shadow-purple-200 hover:scale-105 active:scale-95 transition-transform shrink-0">
                  {sending ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : '➤'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
