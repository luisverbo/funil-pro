// ============================================================================
// Content Studio — implementação Supabase do ContentStore
// ----------------------------------------------------------------------------
// A Fase 1 definiu a porta `ContentStore` mas só entregou a implementação em
// memória (usada nos testes). Esta é a implementação real.
//
// DUAS TRAVAS DE ISOLAMENTO, e ambas importam:
//
//   1. tenant_id vem de FORA (derivado da sessão na Server Action) e é aplicado
//      em TODA query. Nunca é aceito do navegador.
//   2. o store é preso a UMA produção. `claimNextJob` jamais alcança job de
//      outra produção — nem do mesmo tenant, muito menos de outro.
//
// Sem a trava 2, um tick disparado por um tenant poderia reivindicar o job de
// outro: o orquestrador pede "o próximo job vencido", sem qualificar de quem.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  ContentStore,
  EmitEventInput,
  JobRow,
  ProductionRow,
  ProductionStatus,
  StepRow,
} from './types'

export interface StoreScope {
  /** Derivado da sessão no servidor. NUNCA de parâmetro do cliente. */
  tenantId: string
  /** O store só enxerga esta produção. */
  productionId: string
}

/**
 * Cria um ContentStore preso a (tenant, produção).
 *
 * `db` precisa ser um client com service_role: escrita em cs_steps/cs_jobs e a
 * função cs_emit_event são exclusivas do backend. Este módulo NUNCA pode ser
 * importado por componente de cliente.
 */
export function createSupabaseContentStore(
  db: SupabaseClient,
  scope: StoreScope,
): ContentStore {
  const { tenantId, productionId } = scope

  /** Toda leitura passa por aqui: escopo aplicado sempre, sem exceção. */
  const scoped = (table: string) =>
    db.from(table).select('*').eq('tenant_id', tenantId).eq('production_id', productionId)

  return {
    async getProduction(id) {
      if (id !== productionId) return null // fora do escopo: não existe
      const { data, error } = await db
        .from('cs_productions')
        .select('*')
        .eq('id', productionId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (error) throw new Error(`getProduction: ${error.message}`)
      return (data as ProductionRow | null) ?? null
    },

    async updateProductionStatus(id: string, status: ProductionStatus) {
      if (id !== productionId) throw new Error('production_out_of_scope')
      const { error } = await db
        .from('cs_productions')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', productionId)
        .eq('tenant_id', tenantId)
      if (error) throw new Error(`updateProductionStatus: ${error.message}`)
    },

    async listSteps(id: string) {
      if (id !== productionId) return []
      const { data, error } = await scoped('cs_steps').order('step_index', { ascending: true })
      if (error) throw new Error(`listSteps: ${error.message}`)
      return (data ?? []) as StepRow[]
    },

    async insertSteps(steps) {
      if (steps.length === 0) return []
      // Recarimba o escopo: mesmo que o chamador passasse outro tenant/produção,
      // o que vai para o banco é o do escopo. (A FK composta recusaria, mas
      // preferir a recusa a depender dela é mais barato que depurar um 23503.)
      const rows = steps.map(s => ({ ...s, tenant_id: tenantId, production_id: productionId }))
      const { data, error } = await db.from('cs_steps').insert(rows).select('*')
      if (error) throw new Error(`insertSteps: ${error.message}`)
      return (data ?? []) as StepRow[]
    },

    async updateStep(stepId, patch) {
      const { error } = await db
        .from('cs_steps')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', stepId)
        .eq('tenant_id', tenantId)
        .eq('production_id', productionId)
      if (error) throw new Error(`updateStep: ${error.message}`)
    },

    async insertJob(job) {
      const row = { ...job, tenant_id: tenantId, production_id: productionId }
      const { data, error } = await db.from('cs_jobs').insert(row).select('*').single()
      if (error) {
        // 23505 = dedupe_key repetida ou já existe job ativo para o step.
        // Enfileirar duas vezes o mesmo trabalho é no-op, não erro.
        if (error.code === '23505') return null
        throw new Error(`insertJob: ${error.message}`)
      }
      return data as JobRow
    },

    async claimNextJob(now, lockToken, lockSeconds) {
      const { data: candidates, error } = await db
        .from('cs_jobs')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('production_id', productionId)
        .eq('status', 'pending')
        .lte('scheduled_for', now.toISOString())
        .order('scheduled_for', { ascending: true })
        .limit(5)

      if (error) throw new Error(`claimNextJob (scan): ${error.message}`)

      for (const c of candidates ?? []) {
        const { data: claimed, error: claimErr } = await db
          .from('cs_jobs')
          .update({
            status: 'running',
            lock_token: lockToken,
            locked_until: new Date(now.getTime() + lockSeconds * 1000).toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('id', c.id)
          .eq('status', 'pending')   // <- exclusão mútua: só um worker vence
          .select('*')
          .maybeSingle()

        if (claimErr) throw new Error(`claimNextJob (claim): ${claimErr.message}`)
        if (claimed) return claimed as JobRow
      }
      return null
    },

    async completeJob(jobId, lockToken) {
      const { data, error } = await db
        .from('cs_jobs')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('tenant_id', tenantId)
        .eq('lock_token', lockToken)  // <- anti-zumbi: o lock ainda é nosso?
        .eq('status', 'running')
        .select('id')
        .maybeSingle()
      if (error) throw new Error(`completeJob: ${error.message}`)
      return !!data
    },

    async failJob(jobId, lockToken, errorMessage, retryAt) {
      const base = {
        error: errorMessage.slice(0, 2000),
        lock_token: null as string | null,
        locked_until: null as string | null,
        updated_at: new Date().toISOString(),
      }

      // Com retryAt a MESMA linha volta para a fila com attempt+1 — é o
      // incremento que faz o backoff avançar e o retry terminar.
      const { data: current } = await db
        .from('cs_jobs').select('attempt').eq('id', jobId).eq('tenant_id', tenantId).maybeSingle()

      const patch = retryAt
        ? { ...base, status: 'pending', attempt: (current?.attempt ?? 0) + 1, scheduled_for: retryAt.toISOString() }
        : { ...base, status: 'failed' }

      const { error } = await db
        .from('cs_jobs').update(patch).eq('id', jobId).eq('tenant_id', tenantId).eq('lock_token', lockToken)
      if (error) throw new Error(`failJob: ${error.message}`)
    },

    async recoverStaleJobs(now) {
      const { data, error } = await db
        .from('cs_jobs')
        .update({
          status: 'pending',
          lock_token: null,
          locked_until: null,
          error: 'lock expirado — job recuperado',
          updated_at: now.toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('production_id', productionId)
        .eq('status', 'running')
        .lt('locked_until', now.toISOString())
        .select('id')
      if (error) throw new Error(`recoverStaleJobs: ${error.message}`)
      return data?.length ?? 0
    },

    async emitEvent(input: EmitEventInput) {
      if (input.productionId !== productionId) throw new Error('production_out_of_scope')
      // tenant_id NÃO é passado: cs_emit_event o deriva da produção persistida.
      const { data, error } = await db.rpc('cs_emit_event', {
        p_production_id: productionId,
        p_type: input.type,
        p_step_id: input.stepId ?? null,
        p_agent_key: input.agentKey ?? null,
        p_payload: input.payload ?? {},
        p_ui_hint: input.uiHint ?? null,
      })
      if (error) throw new Error(`cs_emit_event: ${error.message}`)
      return Number(data)
    },
  }
}
