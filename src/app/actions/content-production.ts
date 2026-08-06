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
import { CAROUSEL_AI_PIPELINE, QUICK_PIPELINE, STUDIO_PIPELINE } from '@/lib/content-studio/pipeline'
import {
  admitProduction,
  isOpenProduction,
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
import { runQuickCarousel } from '@/lib/content-studio/quick/run'
import { QUICK_COMPARE_FIELDS, validateQuickInput, type QuickInput, type ValidQuickBrief } from '@/lib/content-studio/quick/schema'
import {
  isStaleRunningStep, retryStaleStudioStep, runStudioCarousel,
  STUDIO_REQUEST_BUDGET_MS,
} from '@/lib/content-studio/studio/run'
import { STUDIO_AGENT_LABELS, STUDIO_AGENT_ORDER } from '@/lib/content-studio/studio/schema'
import { preflightStudioImages } from '@/lib/content-studio/images/provider'
import {
  imageStepIndex, isValidImageMode, runStudioSlideImage, STUDIO_IMAGE_AGENT_KEY,
  type ImageMode, type StudioImageStorage,
} from '@/lib/content-studio/images/run'
import { isValidImagePreset, type ImagePreset } from '@/lib/content-studio/images/prompt'
import { runViralCover } from '@/lib/content-studio/images/viral-run'
import { isValidViralIntensity } from '@/lib/content-studio/images/viral-prompt'
import { VIRAL_VISUAL_MODE } from '@/lib/content-studio/images/viral'
import {
  STUDIO_COMPARE_FIELDS, validateStudioInput,
  type StudioInput, type ValidStudioBrief,
} from '@/lib/content-studio/studio/schema'
import { createSupabaseContentStore } from '@/lib/content-studio/store'
import { toPublicEvent, type PublicEvent } from '@/lib/content-studio/demo-guard'
import type { ProductionRow, StepRow, StoredEvent } from '@/lib/content-studio/types'

export interface ProductionSummary {
  /** Sem tenant_id: o navegador não precisa dele. */
  id: string
  title: string | null
  status: ProductionRow['status']
  createdAt: string
  /** Identidade da geração — o rodapé descreve o modo por ela. */
  pipelineKey: string
  /** Modo VISUAL persistido no brief (viral_cover_text_v1 | per_slide_v1). */
  visualMode: string | null
}

export interface ProductionState {
  production: ProductionSummary
  events: PublicEvent[]
  /** true enquanto houver job aberto — o cliente segue pedindo o avanço. */
  pending: boolean
  /** Montado no SERVIDOR, a partir de cs_steps.output. */
  result: ProductionResult
  /**
   * Situação de um step de TEXTO em `running` (geração Studio), decidida pelo
   * RELÓGIO DO SERVIDOR — nada de timestamp cru para o navegador julgar:
   *   running=true              -> execução recente, só aguardar
   *   available=true            -> abandonado; o botão de retomada aparece
   *   agentLabel                -> rótulo amigável do papel travado
   */
  recovery: { available: boolean; running: boolean; agentLabel?: string }
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
 * CRIAÇÃO RÁPIDA — uma Server Action, UMA chamada de IA, sem jobs.
 *
 * Fluxo: autentica → tenant da sessão → valida entrada mínima → preflight de
 * IA (sem rede, ANTES de persistir) → cria a produção (casca) → executa a
 * geração única via `runQuickCarousel` (step + eventos + output + status pela
 * porta ContentStore) → devolve o estado. Falha da IA: produção `failed` com
 * evento seguro — nunca `running` eterno por erro tratável.
 *
 * O cliente NÃO envia tenant, pipeline, agente, status, modelo ou prompt: a
 * validação copia por lista branca e as constantes são do servidor.
 */
export async function createQuickProduction(input: QuickInput): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const validado = validateQuickInput(input ?? {})
  if (!validado.ok) return { ok: false, error: validado.message }

  const admin = createAdminClient()

  try {
    // MESMO coordenador provado na 2A: preflight ÚNICO antes da fábrica do
    // repo; eleição/idempotência por chave DENTRO do pipeline quick; limite de
    // abertas contando as TRÊS gerações (via listOpen + MAX_OPEN_PRODUCTIONS,
    // sem lista duplicada); a materialização — que é a ÚNICA chamada paga —
    // só acontece para a vencedora, depois da eleição. Perdedora cancelada
    // sem step, sem evento e sem chamada de IA.
    const resultado = await createWithPreflight(
      preflightContentAI,
      () => supabaseQuickRepo(admin, tenantId, validado.brief),
      validado.brief,
      QUICK_COMPARE_FIELDS,
    )
    if (!resultado.ok) return fail(resultado.reason)
    return readState(admin, tenantId, resultado.productionId)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('content_ai:')) {
      return fail('ai_disabled', err)
    }
    return fail('create_failed', err)
  }
}

