// ============================================================================
// Estúdio IA — WhatsApp Cloud API do número exclusivo do estúdio (Fase 2)
// ----------------------------------------------------------------------------
// Regras puras (janela, origem, normalização) + chamadas de gestão à Meta
// (status do número, registro com PIN, inscrição do app na WABA). O envio
// reaproveita src/lib/whatsapp-cloud (mesmo transporte da aba WhatsApp).
//
// Janela grátis (seção 3.3): 24h após a última mensagem da cliente; quem
// veio de anúncio "Converse conosco" (mensagem com `referral`) ganha 72h.
// ============================================================================

const GRAPH = 'https://graph.facebook.com/v21.0'

export const JANELA_ORGANICA_H = 24
export const JANELA_ANUNCIO_H = 72

/** Resposta da Fase 2 (teste). Na Fase 3 a Ana (máquina de estados) assume. */
export const RESPOSTA_TESTE_PADRAO =
  'Oi, tudo bem? 😊 Aqui é a Ana, do Estúdio! Recebi sua mensagem e já já te explico como funciona nosso ensaio com IA 💖'

/** Não repete a resposta de teste se já respondeu há menos disso. */
export const INTERVALO_RESPOSTA_TESTE_MS = 30 * 60 * 1000

export type Origem = 'anuncio' | 'organico'

export function origemDaMensagem(referral: unknown): Origem {
  return referral && typeof referral === 'object' && Object.keys(referral as object).length > 0 ? 'anuncio' : 'organico'
}

/**
 * Fim da janela grátis. Origem de anúncio vale para a conversa toda: uma vez
 * 'anuncio', as próximas mensagens também renovam por 72h.
 */
export function fimDaJanela(timestampSegundos: number, origem: Origem): string {
  const horas = origem === 'anuncio' ? JANELA_ANUNCIO_H : JANELA_ORGANICA_H
  const base = (timestampSegundos > 0 ? timestampSegundos * 1000 : Date.now())
  return new Date(base + horas * 3600 * 1000).toISOString()
}

export function dentroDaJanela(janelaAte: string | null | undefined, agora: Date = new Date()): boolean {
  return !!janelaAte && new Date(janelaAte).getTime() > agora.getTime()
}

/** Só dígitos; aceita "+55 (21) 98012-0036" e "[21980120036]". Sem DDI → assume 55. */
export function normalizarWhatsApp(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '')
  if (d.length < 10 || d.length > 15) return null
  return d.length <= 11 ? `55${d}` : d
}

/** Deve mandar a resposta de teste? (Fase 2: uma por conversa a cada 30 min) */
export function deveResponderTeste(ultimaSaidaEm: string | null | undefined, agora: Date = new Date()): boolean {
  if (!ultimaSaidaEm) return true
  return agora.getTime() - new Date(ultimaSaidaEm).getTime() >= INTERVALO_RESPOSTA_TESTE_MS
}

/** PIN de 6 dígitos do registro na Cloud API (two-step verification). */
export function pinValido(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{6}$/.test(pin)
}

/** Mensagem de erro da Meta sem token (pode vir na URL de alguns erros). */
export function limparErro(msg: string): string {
  return msg.replace(/access_token=[^&\s"]+/gi, 'access_token=***').slice(0, 400)
}

// ── Chamadas de gestão (não são envio de mensagem) ──────────────────────────

type Fetch = typeof fetch

async function graph<T>(caminho: string, token: string, init: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {}, f: Fetch = fetch): Promise<T> {
  const resp = await f(`${GRAPH}/${caminho}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  const json = await resp.json().catch(() => null) as (T & { error?: { message?: string; error_user_msg?: string } }) | null
  if (!resp.ok || !json || json.error) {
    throw new Error(limparErro(json?.error?.error_user_msg ?? json?.error?.message ?? `HTTP ${resp.status}`))
  }
  return json
}

export interface StatusDoNumero {
  display_phone_number?: string
  verified_name?: string
  code_verification_status?: string
  quality_rating?: string
  platform_type?: string        // CLOUD_API quando registrado
  name_status?: string          // APPROVED / PENDING_REVIEW / DECLINED…
  status?: string               // CONNECTED / PENDING / …
}

export function statusDoNumero(phoneNumberId: string, token: string, f?: Fetch): Promise<StatusDoNumero> {
  return graph<StatusDoNumero>(
    `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,code_verification_status,quality_rating,platform_type,name_status,status`,
    token, {}, f,
  )
}

/** POST /{phone_number_id}/register — tira o número do "Pendente". */
export async function registrarNumero(phoneNumberId: string, token: string, pin: string, f?: Fetch): Promise<void> {
  if (!pinValido(pin)) throw new Error('O PIN precisa ter 6 dígitos.')
  await graph<{ success?: boolean }>(`${encodeURIComponent(phoneNumberId)}/register`, token,
    { method: 'POST', body: { messaging_product: 'whatsapp', pin } }, f)
}

export interface AppInscrito { id?: string; name?: string; link?: string }

export async function appsInscritos(wabaId: string, token: string, f?: Fetch): Promise<AppInscrito[]> {
  const r = await graph<{ data?: { whatsapp_business_api_data?: AppInscrito }[] }>(`${encodeURIComponent(wabaId)}/subscribed_apps`, token, {}, f)
  return (r.data ?? []).map(d => d.whatsapp_business_api_data ?? {}).filter(a => a.id || a.name)
}

/** Inscreve o app DONO DO TOKEN na WABA — sem isso o webhook não recebe nada dela. */
export async function inscreverApp(wabaId: string, token: string, f?: Fetch): Promise<void> {
  await graph<{ success?: boolean }>(`${encodeURIComponent(wabaId)}/subscribed_apps`, token, { method: 'POST' }, f)
}
