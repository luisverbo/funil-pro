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

import { CAROUSEL_AGENT_LABELS } from './agents/carousel'
import { CAROUSEL_AI_LABELS } from './agents/carousel-ai'
import { OFFICE_AGENT_LABELS } from './agents/office'
import { STUDIO_AGENT_LABELS } from './studio/schema'
import type { EventType, StoredEvent } from './types'

/**
 * O que a view precisa de um evento.
 *
 * Aceita tanto `StoredEvent` (servidor) quanto a versão pública sem
 * `tenant_id` (navegador) — a cena é a mesma; o tenant nunca foi usado aqui.
 */
export type ViewEvent = Omit<StoredEvent, 'tenant_id'> & { tenant_id?: string }

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

  // ─── Posição na cena (derivada dos eventos, nunca de timer) ──────────────

  /**
   * Mesa onde o personagem está NESTE momento da timeline.
   *
   * É a própria, exceto durante um handoff, quando passa a ser a do colega.
   * A cena só interpola entre duas posições com transição CSS — a decisão de
   * ONDE ele está continua vindo dos eventos.
   */
  atDesk: string
  /** Carrega a pasta (durante a entrega). */
  carryingFolder: boolean
  /** Acabou de receber a pasta — usado para o aceno de reconhecimento. */
  receivedFolder: boolean
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

/**
 * Rótulo amigável de cada estado da produção.
 *
 * Só apresentação: o valor persistido em `cs_productions.status` continua o
 * técnico. Ninguém deveria ler "review" numa tela de produto.
 */
export const PRODUCTION_STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  queued: 'Na fila',
  running: 'Em andamento',
  waiting_input: 'Aguardando informação',
  review: 'Aguardando aprovação',
  awaiting_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  scheduled: 'Agendado',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Falhou',
  canceled: 'Cancelado',
}

/** Nunca devolve o valor cru: um estado desconhecido vira texto neutro. */
export function productionStatusLabel(status: string | null | undefined): string {
  if (!status) return 'Não iniciada'
  return PRODUCTION_STATUS_LABEL[status] ?? 'Em andamento'
}

/** Ordem das mesas no escritório. */
export const OFFICE_AGENT_ORDER = ['researcher', 'strategist', 'copywriter'] as const

/**
 * Rótulos de TODOS os agentes que podem aparecer na timeline — os stubs da
 * demonstração e os do pipeline de produção.
 */
export const AGENT_LABELS: Record<string, string> = {
  ...OFFICE_AGENT_LABELS,
  ...CAROUSEL_AGENT_LABELS,
  ...CAROUSEL_AI_LABELS,
  cc_quick_carousel: 'Copywriter',
  ...STUDIO_AGENT_LABELS,
}

/**
 * Em qual MESA um agente trabalha.
 *
 * O escritório tem três mesas, desenhadas na Fase V3/V4. O pipeline de produção
 * tem cinco papéis: os três de sempre, mais Revisor e Aprovação.
 *
 * A escolha aqui é deliberada: os três papéis com mesa animam o escritório; o
 * Revisor e a Aprovação aparecem na LINHA DO TEMPO e no resultado, sem mesa.
 * A alternativa seria sentar o Revisor na cadeira de outro personagem, o que
 * mostraria na tela algo que não corresponde ao evento gravado.
 */
const DESK_BY_AGENT: Record<string, string> = {
  researcher: 'researcher',
  strategist: 'strategist',
  copywriter: 'copywriter',
  cc_researcher: 'researcher',
  cc_strategist: 'strategist',
  cc_copywriter: 'copywriter',
  // Fase 2B: os agentes de IA sentam nas MESMAS mesas — mesmos personagens,
  // mesmas animações. Revisor e Aprovação (das duas gerações) seguem só na
  // linha do tempo, como antes.
  cc_ai_researcher: 'researcher',
  cc_ai_strategist: 'strategist',
  cc_ai_copywriter: 'copywriter',
  // Criação rápida: UM agente, sentado na mesa do Copywriter. Pesquisador e
  // Estrategista não executam — e portanto não são simulados na cena.
  cc_quick_carousel: 'copywriter',
  // Geração Studio: TRÊS agentes, TRÊS mesas — cada um com a sua.
  // Estrategista e Copywriter ficam nas mesas de sempre (mesmas cores). O
  // Designer ocupa a terceira estação, que este pipeline não usa para pesquisa;
  // a placa da mesa passa a exibir "Designer" porque o rótulo vem do agente que
  // REALMENTE trabalhou ali (ver `buildOfficeView`), não do nome do slot.
  cst_strategist: 'strategist',
  cst_copywriter: 'copywriter',
  cst_designer: 'researcher',
}

