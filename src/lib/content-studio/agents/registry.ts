// ============================================================================
// Content Studio — registry de agentes (Fase 1)
// ----------------------------------------------------------------------------
// Ponto único de resolução `agent_key -> implementação`.
//
// O orquestrador NUNCA importa um agente diretamente: pede ao registry. É isso
// que permite acrescentar pesquisador, estrategista, copywriter, diretor de
// arte, revisor e publicador depois, sem tocar no motor.
//
// Os agentes também nunca chamam uns aos outros — a passagem de bastão é feita
// de dados (`upstream`) + eventos, decidida pelo orquestrador.
// ============================================================================

import type { AgentDefinition } from '../types'
import { STUB_A, STUB_B } from './stub'

const REGISTRY = new Map<string, AgentDefinition>()

/**
 * Registra um agente. Chave duplicada é erro: sobrescrever silenciosamente um
 * agente já registrado esconderia um bug grave (dois módulos disputando a mesma
 * etapa do pipeline).
 */
export function registerAgent(agent: AgentDefinition): void {
  if (REGISTRY.has(agent.key)) {
    throw new Error(`agent_already_registered: ${agent.key}`)
  }
  REGISTRY.set(agent.key, agent)
}

/** Resolve um agente. Chave desconhecida falha alto — jamais vira no-op. */
export function getAgent(key: string): AgentDefinition {
  const agent = REGISTRY.get(key)
  if (!agent) throw new Error(`agent_not_found: ${key}`)
  return agent
}

export function hasAgent(key: string): boolean {
  return REGISTRY.has(key)
}

export function listAgents(): AgentDefinition[] {
  return [...REGISTRY.values()]
}

/**
 * Substituição explícita — exclusiva de teste.
 * Existe para que os testes injetem um agente que falha sem precisar de banco
 * nem de rede. Nomeado de forma constrangedora de propósito.
 */
export function __registerAgentForTests(agent: AgentDefinition): void {
  REGISTRY.set(agent.key, agent)
}

// Registro dos agentes desta fase.
registerAgent(STUB_A)
registerAgent(STUB_B)
