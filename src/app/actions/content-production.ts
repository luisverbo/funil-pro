'use server'

// ============================================================================
// Content Studio — Server Actions da PRODUÇÃO REAL (Fase 2A)
// ----------------------------------------------------------------------------
// Server Action é um endpoint HTTP: o cliente controla TODOS os argumentos.
// Nada que chega aqui é confiável. Em particular:
//
//   • tenant      -> SEMPRE derivado da sessão. Um `tenantId` no argumento é
//                    simplesmente ignorado — não existe caminho que o leia.
//   • briefing    -> revalidado aqui, mesmo já tendo sido validado na tela
//   • produção    -> reconferida contra o tenant E contra as regras de produção
//   • quantidade  -> fixa no servidor (1 job por chamada), não é parâmetro
//   • agente      -> escolhido pelo pipeline, nunca pelo cliente
//   • status      -> escrito só pelo orquestrador; o cliente não envia estado
//   • outputs     -> gravados só pelos agentes; o cliente não envia conteúdo
//   • erros       -> detalhe no log do servidor, mensagem genérica no navegador
//
// Estas actions são SEPARADAS das da demonstração de propósito. `advanceDemo`
// recusa produção real e `advanceProduction` recusa demonstração — os dois
// portões existem para que nenhum caminho barato dispare trabalho caro quando a
// IA entrar na Fase 2B.
//
// O service_role vive só aqui. Este arquivo nunca é importado por componente de
// cliente: as actions são chamadas por referência.
// ============================================================================

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

import { drainQueue, startProduction } from '@/lib/content-studio/orchestrator'
import { preflightContentAI } from '@/lib/content-studio/ai/bootstrap'
import { firstBriefMessage, validateBrief, type BriefInput, type ValidBrief } from '@/lib/content-studio/brief'
import { CAROUSEL_AI_PIPELINE } from '@/lib/content-studio/pipeline'
import {
  admitProduction,
  isRealProduction,
  pipelineRequiresAI,
  PRODUCTION_MAX_JOBS_PER_CALL,
  PRODUCTION_PIPELINE_KEYS,
  PRODUCTION_TERMINAL,
  safeProductionMessage,
  type ProductionAdmissionRow,
  type ProductionMessageKey,
} from '@/lib/content-studio/production-guard'
import {
  createWithPreflight,
  type ProductionRepo,
  type ProductionRowLite,
} from '@/lib/content-studio/production-runner'
import { buildProductionResult, type ProductionResult } from '@/lib/content-studio/result-view'
import { createSupabaseContentStore } from '@/lib/content-studio/store'
import { toPublicEvent, type PublicEvent } from '@/lib/content-studio/demo-guard'
import type { ProductionRow, StepRow, StoredEvent } from '@/lib/content-studio/types'

export interface ProductionSummary {
  /** Sem tenant_id: o navegador não precisa dele. */
  id: string
  title: string | null
  status: ProductionRow['status']
  createdAt: string
}

export interface ProductionState {
  production: ProductionSummary
  events: PublicEvent[]
  /** true enquanto houver job aberto — o cliente segue pedindo o avanço. */
  pending: boolean
  /** Montado no SERVIDOR, a partir de cs_steps.output. */
  result: ProductionResult
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

const SELECT_LITE = 'id, status, pipeline_key, brief, created_at'

/** Falha padronizada: detalhe só no servidor, texto genérico para o cliente. */
function fail<T>(key: ProductionMessageKey, internal?: unknown): ActionResult<T> {
  if (internal !== undefined) {
    // Só a mensagem, nunca o objeto inteiro — e NUNCA o briefing.
    console.error(
      `[content-studio:producao] ${key}:`,
      internal instanceof Error ? internal.message : String(internal),
    )
  }
  return { ok: false, error: safeProductionMessage(key) }
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
 * Tenant da sessão. Única origem possível do tenant em todo este arquivo.
 *
 * Devolve `null` em vez de `redirect('/login')` porque estas actions são
 * chamadas em laço pelo cliente: um redirect no meio vira erro opaco na tela.
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

function idValido(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64
}

// ─── Criar a produção ───────────────────────────────────────────────────────

/**
 * Cria a produção a partir do briefing.
 *
 * `input` traz SOMENTE campos de briefing. Se o cliente enviar `tenantId`,
 * `status`, `pipelineKey` ou qualquer outra coisa, nada disso é lido: o
 * `validateBrief` copia campo a campo da lista branca, e o pipeline é constante.
 */
export async function createProduction(input: BriefInput): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const validado = validateBrief(input ?? {})
  if (!validado.ok) {
    // Mensagem de campo é segura: fala do formulário, não do banco.
    return { ok: false, error: firstBriefMessage(validado.errors) }
  }

  // PREFLIGHT ÚNICO, dentro do coordenador: kill switch, chave, modelo e
  // construção do provedor — sem rede — ANTES da fábrica do repo. Reprovado:
  // zero produção, zero step, zero job, zero evento. Os códigos internos
  // (disabled/missing_key/invalid_config) ficam no log; o navegador vê uma
  // única mensagem amigável.
  try {
    const resultado = await createWithPreflight(
      preflightContentAI,
      () => supabaseProductionRepo(createAdminClient(), tenantId),
      validado.brief)
    if (!resultado.ok) return fail(resultado.reason)
    const admin = createAdminClient()
    return readState(admin, tenantId, resultado.productionId)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('content_ai:')) {
      return fail('ai_disabled', err)
    }
    return fail('create_failed', err)
  }
}

