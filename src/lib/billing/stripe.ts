// ============================================================================
// Stripe — cliente mínimo (fetch + HMAC), sem SDK e sem variável de ambiente
// ----------------------------------------------------------------------------
// Por que sem SDK: precisamos de 3 chamadas (criar Checkout, ler Checkout,
// ler assinatura) e da verificação de assinatura do webhook. Tudo isso é um
// POST/GET form-encoded e um HMAC-SHA256 — que aqui fica PURO e testável.
//
// Por que sem env: as chaves ficam em platform_settings (o mesmo lugar do
// Meta/Evolution/Resend), coladas pelo dono em /admin/settings. Nada de
// alterar a Vercel para vender o quiz.
// ============================================================================

import crypto from 'crypto'

const STRIPE_API = 'https://api.stripe.com/v1'

export interface ChavesStripe {
  secretKey: string
  webhookSecret: string
  priceId: string
}

export interface SessaoCheckout {
  id: string
  payment_status?: string          // paid | unpaid | no_payment_required
  status?: string                  // open | complete | expired
  customer?: string | null
  subscription?: string | null
  customer_details?: { email?: string | null } | null
  customer_email?: string | null
  amount_total?: number | null
  currency?: string | null
  mode?: string
}

export interface AssinaturaStripe {
  id: string
  status?: string                  // active | trialing | past_due | canceled | …
  current_period_end?: number      // epoch segundos
  customer?: string | null
}

// ── Assinatura do webhook (puro) ────────────────────────────────────────────

/**
 * Lê o header `Stripe-Signature` (formato `t=…,v1=…,v1=…`).
 */
export function lerHeaderAssinatura(header: string | null | undefined): { t: number; v1: string[] } | null {
  if (!header) return null
  let t = NaN
  const v1: string[] = []
  for (const parte of header.split(',')) {
    const [k, v] = parte.trim().split('=')
    if (k === 't') t = Number(v)
    else if (k === 'v1' && v) v1.push(v)
  }
  if (!Number.isFinite(t) || v1.length === 0) return null
  return { t, v1 }
}

/**
 * Verifica a assinatura do payload cru. Tolerância padrão de 5 minutos, como
 * a Stripe recomenda — evita replay de um evento antigo capturado.
 */
export function verificarAssinaturaStripe(
  payloadCru: string,
  header: string | null | undefined,
  secret: string,
  agoraSegundos: number = Math.floor(Date.now() / 1000),
  toleranciaSegundos = 300,
): boolean {
  if (!secret) return false
  const h = lerHeaderAssinatura(header)
  if (!h) return false
  if (Math.abs(agoraSegundos - h.t) > toleranciaSegundos) return false
  const esperado = crypto.createHmac('sha256', secret).update(`${h.t}.${payloadCru}`).digest('hex')
  return h.v1.some(v => {
    try { return crypto.timingSafeEqual(Buffer.from(v, 'hex'), Buffer.from(esperado, 'hex')) }
    catch { return false }
  })
}

/** Só para testes e simulações: assina como a Stripe assinaria. */
export function assinarComoStripe(payloadCru: string, secret: string, tSegundos: number): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${tSegundos}.${payloadCru}`).digest('hex')
  return `t=${tSegundos},v1=${v1}`
}

// ── Eventos (puro) ──────────────────────────────────────────────────────────

export interface EventoStripe {
  id: string
  type: string
  data: { object: Record<string, unknown> }
}

export function lerEventoStripe(payloadCru: string): EventoStripe | null {
  try {
    const j = JSON.parse(payloadCru)
    if (!j || typeof j.id !== 'string' || typeof j.type !== 'string' || !j.data?.object) return null
    return j as EventoStripe
  } catch { return null }
}

/** Uma sessão de Checkout conta como paga? (assinatura ou pagamento único) */
export function sessaoPaga(s: SessaoCheckout | null | undefined): boolean {
  if (!s) return false
  return s.payment_status === 'paid' || s.payment_status === 'no_payment_required' || s.status === 'complete'
}

/** E-mail do comprador — a Stripe expõe em dois campos conforme o fluxo. */
export function emailDaSessao(s: SessaoCheckout | null | undefined): string | null {
  const e = s?.customer_details?.email ?? s?.customer_email ?? null
  return e ? e.trim().toLowerCase() : null
}

/** Fim do período atual (ISO) — vira `plan_expires_at` do tenant. */
export function fimDoPeriodo(a: AssinaturaStripe | null | undefined): string | null {
  if (!a?.current_period_end) return null
  return new Date(a.current_period_end * 1000).toISOString()
}

/** Formato de id de sessão de checkout — barra lixo antes de gastar uma chamada. */
export function idDeSessaoValido(v: unknown): v is string {
  return typeof v === 'string' && /^cs_(test|live)_[A-Za-z0-9]{10,}$/.test(v)
}

// ── Chamadas HTTP ───────────────────────────────────────────────────────────

function form(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.append(k, String(v))
  return u.toString()
}

async function stripeFetch<T>(secretKey: string, path: string, init?: { method?: 'GET' | 'POST'; body?: string }): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: init?.body,
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Nunca vaza a chave: só a mensagem da Stripe.
    const msg = (json as { error?: { message?: string } })?.error?.message ?? `Stripe HTTP ${res.status}`
    throw new Error(msg)
  }
  return json as T
}

export interface NovoCheckoutQuiz {
  priceId: string
  successUrl: string
  cancelUrl: string
  email?: string
  /** Assinatura recorrente (padrão) ou pagamento único, conforme o preço. */
  modo?: 'subscription' | 'payment'
}

/** Cria a sessão de Checkout hospedada pela Stripe e devolve a URL. */
export async function criarCheckoutQuiz(secretKey: string, n: NovoCheckoutQuiz): Promise<{ id: string; url: string }> {
  const body = form({
    mode: n.modo ?? 'subscription',
    'line_items[0][price]': n.priceId,
    'line_items[0][quantity]': 1,
    success_url: n.successUrl,
    cancel_url: n.cancelUrl,
    customer_email: n.email,
    locale: 'pt-BR',
    allow_promotion_codes: 'true',
    'metadata[produto]': 'quiz',
    ...(n.modo === 'payment' ? {} : { 'subscription_data[metadata][produto]': 'quiz' }),
  })
  const s = await stripeFetch<{ id: string; url: string }>(secretKey, '/checkout/sessions', { method: 'POST', body })
  if (!s.url) throw new Error('Stripe não devolveu a URL do checkout')
  return { id: s.id, url: s.url }
}

export async function buscarSessaoCheckout(secretKey: string, id: string): Promise<SessaoCheckout> {
  return stripeFetch<SessaoCheckout>(secretKey, `/checkout/sessions/${encodeURIComponent(id)}`)
}

export async function buscarAssinatura(secretKey: string, id: string): Promise<AssinaturaStripe> {
  return stripeFetch<AssinaturaStripe>(secretKey, `/subscriptions/${encodeURIComponent(id)}`)
}
