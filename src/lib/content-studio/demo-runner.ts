// ============================================================================
// Content Studio — criação idempotente da demonstração
// ----------------------------------------------------------------------------
// A ORDEM aqui é a garantia inteira, e ela é esta:
//
//   1. procura demonstração aberta          -> se achar, devolve e PARA
//   2. insere a própria                     -> ainda sem steps, jobs ou eventos
//   3. relê todas e ELEGE a vencedora       -> determinístico, mesma em todos
//   4. cancela as perdedoras                -> logicamente, nada é apagado
//   5. materializa SOMENTE a vencedora      -> steps + primeiro job + evento
//
// A materialização é o último passo, de propósito. Se ela viesse antes da
// eleição, cada chamada concorrente teria criado steps e jobs para a própria
// produção — e cancelar depois deixaria produções canceladas COM fila viva,
// que um tick futuro poderia reivindicar.
//
// Uma perdedora nunca chega ao passo 5: ela é cancelada no passo 4 e a chamada
// segue materializando a VENCEDORA, não a própria.
//
// A lógica vive atrás de uma porta (`DemoRepo`) para ser testável sob
// concorrência real, sem Postgres.
// ============================================================================

import { isOpenDemo, pickWinningDemo, type ProductionAdmission } from './demo-guard'

export type DemoRow = ProductionAdmission & { created_at: string }

/** Porta mínima de persistência usada pela criação da demonstração. */
export interface DemoRepo {
  /** Demonstrações do tenant, mais antigas primeiro. */
  listDemos(): Promise<DemoRow[]>
  /** Cria uma demonstração `draft`, SEM steps, jobs ou eventos. */
  insertDemo(): Promise<DemoRow>
  /** Cancelamento lógico (`status='canceled'`). Nada é apagado. */
  cancelDemos(ids: string[]): Promise<void>
  /** Materializa steps e enfileira o primeiro passo. Precisa ser idempotente. */
  materialize(productionId: string): Promise<void>
}

export interface EnsureResult {
  productionId: string
  /** true quando reaproveitamos uma demonstração já existente. */
  reused: boolean
  /** Produções canceladas por terem perdido a eleição. */
  canceled: string[]
}

/**
 * Garante exatamente UMA demonstração ativa por tenant.
 *
 * Devolve sempre a vencedora — inclusive para a chamada que perdeu, que assim
 * mostra a mesma demonstração na tela em vez de um erro.
 */
export async function ensureDemoProduction(repo: DemoRepo): Promise<EnsureResult> {
  // 1) Já existe uma aberta? Reaproveita sem inserir nada.
  const existentes = (await repo.listDemos()).filter(isOpenDemo)
  const jaAberta = pickWinningDemo(existentes)
  if (jaAberta) {
    await repo.materialize(jaAberta.id)   // idempotente: nada duplica
    return { productionId: jaAberta.id, reused: true, canceled: [] }
  }

  // 2) Insere a própria. Neste ponto ela é uma casca: sem steps, sem jobs,
  //    sem eventos de execução.
  const minha = await repo.insertDemo()

  // 3) Relê e elege. Duas chamadas concorrentes chegam à MESMA vencedora
  //    porque `pickWinningDemo` ordena por (created_at, id).
  const abertas = (await repo.listDemos()).filter(isOpenDemo)
  const vencedora = pickWinningDemo(abertas) ?? minha

  // 4) Cancela as perdedoras ANTES de qualquer materialização.
  const perdedoras = abertas.filter(p => p.id !== vencedora.id).map(p => p.id)
  if (perdedoras.length > 0) await repo.cancelDemos(perdedoras)

  // 5) Só agora, e só a vencedora, ganha steps e fila.
  await repo.materialize(vencedora.id)

  return { productionId: vencedora.id, reused: false, canceled: perdedoras }
}