/**
 * Cria e executa a geração Studio (Estrategista → Copywriter → Designer).
 *
 * Mesmo coordenador da 2A/quick: preflight único de IA sem rede ANTES de
 * persistir, eleição/idempotência por chave dentro do pipeline studio, cota de
 * abertas compartilhada entre TODAS as gerações. A materialização executa os
 * agentes que couberem no orçamento de tempo; o que não couber fica para
 * `continueStudioProduction`, com o estado no banco.
 */
export async function createStudioProduction(input: StudioInput): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const validado = validateStudioInput(input ?? {})
  if (!validado.ok) return { ok: false, error: validado.message }

  const admin = createAdminClient()

  try {
    const resultado = await createWithPreflight(
      preflightContentAI,
      () => supabaseStudioRepo(admin, tenantId, validado.brief),
      validado.brief,
      STUDIO_COMPARE_FIELDS,
    )
    if (!resultado.ok) return fail(resultado.reason)
    return readState(admin, tenantId, resultado.productionId)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('content_ai:')) {
      return fail('ai_disabled', err)
    }
    return fail('create_failed', err)
  }
}

/**
 * Continua uma produção Studio que parou por ORÇAMENTO DE TEMPO.
 *
 * Não é um "avançar" genérico: revalida tenant, exige o pipeline studio e um
 * estado ainda avançável. Reentrada em produção concluída é no-op — os steps
 * concluídos são pulados pelo próprio runner, sem nova chamada paga.
 */
export async function continueStudioProduction(productionId: string): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')
  if (typeof productionId !== 'string' || !productionId) return fail('not_found')

  const admin = createAdminClient()

  const { data: row } = await admin
    .from('cs_productions')
    .select(SELECT_LITE)
    .eq('tenant_id', tenantId)          // <- tenant da SESSÃO
    .eq('id', productionId)
    .maybeSingle()

  const candidata = (row ?? null) as ProductionAdmissionRow | null
  if (!candidata) return fail('not_found')
  if (candidata.pipeline_key !== STUDIO_PIPELINE.key) return fail('wrong_pipeline')

  const admissao = admitProduction(candidata)
  if (!admissao.ok) {
    // Já terminou (ou falhou): devolve o estado, não é erro para o usuário.
    if (admissao.reason === 'not_advanceable') return readState(admin, tenantId, productionId)
    return fail(admissao.reason)
  }

  const brief = candidata.brief as ValidStudioBrief | null
  if (!brief || typeof brief.tema !== 'string') return fail('invalid_brief')

  try {
    // Preflight ANTES de qualquer chamada — o kill switch pode ter mudado
    // entre uma requisição e outra.
    preflightContentAI()

    const store = createSupabaseContentStore(admin, { tenantId, productionId })
    const production = await store.getProduction(productionId)
    if (!production) return fail('not_found')

    await runStudioCarousel(store, production, brief, {
      deadlineAt: Date.now() + STUDIO_REQUEST_BUDGET_MS,
    })
    return readState(admin, tenantId, productionId)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('content_ai:')) {
      return fail('ai_disabled', err)
    }
    return fail('create_failed', err)
  }
}

// ─── Recuperação explícita de step running abandonado ───────────────────────

/**
 * Backend do botão "Tentar novamente o {agente}": retoma o ÚNICO step de
 * texto `running` de uma produção Studio, e SOMENTE se ele estiver abandonado
 * pelo relógio do servidor. Uma nova chamada de IA será feita — por isso o
 * caminho é uma action separada, nunca o "Continuar produção".
 */