/**
 * Implementação Supabase da porta usada por `ensureProduction`.
 *
 * Toda query carrega o tenant da sessão — não há uma sequer sem `.eq('tenant_id')`.
 */
function supabaseProductionRepo(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): ProductionRepo {
  const base = () => admin.from('cs_productions').select(SELECT_LITE).eq('tenant_id', tenantId)

  return {
    async findByIdempotencyKey(key: string): Promise<ProductionRowLite[]> {
      // SÓ o pipeline de IA: uma produção determinística antiga jamais é
      // reaproveitada por coincidência de idempotency_key.
      const { data, error } = await base()
        .eq('pipeline_key', CAROUSEL_AI_PIPELINE.key)
        .eq('brief->>idempotency_key', key)
        .order('created_at', { ascending: true })
        .limit(10)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ProductionRowLite[]
    },

    async listOpen(): Promise<ProductionRowLite[]> {
      // O limite de abertas conta as DUAS gerações — trocar de pipeline não
      // multiplica a cota do tenant. Demonstrações ficam fora (lista branca).
      const { data, error } = await base()
        .in('pipeline_key', [...PRODUCTION_PIPELINE_KEYS])
        .not('status', 'in', `(${PRODUCTION_TERMINAL.join(',')})`)
        .order('created_at', { ascending: true })
        .limit(20)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ProductionRowLite[]
    },

    async insert(brief: ValidBrief): Promise<ProductionRowLite> {
      const { data, error } = await admin
        .from('cs_productions')
        .insert({
          tenant_id: tenantId,                 // <- da sessão, nunca do cliente
          pipeline_key: CAROUSEL_AI_PIPELINE.key, // <- constante, não é parâmetro
          title: brief.titulo,
          brief,                               // <- já validado e normalizado
        })
        .select(SELECT_LITE)
        .single()
      if (error || !data) throw new Error(error?.message ?? 'insert falhou')
      return data as unknown as ProductionRowLite
    },

    async cancel(ids: string[]): Promise<void> {
      if (ids.length === 0) return
      const { error } = await admin
        .from('cs_productions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .in('id', ids)
      if (error) throw new Error(error.message)
    },

    async materialize(productionId: string): Promise<void> {
      const store = createSupabaseContentStore(admin, { tenantId, productionId })
      await startProduction(store, productionId)
    },
  }
}

// ─── Avançar ────────────────────────────────────────────────────────────────

/**
 * Executa EXATAMENTE UM passo da produção.
 *
 * Não há parâmetro de quantidade: um cliente que pudesse pedir "avance 50" faria
 * uma chamada disparar 50 execuções. A constante é do servidor.
 *
 * Repetir a chamada é seguro: o claim em cs_jobs só entrega o job a quem
 * encontrar a linha ainda 'pending', e uma produção sem job aberto é no-op.
 */
export async function advanceProduction(productionId: string): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')
  if (!idValido(productionId)) return fail('not_found')

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('cs_productions')
    .select(SELECT_LITE)
    .eq('id', productionId)
    .eq('tenant_id', tenantId)   // <- posse; produção de outro tenant "não existe"
    .maybeSingle()

  if (error) return fail('read_failed', error.message)

  const row = (data ?? null) as ProductionAdmissionRow | null
  const admissao = admitProduction(row)
  if (!admissao.ok) {
    // `not_advanceable` não é erro de verdade: a produção terminou. Devolvemos
    // o estado para o cliente parar de pedir e mostrar o resultado.
    if (admissao.reason === 'not_advanceable' && isRealProduction(row)) {
      return readState(admin, tenantId, productionId)
    }
    return fail(admissao.reason)
  }

  // O preflight de IA SÓ se aplica ao pipeline que executa IA — decidido
  // DEPOIS de carregar e conferir a produção do tenant. Uma produção
  // determinística antiga (content_carousel_v1) conclui normalmente com a IA
  // desligada, sem chave e sem modelo. Pipeline desconhecido já foi recusado
  // pela admissão (lista branca) com erro público seguro.
  if (pipelineRequiresAI(row!.pipeline_key)) {
    try {
      preflightContentAI()
    } catch (err) {
      return fail('ai_disabled', err)
    }
  }

  const store = createSupabaseContentStore(admin, { tenantId, productionId })

  try {
    // RETOMADA de materialização interrompida. Se a criação caiu no meio
    // (produção gravada, mas steps ou primeiro job não), a produção fica em
    // draft/queued sem nada na fila — e só drenar seria um no-op eterno.
    // `startProduction` é idempotente: com tudo no lugar, não duplica nada;
    // com algo faltando, completa exatamente o que faltou.
    if (row!.status === 'draft' || row!.status === 'queued') {
      await startProduction(store, productionId)
    }
    await drainQueue(store, PRODUCTION_MAX_JOBS_PER_CALL)
  } catch (err) {
    // Falhar ao avançar não pode esconder a timeline: seguimos para devolver o
    // estado, que já contém o evento de erro gravado em cs_events.
    console.error(
      '[content-studio:producao] falha ao avançar:',
      err instanceof Error ? err.message : String(err),
    )
  }

  return readState(admin, tenantId, productionId)
}

