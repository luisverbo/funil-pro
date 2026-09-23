// ============================================================================
// Token do Instagram — de onde vem e como se mantém vivo
// ----------------------------------------------------------------------------
// CAUSA RAIZ do "Instagram não conectado" de 23/09: o token de longa duração
// da Instagram API vale 60 DIAS e o FunilPro nunca o renovava. Ele venceu em
// 17/09 e tudo (DMs, automações, conteúdos) parou junto.
//
// Correção em duas partes:
//   1. o token pode viver em platform_settings (`ig_access_token`) — colado
//      em /admin/settings, sem redeploy na Vercel. A variável de ambiente
//      continua valendo como reserva (compatibilidade).
//   2. renovação automática: a Meta aceita `refresh_access_token` para token
//      com mais de 24h e ainda válido, devolvendo outro de 60 dias. O cron
//      dos conteúdos chama isso a cada rodada; `deveRenovar` decide (puro).
//
// Token vencido NÃO renova — aí só gerando um novo no painel da Meta. A tela
// avisa isso com a data.
// ============================================================================
import { createAdminClient } from '@/lib/supabase/admin'

const GRAPH = 'https://graph.instagram.com'
export const CHAVE_TOKEN = 'ig_access_token'
export const CHAVE_RENOVADO_EM = 'ig_token_renovado_em'
/** A Meta só renova token com mais de 24h de vida. */
export const INTERVALO_RENOVACAO_MS = 24 * 60 * 60 * 1000

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

let cache: { token: string | null; em: number } | null = null
const CACHE_MS = 60_000

/** Token efetivo: banco primeiro, ambiente como reserva. null = não conectado. */
export async function obterTokenInstagram(): Promise<string | null> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.token
  let token: string | null = null
  try {
    const admin = createAdminClient()
    const { data } = await admin.from('platform_settings').select('value').eq('key', CHAVE_TOKEN).maybeSingle()
    token = data?.value?.trim() || null
  } catch { /* sem banco, cai no ambiente */ }
  if (!token) token = process.env.IG_ACCESS_TOKEN?.trim() || null
  cache = { token, em: Date.now() }
  return token
}

/** Mesma coisa, mas lança — para os pontos que já lançavam quando faltava. */
export async function exigirTokenInstagram(): Promise<string> {
  const t = await obterTokenInstagram()
  if (!t) throw new Error('Instagram não conectado (token ausente)')
  return t
}

export function limparCacheDoToken(): void { cache = null }

/**
 * Renova se nunca renovou ou se a última renovação tem 24h ou mais.
 * Puro: recebe o carimbo do banco e o agora.
 */
export function deveRenovar(renovadoEmIso: string | null | undefined, agora: Date = new Date()): boolean {
  if (!renovadoEmIso) return true
  const t = Date.parse(renovadoEmIso)
  if (!Number.isFinite(t)) return true
  return agora.getTime() - t >= INTERVALO_RENOVACAO_MS
}

/** Lê o corpo da Meta e devolve o token novo, ou lança com a mensagem dela. */
export async function pedirRenovacao(tokenAtual: string, fetchImpl: FetchLike = fetch): Promise<{ token: string; expiraEmSegundos: number | null }> {
  const url = `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(tokenAtual)}`
  const res = await fetchImpl(url)
  const json = await res.json().catch(() => null) as { access_token?: string; expires_in?: number; error?: { message?: string } } | null
  if (!res.ok || !json?.access_token) throw new Error(json?.error?.message ?? `refresh HTTP ${res.status}`)
  return { token: json.access_token, expiraEmSegundos: json.expires_in ?? null }
}

export interface ResultadoRenovacao {
  renovado: boolean
  motivo: 'sem_token' | 'cedo_demais' | 'renovado' | 'falhou'
  erro?: string
}

/**
 * Renovação com persistência. Grava o token novo e o carimbo em
 * platform_settings. Se o token vier só do ambiente, grava o renovado no
 * banco — a partir daí o banco manda e a Vercel pode ficar como está.
 */
export async function renovarTokenSeNecessario(fetchImpl: FetchLike = fetch, agora: Date = new Date()): Promise<ResultadoRenovacao> {
  const token = await obterTokenInstagram()
  if (!token) return { renovado: false, motivo: 'sem_token' }

  const admin = createAdminClient()
  const { data } = await admin.from('platform_settings').select('value').eq('key', CHAVE_RENOVADO_EM).maybeSingle()
  if (!deveRenovar(data?.value ?? null, agora)) return { renovado: false, motivo: 'cedo_demais' }

  try {
    const r = await pedirRenovacao(token, fetchImpl)
    const carimbo = agora.toISOString()
    await admin.from('platform_settings').upsert(
      [
        { key: CHAVE_TOKEN, value: r.token, updated_at: carimbo },
        { key: CHAVE_RENOVADO_EM, value: carimbo, updated_at: carimbo },
      ],
      { onConflict: 'key' },
    )
    limparCacheDoToken()
    return { renovado: true, motivo: 'renovado' }
  } catch (err) {
    // Não grava nada: o token antigo continua valendo até vencer. O erro
    // aparece no log do cron e na tela de conexão.
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[instagram/token] renovação falhou:', msg)
    return { renovado: false, motivo: 'falhou', erro: msg.slice(0, 300) }
  }
}

/** Texto amigável para a tela quando a Meta reclama do token. */
export function explicarErroDeToken(mensagem: string | undefined | null): string | null {
  if (!mensagem) return null
  const m = mensagem.match(/Session has expired on (.+?)\. The current time/i)
  if (m) return `O token do Instagram venceu em ${m[1]}. Gere um novo no painel da Meta e cole em Admin → Configurações → Instagram.`
  if (/Invalid OAuth|Error validating access token|access token/i.test(mensagem)) {
    return 'O token do Instagram foi recusado pela Meta. Gere um novo no painel da Meta e cole em Admin → Configurações → Instagram.'
  }
  return null
}