export async function retryStaleStudioProduction(productionId: string): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')
  if (!idValido(productionId)) return fail('not_found')

  const admin = createAdminClient()

  const { data: row } = await admin
    .from('cs_productions')
    .select('*')
    .eq('tenant_id', tenantId)          // <- tenant da SESSÃO
    .eq('id', productionId)
    .maybeSingle()

  const production = (row ?? null) as ProductionRow | null
  if (!production) return fail('not_found')
  if (production.pipeline_key !== STUDIO_PIPELINE.key) return fail('wrong_pipeline')
  if (PRODUCTION_TERMINAL.includes(production.status)) return fail('not_advanceable')

  const brief = production.brief as ValidStudioBrief | null
  if (!brief || typeof brief.tema !== 'string') return fail('invalid_brief')

  try {
    // A retomada é uma chamada PAGA: o preflight barra antes de qualquer
    // escrita se a IA estiver desligada/mal configurada.
    preflightContentAI()

    const store = createSupabaseContentStore(admin, { tenantId, productionId })
    await retryStaleStudioStep(store, production, brief)
    return readState(admin, tenantId, productionId)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('content_ai:')) {
      return fail('ai_disabled', err)
    }
    return fail('create_failed', err)
  }
}

// ─── Gerenciamento: remoção segura de produções (soft delete) ───────────────

/**
 * Estados a partir dos quais uma produção pode ser removida. É "tudo menos
 * canceled" DE PROPÓSITO: remover é sempre possível, e repetir é idempotente.
 */
const REMOVABLE_STATUSES: readonly ProductionRow['status'][] = [
  'draft', 'queued', 'running', 'waiting_input', 'review',
  'awaiting_approval', 'approved', 'scheduled', 'publishing', 'published', 'failed',
]

export interface RemoveResult {
  /** Quantas produções ESTA chamada cancelou (0 num replay idempotente). */
  removed: number
  /** A lista atualizada — o seletor rerrenderiza sem refresh. */
  productions: ProductionSummary[]
  /** Quantas ainda contam para o limite de abertas. */
  openCount: number
}

async function listAfterRemoval(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
): Promise<{ productions: ProductionSummary[]; openCount: number }> {
  const { data } = await admin
    .from('cs_productions')
    .select('id, title, status, created_at, pipeline_key, brief')
    .eq('tenant_id', tenantId)
    .in('pipeline_key', [...PRODUCTION_PIPELINE_KEYS])
    .neq('status', 'canceled')
    .order('created_at', { ascending: false })
    .limit(20)

  const rows = (data ?? []) as unknown as (ProductionAdmissionRow & { title: string | null; created_at: string })[]
  const reais = rows.filter(isRealProduction)
  return {
    productions: reais.map(r => ({
      id: r.id, title: r.title, status: r.status, createdAt: r.created_at,
      pipelineKey: r.pipeline_key,
      visualMode: typeof (r.brief as Record<string, unknown> | null)?.visual_mode === 'string'
        ? (r.brief as Record<string, unknown>).visual_mode as string : null,
    })),
    openCount: reais.filter(r => isOpenProduction(r)).length,
  }
}

/**
 * SOFT DELETE de UMA produção: transição atômica para `canceled` (o predicado
 * de status vai na própria UPDATE). Nada é apagado — cs_productions, cs_steps,
 * cs_events, cs_jobs e o Storage ficam intactos para auditoria; a produção só
 * some da lista, deixa de contar para o limite e nunca mais processa:
 *   • jobs pending morrem no próximo claim (runNextJob falha job de produção
 *     canceled SEM executar agente — nenhuma chamada de IA);
 *   • continueStudioProduction recusa (canceled não é avançável);
 *   • geração/regeneração de imagem recusa (loadStudioProductionForImages).
 *
 * Idempotente: remover de novo devolve sucesso com removed=0.
 */
export async function removeContentProduction(productionId: string): Promise<ActionResult<RemoveResult>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')
  if (typeof productionId !== 'string' || !productionId) return fail('not_found')

  const admin = createAdminClient()

  try {
    const { data: row } = await admin
      .from('cs_productions')
      .select(SELECT_LITE)
      .eq('tenant_id', tenantId)          // <- tenant da SESSÃO, sempre
      .eq('id', productionId)
      .maybeSingle()

    const candidata = (row ?? null) as ProductionAdmissionRow | null
    if (!candidata) return fail('not_found')
    if (!PRODUCTION_PIPELINE_KEYS.includes(candidata.pipeline_key)) {
      return fail('wrong_pipeline')
    }

    let removed = 0
    if (candidata.status !== 'canceled') {
      const store = createSupabaseContentStore(admin, { tenantId, productionId })
      const transicionou = await store.transitionProductionStatus(
        productionId, REMOVABLE_STATUSES, 'canceled',
      )
      removed = transicionou ? 1 : 0
    }
    // Já cancelada (agora ou antes): sucesso seguro, nenhuma chamada externa.

    const lista = await listAfterRemoval(admin, tenantId)
    return { ok: true, data: { removed, ...lista } }
  } catch (err) {
    return fail('remove_failed', err)
  }
}

