// ============================================================================
// Content Studio — agentes REAIS do content_carousel_v1 (Fase 2B)
// ----------------------------------------------------------------------------
// Estes agentes substituem os determinísticos no REGISTRY para as chaves cc_*.
// Os determinísticos continuam exportados em carousel.ts como fixture de teste
// e referência — mas produção real NUNCA cai neles: se a IA falha, o job falha
// com código claro e a produção fica em estado recuperável/failed. Template
// fingindo ser resultado é pior que erro.
//
// Cada agente:
//   1. monta system (fixo, versionado) + conteúdo do usuário (envelopado)
//   2. chama a PORTA ContentAIProvider — nunca a Anthropic diretamente
//   3. recebe output JÁ validado pelo schema
//   4. aplica as validações de domínio que o schema não cobre
//   5. persiste output + metadados seguros (modelo, tokens, duração, versão)
//
// Disciplina de custo: a partir da 2ª retentativa de JOB o agente falha ANTES
// de tocar a rede (AI_MAX_ATTEMPTS_WITH_CALLS) — o teto declarado na config é
// real, não decorativo.
// ============================================================================

import {
  AI_MAX_ATTEMPTS_WITH_CALLS,
  AI_PROFILES,
  REVIEW_FLOORS,
  REVIEW_MIN_AVG,
} from '../ai/config'
import { resolveContentAIProvider } from '../ai/bootstrap'
import { ContentAIError, type AICallResult } from '../ai/provider'
import {
  COPYWRITER_PROMPT,
  RESEARCHER_PROMPT,
  REVIEWER_PROMPT,
  STRATEGIST_PROMPT,
  envelopeBrief,
  envelopeUpstream,
} from '../ai/prompts'
import {
  findMetaLeak,
  findUnsupportedClaims,
  parseCopy,
  parseResearch,
  parseReviewAI,
  parseStrategy,
  SCORE_KEYS,
  SLIDES_AI_MAX,
  SLIDES_AI_MIN,
  type CopyOutput,
  type ReviewAIOutput,
} from '../ai/schemas'
import type { AgentDefinition, AgentInput, AgentOutput, AgentUsage } from '../types'
import { CAROUSEL_APPROVAL } from './carousel'

export const CAROUSEL_AI_LABELS: Record<string, string> = {
  cc_researcher: 'Pesquisador',
  cc_strategist: 'Estrategista',
  cc_copywriter: 'Copywriter',
  cc_reviewer: 'Revisor',
  cc_approval: 'Aprovação',
}

/**
 * Metadados seguros da chamada — vão para cs_steps.output.usage (jsonb).
 *
 * SEMÂNTICA DOS TOKENS: `inputTokens` é o TOTAL de entrada (não cacheados +
 * criação de cache + leitura de cache) — nunca subestima o consumo. Os três
 * componentes ficam registrados separadamente. `costCents` fica AUSENTE de
 * propósito: a chamada é paga e o custo ainda não é calculado — zero seria
 * mentira. Só os agentes determinísticos têm custo zero real.
 */
function usageDe(r: AICallResult, promptVersion: string): AgentUsage {
  return {
    provider: 'anthropic',
    model: r.model,
    inputTokens: r.inputTokens,
    uncachedInputTokens: r.uncachedInputTokens,
    cacheCreationInputTokens: r.cacheCreationInputTokens,
    cacheReadInputTokens: r.cacheReadInputTokens,
    outputTokens: r.outputTokens,
    imagesGenerated: 0,
    durationMs: r.durationMs,
    aiCalls: r.calls,
    promptVersion,
  }
}

/** Trava de custo por tentativa de job — falha ANTES de qualquer chamada. */
function exigirTentativaComRede(input: AgentInput): void {
  if (input.envelope.attempt >= AI_MAX_ATTEMPTS_WITH_CALLS) {
    throw new ContentAIError('attempts_exhausted', `attempt=${input.envelope.attempt}`)
  }
}

