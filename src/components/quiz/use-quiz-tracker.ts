'use client'
// ============================================================================
// Quiz v2 — rastreio do visitante (lead "em andamento", eventos, contato,
// conclusão) e integrações por bloco (pixel, webhook, matrícula em funil).
// Mesmos endpoints do renderer de páginas — o modo conversa usa daqui.
// ============================================================================
import { useRef } from 'react'
import type { BlockConfig } from '@/app/actions/quiz-v2'

declare global {
  interface Window { fbq?: (...args: unknown[]) => void }
}

export function useQuizTracker(pageId: string) {
  const leadIdRef = useRef<string | null>(null)
  const trackUrl = `/api/quiz/${pageId}/track`

  async function start() {
    try {
      const utm: Record<string, string> = {}
      if (typeof window !== 'undefined') {
        const sp = new URLSearchParams(window.location.search)
        for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) { const v = sp.get(k); if (v) utm[k] = v }
      }
      const res = await fetch(trackUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', utm, referrer: typeof document !== 'undefined' ? document.referrer : '', landing_url: typeof window !== 'undefined' ? window.location.href : '' }),
      })
      const data = await res.json()
      leadIdRef.current = data.leadId ?? null
    } catch { /* silencioso */ }
  }
  const post = (body: Record<string, unknown>) => { if (leadIdRef.current) fetch(trackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: leadIdRef.current, ...body }) }).catch(() => {}) }
  return {
    start,
    track: (eventType: string, quizPageId: string, blockId: string | null, value: unknown) => post({ action: 'event', pageId: quizPageId, blockId, eventType, value }),
    trackContact: (name?: string, email?: string, phone?: string) => post({ action: 'contact', name, email, phone }),
    trackComplete: (score: number, resultShown: string | null) => post({ action: 'complete', score, resultShown }),
    getLeadId: () => leadIdRef.current,
  }
}

export function dispararPixel(config: BlockConfig) {
  if (typeof window === 'undefined' || !window.fbq) return
  const ev = config.pixel_event
  if (!ev || ev === 'none') return
  if (ev === 'custom') { if (config.pixel_event_custom) window.fbq('trackCustom', config.pixel_event_custom) }
  else window.fbq('track', ev)
}

/** Pixel + webhook + matrícula em funil do bloco (botão / captura final). */
export function dispararIntegracoes(pageId: string, leadId: string | null, blockId: string, config: BlockConfig, ctx: { answers: Record<string, unknown>; score: number; name?: string; email?: string; phone?: string }) {
  dispararPixel(config)
  if (config.webhook_enabled && config.webhook_url) {
    const payload: Record<string, unknown> = {}
    if (config.webhook_send_name) payload.name = ctx.name
    if (config.webhook_send_email) payload.email = ctx.email
    if (config.webhook_send_phone) payload.phone = ctx.phone
    if (config.webhook_send_answers) payload.answers = ctx.answers
    if (config.webhook_send_score) payload.score = ctx.score
    fetch(`/api/quiz/${pageId}/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId, leadId, url: config.webhook_url, payload }) }).catch(() => {})
  }
  if (config.funnel_enroll_enabled && config.funnel_enroll_id && ctx.phone) {
    fetch(`/api/quiz/${pageId}/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ funnelId: config.funnel_enroll_id, phone: ctx.phone, name: ctx.name, email: ctx.email }) }).catch(() => {})
  }
}
