'use server'

// ============================================================================
// Content Studio — Server Actions do Office Preview
// ----------------------------------------------------------------------------
// Server Action é um endpoint HTTP: o cliente controla TODOS os argumentos.
// Nada que chega aqui é confiável. Por isso:
//
//   • tenant     -> sempre derivado da sessão, nunca recebido
//   • produção   -> reconferida contra o tenant E contra as regras de demo
//   • quantidade -> fixa no servidor (1 job por chamada), não é parâmetro
//   • erros      -> detalhe no log do servidor, mensagem genérica no navegador
//
// `advanceDemo` só toca produções marcadas como demonstração. Quando os agentes
// reais entrarem — e passarem a custar dinheiro por execução — esta action não
// pode virar um gatilho barato para disparar produção de verdade.
//
// O service_role vive só aqui. Este arquivo nunca é importado por componente de
// cliente: as actions são chamadas por referência.
// ============================================================================

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

import { drainQueue, startProduction } from '@/lib/content-studio/orchestrator'
import {
  admitDemoProduction,
  DEMO_BRIEF_MODE,
  DEMO_MAX_JOBS_PER_CALL,
  DEMO_PIPELINE_KEY,
  isOpenDemo,
  pickWinningDemo,
  safeUserMessage,
  toPublicEvent,
  type ProductionAdmission,
  type PublicEvent,
  type UserMessageKey,
} from '@/lib/content-studio/demo-guard'
import { createSupabaseContentStore } from '@/lib/content-studio/store'
import type { ProductionRow, StoredEvent } from '@/lib/content-studio/types'

export interface DemoStart {
  productionId: string
}

export interface DemoState {
  /** Sem tenant_id: o navegador não precisa dele. */
  production: { id: string; status: ProductionRow['status']; title: string | null }
  events: PublicEvent[]
  /** true enquanto houver job aberto — o cliente segue chamando o avanço. */
  pending: boolean
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

const SELECT_ADMISSION = 'id, status, title, pipeline_key, brief'
// Literal separado: concatenar a string faz o supabase-js perder a inferência
// da linha e o tipo do retorno degrada.
const SELECT_ADMISSION_DATED = 'id, status, title, pipeline_key, brief, created_at'

/** Falha padronizada: detalhe só no servidor, texto genérico para o cliente. */
function fail<T>(key: UserMessageKey, internal?: unknown): ActionResult<T> {
  if (internal !== undefined) {
    console.error(`[content-studio] ${key}:`, internal instanceof Error ? internal.message : String(internal))
  }
  return { ok: false, error: safeUserMessage(key) }
}

// ─── Auth ───────────────────────────────────────────────────────────────────

async function getSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(list) {
          try { list.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {}
        },
      },
    },
  )
}

/**
 * Tenant da sessão. Devolve `null` em vez de `redirect('/login')` porque estas
 * actions são chamadas em laço a partir do cliente: um redirect no meio vira
 * erro opaco na tela em vez de mensagem clara.
 */
async function currentTenantId(): Promise<string | null> {
  const supabase = await getSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  return data?.tenant_id ?? null
}

/**
 * Carrega a produção conferindo dono E regras de demonstração.
 *
 * São checagens independentes: a posse impede acessar produção de outro tenant;
 * a admissão impede usar esta action numa produção REAL do próprio tenant.
 */
async function loadAdmittedDemo(
  productionId: string,
  tenantId: string,
): Promise<{ ok: true; row: ProductionAdmission & { title: string | null } } | { ok: false; key: UserMessageKey }> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('cs_productions')
    .select(SELECT_ADMISSION)
    .eq('id', productionId)
    .eq('tenant_id', tenantId)   // <- posse
    .maybeSingle()

  if (error) {
    console.error('[content-studio] falha ao carregar produção:', error.message)
    return { ok: false, key: 'read_failed' }
  }

  const row = (data ?? null) as (ProductionAdmission & { title: string | null }) | null
  const admission = admitDemoProduction(row)
  if (!admission.ok) return { ok: false, key: admission.reason }

  return { ok: true, row: row! }
}

