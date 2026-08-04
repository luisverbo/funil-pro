'use server'

// ============================================================================
// Content Studio — Server Actions do Office Preview
// ----------------------------------------------------------------------------
// SEGURANÇA, em uma frase: o tenant é SEMPRE derivado da sessão no servidor.
// Nenhuma action recebe tenant_id do navegador — o cliente só informa o id da
// produção, e mesmo esse é reconferido contra o tenant da sessão antes de
// qualquer escrita.
//
// O service_role vive só aqui (servidor). Este arquivo nunca é importado por
// componente de cliente: as actions são chamadas por referência.
// ============================================================================

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'

import { drainQueue, startProduction } from '@/lib/content-studio/orchestrator'
import { OFFICE_PIPELINE } from '@/lib/content-studio/pipeline'
import { createSupabaseContentStore } from '@/lib/content-studio/store'
import type { ProductionRow, StoredEvent } from '@/lib/content-studio/types'

export interface DemoStart {
  productionId: string
}

export interface DemoState {
  production: { id: string; status: ProductionRow['status']; title: string | null }
  events: StoredEvent[]
  /** true enquanto ainda houver job pendente — o cliente segue chamando o tick. */
  pending: boolean
}

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }

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
 * Tenant da sessão. Diferente do padrão das outras actions (que fazem
 * `redirect('/login')`), aqui devolvemos `null`: estas actions são chamadas por
 * fetch a partir do cliente, e um redirect no meio de um polling vira um erro
 * opaco na tela em vez de uma mensagem clara.
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
 * Carrega a produção conferindo o dono.
 *
 * O `.eq('tenant_id', tenantId)` é o que impede um id de produção adivinhado (ou
 * copiado de outra conta) de virar leitura ou execução cruzada: para o tenant
 * errado, a produção simplesmente não existe.
 */
async function loadOwnedProduction(productionId: string, tenantId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('cs_productions')
    .select('id, tenant_id, status, title')
    .eq('id', productionId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return data as { id: string; tenant_id: string; status: ProductionRow['status']; title: string | null } | null
}

// ─── Iniciar a demonstração ─────────────────────────────────────────────────

/**
 * Cria uma produção de demonstração e enfileira o primeiro passo.
 *
 * Não executa nada ainda: quem faz a produção andar é `advanceDemo`, um passo
 * por chamada. É isso que deixa a animação acompanhar eventos reais em vez de
 * receber tudo pronto de uma vez.
 */
export async function startDemoProduction(input?: {
  tema?: string
  publico?: string
}): Promise<ActionResult<DemoStart>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return { ok: false, error: 'Sessão expirada. Entre novamente para continuar.' }

  const admin = createAdminClient()

  try {
    const { data: production, error } = await admin
      .from('cs_productions')
      .insert({
        tenant_id: tenantId,              // <- da sessão, nunca do cliente
        pipeline_key: OFFICE_PIPELINE.key,
        title: 'Demonstração do escritório',
        brief: {
          tema: (input?.tema ?? 'lançamento de infoproduto').slice(0, 200),
          publico: (input?.publico ?? 'infoprodutores iniciantes').slice(0, 200),
          modo: 'demonstracao',
        },
      })
      .select('id')
      .single()

    if (error || !production) {
      return { ok: false, error: `Não foi possível criar a demonstração: ${error?.message ?? 'erro desconhecido'}` }
    }

    const store = createSupabaseContentStore(admin, { tenantId, productionId: production.id })
    await startProduction(store, production.id)

    return { ok: true, data: { productionId: production.id } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Avançar ────────────────────────────────────────────────────────────────

/**
 * Executa até `max` passos da produção e devolve o estado completo.
 *
 * `max = 1` por padrão: um passo por chamada deixa a tela mostrar cada agente
 * trabalhando. O cliente chama repetidamente enquanto `pending` for true.
 */
export async function advanceDemo(
  productionId: string,
  max = 1,
): Promise<ActionResult<DemoState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return { ok: false, error: 'Sessão expirada. Entre novamente para continuar.' }

  const owned = await loadOwnedProduction(productionId, tenantId)
  if (!owned) return { ok: false, error: 'Demonstração não encontrada.' }

  const admin = createAdminClient()
  const store = createSupabaseContentStore(admin, { tenantId, productionId })

  try {
    await drainQueue(store, Math.min(Math.max(max, 1), 5))
  } catch (err) {
    // Falha ao avançar não pode esconder a timeline: seguimos e devolvemos o
    // estado, para que a tela mostre o erro já registrado em cs_events.
    console.error('[content-studio] falha ao avançar demonstração:', String(err))
  }

  return getDemoState(productionId)
}

// ─── Ler o estado ───────────────────────────────────────────────────────────

/** Estado atual da demonstração. Só leitura, sempre escopada ao tenant. */
export async function getDemoState(productionId: string): Promise<ActionResult<DemoState>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return { ok: false, error: 'Sessão expirada. Entre novamente para continuar.' }

  const owned = await loadOwnedProduction(productionId, tenantId)
  if (!owned) return { ok: false, error: 'Demonstração não encontrada.' }

  const admin = createAdminClient()

  const [{ data: events }, { count }] = await Promise.all([
    admin
      .from('cs_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('production_id', productionId)
      .order('seq', { ascending: true })
      .limit(500),
    admin
      .from('cs_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('production_id', productionId)
      .in('status', ['pending', 'running']),
  ])

  return {
    ok: true,
    data: {
      production: { id: owned.id, status: owned.status, title: owned.title },
      events: (events ?? []) as StoredEvent[],
      pending: (count ?? 0) > 0,
    },
  }
}

// ─── Última demonstração do tenant ──────────────────────────────────────────

/**
 * Retomada: ao abrir a página, mostramos a última demonstração em vez de
 * começar do zero. É também o que impede o botão "Reiniciar visualização" de
 * criar produção nova — ele apenas relê esta.
 */
export async function getLatestDemo(): Promise<ActionResult<DemoState | null>> {
  const tenantId = await currentTenantId()
  if (!tenantId) return { ok: false, error: 'Sessão expirada. Entre novamente para continuar.' }

  const admin = createAdminClient()
  const { data } = await admin
    .from('cs_productions')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('pipeline_key', OFFICE_PIPELINE.key)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return { ok: true, data: null }
  return getDemoState(data.id)
}