/**
 * "Limpar todas em andamento": cancela SOMENTE as produções ABERTAS do tenant
 * da sessão — a MESMA semântica de isOpenProduction (terminais como
 * awaiting_approval, approved e published ficam de fora). O cliente não envia
 * ID nenhum; a UPDATE carrega o predicado de status e de tenant.
 */
export async function removeAllOpenContentProductions(): Promise<ActionResult<RemoveResult>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const admin = createAdminClient()

  try {
    // Seleção NO SERVIDOR, com a semântica de "aberta" já provada.
    const { data } = await admin
      .from('cs_productions')
      .select(SELECT_LITE)
      .eq('tenant_id', tenantId)
      .in('pipeline_key', [...PRODUCTION_PIPELINE_KEYS])
      .not('status', 'in', `(${PRODUCTION_TERMINAL.join(',')})`)
      .limit(50)

    const abertas = ((data ?? []) as unknown as ProductionAdmissionRow[]).filter(isOpenProduction)

    let removed = 0
    if (abertas.length > 0) {
      // Predicado repetido NA UPDATE: mesmo que algo mude entre a leitura e a
      // escrita, só produções ainda abertas transicionam — e `select` devolve
      // quantas realmente foram.
      const { data: alteradas, error } = await admin
        .from('cs_productions')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .in('id', abertas.map(a => a.id))
        .not('status', 'in', `(${PRODUCTION_TERMINAL.join(',')})`)
        .select('id')
      if (error) throw new Error(error.message)
      removed = (alteradas ?? []).length
    }

    const lista = await listAfterRemoval(admin, tenantId)
    return { ok: true, data: { removed, ...lista } }
  } catch (err) {
    return fail('remove_failed', err)
  }
}

// ─── Capa do modo VIRAL: UMA chamada de imagem por carrossel ────────────────

/**
 * Gera a CAPA fotográfica do modo viral e renderiza os slides de texto — o
 * custo visual do carrossel inteiro é UMA geração. O cliente envia só o id e
 * enums de lista branca; modelo, qualidade (sempre high), tamanho, prompt,
 * cor e storage são do servidor. Regeneração só com retry explícito.
 */
export async function generateViralCoverImage(
  productionId: string,
  opts?: { retry?: boolean; intensity?: string },
): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const admin = createAdminClient()
  const carga = await loadStudioProductionForImages(admin, tenantId, productionId)
  if (!carga.ok) return fail(carga.key)
  // SÓ o modo viral usa este caminho — produção por-slide continua no antigo.
  if ((carga.production.brief as Record<string, unknown> | null)?.visual_mode !== VIRAL_VISUAL_MODE) {
    return fail('wrong_pipeline')
  }

  try {
    preflightStudioImages()
    const store = createSupabaseContentStore(admin, { tenantId, productionId })
    await runViralCover(store, studioImageStorage(admin), carga.production, {
      retry: opts?.retry === true,
      intensity: isValidViralIntensity(opts?.intensity) ? opts.intensity : undefined,
    })
    return readState(admin, tenantId, productionId)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('studio_images:')) {
      return fail('images_unavailable', err)
    }
    return fail('create_failed', err)
  }
}

// ─── Aprovação humana do portão awaiting_approval ───────────────────────────

/**
 * APROVA uma produção que está no portão humano.
 *
 * O status `approved` e o evento `content_approved` JÁ EXISTEM no sistema
 * desde a Fase 1 (nenhum enum novo): esta action só liga o botão à transição.
 * CAS estrito: SÓ awaiting_approval → approved. Cancelada, running, failed ou
 * de outro tenant nunca aprovam. Replay em produção já aprovada é sucesso
 * seguro (idempotente), sem evento duplicado.
 */
export async function approveContentProduction(productionId: string): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')
  if (!idValido(productionId)) return fail('not_found')

  const admin = createAdminClient()

  try {
    const { data: row } = await admin
      .from('cs_productions')
      .select(SELECT_LITE)
      .eq('tenant_id', tenantId)          // <- tenant da SESSÃO
      .eq('id', productionId)
      .maybeSingle()

    const candidata = (row ?? null) as ProductionAdmissionRow | null
    if (!candidata) return fail('not_found')
    if (!PRODUCTION_PIPELINE_KEYS.includes(candidata.pipeline_key)) return fail('wrong_pipeline')

    // Idempotência: já aprovada devolve o estado sem nova transição/evento.
    if (candidata.status !== 'approved') {
      const store = createSupabaseContentStore(admin, { tenantId, productionId })
      const transicionou = await store.transitionProductionStatus(
        productionId, ['awaiting_approval'], 'approved',
      )
      if (!transicionou) return fail('not_advanceable')
      await store.emitEvent({
        productionId,
        type: 'content_approved',
        payload: { by: 'human' },
      })
    }
    return readState(admin, tenantId, productionId)
  } catch (err) {
    return fail('approve_failed', err)
  }
}

