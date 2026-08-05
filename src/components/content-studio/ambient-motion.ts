// ============================================================================
// Office Preview V4.1 — locomoção ambiental (máquina de estados PURA)
// ----------------------------------------------------------------------------
// Move personagem OCIOSO entre pontos do escritório. Cosmética: não cria
// evento, não toca a timeline, não fala com o backend, não altera nada
// persistido. O fluxo real continua vindo dos eventos gravados.
//
// Este arquivo é PURO de propósito: sem React, sem rAF, sem relógio. Recebe
// "quanto tempo visual passou" e devolve "onde o agente está". É isso que
// torna a rotina testável sem navegador e reproduzível em captura.
//
// DUAS GARANTIAS ESTRUTURAIS, não temporais:
//
//   ZONAS DISJUNTAS — cada agente opera no próprio setor, com waypoints
//   exclusivos e uma faixa própria do corredor. Dois agentes nunca disputam o
//   mesmo ponto nem o mesmo trecho porque não COMPARTILHAM nenhum. Não é
//   preciso física nem semáforo: a exclusividade está no mapa.
//
//   AGENDA EM PERÍODO COMUM — todos os ciclos fecham em 60s, com saídas
//   escalonadas. Períodos diferentes entrariam em fase mais cedo ou mais tarde
//   e acabariam colocando os três na rua ao mesmo tempo.
// ============================================================================

export type AmbientPhase =
  | 'at_home_desk'
  | 'ambient_walking'
  | 'ambient_at_waypoint'
  /** Coreografia de saída: a tarefa chegou e o agente volta andando. */
  | 'task_returning'
  | 'task_controlled'

export type AmbientAction = 'reach' | 'point' | 'observe' | 'read'

export interface AmbientLeg {
  waypoint: string
  action: AmbientAction
  dwellMs: number
}

export interface AmbientRoutine {
  /** Período do ciclo. Igual para todos — ver nota das zonas acima. */
  periodMs: number
  /** Instantes de saída dentro do período. Escalonados entre os agentes. */
  startOffsetsMs: number[]
  walkMs: number
  legs: AmbientLeg[]
  /** Zonas que este agente ocupa. Disjuntas entre agentes, por construção. */
  zones: string[]
}

export interface AmbientState {
  phase: AmbientPhase
  waypoint: string | null
  action: AmbientAction | null
}

export const AT_HOME: AmbientState = { phase: 'at_home_desk', waypoint: null, action: null }
export const TASK_CONTROLLED: AmbientState = { phase: 'task_controlled', waypoint: null, action: null }
export const TASK_RETURNING: AmbientState = { phase: 'task_returning', waypoint: null, action: null }

/** Período comum. Todas as agendas fecham aqui. */
const PERIOD_MS = 60_000

/** Duração da coreografia de volta quando a tarefa chega fora da mesa. */
export const TASK_RETURN_MS = 1_500

function routine(
  startOffsetsMs: number[], walkMs: number, legs: AmbientLeg[], zones: string[],
): AmbientRoutine {
  return { periodMs: PERIOD_MS, startOffsetsMs, walkMs, legs, zones }
}

/**
 * Rotas. Fixas, determinísticas e ligadas ao papel de cada um.
 *
 * A GRADE: três saídas por agente, a cada 20s, com fases 4s / 8s / 12s. Cada
 * saída dura 8s, então as janelas ficam adjacentes e se sobrepõem DUAS a duas,
 * nunca três. Nenhuma janela atravessa o fim do período — se atravessasse,
 * haveria alguém andando já no instante zero, e o primeiro movimento deixaria
 * de acontecer na janela de 3–6s pedida.
 *
 * Janelas de atividade (8s cada):
 *   researcher   4–12   24–32   44–52
 *   strategist   8–16   28–36   48–56
 *   copywriter  12–20   32–40   52–60
 */
export const AMBIENT_ROUTINES: Record<string, AmbientRoutine> = {
  // Consulta a estante, observa a janela, volta com o documento.
  researcher: routine([4_000, 24_000, 44_000], 1_300, [
    { waypoint: 'shelf', action: 'reach', dwellMs: 2_000 },
    { waypoint: 'window', action: 'observe', dwellMs: 2_100 },
  ], ['wp:shelf', 'wp:window', 'lane:left']),

  // Aponta no quadro, consulta a mesa de reunião, volta.
  strategist: routine([8_000, 28_000, 48_000], 1_400, [
    { waypoint: 'board', action: 'point', dwellMs: 1_900 },
    { waypoint: 'meeting', action: 'read', dwellMs: 1_900 },
  ], ['wp:board', 'wp:meeting', 'lane:center']),

  // Pega a caneca no café, consulta o painel de ideias, volta.
  copywriter: routine([12_000, 32_000, 52_000], 1_250, [
    { waypoint: 'coffee', action: 'reach', dwellMs: 2_100 },
    { waypoint: 'ideas', action: 'observe', dwellMs: 2_150 },
  ], ['wp:coffee', 'wp:ideas', 'lane:right']),
}

/** Duração de uma saída completa: ida, permanências e volta. */
export function activityDuration(r: AmbientRoutine): number {
  return r.legs.reduce((s, l) => s + r.walkMs + l.dwellMs, 0) + r.walkMs
}

