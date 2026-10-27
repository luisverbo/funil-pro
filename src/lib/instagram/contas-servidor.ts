// ============================================================================
// Contas do Instagram — banco + Meta (servidor)
// ----------------------------------------------------------------------------
// Token só sai daqui para o publicador; a tela recebe as contas SEM token.
// ============================================================================
import { createAdminClient } from '@/lib/supabase/admin'
import { pedirRenovacao, deveRenovar } from './token'
import { expiraEm } from './contas'

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ContaInstagram {
  id: string
  ig_user_id: string
  username: string | null
  nome: string | null
  foto_url: string | null
  status: 'ativa' | 'erro'
  erro: string | null
  token_expira_em: string | null
  created_at: string
}

const COLS_PUBLICAS = 'id, ig_user_id, username, nome, foto_url, status, erro, token_expira_em, created_at'

export async function obterAppId(): Promise<string | null> {
  const { data } = await createAdminClient().from('platform_settings').select('value').eq('key', 'ig_app_id').maybeSingle()
  return data?.value?.trim() || null
}

export function segredoDoApp(): string | null {
  return process.env.IG_APP_SECRET?.trim() || null
}

async function json<T>(res: Response): Promise<T> {
  const j = await res.json().catch(() => null) as (T & { error?: { message?: string } | string; error_message?: string }) | null
  if (!res.ok || !j || j.error) {
    const e = j?.error
    throw new Error((typeof e === 'string' ? j?.error_message ?? e : e?.message) ?? `HTTP ${res.status}`)
  }
  return j
}

/** code → token curto → token de 60 dias → perfil. */
export async function trocarCodigo(
  p: { code: string; appId: string; segredo: string; redirectUri: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ token: string; expiresIn: number | null; igUserId: string; username: string | null; nome: string | null; foto: string | null }> {
  const curto = await json<{ access_token: string; user_id: string | number }>(await fetchImpl('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: p.appId, client_secret: p.segredo, grant_type: 'authorization_code', redirect_uri: p.redirectUri, code: p.code }).toString(),
  }))
  const longo = await json<{ access_token: string; expires_in?: number }>(await fetchImpl(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(p.segredo)}&access_token=${encodeURIComponent(curto.access_token)}`,
  ))
  const me = await json<{ user_id?: string; id?: string; username?: string; name?: string; profile_picture_url?: string }>(await fetchImpl(
    'https://graph.instagram.com/v21.0/me?fields=user_id,username,name,profile_picture_url',
    { headers: { Authorization: `Bearer ${longo.access_token}` } },
  ))
  return {
    token: longo.access_token,
    expiresIn: longo.expires_in ?? null,
    igUserId: String(me.user_id ?? me.id ?? curto.user_id),
    username: me.username ?? null,
    nome: me.name ?? null,
    foto: me.profile_picture_url ?? null,
  }
}

export async function salvarConta(tenantId: string, c: Awaited<ReturnType<typeof trocarCodigo>>): Promise<void> {
  const agora = new Date().toISOString()
  const { error } = await createAdminClient().from('instagram_contas').upsert({
    tenant_id: tenantId, ig_user_id: c.igUserId, username: c.username, nome: c.nome, foto_url: c.foto,
    token: c.token, token_expira_em: expiraEm(c.expiresIn), renovado_em: agora,
    status: 'ativa', erro: null, updated_at: agora,
  }, { onConflict: 'tenant_id,ig_user_id' })
  if (error) throw new Error(error.message)
}

export async function listarContas(tenantId: string): Promise<ContaInstagram[]> {
  const { data, error } = await createAdminClient().from('instagram_contas').select(COLS_PUBLICAS)
    .eq('tenant_id', tenantId).order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ContaInstagram[]
}

/** Token + id da conta para publicar. Confere o tenant. */
export async function credencialDaConta(contaId: string, tenantId: string): Promise<{ token: string; igUserId: string } | null> {
  const { data } = await createAdminClient().from('instagram_contas').select('token, ig_user_id, status')
    .eq('id', contaId).eq('tenant_id', tenantId).maybeSingle()
  return data?.token ? { token: data.token, igUserId: data.ig_user_id } : null
}

export async function removerConta(contaId: string, tenantId: string): Promise<void> {
  const { error } = await createAdminClient().from('instagram_contas').delete().eq('id', contaId).eq('tenant_id', tenantId)
  if (error) throw new Error(error.message)
}

/** Meta pediu (usuário removeu o app / pediu exclusão): apaga em todos os tenants. */
export async function apagarPorIgUser(igUserId: string): Promise<number> {
  const { data } = await createAdminClient().from('instagram_contas').delete().eq('ig_user_id', igUserId).select('id')
  return data?.length ?? 0
}

/** Cron: renova os tokens com 24h ou mais desde a última renovação. */
export async function renovarContas(fetchImpl: FetchLike = fetch, limite = 20): Promise<{ renovadas: number; falhas: number }> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('instagram_contas').select('id, token, renovado_em').eq('status', 'ativa')
    .order('renovado_em', { ascending: true, nullsFirst: true }).limit(limite)
  if (error) return { renovadas: 0, falhas: 0 }   // tabela ainda não criada: segue sem quebrar o cron
  let renovadas = 0, falhas = 0
  for (const c of data ?? []) {
    if (!deveRenovar(c.renovado_em)) continue
    const agora = new Date().toISOString()
    try {
      const r = await pedirRenovacao(c.token, fetchImpl)
      await admin.from('instagram_contas').update({ token: r.token, token_expira_em: expiraEm(r.expiraEmSegundos), renovado_em: agora, erro: null, updated_at: agora }).eq('id', c.id)
      renovadas++
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
      const vencido = /expired|invalid|validating access token/i.test(msg)
      await admin.from('instagram_contas').update({ erro: msg, updated_at: agora, ...(vencido ? { status: 'erro' } : {}) }).eq('id', c.id)
      falhas++
    }
  }
  return { renovadas, falhas }
}
