// ============================================================================
// Office Preview V4.1 — locomoção ambiental (máquina de estados PURA)
// ----------------------------------------------------------------------------
// POR QUE A V4 PARECIA PARADA
//
// As "micro-rotinas" da V4 giravam cabeça, braço e tronco — mas o personagem
// nunca saía do lugar. Um escritório habitado não é gente mexendo a cabeça na
// cadeira: é gente ANDANDO. Faltava deslocamento.
//
// O QUE ESTA CAMADA É — E O QUE ELA NÃO É
//
// É cosmética. Move personagem ocioso entre pontos do escritório e nada mais.
// Não cria evento, não toca a timeline, não fala com o backend, não altera
// nenhum estado persistido. O fluxo real continua vindo de cs_events.
//
// Este arquivo é PURO de propósito: sem React, sem rAF, sem relógio próprio.
// Recebe "quanto tempo visual passou" e devolve "onde o agente está". É isso
// que torna a rotina inteira testável sem navegador e reproduzível em captura.
// ============================================================================

/** Fase da rotina ambiental. `task_controlled` = o evento real assumiu. */
export type AmbientPhase =
  | 'at_home_desk'
  | 'ambient_walking'
  | 'ambient_at_waypoint'
  | 'returning_home'
  | 'task_controlled'

/** Ação executada ao chegar num ponto. Vira pose no avatar. */
export type AmbientAction = 'reach' | 'point' | 'observe' | 'read'

export interface AmbientLeg {
  /** Ponto do escritório (ver OFFICE_WAYPOINTS na cena). */
  waypoint: string
  action: AmbientAction
  /** Quanto tempo fica no ponto. */
  dwellMs: number
}

export interface AmbientRoutine {
  /** Atraso inicial — é o que impede os três de saírem juntos. */
  startDelayMs: number
  /** Pausa na própria mesa entre um ciclo e o próximo. */
  restMs: number
  /** Duração de cada trecho de caminhada. */
  walkMs: number
  legs: AmbientLeg[]
}

export interface AmbientState {
  phase: AmbientPhase
  /** Para onde vai (caminhando) ou onde está (parado). `null` = a própria mesa. */
  waypoint: string | null
  /** Ação em curso, só quando `phase === 'ambient_at_waypoint'`. */
  action: AmbientAction | null
}

export const AT_HOME: AmbientState = { phase: 'at_home_desk', waypoint: null, action: null }
export const TASK_CONTROLLED: AmbientState = { phase: 'task_controlled', waypoint: null, action: null }

/**
 * Duração do ciclo, igual para os três. Combinada com atrasos iniciais
 * espaçados, é o que garante que NUNCA dois agentes caminhem ao mesmo tempo —
 * não só no começo, mas para sempre.
 *
 * Ciclos de durações diferentes pareceriam mais orgânicos, mas entram em fase
 * mais cedo ou mais tarde e produzem o efeito que queremos evitar: dois
 * atravessando o escritório juntos, disputando a atenção de quem assiste.
 */
const CYCLE_MS = 45_000

/** Espaçamento entre as saídas: cada agente tem sua janela de 15s. */
const SLOT_MS = 15_000

/** Fecha o ciclo em CYCLE_MS calculando o descanso que sobra. */
function routine(
  startDelayMs: number, walkMs: number, legs: AmbientLeg[],
): AmbientRoutine {
  const atividade = legs.reduce((s, l) => s + walkMs + l.dwellMs, 0) + walkMs
  return { startDelayMs, walkMs, legs, restMs: CYCLE_MS - startDelayMs - atividade }
}

/**
 * Rotas por agente. Fixas e distintas — nada de sorteio.
 *
 * Cada um sai na sua janela e termina antes da próxima começar. As rotas
 * também dizem algo sobre o papel: o Pesquisador consulta e observa, o
 * Estrategista aponta e lê, o Copywriter busca café e olha o painel.
 */
