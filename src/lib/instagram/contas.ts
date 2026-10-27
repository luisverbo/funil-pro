// ============================================================================
// Contas do Instagram — partes PURAS do "Conectar Instagram"
// ----------------------------------------------------------------------------
// Login do Instagram (Instagram API with Instagram Login):
//   1. /api/instagram/conectar → instagram.com/oauth/authorize (state assinado)
//   2. /api/instagram/callback → troca o code por token curto → token de 60
//      dias → /me → grava em instagram_contas
//   3. o cron dos conteúdos renova cada token a cada 24h
//
// O state leva o tenant e vence em 15 min, assinado com o App Secret (que já
// existe no servidor) — ninguém consegue grudar a conta dele em outro tenant.
// A Meta chama o desautorizar/excluir dados com `signed_request` assinado com
// o mesmo segredo.
// ============================================================================
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const ESCOPOS_INSTAGRAM = [
  'instagram_business_basic',
  'instagram_business_content_publish',
] as const

export const VALIDADE_ESTADO_MS = 15 * 60 * 1000

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const hmac = (dado: string, segredo: string) => createHmac('sha256', segredo).update(dado).digest()

function iguais(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

export function urlDeAutorizacao(appId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ESCOPOS_INSTAGRAM.join(','),
    state,
    force_reauth: 'true',
  })
  return `https://www.instagram.com/oauth/authorize?${q.toString()}`
}

export function assinarEstado(tenantId: string, segredo: string, agora = Date.now()): string {
  const corpo = b64url(JSON.stringify({ t: tenantId, e: agora + VALIDADE_ESTADO_MS, n: randomBytes(8).toString('hex') }))
  return `${corpo}.${b64url(hmac(corpo, segredo))}`
}

/** Tenant do state, ou null se adulterado/vencido. */
export function lerEstado(state: string | null | undefined, segredo: string, agora = Date.now()): string | null {
  if (!state || !segredo) return null
  const [corpo, assinatura] = state.split('.')
  if (!corpo || !assinatura) return null
  if (!iguais(Buffer.from(assinatura, 'base64url'), hmac(corpo, segredo))) return null
  try {
    const j = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as { t?: string; e?: number }
    if (!j.t || typeof j.e !== 'number' || j.e < agora) return null
    return j.t
  } catch { return null }
}

/** `signed_request` da Meta (desautorizar / excluir dados) → user_id, ou null. */
export function lerSignedRequest(sr: string | null | undefined, segredo: string): { user_id: string } | null {
  if (!sr || !segredo) return null
  const [sig, payload] = sr.split('.')
  if (!sig || !payload) return null
  if (!iguais(Buffer.from(sig, 'base64url'), hmac(payload, segredo))) return null
  try {
    const j = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { user_id?: string | number; algorithm?: string }
    if (j.algorithm && j.algorithm.toUpperCase() !== 'HMAC-SHA256') return null
    return j.user_id ? { user_id: String(j.user_id) } : null
  } catch { return null }
}

/** Quando o token de 60 dias vence (a Meta manda `expires_in` em segundos). */
export function expiraEm(expiresIn: number | null | undefined, agora = Date.now()): string | null {
  return expiresIn && expiresIn > 0 ? new Date(agora + expiresIn * 1000).toISOString() : null
}

/** Texto curto do estado da conta para a tela. */
export function situacaoDaConta(c: { status: string; token_expira_em: string | null; erro?: string | null }, agora = Date.now()): { ok: boolean; texto: string } {
  if (c.status === 'erro') return { ok: false, texto: c.erro ? `Reconecte: ${c.erro.slice(0, 80)}` : 'Reconecte a conta' }
  if (c.token_expira_em) {
    const dias = Math.floor((Date.parse(c.token_expira_em) - agora) / 86_400_000)
    if (dias < 0) return { ok: false, texto: 'Acesso vencido: reconecte' }
    if (dias <= 7) return { ok: true, texto: `Renova sozinho (vence em ${dias} d)` }
  }
  return { ok: true, texto: 'Conectada' }
}