/**
 * REPROVA uma produção no portão humano — de forma explícita e honesta.
 *
 * O sistema NÃO tem status `rejected` e NÃO suporta re-iterar uma produção
 * concluída (steps completos são reutilizados, nunca reescritos). Sem inventar
 * enum: reprovar grava o evento oficial `content_rejected` (existe desde a
 * Fase 1, aparece na timeline como "Recusado") e ARQUIVA a produção com o
 * status existente `canceled` — ela sai da lista e da cota, o histórico e as
 * artes ficam intactos, e a pessoa cria uma nova versão no lugar. A UI diz
 * exatamente isso antes do clique.
 *
 * CAS estrito: SÓ awaiting_approval → canceled por este caminho.
 */
export async function rejectContentProduction(productionId: string): Promise<ActionResult<RemoveResult>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')
  if (!idValido(productionId)) return fail('not_found')

  const admin = createAdminClient()

  try {
    const { data: row } = await admin
      .from('cs_productions')
      .select(SELECT_LITE)
      .eq('tenant_id', tenantId)
      .eq('id', productionId)
      .maybeSingle()

    const candidata = (row ?? null) as ProductionAdmissionRow | null
    if (!candidata) return fail('not_found')
    if (!PRODUCTION_PIPELINE_KEYS.includes(candidata.pipeline_key)) return fail('wrong_pipeline')

    let removed = 0
    if (candidata.status === 'awaiting_approval') {
      const store = createSupabaseContentStore(admin, { tenantId, productionId })
      const transicionou = await store.transitionProductionStatus(
        productionId, ['awaiting_approval'], 'canceled',
      )
      if (transicionou) {
        removed = 1
        // O evento fica DEPOIS do CAS: só quem realmente reprovou o grava.
        await store.emitEvent({
          productionId,
          type: 'content_rejected',
          payload: { by: 'human' },
        })
      }
    } else if (candidata.status !== 'canceled') {
      // Fora do portão (running, approved...) não é reprovável por aqui.
      return fail('not_advanceable')
    }
    // canceled: replay idempotente, sucesso seguro.

    const lista = await listAfterRemoval(admin, tenantId)
    return { ok: true, data: { removed, ...lista } }
  } catch (err) {
    return fail('approve_failed', err)
  }
}

// ─── Imagens da geração Studio (sob demanda, nunca automáticas) ─────────────

/** Storage real: bucket `quiz-assets` (o MESMO de uploadQuizImage), bytes only. */
function studioImageStorage(admin: ReturnType<typeof createAdminClient>): StudioImageStorage {
  return {
    async upload(path, bytes, contentType) {
      // upsert: a regeneração explícita usa path com attempt, mas mesmo em
      // colisão a sobrescrita é do MESMO slide do MESMO tenant/produção.
      const { error } = await admin.storage
        .from('quiz-assets')
        .upload(path, Buffer.from(bytes), { contentType, upsert: true })
      if (error) throw new Error(`upload falhou: ${error.message}`)
      const { data: pub } = admin.storage.from('quiz-assets').getPublicUrl(path)
      return { path, url: pub.publicUrl }
    },
  }
}

/** Carrega e valida a produção Studio do TENANT DA SESSÃO para gerar imagem. */
async function loadStudioProductionForImages(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  productionId: string,
): Promise<{ ok: true; production: ProductionRow } | { ok: false; key: ProductionMessageKey }> {
  if (typeof productionId !== 'string' || !productionId) return { ok: false, key: 'not_found' }

  const { data: row } = await admin
    .from('cs_productions')
    .select('*')
    .eq('tenant_id', tenantId)          // <- tenant da SESSÃO, sempre
    .eq('id', productionId)
    .maybeSingle()

  if (!row) return { ok: false, key: 'not_found' }
  const production = row as ProductionRow
  // SÓ a geração Studio tem Designer e direção visual — as demais recusam.
  if (production.pipeline_key !== STUDIO_PIPELINE.key) return { ok: false, key: 'wrong_pipeline' }
  // Produção legível mesmo em awaiting_approval: gerar arte NÃO altera o
  // status principal — cancelada/failed é que não recebem arte nova.
  if (production.status === 'canceled' || production.status === 'failed') {
    return { ok: false, key: 'not_advanceable' }
  }
  return { ok: true, production }
}

