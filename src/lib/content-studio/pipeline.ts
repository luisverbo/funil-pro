// ============================================================================
// Content Studio — pipelines declarativos (Fase 1)
// ----------------------------------------------------------------------------
// O pipeline é DADO, não código espalhado: adicionar um agente no futuro é
// acrescentar uma entrada aqui (ou, mais adiante, uma linha em cs_pipelines),
// sem reescrever o orquestrador.
//
// Nesta fase existe apenas o pipeline 'stub_v1', usado para validar a espinha
// dorsal (fila, eventos, retomada) sem chamar nenhum provedor externo.
// ============================================================================

import type { PipelineDef, StepRow } from './types'

/** Pipeline de validação: dois passos encadeados, custo zero. */
export const STUB_PIPELINE: PipelineDef = {
  key: 'stub_v1',
  label: 'Pipeline de validação (stub)',
  steps: [
    { agentKey: 'stub_a', dependsOn: [] },
    { agentKey: 'stub_b', dependsOn: ['stub_a'] },
  ],
}

/**
 * Pipeline do Office Preview: pesquisa → estratégia → copy, em cadeia.
 *
 * As dependências é que produzem a ordem — o orquestrador não sabe a topologia
 * de antemão. Trocar os stubs por agentes reais depois não muda uma linha aqui.
 */
export const OFFICE_PIPELINE: PipelineDef = {
  key: 'office_demo_v1',
  label: 'Demonstração do escritório (stub)',
  steps: [
    { agentKey: 'researcher', dependsOn: [] },
    { agentKey: 'strategist', dependsOn: ['researcher'] },
    { agentKey: 'copywriter', dependsOn: ['strategist'] },
  ],
}

/**
 * Fase 2A — o primeiro pipeline de PRODUÇÃO real.
 *
 * Real no sentido que importa: briefing do usuário, steps e jobs persistidos,
 * outputs gravados, eventos auditáveis. Os agentes continuam determinísticos e
 * sem IA — o que muda é que o material produzido é para valer, e o pipeline
 * termina num portão humano em vez de simplesmente acabar.
 *
 * O passo `approval` NÃO aprova nada. Ele fecha o trabalho automático e deixa a
 * produção em `awaiting_approval`, esperando uma pessoa. Aprovar é Fase 2B.
 */
export const CAROUSEL_PIPELINE: PipelineDef = {
  key: 'content_carousel_v1',
  label: 'Carrossel de conteúdo',
  steps: [
    { agentKey: 'cc_researcher', dependsOn: [] },
    { agentKey: 'cc_strategist', dependsOn: ['cc_researcher'] },
    { agentKey: 'cc_copywriter', dependsOn: ['cc_strategist'] },
    { agentKey: 'cc_reviewer', dependsOn: ['cc_copywriter'] },
    { agentKey: 'cc_approval', dependsOn: ['cc_reviewer'] },
  ],
  finalStatus: 'awaiting_approval',
  finalEvent: 'content_waiting_approval',
  // UMA revisão automática. O revisor pode devolver o copy uma única vez; se
  // ainda assim reprovar, a produção falha com mensagem segura em vez de girar.
  maxAutoRevisions: 1,
}

const PIPELINES: Record<string, PipelineDef> = {
  [STUB_PIPELINE.key]: STUB_PIPELINE,
  [OFFICE_PIPELINE.key]: OFFICE_PIPELINE,
  [CAROUSEL_PIPELINE.key]: CAROUSEL_PIPELINE,
}

export function getPipeline(key: string): PipelineDef {
  const p = PIPELINES[key]
  if (!p) throw new Error(`pipeline_not_found: ${key}`)
  return p
}

export function listPipelines(): PipelineDef[] {
  return Object.values(PIPELINES)
}

/**
 * Valida a coerência do pipeline: sem agentes duplicados, sem dependência
 * inexistente e sem ciclo. Um pipeline inválido deve falhar na materialização,
 * nunca gerar uma produção que trava no meio.
 */
export function validatePipeline(pipeline: PipelineDef): void {
  const keys = pipeline.steps.map(s => s.agentKey)
  const dup = keys.find((k, i) => keys.indexOf(k) !== i)
  if (dup) throw new Error(`pipeline_duplicate_agent: ${dup}`)

  for (const step of pipeline.steps) {
    for (const dep of step.dependsOn) {
      if (!keys.includes(dep)) {
        throw new Error(`pipeline_unknown_dependency: ${step.agentKey} -> ${dep}`)
      }
    }
  }

  // Detecção de ciclo por DFS.
  const byKey = new Map(pipeline.steps.map(s => [s.agentKey, s]))
  const visiting = new Set<string>()
  const done = new Set<string>()

  const visit = (key: string, trail: string[]): void => {
    if (done.has(key)) return
    if (visiting.has(key)) {
      throw new Error(`pipeline_cycle: ${[...trail, key].join(' -> ')}`)
    }
    visiting.add(key)
    for (const dep of byKey.get(key)?.dependsOn ?? []) visit(dep, [...trail, key])
    visiting.delete(key)
    done.add(key)
  }

  for (const step of pipeline.steps) visit(step.agentKey, [])
}

/**
 * Transforma a definição do pipeline nas linhas de cs_steps de uma produção.
 * Função pura — não toca em banco, o que a torna trivialmente testável.
 */
export function materializeSteps(
  pipeline: PipelineDef,
  production: { id: string; tenant_id: string },
): Omit<StepRow, 'id'>[] {
  validatePipeline(pipeline)

  return pipeline.steps.map((step, index) => ({
    production_id: production.id,
    tenant_id: production.tenant_id,
    agent_key: step.agentKey,
    step_index: index,
    depends_on: step.dependsOn,
    status: step.humanGate ? 'waiting' : 'pending',
    input: null,
    output: null,
    attempt: 0,
    error: null,
    started_at: null,
    completed_at: null,
  }))
}

/**
 * Steps elegíveis: pendentes cujas dependências já concluíram.
 * A ordem de execução emerge das dependências — o orquestrador não precisa
 * saber a topologia de antemão.
 */
export function eligibleSteps(steps: StepRow[]): StepRow[] {
  const completed = new Set(
    steps.filter(s => s.status === 'completed').map(s => s.agent_key),
  )
  return steps
    .filter(s => s.status === 'pending')
    .filter(s => s.depends_on.every(dep => completed.has(dep)))
    .sort((a, b) => a.step_index - b.step_index)
}

/** Marca como 'stale' os steps que dependem (direta ou indiretamente) de um agente. */
export function dependentAgentKeys(steps: StepRow[], agentKey: string): string[] {
  const out = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const s of steps) {
      if (out.has(s.agent_key)) continue
      if (s.depends_on.some(d => d === agentKey || out.has(d))) {
        out.add(s.agent_key)
        changed = true
      }
    }
  }
  return [...out]
}
