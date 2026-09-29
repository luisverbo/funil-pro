'use server'
// ============================================================================
// Tráfego — conectar, listar e sincronizar contas de anúncio
// ----------------------------------------------------------------------------
// Chamadas pela tela via /api/trafego (despachante HTTP de lista fechada).
// O token NUNCA volta para o navegador: a tela só recebe nome, moeda e
// situação das contas.
//
// ATENÇÃO: NÃO re-exportar tipos daqui (`export type { … }`) — vide quiz-leads.
// ============================================================================
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  listarContasDoToken, permissoesDoToken, permissoesFaltando, tokenDeLongaDuracao, idDeContaValido,
  type ContaDisponivel,
} from '@/lib/meta/conectar'
import { MetaApiError, descreverErroMeta } from '@/lib/meta/client'
import { sincronizarConta, intervaloPadrao } from '@/lib/meta/sync-v2'
import { listarContasDeAnuncio } from '@/lib/meta/accounts'
import { montarMesa, type PlanoMesa } from '@/lib/trafego/mesa'
import { carregarEntradaMesa } from '@/lib/trafego/mesa-loader'
import { gerarParecer } from '@/lib/trafego/mesa-parecer'
import { callAnthropic } from '@/lib/agents/chat'

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(list) { try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} },
    } },
  )
}

async function getTenantId(): Promise<string> {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!data) redirect('/login')
  return data.tenant_id
}

function mensagemDeErro(err: unknown): string {
  if (err instanceof MetaApiError) return descreverErroMeta(err)
  return err instanceof Error ? err.message : String(err)
}

// ── Passo 1: colar o token e ver as contas ─────────────────────────────────

export async function buscarContasDoToken(token: string): Promise<{
  contas?: ContaDisponivel[]; faltando?: string[]; error?: string
}> {
  try {
    await getTenantId()
    const t = (token ?? '').trim()
    if (t.length < 20) return { error: 'Cole o token completo (ele é bem comprido).' }
    const concedidas = await permissoesDoToken(t).catch(() => [] as string[])
    const faltando = permissoesFaltando(concedidas)
    const contas = await listarContasDoToken(t)
    if (contas.length === 0) {
      return { contas, faltando, error: faltando.length > 0
        ? `O token não tem a permissão ${faltando.join(', ')}. Gere de novo marcando essa permissão.`
        : 'Esse token não enxerga nenhuma conta de anúncio. Confira se você é administrador da conta no Gerenciador de Negócios.' }
    }
    return { contas, faltando }
  } catch (err) { return { error: mensagemDeErro(err) } }
}

// ── Passo 2: conectar as contas escolhidas ─────────────────────────────────

export async function conectarContas(token: string, ids: string[]): Promise<{
  conectadas?: number; tokenLongo?: boolean; expiraEm?: string | null; error?: string
}> {
  try {
    const tenantId = await getTenantId()
    const t = (token ?? '').trim()
    const escolhidos = [...new Set((ids ?? []).filter(idDeContaValido))]
    if (escolhidos.length === 0) return { error: 'Escolha pelo menos uma conta.' }

    // Só conecta conta que o PRÓPRIO token enxerga — ninguém injeta ID.
    const disponiveis = await listarContasDoToken(t)
    const porId = new Map(disponiveis.map(c => [c.id, c]))
    const validas = escolhidos.filter(id => porId.has(id))
    if (validas.length === 0) return { error: 'Essas contas não aparecem para esse token.' }

    const admin = createAdminClient()
    const { data: app } = await admin.from('platform_settings').select('key, value').in('key', ['meta_app_id', 'meta_app_secret'])
    const cfg = Object.fromEntries((app ?? []).map(r => [r.key, r.value]))
    const longo = await tokenDeLongaDuracao(t, { id: cfg.meta_app_id, secret: cfg.meta_app_secret })

    // Conexão antiga com ID inválido (o e-mail no lugar do número) sai.
    const { data: antigas } = await admin.from('ad_accounts').select('id, external_id').eq('tenant_id', tenantId)
    const quebradas = (antigas ?? []).filter(a => !idDeContaValido(String(a.external_id).replace(/^act_/, ''))).map(a => a.id)
    if (quebradas.length > 0) await admin.from('ad_accounts').delete().in('id', quebradas)
    await admin.from('tenants').update({ meta_ad_account_id: null }).eq('id', tenantId).not('meta_ad_account_id', 'is', null)
      .then(() => {}, () => {})

    const agora = new Date().toISOString()
    const { error } = await admin.from('ad_accounts').upsert(validas.map(id => {
      const c = porId.get(id)!
      return {
        tenant_id: tenantId, provider: 'meta', external_id: id,
        name: c.nome, currency: c.moeda, timezone_name: c.fuso,
        access_token: longo.token, token_expires_at: longo.expiraEm,
        status: 'active', last_error: null, last_sync_at: null, updated_at: agora,
      }
    }), { onConflict: 'tenant_id,provider,external_id' })
    if (error) return { error: error.message }

    revalidatePath('/trafego')
    return { conectadas: validas.length, tokenLongo: longo.trocado, expiraEm: longo.expiraEm }
  } catch (err) { return { error: mensagemDeErro(err) } }
}