/**
 * Gera a ARTE FINAL de um slide: fundo pela OpenAI + composição FunilPro
 * (headline/body/CTA via sharp) + upload no bucket `quiz-assets`.
 *
 * O cliente envia SÓ productionId, slideNumber e (na regeneração explícita)
 * retry=true. Prompt, modelo, path e tudo o mais são do servidor.
 */
export async function generateStudioSlideImage(
  productionId: string,
  slideNumber: number,
  opts?: { retry?: boolean; mode?: string; preset?: string },
): Promise<ActionResult<ProductionState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const admin = createAdminClient()
  const carga = await loadStudioProductionForImages(admin, tenantId, productionId)
  if (!carga.ok) return fail(carga.key)
  // Produção do modo VIRAL não usa imagens por slide — o slot da capa é dela.
  if ((carga.production.brief as Record<string, unknown> | null)?.visual_mode === VIRAL_VISUAL_MODE) {
    return fail('wrong_pipeline')
  }

  try {
    // Preflight SEM rede antes de qualquer escrita: sem OPENAI_API_KEY não
    // existe claim, step ou evento.
    preflightStudioImages()

    const store = createSupabaseContentStore(admin, { tenantId, productionId })
    // Enums em LISTA BRANCA: fora dela, caem nos padrões do servidor.
    const mode: ImageMode | undefined = isValidImageMode(opts?.mode) ? opts.mode : undefined
    const preset: ImagePreset | undefined = isValidImagePreset(opts?.preset) ? opts.preset : undefined
    await runStudioSlideImage(
      store, studioImageStorage(admin), carga.production, Number(slideNumber),
      { retry: opts?.retry === true, mode, preset },
    )
    // O estado volta INTEIRO: o status por slide vem dos steps persistidos.
    return readState(admin, tenantId, productionId)
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('studio_images:')) {
      // Mensagem PRÓPRIA do fluxo de imagens — a da copy confundia o usuário
      // (e escondia a causa real: OPENAI_API_KEY ausente no ambiente).
      return fail('images_unavailable', err)
    }
    return fail('create_failed', err)
  }
}

/**
 * "Gerar todas": gera A PRÓXIMA imagem que falta e devolve o estado — o
 * cliente repete em laço FECHADO mostrando "N de M". Uma chamada paga por
 * requisição, pelo mesmo motivo do pipeline de texto: três (ou oito) gerações
 * de imagem não cabem com segurança numa única Server Action.
 */
export async function generateAllStudioSlideImages(
  productionId: string,
  opts?: { mode?: string; preset?: string },
): Promise<ActionResult<ProductionState & { imagesDone: number; imagesTotal: number }>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return fail('unauthenticated')

  const admin = createAdminClient()
  const carga = await loadStudioProductionForImages(admin, tenantId, productionId)
  if (!carga.ok) return fail(carga.key)

  if ((carga.production.brief as Record<string, unknown> | null)?.visual_mode === VIRAL_VISUAL_MODE) {
    return fail('wrong_pipeline')
  }

  try {
    preflightStudioImages()
    const store = createSupabaseContentStore(admin, { tenantId, productionId })

    // O total vem do resultado persistido; o próximo faltante é o primeiro
    // slide sem step de imagem. Steps failed NÃO entram: falha paga só é
    // repetida pelo botão explícito, nunca pelo "Gerar todas".
    const steps = await store.listSteps(productionId)
    const resultado = buildProductionResult(steps)
    const total = resultado.slides.length
    if (total === 0) return fail('not_advanceable')

    const proximo = resultado.slides
      .map(s => s.numero)
      .find(n => !steps.some(st => st.agent_key === STUDIO_IMAGE_AGENT_KEY && st.step_index === imageStepIndex(n)))

    if (proximo !== undefined) {
      const mode: ImageMode | undefined = isValidImageMode(opts?.mode) ? opts.mode : undefined
      const preset: ImagePreset | undefined = isValidImagePreset(opts?.preset) ? opts.preset : undefined
      await runStudioSlideImage(store, studioImageStorage(admin), carga.production, proximo, { mode, preset })
    }

    const estado = await readState(admin, tenantId, productionId)
    if (!estado.ok) return estado
    const prontas = estado.data.result.imagens.filter(i => i.status === 'pronto').length
    return { ok: true, data: { ...estado.data, imagesDone: prontas, imagesTotal: total } }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('studio_images:')) {
      // Mensagem PRÓPRIA do fluxo de imagens — a da copy confundia o usuário
      // (e escondia a causa real: OPENAI_API_KEY ausente no ambiente).
      return fail('images_unavailable', err)
    }
    return fail('create_failed', err)
  }
}