function execId(input: AgentInput): string {
  // Produção + step + tentativa: identifica a execução no log sem expor nada.
  return `${input.envelope.productionId}:${input.envelope.agentKey}:a${input.envelope.attempt}`
}

// ─── Pesquisador ────────────────────────────────────────────────────────────

export const AI_RESEARCHER: AgentDefinition = {
  key: 'cc_researcher',
  version: 2,
  label: CAROUSEL_AI_LABELS.cc_researcher,

  validateInput(input) {
    if (typeof input.brief?.tema !== 'string' || !input.brief.tema) {
      throw new Error('researcher: briefing sem tema')
    }
  },

  async run(input): Promise<AgentOutput> {
    exigirTentativaComRede(input)
    const r = await resolveContentAIProvider().call({
      system: RESEARCHER_PROMPT.system,
      userContent: envelopeBrief(input.brief),
      parse: parseResearch,
      ...AI_PROFILES.researcher,
      executionId: execId(input),
    })
    return { data: r.output, artifacts: [], usage: usageDe(r, RESEARCHER_PROMPT.version) }
  },
}

// ─── Estrategista ───────────────────────────────────────────────────────────

export const AI_STRATEGIST: AgentDefinition = {
  key: 'cc_strategist',
  version: 2,
  label: CAROUSEL_AI_LABELS.cc_strategist,

  validateInput(input) {
    if (!input.upstream.cc_researcher) {
      throw new Error('strategist: a pesquisa do Pesquisador não chegou')
    }
  },

  async run(input): Promise<AgentOutput> {
    exigirTentativaComRede(input)
    const r = await resolveContentAIProvider().call({
      system: STRATEGIST_PROMPT.system,
      userContent: [
        envelopeBrief(input.brief),
        envelopeUpstream('pesquisa', input.upstream.cc_researcher.data),
      ].join('\n\n'),
      parse: parseStrategy,
      ...AI_PROFILES.strategist,
      executionId: execId(input),
    })
    return { data: r.output, artifacts: [], usage: usageDe(r, STRATEGIST_PROMPT.version) }
  },
}

// ─── Copywriter ─────────────────────────────────────────────────────────────

export const AI_COPYWRITER: AgentDefinition = {
  key: 'cc_copywriter',
  version: 2,
  label: CAROUSEL_AI_LABELS.cc_copywriter,

  validateInput(input) {
    if (!input.upstream.cc_strategist) {
      throw new Error('copywriter: a estratégia do Estrategista não chegou')
    }
  },

  async run(input): Promise<AgentOutput> {
    exigirTentativaComRede(input)

    const partes = [
      envelopeBrief(input.brief),
      envelopeUpstream('pesquisa', input.upstream.cc_researcher?.data ?? {}),
      envelopeUpstream('estrategia', input.upstream.cc_strategist.data),
    ]

    // Ciclo de revisão: o orquestrador gravou instruções e a versão anterior
    // em cs_steps.input. O copywriter as recebe como dado, nunca como system.
    const ciclo = input.stepInput ?? null
    const instrucoes = Array.isArray(ciclo?.revision_notes) ? (ciclo.revision_notes as string[]) : []
    const anterior = ciclo?.previous_copy
    if (instrucoes.length > 0) {
      partes.push([
        '<instrucoes_de_revisao>',
        ...(anterior ? ['Versão anterior (para corrigir, não repetir):',
          JSON.stringify(anterior).slice(0, 8_000)] : []),
        'Problemas apontados pelo revisor:',
        ...instrucoes.map(p => `- ${p.slice(0, 300)}`),
        '</instrucoes_de_revisao>',
      ].join('\n'))
    }

    const r = await resolveContentAIProvider().call({
      system: COPYWRITER_PROMPT.system,
      userContent: partes.join('\n\n'),
      parse: parseCopy,
      ...AI_PROFILES.copywriter,
      executionId: execId(input),
    })
    return {
      data: { ...r.output, revision_cycle: typeof ciclo?.revision_cycle === 'number' ? ciclo.revision_cycle : 0 },
      artifacts: [{ kind: 'document', meta: { formato: 'carrossel', slides: (r.output as CopyOutput).slides.length } }],
      usage: usageDe(r, COPYWRITER_PROMPT.version),
    }
  },
}