// ─── Ler ────────────────────────────────────────────────────────────────────

export async function getProductionState(productionId: string): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')
  if (!idValido(productionId)) return fail('not_found')

  const admin = createAdminClient()
  const { data } = await admin
    .from('cs_productions')
    .select(SELECT_LITE)
    .eq('id', productionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!isRealProduction((data ?? null) as ProductionAdmissionRow | null)) return fail('not_found')
  return readState(admin, tenantId, productionId)
}

/**
 * Última produção real do tenant.
 *
 * Apenas LÊ. Abrir ou recarregar a página nunca cria produção nem retoma
 * processamento — quem avança é `advanceProduction`, e só quando chamada.
 */
export async function getLatestProduction(): Promise<ActionResult<ProductionState | null>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const admin = createAdminClient()
  const { data } = await admin
    .from('cs_productions')
    .select(SELECT_LITE)
    .eq('tenant_id', tenantId)
    .in('pipeline_key', [...PRODUCTION_PIPELINE_KEYS])
    .neq('status', 'canceled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const row = (data ?? null) as ProductionAdmissionRow | null
  if (!isRealProduction(row)) return { ok: true, data: null }

  return readState(admin, tenantId, row!.id)
}

/** Lista para o seletor de produção. Só id, título, estado e data. */
export async function listProductions(): Promise<ActionResult<ProductionSummary[]>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('cs_productions')
    .select('id, title, status, created_at, pipeline_key, brief')
    .eq('tenant_id', tenantId)
    .in('pipeline_key', [...PRODUCTION_PIPELINE_KEYS])
    .neq('status', 'canceled')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return fail('read_failed', error.message)

  const rows = (data ?? []) as unknown as (ProductionAdmissionRow & { title: string | null; created_at: string })[]
  return {
    ok: true,
    data: rows.filter(isRealProduction).map(r => ({
      id: r.id, title: r.title, status: r.status, createdAt: r.created_at,
    })),
  }
}

// ─── Estado completo ────────────────────────────────────────────────────────

async function readState(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  productionId: string,
): Promise<ActionResult<ProductionState>> {
  const [producao, eventos, steps, jobs] = await Promise.all([
    admin.from('cs_productions').select('id, status, title, created_at')
      .eq('id', productionId).eq('tenant_id', tenantId).maybeSingle(),
    admin.from('cs_events').select('*')
      .eq('tenant_id', tenantId).eq('production_id', productionId)
      .order('seq', { ascending: true }).limit(500),
    admin.from('cs_steps').select('*')
      .eq('tenant_id', tenantId).eq('production_id', productionId)
      .order('step_index', { ascending: true }),
    admin.from('cs_jobs').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('production_id', productionId)
      .in('status', ['pending', 'running']),
  ])

  if (producao.error || !producao.data) return fail('read_failed', producao.error?.message)

  const row = producao.data as {
    id: string; status: ProductionRow['status']; title: string | null; created_at: string
  }

  return {
    ok: true,
    data: {
      production: { id: row.id, title: row.title, status: row.status, createdAt: row.created_at },
      // tenant_id é removido de cada evento antes de sair do servidor.
      events: ((eventos.data ?? []) as StoredEvent[]).map(toPublicEvent),
      pending: (jobs.count ?? 0) > 0,
      // Montado aqui, no servidor, a partir do que os agentes gravaram.
      result: buildProductionResult((steps.data ?? []) as StepRow[]),
    },
  }
}
