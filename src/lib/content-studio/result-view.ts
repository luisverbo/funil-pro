// ============================================================================
// Content Studio — resultado da produção (leitura da PERSISTÊNCIA)
// ----------------------------------------------------------------------------
// Monta o painel de resultado a partir de `cs_steps.output` — o que os agentes
// realmente gravaram.
//
// O navegador NÃO reconstrói nada. Não roda agente, não recombina briefing, não
// deduz slide a partir de evento. Se o dado não está no banco, ele não aparece.
// A diferença importa: um painel que "remonta" o resultado no cliente mostraria
// algo plausível mesmo quando o backend gravou outra coisa — e a pessoa
// aprovaria (Fase 2B) um material que não é o que existe.
//
// Função PURA: recebe linhas de step, devolve o que a tela mostra.
// ============================================================================

import type { CheckItem, ReviewVerdict } from './agents/carousel'
import type { StepRow } from './types'

export interface ResultSlide {
  numero: number
  papel: string
  headline: string
  texto: string
}

export interface ProductionResult {
  titulo: string | null
  estrategia: {
    angulo: string | null
    promessa: string | null
    tom: string | null
  }
  slides: ResultSlide[]
  legenda: string | null
  cta: string | null
  hashtags: string[]
  revisao: {
    verdict: ReviewVerdict | null
    checklist: CheckItem[]
    avisos: string[]
  }
  /** Quantas vezes o copy foi reescrito por pedido do revisor. */
  revisionCycle: number
  /** true quando há material suficiente para mostrar o painel. */
  disponivel: boolean
}

function dataDe(steps: StepRow[], agentKey: string): Record<string, unknown> | null {
  const step = steps.find(s => s.agent_key === agentKey && s.status === 'completed')
  const data = step?.output?.data
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

const RESULTADO_VAZIO: ProductionResult = {
  titulo: null,
  estrategia: { angulo: null, promessa: null, tom: null },
  slides: [],
  legenda: null,
  cta: null,
  hashtags: [],
  revisao: { verdict: null, checklist: [], avisos: [] },
  revisionCycle: 0,
  disponivel: false,
}

/**
 * Monta o resultado a partir dos steps concluídos.
 *
 * Só lê steps `completed`: um step que falhou pode ter deixado output parcial,
 * e mostrá-lo como resultado seria apresentar rascunho abandonado como entrega.
 */
export function buildProductionResult(steps: StepRow[]): ProductionResult {
  const copy = dataDe(steps, 'cc_copywriter')
  const estrategia = dataDe(steps, 'cc_strategist')
  const revisao = dataDe(steps, 'cc_reviewer')

  if (!copy) return { ...RESULTADO_VAZIO }

  const slidesBrutos = Array.isArray(copy.slides) ? copy.slides : []
  const slides: ResultSlide[] = slidesBrutos
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map(s => ({
      numero: typeof s.numero === 'number' ? s.numero : 0,
      papel: texto(s.papel) ?? '',
      headline: texto(s.headline) ?? '',
      texto: texto(s.texto) ?? '',
    }))

  const checklist = Array.isArray(revisao?.checklist) ? (revisao.checklist as CheckItem[]) : []
  const avisos = Array.isArray(revisao?.avisos) ? (revisao.avisos as string[]) : []
  const verdict = texto(revisao?.verdict) as ReviewVerdict | null

  return {
    titulo: texto(copy.titulo),
    estrategia: {
      angulo: texto(estrategia?.angulo),
      promessa: texto(estrategia?.promessa),
      tom: texto(estrategia?.orientacao_de_tom),
    },
    slides,
    legenda: texto(copy.legenda),
    cta: texto(copy.cta),
    hashtags: Array.isArray(copy.hashtags) ? (copy.hashtags as string[]).filter(h => typeof h === 'string') : [],
    revisao: { verdict, checklist, avisos },
    revisionCycle: typeof copy.revision_cycle === 'number' ? copy.revision_cycle : 0,
    disponivel: slides.length > 0,
  }
}

export function emptyProductionResult(): ProductionResult {
  return { ...RESULTADO_VAZIO }
}