// ── Contas conectadas ──────────────────────────────────────────────────────

export interface ContaConectadaResumo {
  id: string
  externalId: string
  nome: string
  moeda: string | null
  status: string
  ultimaSync: string | null
  erro: string | null
  tokenExpiraEm: string | null
}

export async function listarContasConectadas(): Promise<{ contas: ContaConectadaResumo[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { data, error } = await createAdminClient().from('ad_accounts')
      .select('id, external_id, name, currency, status, last_sync_at, last_error, token_expires_at')
      .eq('tenant_id', tenantId).eq('provider', 'meta').order('created_at')
    if (error) return { contas: [], error: error.message }
    return {
      contas: (data ?? []).map(c => ({
        id: String(c.id), externalId: String(c.external_id), nome: c.name ?? `Conta ${c.external_id}`,
        moeda: c.currency ?? null, status: String(c.status), ultimaSync: c.last_sync_at ?? null,
        erro: c.last_error ?? null, tokenExpiraEm: c.token_expires_at ?? null,
      })),
    }
  } catch (err) { return { contas: [], error: String(err) } }
}

export async function desconectarConta(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const { error } = await createAdminClient().from('ad_accounts').delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) return { success: false, error: error.message }
    revalidatePath('/trafego')
    return { success: true }
  } catch (err) { return { success: false, error: String(err) } }
}

/** Lê agora (sem esperar o cron) as contas ativas do tenant — últimos 30 dias. */
export async function sincronizarAgora(): Promise<{ ok: number; falhas: number; erros: string[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const contas = await listarContasDeAnuncio(admin, tenantId)
    if (contas.length === 0) return { ok: 0, falhas: 0, erros: [], error: 'Nenhuma conta ativa conectada.' }
    const intervalo = intervaloPadrao(30)
    let ok = 0; let falhas = 0; const erros: string[] = []
    for (const c of contas) {
      const r = await sincronizarConta(admin, c, intervalo, {})
      if (r.ok) ok++
      else { falhas++; if (r.erro) erros.push(`${c.name ?? c.externalId}: ${r.erro}`) }
    }
    revalidatePath('/trafego')
    return { ok, falhas, erros }
  } catch (err) { return { ok: 0, falhas: 0, erros: [], error: String(err) } }
}

// ── Mesa de estrategistas ──────────────────────────────────────────────────

/** O que o time recomenda para o período (7, 14 ou 30 dias). */
export async function planoDaMesa(dias: number): Promise<{ plano: PlanoMesa | null; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const d = [7, 14, 30].includes(Number(dias)) ? Number(dias) : 7
    const entrada = await carregarEntradaMesa(createAdminClient(), tenantId, d)
    return { plano: entrada ? montarMesa(entrada) : null }
  } catch (err) { return { plano: null, error: String(err) } }
}

/** Parecer escrito pelo estrategista-chefe (IA), sob demanda. */
export async function parecerDoChefe(dias: number): Promise<{ texto?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const d = [7, 14, 30].includes(Number(dias)) ? Number(dias) : 7
    const entrada = await carregarEntradaMesa(createAdminClient(), tenantId, d)
    if (!entrada) return { error: 'Conecte uma conta de anúncio primeiro.' }
    const plano = montarMesa(entrada)
    if (plano.resumo.gastoCents === 0) return { error: 'Ainda não há gasto lido no período para analisar.' }
    return { texto: await gerarParecer(plano, d, callAnthropic) }
  } catch (err) {
    const m = String(err)
    return { error: m.includes('anthropic_key_missing') ? 'A chave da IA não está configurada no servidor.' : 'Não consegui gerar o parecer agora. Tente de novo.' }
  }
}
