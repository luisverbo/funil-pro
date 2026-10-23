// ============================================================================
// Estúdio IA — Web Push (aviso com o app FECHADO) sem dependência nova
// ----------------------------------------------------------------------------
// Padrão Web Push com VAPID (RFC 8292), funciona no Chrome/Android e no
// Safari do iPhone com o PWA instalado na Tela de Início (iOS 16.4+).
//
// Push SEM conteúdo (sem criptografia de payload): o celular acorda, o
// service worker busca o resumo em /api/estudio/push/resumo (com o cookie da
// sessão) e mostra a notificação. Assim nada da conversa trafega pelo
// servidor de push da Apple/Google.
// ============================================================================
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const deB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

export interface ChavesVapid { publica: string; privadaJwk: string }

/** Par P-256 novo. `publica` = ponto não comprimido (65 bytes) em base64url. */
export function gerarVapid(): ChavesVapid {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }
  const raw = Buffer.concat([Buffer.from([4]), deB64url(jwk.x), deB64url(jwk.y)])
  return { publica: b64url(raw), privadaJwk: JSON.stringify(privateKey.export({ format: 'jwk' })) }
}

/** JWT ES256 do VAPID para a origem do endpoint (vale 12 h). */
export function jwtVapid(endpoint: string, privadaJwk: string, contato = 'mailto:contato@funil.pro', agoraSeg = Math.floor(Date.now() / 1000)): string {
  const aud = new URL(endpoint).origin
  const cab = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const corpo = b64url(Buffer.from(JSON.stringify({ aud, exp: agoraSeg + 12 * 3600, sub: contato })))
  const chave = crypto.createPrivateKey({ key: JSON.parse(privadaJwk), format: 'jwk' })
  const assinatura = crypto.sign('sha256', Buffer.from(`${cab}.${corpo}`), { key: chave, dsaEncoding: 'ieee-p1363' })
  return `${cab}.${corpo}.${b64url(assinatura)}`
}

/** Endpoints aceitos: só serviços de push conhecidos (evita SSRF por inscrição forjada). */
export function endpointValido(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false
  try {
    const u = new URL(endpoint)
    return u.protocol === 'https:' && /(^|\.)(googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com|windows\.com)$/.test(u.hostname)
  } catch { return false }
}

export async function enviarPushVazio(endpoint: string, v: ChavesVapid, f: typeof fetch = fetch): Promise<number> {
  const r = await f(endpoint, {
    method: 'POST',
    headers: { TTL: '86400', Urgency: 'high', Authorization: `vapid t=${jwtVapid(endpoint, v.privadaJwk)}, k=${v.publica}`, 'Content-Length': '0' },
  })
  return r.status
}

/** Chaves do tenant (gera e guarda na 1ª vez). A privada nunca sai do servidor. */
export async function chavesDoTenant(admin: SupabaseClient, tenantId: string): Promise<ChavesVapid | null> {
  const { data, error } = await admin.from('estudio_config').select('vapid_publica, vapid_privada').eq('tenant_id', tenantId).maybeSingle()
  if (error || !data) return null
  if (data.vapid_publica && data.vapid_privada) return { publica: data.vapid_publica, privadaJwk: data.vapid_privada }
  const novas = gerarVapid()
  const { error: e2 } = await admin.from('estudio_config').update({ vapid_publica: novas.publica, vapid_privada: novas.privadaJwk }).eq('tenant_id', tenantId)
  return e2 ? null : novas
}

/** Acorda todos os aparelhos inscritos. Inscrição morta (404/410) é apagada. */
export async function avisarAparelhos(admin: SupabaseClient, tenantId: string): Promise<number> {
  try {
    const v = await chavesDoTenant(admin, tenantId)
    if (!v) return 0
    const { data } = await admin.from('estudio_push').select('id, endpoint').eq('tenant_id', tenantId).limit(20)
    let ok = 0
    for (const s of data ?? []) {
      try {
        const st = await enviarPushVazio(s.endpoint, v)
        if (st === 404 || st === 410) await admin.from('estudio_push').delete().eq('id', s.id)
        else if (st < 300) ok++
      } catch { /* aparelho fora do ar: tenta na próxima */ }
    }
    return ok
  } catch { return 0 }
}
