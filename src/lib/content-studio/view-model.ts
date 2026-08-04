// ============================================================================
// Content Studio — eventos -> estado visual
// ----------------------------------------------------------------------------
// Função PURA e sem dependência de React: recebe a lista de eventos gravados em
// cs_events e devolve o que a tela deve mostrar.
//
// A regra que sustenta o preview inteiro: a UI NUNCA inventa estado. Se o
// personagem está "trabalhando", é porque existe um `agent_started` gravado no
// banco. Se ele "caminha", é porque houve `task_handoff_started`. Nada aqui é
// disparado por timer — o tempo só controla a VELOCIDADE com que os eventos já
// existentes são revelados, nunca o conteúdo deles.
// ============================================================================

import { OFFICE_AGENT_LABELS } from './agents/office'
import type { EventType, StoredEvent } from './types'

/** Postura do personagem no escritório. */
export type AgentVisualState =
  | 'idle'       // parado na mesa
  | 'queued'     // recebeu a tarefa, ainda não começou
  | 'working'    // trabalhando
  | 'walking'    // levando a entrega para o colega
  | 'done'       // concluiu
  | 'error'      // falhou

export interface AgentView {
  key: string
  label: string
  state: AgentVisualState
  /** Balão curto acima do personagem. */
  bubble: string | null
  /** Progresso real, quando o agente reportou. Nunca estimado. */
  progress: { completed: number; total: number; label?: string } | null
  /** Para quem está entregando, quando `state === 'walking'`. */
  handoffTo: string | null
}

export interface TimelineEntry {
  seq: number
  type: EventType
  agentKey: string | null
  agentLabel: string | null
  label: string
  at: string
  tone: 'neutral' | 'good' | 'bad'
}

export interface OfficeView {
  agents: AgentView[]
  timeline: TimelineEntry[]
  /** Última posição consumida — ponto de retomada do polling. */
  lastSeq: number
  finished: boolean
  failed: boolean
}

/** Ordem das mesas no escritório. */
export const OFFICE_AGENT_ORDER = ['researcher', 'strategist', 'copywriter'] as const

const EVENT_LABEL: Record<EventType, string> = {
  production_created: 'Produção criada',
  agent_queued: 'Recebeu a tarefa',
  agent_started: 'Começou a trabalhar',
  agent_progress: 'Progresso',
  agent_completed: 'Concluiu',
  agent_failed: 'Falhou',
  agent_waiting: 'Aguardando',
  agent_retrying: 'Tentando de novo',
  agent_reprocessed: 'Reprocessado',
  task_handoff_started: 'Entregando o material',
  task_handoff_completed: 'Entrega concluída',
  content_waiting_approval: 'Pronto para revisão',
  content_approved: 'Aprovado',
  content_rejected: 'Recusado',
  publication_scheduled: 'Publicação agendada',
  publication_started: 'Publicando',
  publication_completed: 'Publicado',
  publication_failed: 'Falha na publicação',
}

const BAD: EventType[] = ['agent_failed', 'publication_failed', 'content_rejected']
const GOOD: EventType[] = ['agent_completed', 'content_approved', 'publication_completed', 'content_waiting_approval']

function emptyAgent(key: string): AgentView {
  return {
    key,
    label: OFFICE_AGENT_LABELS[key] ?? key,
    state: 'idle',
    bubble: null,
    progress: null,
    handoffTo: null,
  }
}

export function emptyOfficeView(): OfficeView {
  return {
    agents: OFFICE_AGENT_ORDER.map(emptyAgent),
    timeline: [],
    lastSeq: 0,
    finished: false,
    failed: false,
  }
}

/**
 * Reduz os eventos ao estado visual.
 *
 * Determinística: os mesmos eventos produzem sempre a mesma tela — é o que
 * permite reproduzir a animação a partir do banco, inclusive depois de um
 * recarregamento da página.
 */
export function buildOfficeView(events: StoredEvent[]): OfficeView {
  const view = emptyOfficeView()
  const byKey = new Map(view.agents.map(a => [a.key, a]))

  for (const event of events) {
    view.lastSeq = Math.max(view.lastSeq, event.seq)

    view.timeline.push({
      seq: event.seq,
      type: event.type,
      agentKey: event.agent_key,
      agentLabel: event.agent_key ? (OFFICE_AGENT_LABELS[event.agent_key] ?? event.agent_key) : null,
      label: EVENT_LABEL[event.type] ?? event.type,
      at: event.occurred_at,
      tone: BAD.includes(event.type) ? 'bad' : GOOD.includes(event.type) ? 'good' : 'neutral',
    })

    const agent = event.agent_key ? byKey.get(event.agent_key) : undefined

    switch (event.type) {
      case 'agent_queued':
        if (agent) { agent.state = 'queued'; agent.bubble = 'Recebi a tarefa' }
        break

      case 'agent_started':
        if (agent) { agent.state = 'working'; agent.bubble = 'Trabalhando...'; agent.handoffTo = null }
        break

      case 'agent_progress':
        if (agent) {
          const { completed, total, label } = event.payload as {
            completed?: number; total?: number; label?: string
          }
          // Só vira barra se o agente informou um total REAL. Sem total, sem barra.
          if (typeof completed === 'number' && typeof total === 'number' && total > 0) {
            agent.progress = { completed, total, label }
            if (label) agent.bubble = label
          }
        }
        break

      case 'agent_completed':
        if (agent) { agent.state = 'done'; agent.bubble = 'Pronto!'; agent.progress = null }
        break

      case 'agent_failed':
        if (agent) { agent.state = 'error'; agent.bubble = 'Deu problema' }
        view.failed = true
        break

      case 'agent_retrying':
        if (agent) { agent.state = 'queued'; agent.bubble = 'Tentando de novo' }
        break

      case 'task_handoff_started': {
        // O evento carrega quem entrega e quem recebe: a caminhada é dado, não
        // suposição da interface.
        const { from, to } = event.payload as { from?: string; to?: string }
        const origem = from ? byKey.get(from) : undefined
        if (origem) {
          origem.state = 'walking'
          origem.handoffTo = to ?? null
          origem.bubble = to ? `Levando para o ${OFFICE_AGENT_LABELS[to] ?? to}` : 'Entregando'
        }
        break
      }

      case 'task_handoff_completed': {
        const origem = event.agent_key ? byKey.get(event.agent_key) : undefined
        if (origem) { origem.state = 'done'; origem.handoffTo = null; origem.bubble = 'Entregue' }
        break
      }

      case 'content_waiting_approval':
        view.finished = true
        break

      default:
        break
    }
  }

  return view
}
