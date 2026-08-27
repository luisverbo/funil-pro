// ============================================================================
// Distribuição AUTOMÁTICA de conversas — a régua inteligente
// ----------------------------------------------------------------------------
// Quem recebe a conversa nova? Em ordem de prioridade:
//
//   1. AFINIDADE: se este lead já foi atendido por alguém do departamento
//      (conversa anterior), volta para a MESMA pessoa — continuidade vende
//      mais que fila justa, e nenhum concorrente comum faz isso.
//   2. Modo do departamento:
//      • menos_ocupado — quem tem menos conversas abertas recebe
//      • rodizio      — quem recebeu há mais tempo é o próximo
//      • manual       — ninguém: o gestor distribui à mão
//   3. Empate: desempata pelo rodízio (quem recebeu há mais tempo).
//
// Função pura: recebe a foto do departamento, devolve o escolhido. Quem lê o
// banco é o chamador (webhook/action) — a régua é testável sem banco.
// ============================================================================

export interface AtendenteFoto {
  id: string
  ativo: boolean
  /** Conversas ABERTAS atribuídas a ele agora. */
  abertas: number
  /** Última vez que recebeu uma conversa pela distribuição (rodízio). */
  ultimaAtribuicaoAt: string | null
}

export type ModoDistribuicao = 'manual' | 'rodizio' | 'menos_ocupado'

export function modoDistribuicaoValido(v: unknown): v is ModoDistribuicao {
  return v === 'manual' || v === 'rodizio' || v === 'menos_ocupado'
}

/** Epoch da última atribuição — nunca recebeu = 0 (primeiro da fila). */
const marca = (a: AtendenteFoto) =>
  a.ultimaAtribuicaoAt ? new Date(a.ultimaAtribuicaoAt).getTime() : 0

/**
 * Escolhe quem recebe a conversa. null = ninguém (manual, ou sem atendente
 * ativo). `afinidadeId` é quem já atendeu este lead antes, se houver.
 */
export function escolherAtendente(
  atendentes: AtendenteFoto[],
  modo: ModoDistribuicao,
  afinidadeId?: string | null,
): string | null {
  if (modo === 'manual') return null
  const ativos = atendentes.filter(a => a.ativo)
  if (ativos.length === 0) return null

  // 1) Afinidade: o lead volta para quem já o conhece.
  if (afinidadeId && ativos.some(a => a.id === afinidadeId)) return afinidadeId

  // 2) O modo do departamento.
  const ordenados = [...ativos].sort((a, b) => {
    if (modo === 'menos_ocupado' && a.abertas !== b.abertas) return a.abertas - b.abertas
    return marca(a) - marca(b)          // rodízio (e desempate do menos_ocupado)
  })
  return ordenados[0].id
}

/**
 * Fechar a conversa exige classificar: sem NENHUMA tag, a conversa não pode
 * ser resolvida — vira relatório furado ("fechou por quê?"). O gestor pode
 * mudar isso no futuro; a regra padrão protege a medição.
 */
export function podeResolver(tags: string[]): { ok: true } | { ok: false; motivo: string } {
  if (tags.filter(t => t.trim().length > 0).length === 0) {
    return { ok: false, motivo: 'Coloque ao menos uma tag no lead antes de resolver — é ela que classifica o desfecho.' }
  }
  return { ok: true }
}
