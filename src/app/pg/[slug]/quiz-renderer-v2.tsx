'use client'

import { useState, useRef, useEffect } from 'react'
import type { QuizData, QuizBlock, BlockOption, BlockConfig, CarouselItem, ChartDatum } from '@/app/actions/quiz-v2'
import { resolveTheme } from '@/lib/quiz/theme'

interface Props {
  data: QuizData
  pageId: string
  tenantId: string
}

declare global {
  interface Window { fbq?: (...args: unknown[]) => void }
}

// Blocos que NÃO são perguntas/inputs — usados para validação, auto-advance e detecção de landing
const NON_INPUT_BLOCKS = new Set([
  'result','heading','text_block','image','video','audio','button',
  'hero','testimonials','features','faq','countdown','pricing',
  'alert','notification','loading','level','checklist','before_after','carousel',
  'metrics','chart','spacer','html_embed',
])
const LANDING_BLOCKS = new Set([
  'hero','testimonials','features','faq','countdown','heading','text_block','image','video','audio',
  'pricing','alert','notification','loading','level','checklist','before_after','carousel',
  'metrics','chart','spacer','html_embed',
])

// Envolve um bloco para aparecer só depois de `delay` segundos (com fade-in).
// Avisa o pai (onReveal) quando revela, para a validação só considerar blocos visíveis.
function TimedBlock({ delay, onReveal, spaceAfter, children }: { delay?: number; onReveal?: () => void; spaceAfter?: number; children: React.ReactNode }) {
  const [show, setShow] = useState(!delay || delay <= 0)
  const revealCb = useRef(onReveal)
  revealCb.current = onReveal
  useEffect(() => {
    if (!delay || delay <= 0) { revealCb.current?.(); return }
    const t = setTimeout(() => { setShow(true); revealCb.current?.() }, delay * 1000)
    return () => clearTimeout(t)
  }, [delay])
  if (!show) return null
  return <div style={{ animation: 'fadeInUp 400ms cubic-bezier(0.4,0,0.2,1)', marginBottom: spaceAfter ?? 24 }}>{children}</div>
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isValidEmail = (v: string) => EMAIL_RE.test(v.trim())
const isValidPhone = (v: string) => v.replace(/\D/g, '').length >= 10   // DDD + número

// Embed de HTML/script isolado em iframe sandbox — auto-ajusta a altura ao conteúdo.
function HtmlEmbed({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(120)
  const srcDoc = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>${html}</body></html>`
  useEffect(() => {
    // mede a altura por ~10s após montar (scripts terminam de renderizar) e para —
    // antes o intervalo rodava pra sempre em cada embed (vazamento)
    let ticks = 0
    const iv = setInterval(() => {
      ticks++
      try {
        const h = ref.current?.contentWindow?.document?.body?.scrollHeight
        if (h) setHeight(prev => Math.abs(h - prev) > 4 ? h : prev)
      } catch { /* cross-origin */ }
      if (ticks >= 20) clearInterval(iv)
    }, 500)
    return () => clearInterval(iv)
  }, [])
  return (
    <iframe ref={ref} srcDoc={srcDoc} sandbox="allow-scripts allow-popups allow-forms"
      style={{ width: '100%', height, border: 'none' }} title="embed" />
  )
}

function firePixelEvent(config: BlockConfig) {
  if (typeof window === 'undefined' || !window.fbq) return
  const ev = config.pixel_event
  if (!ev || ev === 'none') return
  if (ev === 'custom') {
    if (config.pixel_event_custom) window.fbq('trackCustom', config.pixel_event_custom)
  } else {
    window.fbq('track', ev)
  }
}

function CountdownBlock({ config, blockId }: { config: BlockConfig; blockId: string }) {
  const [remaining, setRemaining] = useState<number | null>(null)

  useEffect(() => {
    function computeTarget(): number {
      if (config.countdown_mode === 'date' && config.countdown_target) {
        const t = new Date(config.countdown_target).getTime()
        // #26: data inválida → cai no evergreen em vez de renderizar "NaN"
        if (!Number.isNaN(t)) return t
      }
      // evergreen: persiste por visitante no localStorage
      const key = `qz_cd_${blockId}`
      const stored = localStorage.getItem(key)
      if (stored) return Number(stored)
      const target = Date.now() + (config.countdown_minutes ?? 15) * 60_000
      localStorage.setItem(key, String(target))
      return target
    }
    const target = computeTarget()
    const tick = () => setRemaining(Math.max(0, target - Date.now()))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [config.countdown_mode, config.countdown_target, config.countdown_minutes, blockId])

  if (remaining === null) return null

  if (remaining <= 0) {
    return <p className="text-center text-lg font-semibold text-red-500">{config.countdown_expired_text || 'Oferta encerrada'}</p>
  }

  const h = Math.floor(remaining / 3_600_000)
  const m = Math.floor((remaining % 3_600_000) / 60_000)
  const s = Math.floor((remaining % 60_000) / 1000)
  const cells = h > 0 ? [h, m, s] : [m, s]
  const labels = h > 0 ? ['h', 'min', 'seg'] : ['min', 'seg']

  return (
    <div className="text-center">
      {config.countdown_text && <p className="text-base font-medium mb-2 opacity-80">{config.countdown_text}</p>}
      <div className="flex gap-2 justify-center">
        {cells.map((v, i) => (
          <div key={i} className="bg-gray-900 text-white rounded-xl px-3 py-2 min-w-[3.2rem]">
            <div className="text-2xl font-mono font-bold">{String(v).padStart(2, '0')}</div>
            <div className="text-[10px] text-gray-400 uppercase">{labels[i]}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function getYoutubeEmbed(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([^&?/]+)/)
  if (match) return `https://www.youtube.com/embed/${match[1]}`
  const vimeo = url.match(/vimeo\.com\/(\d+)/)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`
  return url.includes('embed') ? url : null
}

type ThemeShape = ReturnType<typeof resolveTheme>

// Prova social: alterna mensagens estilo toast
// Sininho suave gerado no navegador (sem arquivo externo) — só toca após a
// pessoa já ter interagido com a página (política de autoplay), o que sempre
// acontece no quiz.
function playDing() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    o.type = 'sine'; o.frequency.value = 880
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.06, ctx.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45)
    o.start(); o.stop(ctx.currentTime + 0.45)
    o.onended = () => ctx.close().catch(() => {})
  } catch {}
}

function NotificationBlock({ config }: { config: BlockConfig }) {
  const items = config.notification_items ?? []
  const interval = (config.notification_interval ?? 5) * 1000
  const pos = config.notification_position ?? 'bottom'
  const color = config.notification_color || '#16a34a'
  const [idx, setIdx] = useState(0)
  const [done, setDone] = useState(false)

  // Passa UMA vez pelos itens e para (sem loop). 1 item: mostra e some.
  useEffect(() => {
    if (items.length === 0) return
    if (items.length === 1) { const t = setTimeout(() => setDone(true), interval + 1200); return () => clearTimeout(t) }
    const iv = setInterval(() => {
      setIdx(i => {
        if (i >= items.length - 1) { clearInterval(iv); setTimeout(() => setDone(true), interval); return i }
        return i + 1
      })
    }, interval)
    return () => clearInterval(iv)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, interval])

  // Sininho a cada notificação que entra
  useEffect(() => {
    if (items.length === 0 || done) return
    if (config.notification_sound) playDing()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, done])

  if (items.length === 0 || done) return null
  const card = (
    <div key={idx} className="flex items-center gap-3 bg-white rounded-xl px-4 py-3 shadow-lg pointer-events-auto"
      style={{ animation: 'fadeInUp 400ms ease', borderLeft: `4px solid ${color}` }}>
      <span className="w-8 h-8 rounded-full flex items-center justify-center text-base shrink-0" style={{ background: color + '22' }}>🔔</span>
      <span className="text-sm text-gray-800">{items[idx].text}</span>
    </div>
  )
  if (pos === 'inline') return card
  return (
    <div className="fixed z-[60] left-4 right-4 sm:left-auto sm:right-6 sm:max-w-xs pointer-events-none"
      style={pos === 'top' ? { top: 16 } : { bottom: 16 }}>
      {card}
    </div>
  )
}

// Animação de carregamento que revela/avança após N segundos
function LoadingBlock({ config, onDone, theme, primaryColor }: { config: BlockConfig; onDone: () => void; theme: ThemeShape; primaryColor: string }) {
  const [done, setDone] = useState(false)
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const total = (config.loading_seconds ?? 3) * 1000
    const step = 50
    let elapsed = 0
    const iv = setInterval(() => {
      elapsed += step
      setPct(Math.min(100, Math.round((elapsed / total) * 100)))
      if (elapsed >= total) { clearInterval(iv); setDone(true); onDone() }
    }, step)
    return () => clearInterval(iv)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Ao terminar, se NÃO for o loading que avança a página, some de cena — assim
  // dá pra encadear vários (um aparece via "Aparecer após", roda a duração e sai,
  // e o próximo entra no lugar). O que avança a página mantém-se até trocar.
  if (done && !config.loading_auto_advance) return null
  return (
    <div className="text-center py-6" style={{ animation: 'fadeInUp 300ms ease' }}>
      <div className="inline-block w-10 h-10 border-4 rounded-full animate-spin mb-4" style={{ borderColor: theme.isDark ? '#334155' : '#e5e7eb', borderTopColor: primaryColor }} />
      <p className="text-base font-medium mb-3" style={{ color: theme.textColor }}>{config.loading_text || 'Carregando...'}</p>
      <div className="max-w-xs mx-auto h-2 rounded-full overflow-hidden" style={{ background: theme.isDark ? '#334155' : '#e5e7eb' }}>
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: primaryColor }} />
      </div>
    </div>
  )
}

// Carrossel de imagens
function CarouselBlock({ items, theme, fit = 'contain', height = 320 }: { items: CarouselItem[]; theme: ThemeShape; fit?: 'cover' | 'contain'; height?: number }) {
  const [idx, setIdx] = useState(0)
  if (items.length === 0) return null
  const go = (d: number) => setIdx(i => (i + d + items.length) % items.length)
  return (
    <div className="relative rounded-2xl overflow-hidden" style={{ border: theme.cardBorder, background: fit === 'contain' ? (theme.isDark ? '#0f172a' : '#f1f5f9') : undefined }}>
      <img src={items[idx].image_url} alt="" className="w-full" style={{ height, objectFit: fit }} />
      {items[idx].caption && <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-sm px-4 py-2">{items[idx].caption}</div>}
      {items.length > 1 && (
        <>
          <button onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 text-gray-800 flex items-center justify-center">‹</button>
          <button onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 text-gray-800 flex items-center justify-center">›</button>
          <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5">
            {items.map((_, i) => <div key={i} className={`w-2 h-2 rounded-full ${i === idx ? 'bg-white' : 'bg-white/40'}`} />)}
          </div>
        </>
      )}
    </div>
  )
}

// Gráfico de pizza em CSS (conic-gradient)
function PieChart({ data, theme }: { data: ChartDatum[]; theme: ThemeShape }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  let acc = 0
  const stops = data.map(d => {
    const start = (acc / total) * 360
    acc += d.value
    const end = (acc / total) * 360
    return `${d.color || '#6366f1'} ${start}deg ${end}deg`
  }).join(', ')
  return (
    <div className="flex items-center gap-5 justify-center flex-wrap">
      <div className="w-36 h-36 rounded-full" style={{ background: `conic-gradient(${stops})` }} />
      <div className="space-y-1.5">
        {data.map(d => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full" style={{ background: d.color || '#6366f1' }} />
            <span style={{ color: theme.textColor }}>{d.label}</span>
            <span style={{ color: theme.mutedColor }}>({Math.round((d.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tracking ─────────────────────────────────────────────────────────────────

function useTracker(pageId: string) {
  const leadIdRef = useRef<string | null>(null)
  const trackUrl = `/api/quiz/${pageId}/track`

  async function start() {
    try {
      const res = await fetch(trackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      const data = await res.json()
      leadIdRef.current = data.leadId ?? null
    } catch { /* silent */ }
  }

  function track(eventType: string, quizPageId: string, blockId: string | null, value: unknown) {
    if (!leadIdRef.current) return
    fetch(trackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'event',
        leadId: leadIdRef.current,
        pageId: quizPageId,
        blockId,
        eventType,
        value,
      }),
    }).catch(() => {})
  }

  function trackContact(name?: string, email?: string, phone?: string) {
    if (!leadIdRef.current) return
    fetch(trackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'contact', leadId: leadIdRef.current, name, email, phone }),
    }).catch(() => {})
  }

  function trackComplete(score: number, resultShown: string | null) {
    if (!leadIdRef.current) return
    fetch(trackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete', leadId: leadIdRef.current, score, resultShown }),
    }).catch(() => {})
  }

  function getLeadId() { return leadIdRef.current }

  return { start, track, trackContact, trackComplete, getLeadId }
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export default function QuizRendererV2({ data, pageId, tenantId }: Props) {
  const primaryColor = data.settings.primary_color || '#6366f1'
  const showProgress = data.settings.show_progress !== false
  const pages = data.pages
  const theme = resolveTheme(data.settings.theme)
  const logoUrl = data.settings.logo_url

  const [pageIdx, setPageIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [score, setScore] = useState(0)
  const [leadData, setLeadData] = useState<{ name?: string; email?: string; phone?: string }>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<'answering' | 'submitting' | 'done'>('answering')
  const [resultBlock, setResultBlock] = useState<QuizBlock | null>(null)
  const [transitionKey, setTransitionKey] = useState(0)
  // Blocos com appear_delay que já foram revelados — usado para não validar/errar
  // um obrigatório que ainda está escondido (senão o quiz trava sem feedback).
  const [revealedBlocks, setRevealedBlocks] = useState<Set<string>>(new Set())
  const captureRef = useRef<{ name: string; email: string; phone: string }>({ name: '', email: '', phone: '' })

  function isRevealed(block: QuizBlock): boolean {
    const d = block.config.appear_delay
    return !d || d <= 0 || revealedBlocks.has(block.id)
  }
  const markRevealed = (id: string) => setRevealedBlocks(prev => prev.has(id) ? prev : new Set(prev).add(id))

  // #7: pontuação SEMPRE derivada de `answers`, nunca acumulada. Acumular fazia o
  // "Voltar" + avançar somar a mesma página duas vezes.
  function computeScore(ans: Record<string, unknown>): number {
    let total = 0
    for (const p of pages) {
      for (const block of p.blocks) {
        if (['single_choice', 'yes_no'].includes(block.type)) {
          const chosen = (block.config.options ?? []).find(o => o.label === ans[block.id])
          total += chosen?.points ?? 0
        } else if (block.type === 'multi_choice') {
          for (const lbl of (ans[block.id] as string[]) ?? []) {
            total += (block.config.options ?? []).find(o => o.label === lbl)?.points ?? 0
          }
        } else if (block.type === 'scale') {
          // escala soma o valor escolhido na pontuação (NPS/diagnóstico)
          const v = ans[block.id]
          if (typeof v === 'number') total += v
        }
      }
    }
    return total
  }

  // Personalização: {{identificador}} puxa a resposta do campo com aquele
  // "identificador" (definido no editor). Também há atalhos prontos:
  // {{nome}}, {{email}}, {{telefone}}, {{score}}.
  function resolveVars(text: string): string {
    if (!text || !text.includes('{{')) return text
    // mapa: identificador do campo (minúsculo) → resposta
    const map: Record<string, string> = {}
    for (const p of pages) for (const b of p.blocks) {
      const a = answers[b.id]
      if (a == null || a === '') continue
      const key = (b.config.field_key || '').trim().toLowerCase()
      if (key) map[key] = Array.isArray(a) ? a.join(', ') : String(a)
    }
    // valores "inteligentes": campo marcado com esse identificador > leadData >
    // 1º campo do tipo (fallback pra funcionar sem configurar nada)
    let name = leadData.name || captureRef.current.name || map['nome'] || map['name'] || ''
    let email = leadData.email || captureRef.current.email || map['email'] || ''
    let phone = leadData.phone || captureRef.current.phone || map['telefone'] || map['whatsapp'] || ''
    for (const p of pages) for (const b of p.blocks) {
      const a = answers[b.id]; if (a == null || a === '') continue
      if (b.type === 'field_text' && !name) name = String(a)
      if (b.type === 'field_email' && !email) email = String(a)
      if (b.type === 'field_phone' && !phone) phone = String(a)
    }
    const firstName = name.trim().split(/\s+/)[0] || ''
    return text.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (m, raw) => {
      const k = String(raw).toLowerCase()
      if (k === 'nome' || k === 'name' || k === 'primeiro_nome') return firstName || (map[k] ?? m)
      if (k === 'nome_completo' || k === 'full_name') return name
      if (k === 'email' || k === 'e-mail') return email
      if (k === 'telefone' || k === 'whatsapp' || k === 'phone') return phone
      if (k === 'score') return String(score)
      return map[k] ?? m   // identificador personalizado; se não achar, mantém o texto
    })
  }

  const tracker = useTracker(pageId)

  function fireIntegrations(
    blockId: string,
    config: import('@/app/actions/quiz-v2').BlockConfig,
    context: { answers: Record<string, unknown>; score: number; name?: string; email?: string; phone?: string }
  ) {
    const leadId = tracker.getLeadId()

    firePixelEvent(config)

    if (config.webhook_enabled && config.webhook_url) {
      const payload: Record<string, unknown> = {}
      if (config.webhook_send_name)    payload.name    = context.name
      if (config.webhook_send_email)   payload.email   = context.email
      if (config.webhook_send_phone)   payload.phone   = context.phone
      if (config.webhook_send_answers) payload.answers = context.answers
      if (config.webhook_send_score)   payload.score   = context.score
      fetch(`/api/quiz/${pageId}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockId, leadId, url: config.webhook_url, payload }),
      }).catch(() => {})
    }

    if (config.funnel_enroll_enabled && config.funnel_enroll_id && context.phone) {
      fetch(`/api/quiz/${pageId}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funnelId: config.funnel_enroll_id,
          phone: context.phone,
          name: context.name,
          email: context.email,
        }),
      }).catch(() => {})
    }
  }

  // Start tracking session on mount
  useEffect(() => {
    tracker.start()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track page views + reseta blocos revelados ao entrar em cada página
  useEffect(() => {
    const currentPage = pages[pageIdx]
    if (!currentPage) return
    setRevealedBlocks(new Set())
    tracker.track('page_viewed', currentPage.id, null, {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIdx, pages])

  const currentPage = pages[pageIdx]
  const totalPages = pages.length
  const progressPct = Math.round(((pageIdx + 1) / Math.max(1, totalPages)) * 100)

  function setAnswer(blockId: string, value: unknown, quizPageId: string, eventType = 'choice_selected') {
    setAnswers(a => ({ ...a, [blockId]: value }))
    setErrors(e => { const ne = { ...e }; delete ne[blockId]; return ne })
    tracker.track(eventType, quizPageId, blockId, { selected: value })
  }

  function resolveNextPage(currentPageIdx: number, currentAnswers: Record<string, unknown>, currentScore: number): number | 'result' | 'end' {
    const page = pages[currentPageIdx]

    for (const block of page.blocks) {
      if (['single_choice', 'multi_choice', 'yes_no'].includes(block.type)) {
        const ans = currentAnswers[block.id]
        const opts = block.config.options ?? []
        if (block.type === 'single_choice' || block.type === 'yes_no') {
          const chosen = opts.find(o => o.label === ans)
          if (chosen?.goto_page_id) {
            const idx = pages.findIndex(p => p.id === chosen.goto_page_id)
            if (idx >= 0) return idx
          }
        } else if (block.type === 'multi_choice') {
          // múltipla escolha também ramifica: a 1ª opção marcada com destino vence
          const selected = Array.isArray(ans) ? ans as string[] : []
          const chosen = opts.find(o => selected.includes(o.label) && o.goto_page_id)
          if (chosen?.goto_page_id) {
            const idx = pages.findIndex(p => p.id === chosen.goto_page_id)
            if (idx >= 0) return idx
          }
        }
      }
    }

    const resultBlk = page.blocks.find(b => b.type === 'result')
    if (resultBlk) return 'result'

    for (let i = currentPageIdx + 1; i < pages.length; i++) {
      const rb = pages[i].blocks.find(b => b.type === 'result')
      if (rb) {
        const ranges = rb.config.score_ranges ?? []
        if (ranges.length > 0) {
          const match = ranges.find(r => currentScore >= r.min && currentScore <= r.max)
          if (match?.goto_page_id) {
            const idx = pages.findIndex(p => p.id === match.goto_page_id)
            if (idx >= 0) {
              const targetResult = pages[idx].blocks.find(b => b.type === 'result')
              // #17: se a página-alvo tem result, mostra; senão NAVEGA para ela
              // (antes a faixa era ignorada quando a página não tinha bloco result)
              if (targetResult) { setResultBlock(targetResult); return 'result' }
              return idx
            }
          }
          setResultBlock(rb)
          return 'result'
        }
      }
    }

    if (currentPageIdx + 1 >= pages.length) return 'end'
    return currentPageIdx + 1
  }

  function handleNext() {
    const page = pages[pageIdx]

    const newErrors: Record<string, string> = {}
    for (const block of page.blocks) {
      if (!isRevealed(block)) continue
      const val = answers[block.id]
      const empty = val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)

      if (block.config.required && !NON_INPUT_BLOCKS.has(block.type) && empty) {
        newErrors[block.id] = 'Campo obrigatório'
        continue
      }
      // #8: valida formato de email/telefone
      if (block.type === 'field_email' && !empty && !isValidEmail(String(val))) {
        newErrors[block.id] = 'E-mail inválido'
      }
      if (block.type === 'field_phone' && !empty && !isValidPhone(String(val))) {
        newErrors[block.id] = 'Telefone inválido'
      }
      if (block.type === 'final_capture') {
        const fc = captureRef.current
        if (block.config.show_name && block.config.required && !fc.name.trim()) newErrors[block.id] = 'Preencha seu nome'
        else if (block.config.show_email && (block.config.required || fc.email) && !isValidEmail(fc.email)) newErrors[block.id] = 'E-mail inválido'
        else if (block.config.show_phone && (block.config.required || fc.phone) && !isValidPhone(fc.phone)) newErrors[block.id] = 'Telefone inválido'
      }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }
    setErrors({})

    const newScore = computeScore(answers)
    let newLeadData = { ...leadData }
    for (const block of page.blocks) {
      if (block.type === 'field_text' && answers[block.id] && !newLeadData.name) {
        newLeadData = { ...newLeadData, name: String(answers[block.id]) }
        tracker.trackContact(String(answers[block.id]), undefined, undefined)
      }
      if (block.type === 'field_email' && answers[block.id]) {
        newLeadData = { ...newLeadData, email: String(answers[block.id]) }
        tracker.trackContact(undefined, String(answers[block.id]), undefined)
      }
      if (block.type === 'field_phone' && answers[block.id]) {
        newLeadData = { ...newLeadData, phone: String(answers[block.id]) }
        tracker.trackContact(undefined, undefined, String(answers[block.id]))
      }
      if (block.type === 'final_capture') {
        const fc = captureRef.current
        newLeadData = { ...newLeadData, name: fc.name || newLeadData.name, email: fc.email || newLeadData.email, phone: fc.phone || newLeadData.phone }
        tracker.trackContact(fc.name || undefined, fc.email || undefined, fc.phone || undefined)
        tracker.track('form_submitted', page.id, block.id, { name: fc.name, email: fc.email, phone: fc.phone })
        fireIntegrations(block.id, block.config, {
          answers,
          score: newScore,
          name: fc.name || newLeadData.name,
          email: fc.email || newLeadData.email,
          phone: fc.phone || newLeadData.phone,
        })
      }
    }
    setLeadData(newLeadData)
    setScore(newScore)

    const resultBlk = page.blocks.find(b => b.type === 'result')
    if (resultBlk) {
      setResultBlock(resultBlk)
      submitResult(resultBlk, newScore, newLeadData)
      return
    }

    const next = resolveNextPage(pageIdx, answers, newScore)
    if (next === 'result') {
      const rb = resultBlock ?? pages.flatMap(p => p.blocks).find(b => b.type === 'result')
      if (rb) { setResultBlock(rb); submitResult(rb, newScore, newLeadData) }
      return
    }
    if (next === 'end') { setPhase('done'); return }
    setTransitionKey(k => k + 1)
    setPageIdx(next as number)
  }

  async function submitResult(rb: QuizBlock, finalScore: number, ld: typeof leadData) {
    setPhase('submitting')

    const finalLd = { ...ld }
    if (captureRef.current.name)  finalLd.name  = captureRef.current.name
    if (captureRef.current.email) finalLd.email = captureRef.current.email
    if (captureRef.current.phone) finalLd.phone = captureRef.current.phone

    // Track completion
    tracker.track('quiz_completed', currentPage?.id ?? '', null, { score: finalScore, result: rb.config.title })
    tracker.trackComplete(finalScore, rb.config.title ?? null)

    try {
      await fetch(`/api/quiz/${pageId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          leadData: finalLd,
          result_profile: rb.config.title ?? null,
          funnel_id: rb.config.funnel_id ?? null,
          tenantId,
        }),
      })
    } catch { /* continue */ }

    setPhase('done')
    // #29: só auto-redireciona quando NÃO há botão de CTA visível (senão o botão
    // que o usuário ia clicar é atropelado pelo redirect).
    const cta = rb.config.cta_url
    if (cta && !rb.config.cta_text) setTimeout(() => { window.location.href = cta }, 1500)
  }

  function renderBlock(block: QuizBlock) {
    const { config } = block
    const val = answers[block.id]
    const err = errors[block.id]
    const page = pages[pageIdx]

    if (block.type === 'result' || phase !== 'answering') return null

    return (
      <TimedBlock key={block.id} delay={config.appear_delay} onReveal={() => markRevealed(block.id)} spaceAfter={config.space_after}>
      <div>
        {['single_choice', 'multi_choice', 'yes_no'].includes(block.type) && (
          <div>
            {config.question && (
              <div className="text-center mb-6">
                <h2 className="text-2xl md:text-3xl font-bold" style={{ color: theme.textColor }}>{resolveVars(config.question)}</h2>
                {config.subtitle && <p className="mt-1" style={{ color: theme.mutedColor }}>{resolveVars(config.subtitle)}</p>}
              </div>
            )}
            {(() => {
              const opts = config.options ?? []
              const hasImages = opts.some(o => o.image_url)
              const selectOption = (opt: BlockOption, isSelected: boolean) => {
                if (block.type === 'multi_choice') {
                  const cur = (val as string[]) ?? []
                  setAnswer(block.id, isSelected ? cur.filter(l => l !== opt.label) : [...cur, opt.label], page.id, 'choice_selected')
                } else {
                  setAnswer(block.id, opt.label, page.id, 'choice_selected')
                  const nonChoiceInputs = page.blocks.filter(b => !['single_choice','yes_no'].includes(b.type) && !NON_INPUT_BLOCKS.has(b.type))
                  const hasFinalCapture = page.blocks.some(b => b.type === 'final_capture')
                  // #6: só auto-avança quando há UMA única pergunta de escolha na página.
                  // Com duas single_choice, auto-avançar pularia a segunda sem resposta.
                  const choiceBlocks = page.blocks.filter(b => ['single_choice','yes_no'].includes(b.type))
                  if (nonChoiceInputs.length === 0 && !hasFinalCapture && choiceBlocks.length === 1) {
                    setTimeout(() => handleNextWithAnswer(block.id, opt.label), 350)
                  }
                }
              }

              if (hasImages) {
                return (
                  <div className="grid grid-cols-2 gap-3">
                    {opts.map((opt: BlockOption) => {
                      const isSelected = block.type === 'multi_choice'
                        ? Array.isArray(val) && (val as string[]).includes(opt.label)
                        : val === opt.label
                      return (
                        <button key={opt.id} onClick={() => selectOption(opt, isSelected)}
                          className={`rounded-2xl border-2 overflow-hidden text-left transition-all duration-150 shadow-sm ${isSelected ? 'scale-[0.98]' : 'hover:scale-[1.02]'}`}
                          style={isSelected ? { borderColor: primaryColor, backgroundColor: primaryColor + '10' } : { background: config.bg_color || theme.cardBg, borderColor: config.border_color || undefined, ...(config.border_color ? {} : { border: theme.cardBorder }) }}>
                          {opt.image_url
                            ? <img src={opt.image_url} alt="" className="w-full h-28 object-cover" />
                            : <div className="w-full h-28 bg-gray-100 flex items-center justify-center text-4xl">{opt.emoji || '🎯'}</div>}
                          <div className="px-3 py-2.5 flex items-center gap-2">
                            {opt.emoji && opt.image_url && <span className="text-lg shrink-0">{opt.emoji}</span>}
                            <span className="text-sm font-medium flex-1" style={{ color: theme.textColor }}>{opt.label}</span>
                            {isSelected && <span style={{ color: primaryColor }}>✓</span>}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )
              }

              return (
                <div className="space-y-3">
                  {opts.map((opt: BlockOption) => {
                    const isSelected = block.type === 'multi_choice'
                      ? Array.isArray(val) && (val as string[]).includes(opt.label)
                      : val === opt.label
                    return (
                      <button key={opt.id} onClick={() => selectOption(opt, isSelected)}
                        className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all duration-150 shadow-sm ${
                          isSelected ? 'scale-[0.99]' : 'hover:scale-[1.01]'
                        }`}
                        style={isSelected ? { borderColor: primaryColor, backgroundColor: primaryColor + '10' } : { background: config.bg_color || theme.cardBg, borderColor: config.border_color || undefined, ...(config.border_color ? {} : { border: theme.cardBorder }) }}
                      >
                        {block.type === 'multi_choice' && (
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition ${isSelected ? 'text-white' : 'border-gray-300'}`}
                            style={isSelected ? { background: primaryColor, borderColor: primaryColor } : undefined}>
                            {isSelected && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>}
                          </div>
                        )}
                        {opt.emoji && <span className="text-3xl shrink-0">{opt.emoji}</span>}
                        <span className="text-base font-medium flex-1" style={{ color: theme.textColor }}>{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })()}
            {block.type === 'multi_choice' && (
              <button onClick={handleNext} disabled={!Array.isArray(val) || (val as string[]).length === 0}
                style={{ background: config.button_color || primaryColor }}
                className="w-full mt-4 py-4 text-white text-base font-semibold rounded-2xl shadow transition disabled:opacity-40 hover:opacity-90">
                {config.next_button_text || 'Próximo →'}
              </button>
            )}
          </div>
        )}

        {block.type === 'scale' && (
          <div className="text-center">
            {config.question && <h2 className="text-2xl font-bold mb-6" style={{ color: theme.textColor }}>{config.question}</h2>}
            <div className="flex flex-wrap justify-center gap-3">
              {(() => {
                // #20: clampa para nunca gerar 0/negativo (travaria um scale obrigatório)
                const min = config.scale_min ?? 1
                const max = Math.max(min, config.scale_max ?? 10)
                return Array.from({ length: max - min + 1 }, (_, i) => {
                const v = min + i
                return (
                  <button key={v} onClick={() => setAnswer(block.id, v, page.id, 'choice_selected')}
                    className={`w-14 h-14 rounded-xl text-lg font-bold border-2 transition-all ${val === v ? 'text-white scale-110' : 'bg-white border-gray-200 text-gray-700 hover:scale-105'}`}
                    style={val === v ? { background: primaryColor, borderColor: primaryColor } : undefined}>
                    {v}
                  </button>
                )
              })
              })()}
            </div>
          </div>
        )}

        {['field_text','field_email','field_phone','field_number'].includes(block.type) && (
          <div>
            {config.label && <label className="block text-lg font-semibold mb-3" style={{ color: theme.textColor }}>{config.label}</label>}
            <input
              type={block.type === 'field_email' ? 'email' : block.type === 'field_phone' ? 'tel' : block.type === 'field_number' ? 'number' : 'text'}
              value={(val as string) ?? ''}
              onChange={e => setAnswer(block.id, e.target.value, page.id, 'text_entered')}
              placeholder={config.placeholder}
              className="w-full px-5 py-4 text-lg border-2 rounded-2xl focus:outline-none transition"
              style={{
                borderColor: err ? '#ef4444' : (theme.isDark ? '#334155' : '#e5e7eb'),
                background: theme.isDark ? '#1e293b' : '#ffffff',
                color: theme.textColor,
              }}
              onFocus={e => e.target.style.borderColor = primaryColor}
              onBlur={e => e.target.style.borderColor = err ? '#ef4444' : (theme.isDark ? '#334155' : '#e5e7eb')}
            />
          </div>
        )}

        {block.type === 'field_textarea' && (
          <div>
            {config.label && <label className="block text-lg font-semibold mb-3" style={{ color: theme.textColor }}>{config.label}</label>}
            <textarea
              value={(val as string) ?? ''}
              onChange={e => setAnswer(block.id, e.target.value, page.id, 'text_entered')}
              placeholder={config.placeholder}
              rows={4}
              className="w-full px-5 py-4 text-lg border-2 rounded-2xl focus:outline-none resize-none"
              style={{ borderColor: theme.isDark ? '#334155' : '#e5e7eb', background: theme.isDark ? '#1e293b' : '#ffffff', color: theme.textColor }}
            />
          </div>
        )}

        {block.type === 'heading' && config.heading_text && (
          <h2 className="font-bold leading-tight"
            style={{
              textAlign: config.heading_align ?? 'center',
              color: config.heading_color || theme.textColor,
              fontSize: config.heading_size === 'sm' ? '1.375rem' : config.heading_size === 'md' ? '1.75rem' : config.heading_size === 'xl' ? '2.75rem' : '2.125rem',
            }}
            dangerouslySetInnerHTML={{ __html: resolveVars(config.heading_text).replace(/href\s*=\s*(["'])\s*(?:javascript|data|vbscript):[^"']*\1/gi, 'href="#"').replace(/on\w+\s*=\s*(["'])[^"']*\1/gi, '') }}
          />
        )}

        {block.type === 'text_block' && config.content && (
          <div className="prose max-w-none"
            style={{ color: theme.textColor, textAlign: config.text_align ?? 'center' }}
            dangerouslySetInnerHTML={{ __html: resolveVars(config.content).replace(/href\s*=\s*(["'])\s*(?:javascript|data|vbscript):[^"']*\1/gi, 'href="#"').replace(/on\w+\s*=\s*(["'])[^"']*\1/gi, '') }} />
        )}

        {block.type === 'image' && config.image_url && (
          <div className={`flex ${config.image_align === 'left' ? 'justify-start' : config.image_align === 'right' ? 'justify-end' : 'justify-center'}`}>
            <img src={config.image_url} alt=""
              className={`rounded-xl object-cover ${
                config.image_size === 'small' ? 'max-w-xs' :
                config.image_size === 'large' ? 'max-w-2xl w-full' :
                config.image_size === 'full' ? 'w-full' : 'max-w-md'
              }`}
            />
          </div>
        )}

        {block.type === 'video' && config.video_url && (() => {
          const embed = getYoutubeEmbed(config.video_url)
          return embed ? (
            <div className="aspect-video rounded-xl overflow-hidden bg-black">
              <iframe src={embed} className="w-full h-full" allowFullScreen />
            </div>
          ) : null
        })()}

        {block.type === 'button' && (() => {
          const btnSize = config.button_size === 'sm'
            ? 'px-4 py-2 text-sm'
            : config.button_size === 'lg'
            ? 'px-10 py-5 text-lg w-full'
            : 'px-8 py-4 text-base'
          const align = `flex ${config.button_align === 'left' ? 'justify-start' : config.button_align === 'right' ? 'justify-end' : 'justify-center'}`
          const cls = `font-semibold text-white rounded-2xl shadow transition hover:opacity-90 ${btnSize}`
          const st = { background: config.button_color || primaryColor }
          // Botão de link externo abre a URL; os demais avançam o quiz (na posição)
          if (config.button_action === 'external_url') {
            return (
              <div className={align}>
                <a href={config.button_url || '#'} target="_blank" rel="noopener noreferrer"
                  onClick={() => tracker.track('button_clicked', page.id, block.id, { url: config.button_url })}
                  className={cls} style={st}>{config.button_text || 'Acessar'}</a>
              </div>
            )
          }
          return (
            <div className={align}>
              <button
                onClick={() => {
                  tracker.track('button_clicked', page.id, block.id, {})
                  fireIntegrations(block.id, config, {
                    answers, score,
                    name: captureRef.current.name || leadData.name,
                    email: captureRef.current.email || leadData.email,
                    phone: captureRef.current.phone || leadData.phone,
                  })
                  handleNext()
                }}
                className={cls} style={st}>{config.button_text || 'Próximo →'}</button>
            </div>
          )
        })()}

        {block.type === 'final_capture' && (() => {
          const inputStyle = { borderColor: theme.isDark ? '#334155' : '#e5e7eb', background: theme.isDark ? '#1e293b' : '#ffffff', color: theme.textColor }
          const inputCls = 'w-full px-5 py-4 text-lg border-2 rounded-2xl focus:outline-none'
          return (
          <div className="space-y-3">
            {config.show_name && (
              <input type="text" placeholder="Seu nome" defaultValue={captureRef.current.name ?? ''}
                onChange={e => { captureRef.current.name = e.target.value }}
                className={inputCls} style={inputStyle} />
            )}
            {config.show_email && (
              <input type="email" placeholder="seu@email.com" defaultValue={captureRef.current.email ?? ''}
                onChange={e => { captureRef.current.email = e.target.value }}
                className={inputCls} style={inputStyle} />
            )}
            {config.show_phone && (
              <input type="tel" placeholder="(11) 99999-9999" defaultValue={captureRef.current.phone ?? ''}
                onChange={e => { captureRef.current.phone = e.target.value }}
                className={inputCls} style={inputStyle} />
            )}
            {err && <p className="text-sm text-red-500 font-medium">{err}</p>}
          </div>
          )
        })()}

        {block.type === 'hero' && (
          <div className={config.hero_align === 'left' ? 'text-left' : 'text-center'}>
            {config.hero_image_url && (
              <img src={config.hero_image_url} alt="" className="w-full max-h-72 object-cover rounded-2xl mb-6" />
            )}
            <h1 className="text-3xl md:text-5xl font-extrabold leading-tight" style={{ color: theme.textColor }}>
              {resolveVars(config.hero_headline ?? '')}
            </h1>
            {config.hero_subheadline && (
              <p className="text-lg md:text-xl mt-4" style={{ color: theme.mutedColor }}>{resolveVars(config.hero_subheadline)}</p>
            )}
            {config.hero_cta_text && (
              <div className={`mt-8 ${config.hero_align === 'left' ? '' : 'flex justify-center'}`}>
                {config.hero_cta_action === 'external_url' && config.hero_cta_url ? (
                  <a href={config.hero_cta_url} target="_blank" rel="noopener noreferrer"
                    onClick={() => tracker.track('button_clicked', page.id, block.id, { url: config.hero_cta_url })}
                    className="inline-block px-10 py-4 text-white text-lg font-bold shadow-lg hover:opacity-90 transition"
                    style={{ background: primaryColor, borderRadius: theme.buttonRadius }}>
                    {config.hero_cta_text}
                  </a>
                ) : (
                  <button onClick={() => { tracker.track('button_clicked', page.id, block.id, {}); handleNext() }}
                    className="px-10 py-4 text-white text-lg font-bold shadow-lg hover:opacity-90 transition"
                    style={{ background: primaryColor, borderRadius: theme.buttonRadius }}>
                    {config.hero_cta_text}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {block.type === 'testimonials' && (
          <div>
            {config.testimonials_title && (
              <h2 className="text-2xl font-bold text-center mb-6" style={{ color: theme.textColor }}>{config.testimonials_title}</h2>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {(config.testimonials ?? []).map(t => (
                <div key={t.id} className="rounded-2xl p-5"
                  style={{ background: theme.cardBg, border: theme.cardBorder, boxShadow: theme.cardShadow, backdropFilter: theme.cardBackdrop ?? undefined }}>
                  <div className="text-amber-400 text-sm mb-2">{'★'.repeat(t.stars ?? 5)}</div>
                  <p className="text-sm leading-relaxed mb-3" style={{ color: theme.textColor }}>&ldquo;{t.text}&rdquo;</p>
                  <div className="flex items-center gap-2">
                    {t.photo_url
                      ? <img src={t.photo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                      : <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: primaryColor }}>{t.name.charAt(0)}</div>}
                    <span className="text-sm font-semibold" style={{ color: theme.textColor }}>{t.name}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {block.type === 'features' && (
          <div>
            {config.features_title && (
              <h2 className="text-2xl font-bold text-center mb-6" style={{ color: theme.textColor }}>{config.features_title}</h2>
            )}
            <div className={`grid gap-4 ${(config.features_columns ?? 3) === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
              {(config.features ?? []).map(f => (
                <div key={f.id} className="rounded-2xl p-5 text-center"
                  style={{ background: theme.cardBg, border: theme.cardBorder, boxShadow: theme.cardShadow, backdropFilter: theme.cardBackdrop ?? undefined }}>
                  <div className="text-3xl mb-2">{f.icon || '✨'}</div>
                  <p className="text-base font-bold mb-1" style={{ color: theme.textColor }}>{f.title}</p>
                  {f.description && <p className="text-sm" style={{ color: theme.mutedColor }}>{f.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {block.type === 'faq' && (
          <div>
            {config.faq_title && (
              <h2 className="text-2xl font-bold text-center mb-6" style={{ color: theme.textColor }}>{config.faq_title}</h2>
            )}
            <div className="space-y-2">
              {(config.faq_items ?? []).map(f => (
                <details key={f.id} className="rounded-xl overflow-hidden group"
                  style={{ background: theme.cardBg, border: theme.cardBorder }}>
                  <summary className="px-5 py-4 cursor-pointer font-semibold text-sm flex items-center justify-between list-none" style={{ color: theme.textColor }}>
                    {f.question}
                    <span className="transition group-open:rotate-180" style={{ color: theme.mutedColor }}>▾</span>
                  </summary>
                  <p className="px-5 pb-4 text-sm leading-relaxed" style={{ color: theme.mutedColor }}>{f.answer}</p>
                </details>
              ))}
            </div>
          </div>
        )}

        {block.type === 'countdown' && (
          <CountdownBlock config={config} blockId={block.id} />
        )}

        {/* Date / Height / Weight fields */}
        {['field_date','field_height','field_weight'].includes(block.type) && (
          <div>
            {config.label && <label className="block text-lg font-semibold mb-3" style={{ color: theme.textColor }}>{config.label}</label>}
            <div className="relative">
              <input
                type={block.type === 'field_date' ? 'date' : 'number'}
                value={(val as string) ?? ''}
                onChange={e => setAnswer(block.id, e.target.value, page.id, 'text_entered')}
                placeholder={config.placeholder}
                className="w-full px-5 py-4 text-lg border-2 rounded-2xl focus:outline-none transition"
                style={{ borderColor: theme.isDark ? '#334155' : '#e5e7eb', background: theme.isDark ? '#1e293b' : '#ffffff', color: theme.textColor }}
              />
              {block.type !== 'field_date' && (
                <span className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{block.type === 'field_height' ? 'cm' : 'kg'}</span>
              )}
            </div>
          </div>
        )}

        {/* Video answer */}
        {block.type === 'video_answer' && (() => {
          const embed = config.video_answer_url ? getYoutubeEmbed(config.video_answer_url) : null
          return (
            <div>
              {config.question && <h2 className="text-2xl font-bold text-center mb-4" style={{ color: theme.textColor }}>{config.question}</h2>}
              {embed && <div className="aspect-video rounded-xl overflow-hidden bg-black mb-4"><iframe src={embed} className="w-full h-full" allowFullScreen /></div>}
              <div className="space-y-3">
                {(config.options ?? []).map((opt: BlockOption) => {
                  const isSel = val === opt.label
                  return (
                    <button key={opt.id} onClick={() => setAnswer(block.id, opt.label, page.id, 'choice_selected')}
                      className={`w-full flex items-center gap-3 px-5 py-4 rounded-2xl border-2 text-left transition ${isSel ? 'scale-[0.99]' : 'hover:scale-[1.01]'}`}
                      style={isSel ? { borderColor: primaryColor, backgroundColor: primaryColor + '10' } : { background: theme.cardBg, border: theme.cardBorder }}>
                      {opt.emoji && <span className="text-2xl">{opt.emoji}</span>}
                      <span className="font-medium" style={{ color: theme.textColor }}>{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Audio */}
        {block.type === 'audio' && config.audio_url && (
          <div className="rounded-2xl p-4" style={{ background: theme.cardBg, border: theme.cardBorder }}>
            {config.audio_title && <p className="text-sm font-semibold mb-2" style={{ color: theme.textColor }}>{config.audio_title}</p>}
            <audio controls src={config.audio_url} className="w-full" />
          </div>
        )}

        {/* Alert */}
        {block.type === 'alert' && (() => {
          const v = config.alert_variant ?? 'warning'
          const cls = { info: 'bg-blue-50 text-blue-800 border-blue-200', success: 'bg-emerald-50 text-emerald-800 border-emerald-200', warning: 'bg-amber-50 text-amber-800 border-amber-200', danger: 'bg-red-50 text-red-800 border-red-200' }[v]
          const icon = { info: 'ℹ️', success: '✅', warning: '⚠️', danger: '🚨' }[v]
          return <div className={`flex items-start gap-2 border rounded-2xl px-4 py-3 ${cls}`}><span>{icon}</span><p className="text-sm font-medium">{config.alert_text}</p></div>
        })()}

        {/* Notification */}
        {block.type === 'notification' && <NotificationBlock config={config} />}

        {/* Loading */}
        {block.type === 'loading' && (
          <LoadingBlock config={config} onDone={() => { if (config.loading_auto_advance) handleNext() }} theme={theme} primaryColor={primaryColor} />
        )}

        {/* Level */}
        {block.type === 'level' && (
          <div>
            <div className="flex justify-between mb-1.5">
              <span className="text-sm font-semibold" style={{ color: theme.textColor }}>{config.level_label}</span>
              <span className="text-sm font-bold" style={{ color: config.level_color || primaryColor }}>{config.level_percent ?? 0}%</span>
            </div>
            <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: theme.isDark ? '#334155' : '#e5e7eb' }}>
              <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${config.level_percent ?? 0}%`, background: config.level_color || primaryColor }} />
            </div>
          </div>
        )}

        {/* Pricing */}
        {block.type === 'pricing' && (
          <div className="rounded-2xl p-6 text-center" style={{ background: theme.cardBg, border: config.pricing_highlight ? `2px solid ${primaryColor}` : theme.cardBorder, boxShadow: theme.cardShadow }}>
            <p className="text-lg font-bold" style={{ color: theme.textColor }}>{config.pricing_title}</p>
            <p className="my-2"><span className="text-4xl font-extrabold" style={{ color: theme.textColor }}>{config.pricing_price}</span><span className="text-sm" style={{ color: theme.mutedColor }}>{config.pricing_period}</span></p>
            <div className="space-y-2 my-4 text-left">
              {(config.pricing_items ?? []).map(it => (
                <div key={it.id} className="flex items-center gap-2 text-sm" style={{ color: it.included !== false ? theme.textColor : theme.mutedColor }}>
                  <span style={{ color: it.included !== false ? '#10b981' : '#ef4444' }}>{it.included !== false ? '✓' : '✕'}</span>
                  <span className={it.included === false ? 'line-through' : ''}>{it.text}</span>
                </div>
              ))}
            </div>
            {config.pricing_cta_text && (
              <a href={config.pricing_cta_url || '#'} target={config.pricing_cta_url ? '_blank' : undefined} rel="noopener noreferrer"
                onClick={() => tracker.track('button_clicked', page.id, block.id, {})}
                className="block w-full py-3.5 text-white font-semibold hover:opacity-90 transition"
                style={{ background: primaryColor, borderRadius: theme.buttonRadius }}>
                {config.pricing_cta_text}
              </a>
            )}
          </div>
        )}

        {/* Checklist */}
        {block.type === 'checklist' && (
          <div>
            {config.checklist_title && <h3 className="text-xl font-bold mb-3 text-center" style={{ color: theme.textColor }}>{config.checklist_title}</h3>}
            <div className="space-y-2">
              {(config.checklist_items ?? []).map(it => (
                <div key={it.id} className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: theme.cardBg, border: theme.cardBorder }}>
                  <span className="flex items-center justify-center w-6 h-6 rounded-full text-white text-sm shrink-0" style={{ background: '#10b981' }}>✓</span>
                  <span className="text-sm" style={{ color: theme.textColor }}>{it.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Before / After */}
        {block.type === 'before_after' && (
          <div className="grid grid-cols-2 gap-3">
            {([['before', config.before_image_url, config.before_label], ['after', config.after_image_url, config.after_label]] as const).map(([k, img, lbl]) => (
              <div key={k} className="rounded-2xl overflow-hidden" style={{ border: theme.cardBorder }}>
                <div className="text-center text-xs font-bold py-1.5 text-white" style={{ background: k === 'before' ? '#94a3b8' : primaryColor }}>{lbl || (k === 'before' ? 'Antes' : 'Depois')}</div>
                {img ? <img src={img} alt="" className="w-full h-44 object-cover" /> : <div className="w-full h-44 bg-gray-100 flex items-center justify-center text-gray-400 text-sm">Sem imagem</div>}
              </div>
            ))}
          </div>
        )}

        {/* Carousel */}
        {block.type === 'carousel' && <CarouselBlock items={config.carousel_items ?? []} theme={theme} fit={config.carousel_fit ?? 'contain'} height={config.carousel_height ?? 320} />}

        {/* Metrics */}
        {block.type === 'metrics' && (
          <div className={`grid gap-4 ${(config.metrics_items ?? []).length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {(config.metrics_items ?? []).map(m => (
              <div key={m.id} className="text-center">
                <p className="text-3xl md:text-4xl font-extrabold" style={{ color: primaryColor }}>{m.value}<span className="text-2xl">{m.suffix}</span></p>
                <p className="text-xs mt-1" style={{ color: theme.mutedColor }}>{m.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Chart */}
        {block.type === 'chart' && (
          <div className="rounded-2xl p-5" style={{ background: theme.cardBg, border: theme.cardBorder }}>
            {config.chart_title && <p className="text-sm font-bold mb-4 text-center" style={{ color: theme.textColor }}>{config.chart_title}</p>}
            {(config.chart_type ?? 'bar') === 'bar' ? (
              <div className="flex items-end justify-around gap-2 h-48">
                {(config.chart_data ?? []).map(d => {
                  const max = Math.max(...(config.chart_data ?? []).map(x => x.value), 1)
                  return (
                    <div key={d.id} className="flex-1 flex flex-col items-center justify-end h-full">
                      <span className="text-xs font-bold mb-1" style={{ color: theme.textColor }}>{d.value}</span>
                      <div className="w-full rounded-t-lg transition-all duration-700" style={{ height: `${(d.value / max) * 100}%`, background: d.color || primaryColor }} />
                      <span className="text-[10px] mt-1 text-center" style={{ color: theme.mutedColor }}>{d.label}</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <PieChart data={config.chart_data ?? []} theme={theme} />
            )}
          </div>
        )}

        {/* Spacer */}
        {block.type === 'spacer' && <div style={{ height: config.spacer_height ?? 40 }} />}

        {/* HTML embed — iframe sandbox: isola do domínio compartilhado (sem acesso a
            cookies/DOM do app) E permite <script> de terceiros (pixels), que não executa via innerHTML */}
        {block.type === 'html_embed' && config.html_content && (
          <HtmlEmbed html={config.html_content} />
        )}

        {err && <p className="text-sm text-red-500 mt-2">{err}</p>}
      </div>
      </TimedBlock>
    )
  }

  // Used for auto-advance: ensures answers state has latest value
  function handleNextWithAnswer(blockId: string, value: unknown) {
    // Calcula tudo FORA do updater do setAnswers — efeitos colaterais dentro do
    // updater rodam 2x em StrictMode/re-render (score dobrado, submit duplicado, avanço duplo).
    const updated = { ...answers, [blockId]: value }
    const page = pages[pageIdx]

    // Só valida blocos JÁ REVELADOS (appear_delay pode esconder um obrigatório)
    const newErrors: Record<string, string> = {}
    for (const block of page.blocks) {
      if (block.config.required && !['single_choice','yes_no'].includes(block.type)
          && !NON_INPUT_BLOCKS.has(block.type) && isRevealed(block)) {
        const v = updated[block.id]
        if (v === undefined || v === null || v === '') newErrors[block.id] = 'Campo obrigatório'
      }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }
    setErrors({})

    setAnswers(updated)

    const newScore = computeScore(updated)
    setScore(newScore)

    // Mescla contato preenchido nesta página (email/telefone) — o caminho de
    // auto-avanço usava o leadData de estado antigo e podia submeter sem contato
    let newLeadData = { ...leadData }
    for (const block of page.blocks) {
      if (block.type === 'field_text' && updated[block.id] && !newLeadData.name) newLeadData = { ...newLeadData, name: String(updated[block.id]) }
      if (block.type === 'field_email' && updated[block.id]) newLeadData = { ...newLeadData, email: String(updated[block.id]) }
      if (block.type === 'field_phone' && updated[block.id]) newLeadData = { ...newLeadData, phone: String(updated[block.id]) }
    }
    setLeadData(newLeadData)

    const resultBlk = page.blocks.find(b => b.type === 'result')
    if (resultBlk) { setResultBlock(resultBlk); submitResult(resultBlk, newScore, newLeadData); return }

    const next = resolveNextPage(pageIdx, updated, newScore)
    if (next === 'result') {
      const rb = resultBlock ?? pages.flatMap(p => p.blocks).find(b => b.type === 'result')
      if (rb) { setResultBlock(rb); submitResult(rb, newScore, newLeadData) }
      return
    }
    if (next === 'end') { setPhase('done'); return }
    setTransitionKey(k => k + 1)
    setPageIdx(next as number)
  }

  const hasChoiceAutoAdvance = currentPage?.blocks.some(b => ['single_choice','yes_no'].includes(b.type))
  const hasFinalCapture = currentPage?.blocks.some(b => b.type === 'final_capture')
  const hasExplicitButton = currentPage?.blocks.some(b => b.type === 'button' && b.config.button_action !== 'external_url')
  const hasResultBlock = currentPage?.blocks.some(b => b.type === 'result')
  const nonChoiceInputs = currentPage?.blocks.filter(b => !['single_choice','yes_no'].includes(b.type) && !NON_INPUT_BLOCKS.has(b.type)) ?? []
  const isLandingOnly = (currentPage?.blocks.length ?? 0) > 0 && currentPage!.blocks.every(b => LANDING_BLOCKS.has(b.type))
  // Página só de conteúdo (título/imagem/texto…, sem campos de resposta): NÃO
  // força botão — quem monta decide se coloca um bloco Botão.
  // Rede de segurança: página COM campos de resposta e sem botão ganha o
  // "Próximo" automático pra não travar o visitante.
  // Múltipla escolha já renderiza o próprio botão "Próximo" — não força o auto
  const hasMultiChoice = currentPage?.blocks.some(b => b.type === 'multi_choice')
  const inputsNeedingButton = nonChoiceInputs.filter(b => b.type !== 'multi_choice')
  const hasInputNeedingSubmit = inputsNeedingButton.length > 0 || hasFinalCapture
  const shouldShowNextButton = !hasResultBlock && !isLandingOnly && !hasMultiChoice && (!hasChoiceAutoAdvance || hasInputNeedingSubmit)
  const autoNextText = currentPage?.blocks.map(b => b.config.next_button_text).find(Boolean)

  if (phase !== 'answering' && resultBlock) {
    const cfg = resultBlock.config
    const scoreText = cfg.show_score
      ? (cfg.score_display_text || 'Você fez {{score}} pontos!').replace(/\{\{score\}\}/g, String(score))
      : null
    const ctaUrl = cfg.cta_url

    return (
      <div className="min-h-screen w-full max-w-full overflow-x-hidden flex flex-col items-center justify-center px-4 py-8"
        style={{
          background: theme.background,
          backgroundImage: theme.backgroundImage ? `url(${theme.backgroundImage})` : undefined,
          backgroundSize: 'cover', backgroundPosition: 'center',
          fontFamily: theme.fontFamily,
        }}>
        {theme.fontUrl && <link rel="stylesheet" href={theme.fontUrl} />}
        <style>{`@keyframes fadeInUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } } @keyframes confettiFall { 0%{transform:translateY(-20px) rotate(0deg);opacity:1} 100%{transform:translateY(200px) rotate(720deg);opacity:0} }`}</style>
        <div className="w-full max-w-xl text-center" style={{ animation: 'fadeInUp 500ms cubic-bezier(0.4,0,0.2,1) forwards' }}>
          <div className="relative flex justify-center mb-6" aria-hidden>
            {[primaryColor,'#10b981','#f59e0b','#ef4444','#a855f7'].map((c, i) => (
              <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: c, margin: '0 4px', animation: `confettiFall ${1 + i * 0.15}s ${i * 0.1}s ease-in forwards` }} />
            ))}
          </div>
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl md:text-4xl font-bold mb-4" style={{ color: theme.textColor }}>{cfg.title || 'Parabéns!'}</h2>
          {scoreText && (
            <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 rounded-2xl font-semibold text-lg" style={{ background: primaryColor + '20', color: primaryColor }}>
              🏆 {scoreText}
            </div>
          )}
          {cfg.description && <p className="text-base md:text-lg mb-8 leading-relaxed whitespace-pre-line" style={{ color: theme.mutedColor }}>{cfg.description.replace(/\{\{score\}\}/g, String(score))}</p>}
          {phase === 'submitting' && (
            <div className="flex items-center justify-center gap-2 text-gray-500">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/></svg>
              Processando...
            </div>
          )}
          {phase === 'done' && cfg.cta_text && (
            <a href={ctaUrl || '#'} target={ctaUrl ? '_blank' : undefined} rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 text-white text-lg font-semibold rounded-2xl shadow-lg hover:opacity-90 transition"
              style={{ background: primaryColor }}>
              {cfg.cta_text}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
          )}
          {phase === 'done' && !cfg.cta_text && (
            <div className="flex items-center justify-center gap-2 font-medium" style={{ color: primaryColor }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="20 6 9 17 4 12"/></svg>
              Tudo certo! Aguarde o contato.
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden flex flex-col"
      style={{
        background: theme.background,
        backgroundImage: theme.backgroundImage ? `url(${theme.backgroundImage})` : undefined,
        backgroundSize: 'cover', backgroundPosition: 'center',
        fontFamily: theme.fontFamily,
      }}>
      {theme.fontUrl && <link rel="stylesheet" href={theme.fontUrl} />}
      <style>{`@keyframes slideIn { from { opacity:0; transform:translateX(32px); } to { opacity:1; transform:translateX(0); } } @keyframes fadeInUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {logoUrl && (
        <div className="flex justify-center pt-6 shrink-0">
          <img src={logoUrl} alt="" className="h-10 object-contain" />
        </div>
      )}

      {showProgress && (
        <div className="h-1.5 shrink-0" style={{ background: (data.settings.progress_color || primaryColor) + '30' }}>
          <div className="h-full transition-all duration-500" style={{ width: `${progressPct}%`, background: data.settings.progress_color || primaryColor }} />
        </div>
      )}

      {pageIdx > 0 && data.settings.show_back !== false && (
        <div className="px-6 pt-4 shrink-0">
          <button onClick={() => { setPageIdx(i => i - 1); setTransitionKey(k => k + 1) }}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Voltar
          </button>
        </div>
      )}

      <div key={transitionKey} className={`flex-1 flex items-start justify-center w-full max-w-full overflow-x-hidden px-4 pb-8 ${currentPage?.blocks[0]?.type === 'image' ? 'pt-0' : 'pt-6'}`}
        style={{ animation: 'slideIn 350ms cubic-bezier(0.4,0,0.2,1) forwards' }}>
        <div className="w-full max-w-xl min-w-0">
          {currentPage?.blocks.map(renderBlock)}

          {shouldShowNextButton && !hasExplicitButton && (
            <button
              onClick={() => {
                if (hasChoiceAutoAdvance) {
                  const choiceBlock = currentPage.blocks.find(b => ['single_choice','yes_no'].includes(b.type))
                  if (choiceBlock && !answers[choiceBlock.id]) {
                    setErrors(e => ({ ...e, [choiceBlock.id]: 'Selecione uma opção' }))
                    return
                  }
                }
                handleNext()
              }}
              style={{ background: primaryColor }}
              className="w-full py-4 text-white text-base font-semibold rounded-2xl shadow transition hover:opacity-90"
            >
              {hasFinalCapture ? (currentPage.blocks.find(b => b.type === 'final_capture')?.config.submit_text || 'Ver meu resultado →') : (autoNextText || 'Próximo →')}
            </button>
          )}

          {/* Botões explícitos agora renderizam na posição em que foram colocados
              (dentro de renderBlock), respeitando a ordem dos blocos. */}
        </div>
      </div>
    </div>
  )
}