/** Estado dentro de UMA saída, dado quanto tempo já se passou desde o início. */
function stateWithinActivity(r: AmbientRoutine, t: number): AmbientState {
  let resto = t
  for (const leg of r.legs) {
    if (resto < r.walkMs) return { phase: 'ambient_walking', waypoint: leg.waypoint, action: null }
    resto -= r.walkMs
    if (resto < leg.dwellMs) return { phase: 'ambient_at_waypoint', waypoint: leg.waypoint, action: leg.action }
    resto -= leg.dwellMs
  }
  // Última perna: voltando para a própria mesa.
  return { phase: 'ambient_walking', waypoint: null, action: null }
}

/**
 * Onde o agente está no instante `elapsedMs`.
 *
 * Cíclica e pura: o mesmo instante devolve sempre o mesmo estado — servidor e
 * cliente iguais, captura reproduzível, teste sem navegador.
 */
export function ambientStateAt(r: AmbientRoutine, elapsedMs: number): AmbientState {
  if (!Number.isFinite(elapsedMs) || r.periodMs <= 0) return AT_HOME

  let t = elapsedMs % r.periodMs
  if (t < 0) t += r.periodMs

  const dur = activityDuration(r)

  for (const offset of r.startOffsetsMs) {
    // Janela normal.
    if (t >= offset && t < offset + dur) return stateWithinActivity(r, t - offset)
    // Janela que atravessa o fim do período e continua no começo do seguinte.
    const excedente = offset + dur - r.periodMs
    if (excedente > 0 && t < excedente) return stateWithinActivity(r, t + r.periodMs - offset)
  }

  return AT_HOME
}

/** Fora da mesa: em deslocamento ou parado num ponto. */
export function isAwayFromDesk(s: AmbientState): boolean {
  return s.phase === 'ambient_walking' || s.phase === 'ambient_at_waypoint'
}

/** Em deslocamento — a cena liga o ciclo de passos do rig. */
export function isAmbientMoving(s: AmbientState): boolean {
  return s.phase === 'ambient_walking' || s.phase === 'task_returning'
}

/** Zonas ocupadas por um agente num dado estado. Vazio se ele está na mesa. */
export function occupiedZones(r: AmbientRoutine, s: AmbientState): string[] {
  if (!isAwayFromDesk(s)) return []
  const lane = r.zones.find(z => z.startsWith('lane:'))
  const wp = s.waypoint ? `wp:${s.waypoint}` : null
  return [lane, wp].filter((z): z is string => !!z)
}

// ─── Prioridade dos eventos reais ───────────────────────────────────────────

/** `idle` é o único estado sem tarefa. Qualquer outro veio de um evento. */
export function isTaskControlled(visualState: string): boolean {
  return visualState !== 'idle'
}

/** Handoff em curso: a ação dominante da cena. */
export function isHandoffActive(
  agents: readonly { state: string; carryingFolder?: boolean }[],
): boolean {
  return agents.some(a => a.state === 'walking' || a.carryingFolder === true)
}

/**
 * Quem pode ter rotina ambiental agora.
 *
 * Regras de encenação, em ordem de força:
 *   1. handoff em curso   -> NINGUÉM. É a ação mais importante da cena.
 *   2. alguém trabalhando -> no máximo UM secundário, e discreto.
 *   3. cena parada        -> todos os ociosos podem se mover.
 *
 * A escolha do "um" é por ordem fixa da cena, não por sorteio: a mesma
 * situação sempre produz o mesmo resultado.
 */
export function allowedAmbientAgents(
  agents: readonly { key: string; state: string; carryingFolder?: boolean }[],
  focusKey: string | null,
): Set<string> {
  if (isHandoffActive(agents)) return new Set()

  const ociosos = agents
    .filter(a => a.state === 'idle' && a.key !== focusKey)
    .map(a => a.key)

  const alguemTrabalhando = agents.some(a => a.state === 'working')
  return new Set(alguemTrabalhando ? ociosos.slice(0, 1) : ociosos)
}

export interface ResolveParams {
  agentKey: string
  visualState: string
  /** Vindo de `allowedAmbientAgents`. */
  allowed: boolean
  elapsedMs: number
  /** Tempo visual em que a coreografia de volta termina. */
  returningUntilMs?: number
  reducedMotion?: boolean
}

/**
 * Estado ambiental já com a prioridade dos eventos aplicada.
 *
 * A ordem importa: `task_returning` vem ANTES de `task_controlled`, porque é
 * justamente o intervalo em que o evento já chegou mas o personagem ainda está
 * voltando — sem isso ele assumiria a pose de trabalho no meio do corredor.
 */
export function resolveAmbient(p: ResolveParams): AmbientState {
  if (p.reducedMotion) return TASK_CONTROLLED

  const temTarefa = isTaskControlled(p.visualState)

  // Coreografia de saída: a tarefa chegou com o agente fora da mesa.
  // `error` não espera — quem falhou não sai andando de volta.
  if (temTarefa && p.visualState !== 'error' &&
      p.returningUntilMs !== undefined && p.elapsedMs < p.returningUntilMs) {
    return TASK_RETURNING
  }

  if (temTarefa) return TASK_CONTROLLED
  if (!p.allowed) return AT_HOME

  const routine = AMBIENT_ROUTINES[p.agentKey]
  if (!routine) return AT_HOME

  return ambientStateAt(routine, p.elapsedMs)
}