// ─── Revisor: determinístico + IA, veredito do SERVIDOR ─────────────────────

export interface DeterministicCheck {
  id: string
  label: string
  ok: boolean
  detalhe?: string
}

/**
 * Nível 1 — validação determinística. Barata, sem rede, roda SEMPRE.
 * O schema já barrou estrutura errada e metalinguagem no copywriter; aqui
 * conferimos de novo (defesa em profundidade) e o que só o domínio sabe.
 */
export function deterministicReview(
  copy: CopyOutput,
  brief: Record<string, unknown>,
): { checks: DeterministicCheck[]; passed: boolean } {
  const checks: DeterministicCheck[] = []
  const add = (id: string, label: string, ok: boolean, detalhe?: string) =>
    checks.push({ id, label, ok, detalhe })

  const textos = [copy.title, copy.caption, ...copy.slides.flatMap(s => [s.headline, s.body])]

  add('titulo', 'Título presente', copy.title.trim().length > 0)
  add('slides_faixa', `Entre ${SLIDES_AI_MIN} e ${SLIDES_AI_MAX} slides`,
    copy.slides.length >= SLIDES_AI_MIN && copy.slides.length <= SLIDES_AI_MAX,
    `${copy.slides.length} slides`)
  add('campos', 'Nenhum campo vazio',
    textos.every(t => t.trim().length > 0) && copy.cta.trim().length > 0)

  const vazamento = findMetaLeak(textos)
  add('sem_instrucao_interna', 'Sem instrução interna vazada', !vazamento,
    vazamento ? `padrão: ${vazamento}` : undefined)

  const inventados = findUnsupportedClaims(textos, brief)
  add('sem_dados_inventados', 'Sem estatística ou fonte não sustentada',
    inventados.length === 0, inventados.length ? inventados.join(', ') : undefined)

  // Repetição mecânica do público: o defeito da 2A. Régua objetiva — o nome
  // do público não pode aparecer na maioria dos slides.
  const publico = typeof brief.publico === 'string' ? brief.publico.trim().toLowerCase() : ''
  if (publico.length > 5) {
    const repeticoes = copy.slides
      .filter(s => `${s.headline} ${s.body}`.toLowerCase().includes(publico)).length
    add('sem_repetir_publico', 'Público-alvo não é repetido slide a slide',
      repeticoes <= Math.floor(copy.slides.length / 2), `${repeticoes} ocorrências`)
  }

  add('cta', 'CTA presente e com tamanho de CTA', copy.cta.length >= 2 && copy.cta.length <= 160)

  return { checks, passed: checks.every(c => c.ok) }
}

/** Nível 2 → veredito. A régua é do servidor, não do modelo. */
export function computeVerdict(
  deterministicPassed: boolean,
  ai: ReviewAIOutput,
): 'approved_for_human_review' | 'needs_revision' {
  if (!deterministicPassed) return 'needs_revision'
  const notas = SCORE_KEYS.map(k => ai.scores[k])
  const media = notas.reduce((a, b) => a + b, 0) / notas.length
  if (media < REVIEW_MIN_AVG) return 'needs_revision'
  for (const [k, piso] of Object.entries(REVIEW_FLOORS)) {
    if (ai.scores[k as keyof typeof ai.scores] < piso) return 'needs_revision'
  }
  return 'approved_for_human_review'
}

