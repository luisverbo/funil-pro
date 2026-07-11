'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { resolveTheme } from '@/lib/quiz/theme'
import type { QuizTheme } from '@/app/actions/quiz-v2'

export interface LandingConfig {
  theme?: QuizTheme
  headline?: string
  subheadline?: string
  avatar_url?: string
  quick_replies?: string[]
  capture_mode?: 'inline' | 'gate' | 'none'
  capture_after?: number        // nº de mensagens do agente antes de pedir contato (modo inline)
  pixel_id?: string
}

interface Msg { role: 'user' | 'agent'; content: string }
type Action = { type: string; data?: Record<string, unknown> }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ChatLanding({ slug, agentName, greeting, config }: {
  slug: string
  agentName: string
  greeting: string
  config: LandingConfig
}) {
  const theme = resolveTheme(config.theme)
  const primary = '#6366f1'

  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [typing, setTyping] = useState(false)
  const [conversationId, setConversationId] = useState<string | undefined>()
  const [agentMsgCount, setAgentMsgCount] = useState(0)
  const [captured, setCaptured] = useState(false)
  const [showCapture, setShowCapture] = useState(config.capture_mode === 'gate')
  const [lastAction, setLastAction] = useState<Action | null>(null)
  const [cap, setCap] = useState({ name: '', email: '', phone: '' })
  const [capError, setCapError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const utmRef = useRef<Record<string, string>>({})
  const landingUrlRef = useRef<string>('')

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing, showCapture])

  // Captura UTMs da URL uma vez
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const utm: Record<string, string> = {}
    ;['utm_source','utm_campaign','utm_campaign_id','utm_adset_id','utm_ad_id','utm_content'].forEach(k => {
      const v = p.get(k); if (v) utm[k] = v
    })
    utmRef.current = utm
    landingUrlRef.current = window.location.href
    // Pixel opcional
    if (config.pixel_id && typeof window !== 'undefined') {
      const w = window as unknown as { fbq?: (...a: unknown[]) => void }
      w.fbq?.('track', 'PageView')
    }
  }, [config.pixel_id])

  // Saudação inicial: chat começa VAZIO, mostra "digitando…" e a saudação
  // "chega" depois de um tempo proporcional ao texto — dá o ar de um atendente
  // de verdade digitando na hora, em vez de a mensagem já estar lá pronta.
  useEffect(() => {
    const delay = Math.min(2800, Math.max(1400, greeting.length * 32))
    setTyping(true)
    const t = setTimeout(() => {
      setTyping(false)
      setMessages([{ role: 'agent', content: greeting }])
      setAgentMsgCount(1)
    }, delay)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const revealParts = useCallback(async (parts: string[]) => {
    for (const part of parts) {
      setTyping(true)
      await new Promise(r => setTimeout(r, Math.min(4000, Math.max(1200, part.length * 35))))
      setTyping(false)
      setMessages(m => [...m, { role: 'agent', content: part }])
      setAgentMsgCount(c => c + 1)
    }
  }, [])

  async function sendMessage(text: string) {
    const clean = text.trim()
    if (!clean || typing) return
    setInput('')
    setMessages(m => [...m, { role: 'user', content: clean }])
    setTyping(true)
    try {
      const res = await fetch(`/api/agents/public/${slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: clean,
          conversationId,
          utm: utmRef.current,
          landingUrl: landingUrlRef.current,
        }),
      })
      const data = await res.json() as { parts?: string[]; reply?: string; conversationId?: string; action?: Action; error?: string }
      setTyping(false)
      if (data.conversationId) setConversationId(data.conversationId)
      if (data.error) {
        await revealParts(['Tive um probleminha aqui. Pode tentar de novo em instantes? 🙏'])
        return
      }
      const parts = (data.parts && data.parts.length > 0) ? data.parts : (data.reply ? [data.reply] : [])
      await revealParts(parts)
      if (data.action) setLastAction(data.action)

      // Captura inline: após N mensagens do agente, pede contato (se ainda não
      // capturou). Default 4 (não 2) pra não pular por cima do início da conversa,
      // onde o próprio agente já pede o nome de forma natural.
      const after = config.capture_after ?? 4
      if (config.capture_mode !== 'none' && !captured && (agentMsgCount + parts.length) >= after) {
        setShowCapture(true)
      }
    } catch {
      setTyping(false)
      await revealParts(['Tive um probleminha de conexão. Pode tentar de novo? 🙏'])
    }
  }

  async function submitCapture() {
    setCapError(null)
    if (config.capture_mode === 'gate' || cap.email || cap.phone) {
      if (cap.email && !EMAIL_RE.test(cap.email)) { setCapError('E-mail inválido'); return }
      if (cap.phone && cap.phone.replace(/\D/g, '').length < 10) { setCapError('Telefone inválido'); return }
      if (!cap.email && !cap.phone) { setCapError('Informe e-mail ou WhatsApp'); return }
    }
    // Envia os dados de captura junto de uma mensagem de contexto
    setShowCapture(false)
    setCaptured(true)
    const w = window as unknown as { fbq?: (...a: unknown[]) => void }
    w.fbq?.('track', 'Lead')
    setTyping(true)
    try {
      const res = await fetch(`/api/agents/public/${slug}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: config.capture_mode === 'gate' ? 'Olá!' : '(dados de contato enviados)',
          conversationId,
          leadData: cap,
          utm: utmRef.current,
          landingUrl: landingUrlRef.current,
        }),
      })
      const data = await res.json() as { parts?: string[]; reply?: string; conversationId?: string; action?: Action }
      setTyping(false)
      if (data.conversationId) setConversationId(data.conversationId)
      const parts = (data.parts && data.parts.length > 0) ? data.parts : (data.reply ? [data.reply] : [])
      await revealParts(parts)
      if (data.action) setLastAction(data.action)
    } catch { setTyping(false) }
  }

  const inputBg = theme.isDark ? '#1e293b' : '#ffffff'
  const inputText = theme.isDark ? '#f1f5f9' : '#111827'

  return (
    <div style={{ background: theme.background, backgroundImage: theme.backgroundImage ?? undefined, fontFamily: theme.fontFamily }}
      className="min-h-[100dvh] w-full flex flex-col items-center overflow-x-hidden">
      {theme.fontUrl && <link rel="stylesheet" href={theme.fontUrl} />}
      {config.pixel_id && (
        <img alt="" width={1} height={1} style={{ display: 'none' }}
          src={`https://www.facebook.com/tr?id=${config.pixel_id}&ev=PageView&noscript=1`} />
      )}

      <div className="w-full max-w-lg flex flex-col h-[100dvh]" style={{ background: theme.isDark ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.6)' }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: theme.cardBorder, background: theme.cardBg }}>
          {config.avatar_url
            ? <img src={config.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
            : <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ background: primary }}>{agentName.charAt(0).toUpperCase()}</div>}
          <div>
            <p className="font-semibold text-sm" style={{ color: theme.textColor }}>{agentName}</p>
            <p className="text-xs flex items-center gap-1" style={{ color: theme.mutedColor }}>
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> online
            </p>
          </div>
        </div>

        {/* Mensagens */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 flex flex-col gap-2">
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} theme={theme} primary={primary} />
          ))}
          {typing && <TypingDots theme={theme} />}

          {/* Ação de venda: botão de pagamento */}
          {lastAction?.type === 'sell' && typeof lastAction.data?.payment_link === 'string' && (
            <a href={lastAction.data.payment_link as string} target="_blank" rel="noopener noreferrer"
              onClick={() => { const w = window as unknown as { fbq?: (...a: unknown[]) => void }; w.fbq?.('track', 'InitiateCheckout') }}
              className="self-start mt-1 px-5 py-3 rounded-xl text-white font-semibold text-sm shadow-lg"
              style={{ background: primary, borderRadius: theme.buttonRadius }}>
              Finalizar compra →
            </a>
          )}

          {/* Captura de contato inline */}
          {showCapture && !captured && (
            <div className="self-stretch mt-2 p-4 rounded-2xl border" style={{ background: theme.cardBg, borderColor: theme.cardBorder }}>
              <p className="text-sm font-medium mb-3" style={{ color: theme.textColor }}>
                Para continuar, deixe seu contato 👇
              </p>
              <div className="flex flex-col gap-2">
                <input placeholder="Seu nome" value={cap.name} onChange={e => setCap(c => ({ ...c, name: e.target.value }))}
                  className="px-3 py-2 rounded-lg border outline-none w-full" style={{ background: inputBg, color: inputText, borderColor: theme.cardBorder, fontSize: 16 }} />
                <input type="tel" placeholder="Seu WhatsApp" value={cap.phone} onChange={e => setCap(c => ({ ...c, phone: e.target.value }))}
                  className="px-3 py-2 rounded-lg border outline-none w-full" style={{ background: inputBg, color: inputText, borderColor: theme.cardBorder, fontSize: 16 }} />
                <input type="email" placeholder="Seu e-mail" value={cap.email} onChange={e => setCap(c => ({ ...c, email: e.target.value }))}
                  className="px-3 py-2 rounded-lg border outline-none w-full" style={{ background: inputBg, color: inputText, borderColor: theme.cardBorder, fontSize: 16 }} />
                {capError && <p className="text-xs text-red-500">{capError}</p>}
                <button onClick={submitCapture} className="mt-1 px-4 py-2 rounded-lg text-white font-medium text-sm" style={{ background: primary, borderRadius: theme.buttonRadius }}>
                  Continuar
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Quick replies */}
        {messages.length > 0 && !typing && (config.quick_replies?.length ?? 0) > 0 && agentMsgCount <= 2 && (
          <div className="px-4 pb-2 flex gap-2 overflow-x-auto" style={{ scrollSnapType: 'x mandatory' }}>
            {config.quick_replies!.map((q, i) => (
              <button key={i} onClick={() => sendMessage(q)}
                className="whitespace-nowrap px-3 py-2 rounded-full text-sm border flex-shrink-0"
                style={{ borderColor: primary, color: primary, background: theme.cardBg, scrollSnapAlign: 'start' }}>
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-3 py-3 border-t flex gap-2" style={{ borderColor: theme.cardBorder, background: theme.cardBg, paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendMessage(input) }}
            placeholder="Digite sua mensagem…"
            className="flex-1 min-w-0 px-4 py-3 rounded-full outline-none border"
            // fontSize 16px: abaixo disso o iOS dá zoom automático ao focar e "desconfigura" o layout
            style={{ background: inputBg, color: inputText, borderColor: theme.cardBorder, fontSize: 16 }}
          />
          <button onClick={() => sendMessage(input)} disabled={typing}
            className="w-11 h-11 rounded-full flex items-center justify-center text-white disabled:opacity-50 flex-shrink-0"
            style={{ background: primary }}>
            ➤
          </button>
        </div>
      </div>
    </div>
  )
}

function Bubble({ role, content, theme, primary }: { role: 'user' | 'agent'; content: string; theme: ReturnType<typeof resolveTheme>; primary: string }) {
  const isUser = role === 'user'
  // Links clicáveis + quebra forçada (URL longa sem quebra estourava o layout no mobile)
  const parts = content.split(/(https?:\/\/[^\s]+)/g)
  return (
    <div className={`max-w-[80%] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${isUser ? 'self-end' : 'self-start'}`}
      style={{
        background: isUser ? primary : theme.cardBg,
        color: isUser ? '#ffffff' : theme.textColor,
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        border: isUser ? 'none' : `1px solid ${theme.cardBorder}`,
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
      }}>
      {parts.map((p, i) => /^https?:\/\//.test(p)
        ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline font-medium break-all"
            style={{ color: isUser ? '#ffffff' : primary }}>{p}</a>
        : <React.Fragment key={i}>{p}</React.Fragment>
      )}
    </div>
  )
}

function TypingDots({ theme }: { theme: ReturnType<typeof resolveTheme> }) {
  return (
    <div className="self-start px-4 py-3 flex items-center gap-1" style={{ background: theme.cardBg, borderRadius: '18px 18px 18px 4px', border: `1px solid ${theme.cardBorder}` }}>
      {[0, 150, 300].map(d => (
        <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: theme.mutedColor, animationDelay: `${d}ms` }} />
      ))}
    </div>
  )
}