export const AMBIENT_ROUTINES: Record<string, AmbientRoutine> = {
  // Curioso: vai à estante, passa pela janela, volta.  Janela 0–13,6s
  researcher: routine(0 * SLOT_MS, 2_400, [
    { waypoint: 'shelf', action: 'reach', dwellMs: 3_400 },
    { waypoint: 'window', action: 'observe', dwellMs: 3_000 },
  ]),
  // Analítico: quadro de planejamento, depois a mesa de reunião.  15–29,4s
  strategist: routine(1 * SLOT_MS, 2_600, [
    { waypoint: 'board', action: 'point', dwellMs: 3_600 },
    { waypoint: 'meeting', action: 'read', dwellMs: 3_000 },
  ]),
  // Criativo: café e painel de ideias.  30–43s
  copywriter: routine(2 * SLOT_MS, 2_200, [
    { waypoint: 'coffee', action: 'reach', dwellMs: 3_400 },
    { waypoint: 'ideas', action: 'observe', dwellMs: 3_800 },
  ]),
}

/** Duração total de um ciclo: espera, ida-e-volta por cada trecho, descanso. */
export function cycleDuration(r: AmbientRoutine): number {
  const trechos = r.legs.reduce((soma, leg) => soma + r.walkMs + leg.dwellMs, 0)
  return r.startDelayMs + trechos + r.walkMs + r.restMs
}

/**
 * Onde o agente está, dado o tempo visual decorrido.
 *
 * Função pura e cíclica: o mesmo `elapsedMs` sempre devolve o mesmo estado.
 * É isso que garante servidor e cliente iguais, captura reproduzível e teste
 * sem navegador.
 */
export function ambientStateAt(routine: AmbientRoutine, elapsedMs: number): AmbientState {
  const total = cycleDuration(routine)
  if (total <= 0 || !Number.isFinite(elapsedMs)) return AT_HOME

  // Tempo negativo (relógio ainda não começou) conta como parado na mesa.
  let t = elapsedMs % total
  if (t < 0) t += total

  // 1) Espera inicial na própria mesa.
  if (t < routine.startDelayMs) return AT_HOME
  t -= routine.startDelayMs

  // 2) Para cada trecho: caminhada até o ponto, depois permanência.
  for (const leg of routine.legs) {
    if (t < routine.walkMs) {
      return { phase: 'ambient_walking', waypoint: leg.waypoint, action: null }
    }
    t -= routine.walkMs

    if (t < leg.dwellMs) {
      return { phase: 'ambient_at_waypoint', waypoint: leg.waypoint, action: leg.action }
    }
    t -= leg.dwellMs
  }

  // 3) Volta para a mesa.
  if (t < routine.walkMs) {
    return { phase: 'returning_home', waypoint: null, action: null }
  }

  // 4) Descanso na mesa até o ciclo reiniciar.
  return AT_HOME
}

/**
 * Estados do fluxo REAL em que a camada ambiental não pode interferir.
 *
 * `idle` é o único momento em que o agente não tem tarefa: qualquer outro
 * significa que os eventos assumiram, e a rotina cede na hora.
 */
export function isTaskControlled(visualState: string): boolean {
  return visualState !== 'idle'
}

/**
 * Estado ambiental de um agente, já respeitando a prioridade dos eventos.
 *
 * Três motivos para devolver `task_controlled` — e a ordem importa menos que o
 * fato de qualquer um deles bastar:
 *   • o agente tem tarefa (state != idle);
 *   • o agente é o foco da cena;
 *   • o usuário pediu menos movimento.
 *
 * Em todos, a cena devolve o agente à mesa INTERPOLANDO a posição — o CSS faz
 * a volta. Nunca há teleporte.
 */
export function resolveAmbient(params: {
  agentKey: string
  visualState: string
  isFocus: boolean
  elapsedMs: number
  reducedMotion?: boolean
}): AmbientState {
  const { agentKey, visualState, isFocus, elapsedMs, reducedMotion } = params

  if (reducedMotion) return TASK_CONTROLLED
  if (isFocus) return TASK_CONTROLLED
  if (isTaskControlled(visualState)) return TASK_CONTROLLED

  const routine = AMBIENT_ROUTINES[agentKey]
  if (!routine) return AT_HOME

  return ambientStateAt(routine, elapsedMs)
}

/** Se a fase implica deslocamento — a cena liga a caminhada do rig. */
export function isAmbientMoving(state: AmbientState): boolean {
  return state.phase === 'ambient_walking' || state.phase === 'returning_home'
}