/** Mesa do agente, ou null para quem não tem lugar na cena. */
export function deskOf(agentKey: string | null | undefined): string | null {
  if (!agentKey) return null
  return DESK_BY_AGENT[agentKey] ?? null
}

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
    label: AGENT_LABELS[key] ?? key,
    state: 'idle',
    bubble: null,
    progress: null,
    handoffTo: null,
    atDesk: key,          // começa na própria mesa
    carryingFolder: false,
    receivedFolder: false,
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
export function buildOfficeView(events: ViewEvent[]): OfficeView {
  const view = emptyOfficeView()
  const byKey = new Map(view.agents.map(a => [a.key, a]))

  for (const event of events) {
    view.lastSeq = Math.max(view.lastSeq, event.seq)

    view.timeline.push({
      seq: event.seq,
      type: event.type,
      agentKey: event.agent_key,
      agentLabel: event.agent_key ? (AGENT_LABELS[event.agent_key] ?? event.agent_key) : null,
      label: EVENT_LABEL[event.type] ?? event.type,
      at: event.occurred_at,
      tone: BAD.includes(event.type) ? 'bad' : GOOD.includes(event.type) ? 'good' : 'neutral',
    })

    // Mapeado para a MESA: o pipeline de produção usa chaves cc_*, e quem não
    // tem mesa (Revisor, Aprovação) simplesmente não move ninguém na cena.
    const deskKey = deskOf(event.agent_key)
    const agent = deskKey ? byKey.get(deskKey) : undefined

    // A placa da mesa mostra QUEM trabalhou ali, não o nome do slot. É o que
    // permite o Designer ter a própria estação sem redesenhar o escritório: se
    // o evento gravado é de `cst_designer`, a mesa passa a se chamar Designer.
    // Sem evento, nada muda — a cena continua sem inventar ocupante.
    if (agent && event.agent_key) {
      const rotulo = AGENT_LABELS[event.agent_key]
      if (rotulo) agent.label = rotulo
    }

    switch (event.type) {
      case 'agent_queued':
        if (agent) { agent.state = 'queued'; agent.bubble = 'Recebi a tarefa' }
        break

      case 'agent_started':
        if (agent) {
          agent.state = 'working'
          agent.bubble = 'Trabalhando...'
          agent.handoffTo = null
          agent.atDesk = agent.key          // de volta à própria mesa
          agent.receivedFolder = false
        }
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
        if (agent) {
          agent.state = 'done'
          agent.bubble = 'Pronto!'
          agent.progress = null
          agent.atDesk = agent.key
        }
        break

      case 'agent_failed':
        if (agent) {
          agent.state = 'error'
          agent.bubble = 'Deu problema'
          agent.atDesk = agent.key
          agent.carryingFolder = false
        }
        view.failed = true
        break

      case 'agent_retrying':
        if (agent) { agent.state = 'queued'; agent.bubble = 'Tentando de novo' }
        break

      case 'task_handoff_started': {
        // O evento carrega quem entrega e quem recebe: a caminhada é dado, não
        // suposição da interface.
        const { from, to } = event.payload as { from?: string; to?: string }
        const origemKey = deskOf(from)
        const destinoKey = deskOf(to)
        const origem = origemKey ? byKey.get(origemKey) : undefined
        if (origem) {
          origem.state = 'walking'
          origem.handoffTo = destinoKey
          origem.bubble = to ? `Levando para o ${AGENT_LABELS[to] ?? to}` : 'Entregando'
          // Caminha ATÉ a mesa do destinatário, levando a pasta junto.
          origem.atDesk = destinoKey ?? origem.key
          origem.carryingFolder = true
        }
        break
      }

      case 'task_handoff_completed': {
        // Entrega feita: quem levou solta a pasta e VOLTA para a própria mesa;
        // quem recebeu fica com ela até começar a trabalhar.
        const origemDesk = deskOf(event.agent_key)
        const origem = origemDesk ? byKey.get(origemDesk) : undefined
        if (origem) {
          const destino = origem.handoffTo ? byKey.get(origem.handoffTo) : undefined
          if (destino) destino.receivedFolder = true

          origem.state = 'done'
          origem.handoffTo = null
          origem.bubble = 'Entregue'
          origem.atDesk = origem.key
          origem.carryingFolder = false
        }
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