/**
 * Repo da geração Studio — mesma porta, escopos próprios (espelha o do quick):
 *   • idempotency_key buscada SÓ dentro de content_carousel_studio_v1;
 *   • listOpen conta TODAS as gerações — a cota do tenant continua uma só;
 *   • materialize = runStudioCarousel, com orçamento de tempo. Só a vencedora
 *     da eleição chega até aqui, e cada step tem claim atômico próprio.
 */
function supabaseStudioRepo(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  brief: ValidStudioBrief,
): ProductionRepo {
  const base = () => admin.from('cs_productions').select(SELECT_LITE).eq('tenant_id', tenantId)

  return {
    async findByIdempotencyKey(key: string): Promise<ProductionRowLite[]> {
      const { data, error } = await base()
        .eq('pipeline_key', STUDIO_PIPELINE.key)
        .eq('brief->>idempotency_key', key)
        .order('created_at', { ascending: true })
        .limit(10)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ProductionRowLite[]
    },

    async listOpen(): Promise<ProductionRowLite[]> {
      const { data, error } = await base()
        .in('pipeline_key', [...PRODUCTION_PIPELINE_KEYS])
        .not('status', 'in', `(${PRODUCTION_TERMINAL.join(',')})`)
        .order('created_at', { ascending: true })
        .limit(20)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ProductionRowLite[]
    },

    async insert(briefValido): Promise<ProductionRowLite> {
      const { data, error } = await admin
        .from('cs_productions')
        .insert({
          tenant_id: tenantId,                // <- da sessão, nunca do cliente
          pipeline_key: STUDIO_PIPELINE.key,  // <- constante do servidor
          title: brief.tema.slice(0, 80),
          brief: briefValido,
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
      const production = await store.getProduction(productionId)
      if (!production) throw new Error('produção não encontrada na materialização')
      await runStudioCarousel(store, production, brief, {
        deadlineAt: Date.now() + STUDIO_REQUEST_BUDGET_MS,
      })
    },
  }
}

/**
 * Repo da Criação rápida — mesma porta do avançado, escopos próprios:
 *   • idempotency_key buscada SÓ dentro de content_carousel_quick_v1 — uma
 *     produção dos pipelines antigos jamais é reaproveitada por coincidência;
 *   • listOpen conta as TRÊS gerações (PRODUCTION_PIPELINE_KEYS) — a cota do
 *     tenant é uma só, trocar de pipeline não a multiplica; demonstrações e
 *     estados terminais ficam fora (isOpenProduction, semântica única);
 *   • materialize = runQuickCarousel: a única chamada de IA vive aqui, e só a
 *     vencedora da eleição chega até ela. Reentrada com step concluído é
 *     no-op — nunca uma segunda chamada paga.
 *
 * LIMITAÇÃO DOCUMENTADA (a mesma da 2A, sem constraint/migration): a
 * convergência é por releitura+eleição. Duas chamadas simultâneas podem
 * inserir duas cascas, mas ambas elegem a MESMA vencedora e a perdedora é
 * cancelada ANTES de qualquer materialização — a janela restante produz no
 * máximo uma casca cancelada, nunca chamada de IA nem conteúdo duplicado.
 */
function supabaseQuickRepo(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  brief: ValidQuickBrief,
): ProductionRepo {
  const base = () => admin.from('cs_productions').select(SELECT_LITE).eq('tenant_id', tenantId)

  return {
    async findByIdempotencyKey(key: string): Promise<ProductionRowLite[]> {
      const { data, error } = await base()
        .eq('pipeline_key', QUICK_PIPELINE.key)
        .eq('brief->>idempotency_key', key)
        .order('created_at', { ascending: true })
        .limit(10)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ProductionRowLite[]
    },

    async listOpen(): Promise<ProductionRowLite[]> {
      const { data, error } = await base()
        .in('pipeline_key', [...PRODUCTION_PIPELINE_KEYS])
        .not('status', 'in', `(${PRODUCTION_TERMINAL.join(',')})`)
        .order('created_at', { ascending: true })
        .limit(20)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ProductionRowLite[]
    },

    async insert(briefValido): Promise<ProductionRowLite> {
      const { data, error } = await admin
        .from('cs_productions')
        .insert({
          tenant_id: tenantId,               // <- da sessão, nunca do cliente
          pipeline_key: QUICK_PIPELINE.key,  // <- constante do servidor
          title: brief.tema.slice(0, 80),
          brief: briefValido,
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
      const production = await store.getProduction(productionId)
      if (!production) throw new Error('produção não encontrada na materialização')
      await runQuickCarousel(store, production, brief)
    },
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
      pipelineKey: r.pipeline_key,
      visualMode: typeof (r.brief as Record<string, unknown> | null)?.visual_mode === 'string'
        ? (r.brief as Record<string, unknown>).visual_mode as string : null,
    })),
  }
}

// ─── Estado completo ────────────────────────────────────────────────────────

/**
 * Ainda falta agente para rodar nesta produção Studio?
 *
 * Só é `true` num estado em que continuar faz sentido: produção terminal
 * (concluída, falhada, cancelada) nunca pede continuação, mesmo que algum step
 * não exista — senão o cliente ficaria pedindo avanço para sempre.
 */
function studioPending(status: ProductionRow['status'], steps: StepRow[]): boolean {
  if (PRODUCTION_TERMINAL.includes(status)) return false
  // Conta SÓ os agentes de texto do pipeline: steps de imagem
  // (cst_image_designer, índice 100+) são artefatos sob demanda e não podem
  // fazer a contagem "fechar" antes da copy existir.
  const agentesTexto = new Set(STUDIO_PIPELINE.steps.map(s => s.agentKey))
  const concluidos = steps.filter(s => agentesTexto.has(s.agent_key) && s.status === 'completed').length
  return concluidos < STUDIO_PIPELINE.steps.length
}

/**
 * Um step de TEXTO em `running` está recente (aguarde) ou abandonado
 * (ofereça o retry)? A idade é medida AQUI, com o relógio do servidor.
 */
function studioRecovery(steps: StepRow[]): { available: boolean; running: boolean; agentLabel?: string } {
  const texto = new Set<string>(STUDIO_AGENT_ORDER)
  const emExecucao = steps.find(s => texto.has(s.agent_key) && s.status === 'running')
  if (!emExecucao) return { available: false, running: false }
  const agentLabel = STUDIO_AGENT_LABELS[emExecucao.agent_key] ?? emExecucao.agent_key
  if (isStaleRunningStep(emExecucao, Date.now())) {
    return { available: true, running: false, agentLabel }
  }
  return { available: false, running: true, agentLabel }
}

async function readState(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  productionId: string,
): Promise<ActionResult<ProductionState>> {
  const [producao, eventos, steps, jobs] = await Promise.all([
    admin.from('cs_productions').select('id, status, title, created_at, pipeline_key, brief')
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
    id: string; status: ProductionRow['status']; title: string | null
    created_at: string; pipeline_key: string; brief: Record<string, unknown> | null
  }

  return {
    ok: true,
    data: {
      production: {
        id: row.id, title: row.title, status: row.status,
        createdAt: row.created_at, pipelineKey: row.pipeline_key,
        visualMode: typeof row.brief?.visual_mode === 'string' ? row.brief.visual_mode : null,
      },
      // tenant_id é removido de cada evento antes de sair do servidor.
      events: ((eventos.data ?? []) as StoredEvent[]).map(toPublicEvent),
      // A geração Studio não usa fila: "falta trabalho" é medido pelos STEPS
      // concluídos, não por job aberto. Isso é o que diz ao cliente se ele
      // deve pedir a continuação — e o critério vem do banco, não de um timer.
      pending: row.pipeline_key === STUDIO_PIPELINE.key
        ? studioPending(row.status, (steps.data ?? []) as StepRow[])
        : (jobs.count ?? 0) > 0,
      recovery: row.pipeline_key === STUDIO_PIPELINE.key && !PRODUCTION_TERMINAL.includes(row.status)
        ? studioRecovery((steps.data ?? []) as StepRow[])
        : { available: false, running: false },
      // Montado aqui, no servidor, a partir do que os agentes gravaram.
      result: buildProductionResult((steps.data ?? []) as StepRow[]),
    },
  }
}
