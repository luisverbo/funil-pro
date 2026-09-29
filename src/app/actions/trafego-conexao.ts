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
import { montarMesa, type PlanoMesa, type LinhaMesa } from '@/lib/trafego/mesa'
import { carregarEntradaMesa, type SerieDia } from '@/lib/trafego/mesa-loader'
import { resolverPeriodo, MAX_DIAS_PERIODO, type Periodo } from '@/lib/trafego/periodo'
import { alterarStatus, alterarOrcamentoDiario, PERMISSAO_ACOES, type StatusAcao } from '@/lib/meta/acoes'
import type { NivelAnuncio } from '@/lib/meta/sync-v2'
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
export async function sincronizarAgora(
  contaId: string | null = null,
  periodo: { desde: string; ate: string } | null = null,
): Promise<{ ok: number; falhas: number; erros: string[]; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const admin = createAdminClient()
    const contas = (await listarContasDeAnuncio(admin, tenantId)).filter(c => !contaId || c.id === contaId)
    if (contas.length === 0) return { ok: 0, falhas: 0, erros: [], error: 'Nenhuma conta ativa conectada.' }
    // Lê pelo menos os últimos 30 dias; período pedido maior amplia a janela (teto MAX_DIAS_PERIODO).
    const padrao = intervaloPadrao(30)
    const pedido = periodo ? resolverPeriodo({ p: 'custom', de: periodo.desde, ate: periodo.ate }) : null
    const intervalo = pedido && pedido.dias <= MAX_DIAS_PERIODO
      ? { desde: pedido.desde < padrao.desde ? pedido.desde : padrao.desde, ate: padrao.ate }
      : padrao
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

/** Tudo o que a aba mostra, recortado por conta (null = todas) e período livre. */
export async function painelTrafego(contaId: string | null, q: { p?: string; de?: string; ate?: string } | number): Promise<{
  plano: PlanoMesa | null
  linhas: LinhaMesa[]
  serie: SerieDia[]
  periodo: Periodo
  semAtribuicao: { vendas: number; receitaCents: number }
  error?: string
}> {
  const periodo = resolverPeriodo(typeof q === 'number' ? { p: String(q) } : (q ?? {}))
  const vazio = { plano: null, linhas: [], serie: [], periodo, semAtribuicao: { vendas: 0, receitaCents: 0 } }
  try {
    const tenantId = await getTenantId()
    const entrada = await carregarEntradaMesa(createAdminClient(), tenantId, periodo, contaId || null)
    if (!entrada) return vazio
    return {
      plano: montarMesa(entrada), linhas: entrada.linhas, serie: entrada.serie, periodo,
      semAtribuicao: entrada.semAtribuicao,
    }
  } catch (err) { return { ...vazio, error: String(err) } }
}

/** Parecer escrito pelo estrategista-chefe (IA), sob demanda. */
export async function parecerDoChefe(q: { p?: string; de?: string; ate?: string } | number, contaId: string | null = null): Promise<{ texto?: string; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const periodo = resolverPeriodo(typeof q === 'number' ? { p: String(q) } : (q ?? {}))
    const d = periodo.dias
    const entrada = await carregarEntradaMesa(createAdminClient(), tenantId, periodo, contaId || null)
    if (!entrada) return { error: 'Conecte uma conta de anúncio primeiro.' }
    const plano = montarMesa(entrada)
    if (plano.resumo.gastoCents === 0) return { error: 'Ainda não há gasto lido no período para analisar.' }
    return { texto: await gerarParecer(plano, d, callAnthropic) }
  } catch (err) {
    const m = String(err)
    return { error: m.includes('anthropic_key_missing') ? 'A chave da IA não está configurada no servidor.' : 'Não consegui gerar o parecer agora. Tente de novo.' }
  }
}

// ── Ações na campanha (sem abrir o Gerenciador) ────────────────────────────

export type AcaoCampanha =
  | { tipo: 'status'; status: StatusAcao }
  | { tipo: 'orcamento'; novoCents: number }

/**
 * Executa uma ação num item da Meta. Acha a conta dona do item no banco (o
 * cliente NÃO manda token nem escolhe conta), confere a permissão e
 * espelha o resultado em `ad_entities` para a tela refletir na hora.
 */
export async function executarAcao(nivel: NivelAnuncio, externalId: string, acao: AcaoCampanha): Promise<{
  ok: boolean; error?: string; precisaPermissao?: boolean
}> {
  try {
    const tenantId = await getTenantId()
    if (!/^\d{5,30}$/.test(externalId)) return { ok: false, error: 'ID inválido.' }
    const admin = createAdminClient()
    const { data: ent } = await admin.from('ad_entities')
      .select('id, ad_account_id, daily_budget_cents, name')
      .eq('tenant_id', tenantId).eq('level', nivel).eq('external_id', externalId).maybeSingle()
    if (!ent) return { ok: false, error: 'Item não encontrado nesta conta.' }
    const { data: conta } = await admin.from('ad_accounts').select('id, access_token, status')
      .eq('id', ent.ad_account_id).eq('tenant_id', tenantId).maybeSingle()
    if (!conta?.access_token) return { ok: false, error: 'Conta sem token. Reconecte.' }

    const concedidas = await permissoesDoToken(String(conta.access_token)).catch(() => [] as string[])
    if (!concedidas.includes(PERMISSAO_ACOES)) {
      return { ok: false, precisaPermissao: true, error: `Para mexer na campanha o token precisa da permissão ${PERMISSAO_ACOES}. Gere um token novo no Explorador marcando ads_read + ads_management e reconecte a conta.` }
    }

    const agora = new Date().toISOString()
    if (acao.tipo === 'status') {
      await alterarStatus(externalId, acao.status, String(conta.access_token))
      await admin.from('ad_entities').update({ status: acao.status, effective_status: acao.status, synced_at: agora }).eq('id', ent.id)
    } else {
      await alterarOrcamentoDiario(externalId, nivel, acao.novoCents, ent.daily_budget_cents ?? null, String(conta.access_token))
      await admin.from('ad_entities').update({ daily_budget_cents: acao.novoCents, synced_at: agora }).eq('id', ent.id)
    }
    console.info(`[trafego] ação ${acao.tipo} em ${nivel}/${externalId} (${ent.name ?? '-'}) por tenant ${tenantId}`)
    revalidatePath('/trafego')
    return { ok: true }
  } catch (err) { return { ok: false, error: mensagemDeErro(err) } }
}