// ─── Iniciar a demonstração ─────────────────────────────────────────────────

/**
 * Cria (ou reaproveita) a demonstração do tenant.
 *
 * Idempotente contra clique duplo, em duas camadas:
 *   1. se já existe demo ABERTA, devolve-a sem inserir nada;
 *   2. se duas chamadas simultâneas passarem pela camada 1 e inserirem, ambas
 *      releem, elegem a mesma vencedora e a perdedora cancela a própria.
 *
 * A camada 2 existe porque a 1 sozinha tem janela de corrida, e fechá-la de
 * verdade exigiria índice único — ou seja, migration, que não está autorizada.
 */
export async function startDemoProduction(): Promise<ActionResult<DemoStart>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const admin = createAdminClient()

  try {
    // Camada 1: reaproveita demonstração aberta.
    const existente = await findOpenDemo(admin, tenantId)
    if (existente) return { ok: true, data: { productionId: existente.id } }

    const { data: criada, error } = await admin
      .from('cs_productions')
      .insert({
        tenant_id: tenantId,                 // <- da sessão, nunca do cliente
        pipeline_key: DEMO_PIPELINE_KEY,     // <- fixo, não é parâmetro
        title: 'Demonstração do escritório',
        brief: {
          // `modo` é a marca de demonstração. Campo jsonb já existente: nenhuma
          // coluna nova, nenhuma migration.
          modo: DEMO_BRIEF_MODE,
          tema: 'lançamento de infoproduto',
          publico: 'infoprodutores iniciantes',
        },
      })
      .select('id, created_at')
      .single()

    if (error || !criada) return fail('start_failed', error?.message)

    // Camada 2: resolve corrida entre criações simultâneas.
    const vencedora = await resolveDuplicateDemos(admin, tenantId, criada.id)

    const store = createSupabaseContentStore(admin, { tenantId, productionId: vencedora })
    await startProduction(store, vencedora)   // idempotente

    return { ok: true, data: { productionId: vencedora } }
  } catch (err) {
    return fail('start_failed', err)
  }
}

async function findOpenDemo(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<{ id: string } | null> {
  const { data } = await admin
    .from('cs_productions')
    .select(SELECT_ADMISSION_DATED)
    .eq('tenant_id', tenantId)
    .eq('pipeline_key', DEMO_PIPELINE_KEY)
    .order('created_at', { ascending: true })
    .limit(20)

  const abertas = ((data ?? []) as unknown as (ProductionAdmission & { created_at: string })[]).filter(isOpenDemo)
  return pickWinningDemo(abertas)
}

/**
 * Elege uma vencedora entre demos abertas e cancela as demais.
 *
 * Cancelamento é lógico (`status='canceled'`) — nada é apagado, e a produção
 * perdedora fica registrada como o que foi: uma criação duplicada abandonada.
 */
async function resolveDuplicateDemos(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  minhaId: string,
): Promise<string> {
  const { data } = await admin
    .from('cs_productions')
    .select(SELECT_ADMISSION_DATED)
    .eq('tenant_id', tenantId)
    .eq('pipeline_key', DEMO_PIPELINE_KEY)
    .order('created_at', { ascending: true })
    .limit(20)

  const abertas = ((data ?? []) as unknown as (ProductionAdmission & { created_at: string })[]).filter(isOpenDemo)
  const vencedora = pickWinningDemo(abertas)
  if (!vencedora) return minhaId

  const perdedoras = abertas.filter(p => p.id !== vencedora.id).map(p => p.id)
  if (perdedoras.length > 0) {
    await admin
      .from('cs_productions')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .in('id', perdedoras)
  }

  return vencedora.id
}

// ─── Avançar ────────────────────────────────────────────────────────────────

/**
 * Executa EXATAMENTE UM passo da demonstração.
 *
 * Não há parâmetro de quantidade: um cliente que pudesse pedir "avance 50" faria
 * uma chamada disparar 50 execuções. A constante é do servidor.
 */
export async function advanceDemo(productionId: string): Promise<ActionResult<DemoState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  if (typeof productionId !== 'string' || productionId.length === 0 || productionId.length > 64) {
    return fail('not_found')
  }

  const admitida = await loadAdmittedDemo(productionId, tenantId)
  if (!admitida.ok) return fail(admitida.key)

  const admin = createAdminClient()
  const store = createSupabaseContentStore(admin, { tenantId, productionId })

  try {
    // O lock em cs_jobs é o que impede duas chamadas simultâneas de executarem
    // o mesmo job: o claim só vence quem encontrar a linha ainda 'pending'.
    await drainQueue(store, DEMO_MAX_JOBS_PER_CALL)
  } catch (err) {
    // Falhar ao avançar não pode esconder a timeline: seguimos para devolver o
    // estado, que já contém o evento de erro gravado em cs_events.
    console.error('[content-studio] falha ao avançar demonstração:', err instanceof Error ? err.message : String(err))
  }

  return readState(admin, tenantId, productionId)
}

