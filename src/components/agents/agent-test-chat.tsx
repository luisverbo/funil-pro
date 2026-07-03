'use client'

import React, { useState, useRef, useEffect } from 'react'

interface Msg { role: 'lead' | 'agent'; content: string }

const ACTION_LABELS: Record<string, string> = {
  qualify: 'Lead qualificado',
  route: 'Lead roteado para o funil',
  sell: 'Venda concluída',
  handoff: 'Transferido para atendimento humano',
}

export default function AgentTestChat({ agentId }: { agentId: string }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [banner, setBanner] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setMessages(m => [...m, { role: 'lead', content: text }])
    setLoading(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId, testMode: true }),
      })
      const data = await res.json() as { reply?: string; parts?: string[]; conversationId?: string; action?: { type: string } }
      if (data.conversationId) setConversationId(data.conversationId)

      // Animate parts one by one, com delay de "digitando" proporcional ao tamanho
      const parts = (data.parts && data.parts.length > 0) ? data.parts : (data.reply ? [data.reply] : [])
      for (const part of parts) {
        const typingMs = Math.min(5000, Math.max(1500, part.length * 40))
        await new Promise(r => setTimeout(r, typingMs))
        setMessages(m => [...m, { role: 'agent', content: part }])
      }

      if (data.action && data.action.type !== 'continue') {
        setBanner(ACTION_LABELS[data.action.type] ?? data.action.type)
      }
    } catch {
      setMessages(m => [...m, { role: 'agent', content: 'Erro ao processar mensagem.' }])
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setMessages([])
    setConversationId(undefined)
    setBanner(null)
  }

  return (
    <div className="flex flex-col h-[440px] border rounded-xl overflow-hidden bg-gray-50">
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b">
        <span className="text-sm font-medium text-gray-700">Teste do agente</span>
        <button onClick={reset} className="text-xs text-indigo-600 hover:underline">Reiniciar</button>
      </div>

      {banner && (
        <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-200 text-emerald-700 text-sm font-medium">
          ✓ {banner}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {messages.length === 0 && (
          <p className="text-center text-sm text-gray-400 mt-8">Envie uma mensagem para iniciar o teste</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
            m.role === 'lead'
              ? 'self-end bg-indigo-600 text-white rounded-br-sm'
              : 'self-start bg-white border text-gray-800 rounded-bl-sm'
          }`}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="self-start bg-white border text-gray-400 px-3 py-2 rounded-2xl text-sm flex items-center gap-1">
            <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
            <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
            <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
          </div>
        )}
      </div>

      <div className="flex gap-2 p-3 bg-white border-t">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder="Digite uma mensagem…"
          className="flex-1 px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <button
          onClick={send}
          disabled={loading}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-indigo-700"
        >
          Enviar
        </button>
      </div>
    </div>
  )
}
