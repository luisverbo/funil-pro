// ============================================================================
// Content Studio — criação idempotente da PRODUÇÃO REAL (Fase 2A)
// ----------------------------------------------------------------------------
// A ordem é a garantia inteira, e é a mesma provada na demonstração:
//
//   1. já existe produção com ESTA chave de idempotência?  -> devolve e PARA
//   2. o tenant estourou o limite de produções abertas?     -> recusa
//   3. insere a própria                                     -> casca, sem fila
//   4. relê pela chave e ELEGE a vencedora                  -> determinístico
//   5. cancela as perdedoras                                -> lógico, nada apaga
//   6. materializa SOMENTE a vencedora                      -> steps + 1º job
//
// A materialização vem por último de propósito. Se viesse antes da eleição,
// cada chamada concorrente teria criado steps e jobs para a PRÓPRIA produção, e
// cancelar depois deixaria produções canceladas com fila viva — que uma chamada
// futura poderia reivindicar e executar.
//
// POR QUE UMA CHAVE DE IDEMPOTÊNCIA, e não só o estado do botão:
//   o botão desabilitado morre num F5, numa reconexão ou num duplo toque de
//   celular com rede ruim. A chave nasce com o formulário, viaja com a
//   requisição e sobrevive a tudo isso. Ela não concede privilégio nenhum —
//   só diz "este é o mesmo envio de antes".
//
// A lógica vive atrás de uma porta (`ProductionRepo`) para ser testável sob
// concorrência real, sem Postgres.
// ============================================================================

import {
  isOpenProduction,
  MAX_OPEN_PRODUCTIONS,
  pickWinningProduction,
  type ProductionAdmissionRow,
} from './production-guard'
import { BRIEF_FIELDS } from './brief'
import type { ValidBrief } from './brief'

export type ProductionRowLite = ProductionAdmissionRow & { created_at: string }

/** Porta mínima de persistência usada pela criação da produção. */
export interface ProductionRepo {
  /** Produções do tenant com esta chave de idempotência, mais antigas primeiro. */
  findByIdempotencyKey(key: string): Promise<ProductionRowLite[]>
  /** Produções reais do tenant ainda abertas. */
  listOpen(): Promise<ProductionRowLite[]>
  /** Cria a produção `draft`, SEM steps, jobs ou eventos. */
  insert(brief: ValidBrief): Promise<ProductionRowLite>
  /** Cancelamento lógico (`status='canceled'`). Nada é apagado. */
  cancel(ids: string[]): Promise<void>
  /** Materializa steps e enfileira o primeiro passo. Precisa ser idempotente. */
  materialize(productionId: string): Promise<void>
}

export type EnsureProductionResult =
  | { ok: true; productionId: string; reused: boolean; canceled: string[] }
  | { ok: false; reason: 'too_many_open' | 'idempotency_conflict' }

/**
 * Coordenador da criação: PREFLIGHT exatamente UMA vez, antes de tudo.
 *
 * `preflight` lança quando a configuração de IA não sustenta uma produção
 * (desligada, sem chave, modelo inválido). A FÁBRICA do repo só roda depois
 * dele: reprovado, nem o repo é construído — zero persistência, zero fetch,
 * nem findByIdempotencyKey. Função pequena com dependências injetáveis: o
 * teste comportamental prova "zero escrita" com um repo espião, sem Server
 * Action nem banco.
 */
export async function createWithPreflight(
  preflight: () => void,
  repoFactory: () => ProductionRepo,
  brief: ValidBrief,
): Promise<EnsureProductionResult> {
  preflight() // lança ContentAIError — o chamador traduz para mensagem pública
  return ensureProduction(repoFactory(), brief)
}

/**
 * Os DOIS briefings dizem a mesma coisa?
 *
 * A chave de idempotência afirma "este é o mesmo envio de antes" — e isso só é
 * verdade se o CONTEÚDO também for o mesmo. Sem esta comparação, uma chave
 * repetida com briefing diferente devolveria silenciosamente uma produção cujo
 * conteúdo não corresponde ao que a pessoa acabou de escrever, e ela aprovaria
 * (Fase 2B) um material de outro pedido.
 */
export function sameBrief(
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
): boolean {
  if (!a || !b) return false
  return BRIEF_FIELDS.every(f => (a[f] ?? '') === (b[f] ?? ''))
}

/**
 * Garante UMA produção por chave de idempotência.
 *
 * Devolve sempre a vencedora — inclusive para a chamada que perdeu, que assim
 * mostra a mesma produção na tela em vez de um erro.
 */
export async function ensureProduction(
  repo: ProductionRepo,
  brief: ValidBrief,
): Promise<EnsureProductionResult> {
  // 1) Mesmo envio de novo? Só se o CONTEÚDO também for o mesmo.
  //    Chave igual + briefing igual    -> devolve a de antes, nada é criado.
  //    Chave igual + briefing diferente -> conflito explícito. Nunca reaproveita
  //    em silêncio, nunca cria uma segunda produção ativa com a mesma chave.
  const mesmas = await repo.findByIdempotencyKey(brief.idempotency_key)
  const jaCriada = pickWinningProduction(mesmas)
  if (jaCriada) {
    if (!sameBrief(jaCriada.brief, brief)) return { ok: false, reason: 'idempotency_conflict' }
    await repo.materialize(jaCriada.id)   // idempotente: nada duplica
    return { ok: true, productionId: jaCriada.id, reused: true, canceled: [] }
  }

  // 2) Limite de produções abertas. Checado ANTES de inserir — recusar depois
  //    deixaria uma casca cancelada no banco a cada tentativa.
  const abertas = (await repo.listOpen()).filter(isOpenProduction)
  if (abertas.length >= MAX_OPEN_PRODUCTIONS) {
    return { ok: false, reason: 'too_many_open' }
  }

  // 3) Insere a própria: neste ponto é uma casca, sem steps, jobs ou eventos.
  const minha = await repo.insert(brief)

  // 4) Relê pela chave e elege. Duas chamadas concorrentes chegam à MESMA
  //    vencedora porque a ordenação é por (created_at, id).
  const candidatas = await repo.findByIdempotencyKey(brief.idempotency_key)
  const vencedora = pickWinningProduction(candidatas) ?? minha

  // 5) Cancela as perdedoras ANTES de qualquer materialização.
  const perdedoras = candidatas.filter(p => p.id !== vencedora.id).map(p => p.id)
  if (perdedoras.length > 0) await repo.cancel(perdedoras)

  // Corrida patológica: outra chamada venceu com a MESMA chave mas briefing
  // DIFERENTE. A nossa já foi cancelada acima — devolver a vencedora aqui
  // entregaria conteúdo que não é o deste envio. Conflito explícito.
  if (vencedora.id !== minha.id && !sameBrief(vencedora.brief, brief)) {
    return { ok: false, reason: 'idempotency_conflict' }
  }

  // 6) Só agora, e só a vencedora, ganha steps e fila.
  await repo.materialize(vencedora.id)

  return { ok: true, productionId: vencedora.id, reused: false, canceled: perdedoras }
}