// ─── Ler o estado ───────────────────────────────────────────────────────────

export async function getDemoState(productionId: string): Promise<ActionResult<DemoState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const admin = createAdminClient()

  // Leitura não exige que a produção seja avançável (uma demo concluída pode
  // ser relida à vontade), mas exige posse e que seja mesmo uma demonstração.
  const { data } = await admin
    .from('cs_productions')
    .select(SELECT_ADMISSION)
    .eq('id', productionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const row = (data ?? null) as (ProductionAdmission & { title: string | null }) | null
  if (!row || row.pipeline_key !== DEMO_PIPELINE_KEY || row.brief?.modo !== DEMO_BRIEF_MODE) {
    return fail('not_found')
  }

  return readState(admin, tenantId, productionId)
}

async function readState(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  productionId: string,
): Promise<ActionResult<DemoState>> {
  const [producao, eventos, jobs] = await Promise.all([
    admin.from('cs_productions').select('id, status, title')
      .eq('id', productionId).eq('tenant_id', tenantId).maybeSingle(),
    admin.from('cs_events').select('*')
      .eq('tenant_id', tenantId).eq('production_id', productionId)
      .order('seq', { ascending: true }).limit(500),
    admin.from('cs_jobs').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('production_id', productionId)
      .in('status', ['pending', 'running']),
  ])

  if (producao.error || !producao.data) {
    return fail('read_failed', producao.error?.message)
  }

  const row = producao.data as { id: string; status: ProductionRow['status']; title: string | null }

  return {
    ok: true,
    data: {
      production: { id: row.id, status: row.status, title: row.title },
      // tenant_id é removido de cada evento antes de sair do servidor.
      events: ((eventos.data ?? []) as StoredEvent[]).map(toPublicEvent),
      pending: (jobs.count ?? 0) > 0,
    },
  }
}

// ─── Última demonstração do tenant ──────────────────────────────────────────

/**
 * Retomada ao abrir a página. Apenas LÊ — abrir ou recarregar a tela nunca
 * inicia nem retoma processamento.
 */
export async function getLatestDemo(): Promise<ActionResult<DemoState | null>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const admin = createAdminClient()
  const { data } = await admin
    .from('cs_productions')
    .select('id, brief, pipeline_key')
    .eq('tenant_id', tenantId)
    .eq('pipeline_key', DEMO_PIPELINE_KEY)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = data as { id: string; brief: Record<string, unknown> | null; pipeline_key: string } | null
  if (!row || row.brief?.modo !== DEMO_BRIEF_MODE) return { ok: true, data: null }

  return readState(admin, tenantId, row.id)
}