export const AI_REVIEWER: AgentDefinition = {
  key: 'cc_reviewer',
  version: 2,
  label: CAROUSEL_AI_LABELS.cc_reviewer,

  validateInput(input) {
    if (!input.upstream.cc_copywriter) {
      throw new Error('reviewer: o texto do Copywriter não chegou')
    }
  },

  async run(input): Promise<AgentOutput> {
    // A cópia persistida já passou pelo schema; revalidar aqui garante que o
    // revisor nunca avalia estrutura inválida vinda de um estado antigo.
    const copy = parseCopy(input.upstream.cc_copywriter.data)

    // Nível 1: sem rede. Se falhar, nem gastamos a chamada de IA.
    const det = deterministicReview(copy, input.brief ?? {})

    let ai: ReviewAIOutput
    let usage: AgentUsage
    if (det.passed) {
      exigirTentativaComRede(input)
      const r = await resolveContentAIProvider().call({
        system: REVIEWER_PROMPT.system,
        userContent: [
          envelopeBrief(input.brief),
          envelopeUpstream('estrategia', input.upstream.cc_strategist?.data ?? {}),
          envelopeUpstream('copy_para_avaliar', copy),
        ].join('\n\n'),
        parse: parseReviewAI,
        ...AI_PROFILES.reviewer,
        executionId: execId(input),
      })
      ai = r.output as ReviewAIOutput
      usage = usageDe(r, REVIEWER_PROMPT.version)
    } else {
      // Reprovado no determinístico: notas zeradas, problemas objetivos, zero
      // custo. As instruções de revisão vêm dos próprios checks.
      ai = {
        scores: Object.fromEntries(SCORE_KEYS.map(k => [k, 0])) as ReviewAIOutput['scores'],
        strengths: [],
        problems: det.checks.filter(c => !c.ok).map(c => `${c.label}${c.detalhe ? ` (${c.detalhe})` : ''}`),
        revision_instructions: det.checks.filter(c => !c.ok).map(c => `Corrigir: ${c.label}`),
      }
      usage = {
        provider: 'none', model: 'deterministic', inputTokens: 0, outputTokens: 0,
        imagesGenerated: 0, costCents: 0, durationMs: 0, aiCalls: 0,
        promptVersion: REVIEWER_PROMPT.version,
      }
    }

    const verdict = computeVerdict(det.passed, ai)
    const media = SCORE_KEYS.reduce((s, k) => s + ai.scores[k], 0) / SCORE_KEYS.length

    return {
      data: {
        agent: 'cc_reviewer',
        verdict,
        scores: ai.scores,
        media: Math.round(media * 10) / 10,
        strengths: ai.strengths,
        problems: ai.problems,
        revision_instructions: ai.revision_instructions,
        deterministic_checks: det.checks,
        // Compatibilidade com o painel/result-view da 2A:
        checklist: det.checks.map(c => ({ id: c.id, label: c.label, ok: c.ok, detalhe: c.detalhe, bloqueia: true })),
        avisos: ai.problems,
        itens_ok: det.checks.filter(c => c.ok).length,
        itens_total: det.checks.length,
      },
      artifacts: [],
      usage,
      nextHint: verdict === 'needs_revision' ? { suggestRevise: ['cc_copywriter'] } : undefined,
    }
  },
}

// A aprovação continua DETERMINÍSTICA e continua não aprovando nada — só
// exige que o parecer exista e tenha passado, e leva a awaiting_approval.
export const AI_APPROVAL: AgentDefinition = {
  ...CAROUSEL_APPROVAL,
  validateInput(input) {
    const parecer = input.upstream.cc_reviewer?.data
    if (!parecer) throw new Error('approval: o parecer do Revisor não chegou')
    if (parecer.verdict !== 'approved_for_human_review') {
      throw new Error('approval: o material não passou na revisão')
    }
  },
}

export const CAROUSEL_AI_AGENTS: AgentDefinition[] = [
  AI_RESEARCHER,
  AI_STRATEGIST,
  AI_COPYWRITER,
  AI_REVIEWER,
  AI_APPROVAL,
]
