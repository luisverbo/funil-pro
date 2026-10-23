// ============================================================================
// Estúdio IA — assinatura e verify_token do webhook por número (Fase 2b)
// ----------------------------------------------------------------------------
// O número do estúdio usa o app COBRAZAP (webhook do app vai para o
// CobrarZap). Para ele, a Meta assina o POST com o App Secret do Cobrazap e
// verifica o GET do override com o verify_token do estúdio. Puro e testado.
// ============================================================================
import crypto from 'crypto'

/** X-Hub-Signature-256 confere com este secret? Comparação em tempo constante. */
export function assinaturaConfere(raw: string, header: string | null, secret: string | null | undefined): boolean {
  if (!secret || !header) return false
  const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(esperado)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Token aleatório para o handshake do override (hex, 48 caracteres). */
export function novoVerifyToken(): string {
  return crypto.randomBytes(24).toString('hex')
}

/** Igualdade em tempo constante para o verify_token do GET. */
export function tokenConfere(recebido: string | null, esperado: string | null | undefined): boolean {
  if (!recebido || !esperado) return false
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** URL pública do webhook (o mesmo endpoint da aba WhatsApp). */
export const URL_WEBHOOK_ESTUDIO = 'https://funil-pro.vercel.app/api/webhooks/meta-wa'
