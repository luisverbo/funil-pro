// ============================================================================
// Content Studio — agentes do pipeline content_carousel_v1 (Fase 2A)
// ----------------------------------------------------------------------------
// Determinísticos e SEM IA. Mesma entrada, mesma saída, sempre — o que os torna
// testáveis linha a linha e reproduzíveis numa captura.
//
// A REGRA QUE GOVERNA ESTE ARQUIVO: nada sai daqui que não tenha entrado pelo
// briefing. Nenhum número, nenhum estudo, nenhum depoimento, nenhuma marca.
//
// Isso não é escrúpulo estético. Um agente determinístico que "enfeita" com
// "87% dos clientes relatam..." produz um dado FALSO com aparência de dado
// verdadeiro, e ele vai parar num carrossel publicado. Quando a IA real entrar
// na Fase 2B, é este contrato que ela terá de respeitar — e o revisor abaixo
// já rejeita quem quebrá-lo.
//
// Toda inferência que não está literalmente no briefing sai marcada como
// hipótese, com `hipotese: true`, para que a pessoa saiba o que validar.
// ============================================================================

import type { AgentContext, AgentDefinition, AgentInput, AgentOutput } from '../types'
import { stableHash } from './stub'

export const CAROUSEL_AGENT_LABELS: Record<string, string> = {
  cc_researcher: 'Pesquisador',
  cc_strategist: 'Estrategista',
  cc_copywriter: 'Copywriter',
  cc_reviewer: 'Revisor',
  cc_approval: 'Aprovação',
}

/** Faixa aceita de slides. O revisor cobra os dois extremos. */
export const SLIDES_MIN = 5
export const SLIDES_MAX = 8
/** Teto de texto por slide — carrossel não é artigo. */
export const SLIDE_TEXT_MAX = 220
export const HEADLINE_MAX = 70
export const LEGENDA_MAX = 600

/** Campo do briefing, já normalizado pela validação do servidor. */
function campo(input: AgentInput, key: string): string {
  const value = input.brief?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

async function reportar(ctx: AgentContext, etapas: string[]): Promise<void> {
  for (let i = 0; i < etapas.length; i++) {
    await ctx.reportProgress?.({ completed: i + 1, total: etapas.length, label: etapas[i] })
  }
}

/** Corta sem partir palavra no meio — e sem reticências mentirosas de estouro. */
function limitar(texto: string, max: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  if (limpo.length <= max) return limpo
  const corte = limpo.slice(0, max - 1)
  const espaco = corte.lastIndexOf(' ')
  return `${(espaco > max * 0.6 ? corte.slice(0, espaco) : corte).trim()}…`
}

const SEM_CUSTO = {
  provider: 'none', model: 'deterministic',
  inputTokens: 0, outputTokens: 0, imagesGenerated: 0, costCents: 0,
} as const

// ─── Pesquisador ────────────────────────────────────────────────────────────

/**
 * Organiza o que o briefing já diz. Não pesquisa nada — não há rede aqui.
 *
 * A separação entre `informado` e `hipoteses` é o produto deste agente: o que é
 * fato do briefing fica de um lado, o que foi inferido fica do outro, marcado.
 */
export const CAROUSEL_RESEARCHER: AgentDefinition = {
  key: 'cc_researcher',
  version: 1,
  label: CAROUSEL_AGENT_LABELS.cc_researcher,

  validateInput(input) {
    if (!campo(input, 'tema')) throw new Error('researcher: o briefing não informou o tema')
    if (!campo(input, 'publico')) throw new Error('researcher: o briefing não informou o público')
  },

  async run(input, ctx): Promise<AgentOutput> {
    const tema = campo(input, 'tema')
    const publico = campo(input, 'publico')
    const objetivo = campo(input, 'objetivo')
    const oferta = campo(input, 'oferta')
    const observacoes = campo(input, 'observacoes')

    await reportar(ctx, ['Lendo o briefing', 'Separando fato de hipótese', 'Fechando o resumo'])

    // Tudo abaixo é recombinação do briefing. Nenhuma fonte externa.
    const hipotese = (texto: string) => ({ texto, hipotese: true as const })

    return {
      data: {
        agent: 'cc_researcher',
        resumo: limitar(
          `${tema} apresentado para ${publico}${objetivo ? `, com o objetivo de ${objetivo}` : ''}.`,
          SLIDE_TEXT_MAX,
        ),
        // Fatos: repetem o briefing, sem acrescentar.
        informado: {
          tema, publico, objetivo,
          oferta, observacoes: observacoes || null,
        },
        // Inferências: marcadas uma a uma. Nenhum número, nenhuma fonte.
        necessidades: [
          hipotese(`Entender como ${tema} se aplica à realidade de ${publico}`),
          hipotese(`Saber o que muda na prática ao adotar ${tema}`),
        ],
        dores_possiveis: [
          hipotese(`Já tentou resolver isso antes sem o resultado esperado`),
          hipotese(`Falta de clareza sobre por onde começar com ${tema}`),
        ],
        beneficios_informados: oferta ? [oferta] : [],
        restricoes: observacoes ? [observacoes] : [],
        premissas_a_validar: [
          `O público descrito como "${publico}" reconhece o problema tratado`,
          `A oferta descrita responde ao objetivo "${objetivo || 'não informado'}"`,
        ],
        // Declaração explícita, verificada por teste.
        fontes_externas: [],
        sem_dados_inventados: true,
        assinatura: stableHash({ tema, publico, objetivo, oferta }),
      },
      artifacts: [],
      usage: { ...SEM_CUSTO },
    }
  },
}

// ─── Estrategista ───────────────────────────────────────────────────────────

export const CAROUSEL_STRATEGIST: AgentDefinition = {
  key: 'cc_strategist',
  version: 1,
  label: CAROUSEL_AGENT_LABELS.cc_strategist,

  validateInput(input) {
    if (!input.upstream.cc_researcher) {
      throw new Error('strategist: a pesquisa do Pesquisador não chegou')
    }
  },

  async run(input, ctx): Promise<AgentOutput> {
    const pesquisa = input.upstream.cc_researcher.data
    const informado = (pesquisa.informado ?? {}) as Record<string, string>
    const tema = informado.tema ?? campo(input, 'tema')
    const publico = informado.publico ?? campo(input, 'publico')
    const objetivo = informado.objetivo ?? campo(input, 'objetivo')
    const tom = campo(input, 'tom')
    const cta = campo(input, 'cta')
    const oferta = campo(input, 'oferta')

    await reportar(ctx, ['Analisando a pesquisa', 'Definindo o ângulo', 'Desenhando a sequência'])

    // A sequência é fixa e nomeada: é ela que dá ao copywriter um objetivo por
    // slide, em vez de "escreva sete textos".
    const sequencia = [
      { slide: 1, papel: 'gancho',   objetivo: `Prender ${publico} no primeiro segundo` },
      { slide: 2, papel: 'problema', objetivo: `Nomear o problema ligado a ${tema}` },
      { slide: 3, papel: 'causa',    objetivo: 'Explicar por que o problema persiste' },
      { slide: 4, papel: 'virada',   objetivo: `Apresentar ${tema} como caminho` },
      { slide: 5, papel: 'como',     objetivo: 'Mostrar como funciona na prática' },
      { slide: 6, papel: 'oferta',   objetivo: oferta ? `Apresentar: ${oferta}` : 'Apresentar a oferta' },
      { slide: 7, papel: 'cta',      objetivo: cta ? `Levar à ação: ${cta}` : 'Levar à ação' },
    ]

    return {
      data: {
        agent: 'cc_strategist',
        angulo: limitar(
          `Partir da dor de ${publico}, explicar a causa e posicionar ${tema} como resposta`,
          SLIDE_TEXT_MAX,
        ),
        promessa: limitar(
          objetivo
            ? `Ao final, ${publico} entende ${tema} e sabe qual é o próximo passo para ${objetivo}`
            : `Ao final, ${publico} entende ${tema} e sabe qual é o próximo passo`,
          SLIDE_TEXT_MAX,
        ),
        sequencia,
        orientacao_de_tom: tom || 'direto e claro',
        cta_recomendado: cta,
        baseado_em: {
          hipoteses: Array.isArray(pesquisa.dores_possiveis) ? pesquisa.dores_possiveis.length : 0,
          premissas: Array.isArray(pesquisa.premissas_a_validar) ? pesquisa.premissas_a_validar.length : 0,
        },
        assinatura: stableHash(pesquisa),
      },
      artifacts: [],
      usage: { ...SEM_CUSTO },
    }
  },
}

// ─── Copywriter ─────────────────────────────────────────────────────────────

interface Slide {
  numero: number
  papel: string
  headline: string
  texto: string
}

export const CAROUSEL_COPYWRITER: AgentDefinition = {
  key: 'cc_copywriter',
  version: 1,
  label: CAROUSEL_AGENT_LABELS.cc_copywriter,

  validateInput(input) {
    if (!input.upstream.cc_strategist) {
      throw new Error('copywriter: a estratégia do Estrategista não chegou')
    }
  },

  async run(input, ctx): Promise<AgentOutput> {
    const estrategia = input.upstream.cc_strategist.data
    const sequencia = Array.isArray(estrategia.sequencia)
      ? (estrategia.sequencia as { slide: number; papel: string; objetivo: string }[])
      : []

    const tema = campo(input, 'tema')
    const publico = campo(input, 'publico')
    const oferta = campo(input, 'oferta')
    const cta = campo(input, 'cta')
    const tom = campo(input, 'tom')

    await reportar(ctx, ['Escrevendo o gancho', 'Desenvolvendo os slides', 'Fechando legenda e CTA'])

    const headlinePorPapel: Record<string, string> = {
      gancho:   `Se você trabalha com ${publico}, comece por aqui`,
      problema: `O problema que trava ${publico}`,
      causa:    'Por que isso continua acontecendo',
      virada:   `${tema}: o que muda`,
      como:     'Como aplicar na prática',
      oferta:   oferta || 'A proposta',
      cta:      cta || 'Próximo passo',
    }

    const slides: Slide[] = sequencia.map(item => ({
      numero: item.slide,
      papel: item.papel,
      headline: limitar(headlinePorPapel[item.papel] ?? item.papel, HEADLINE_MAX),
      texto: limitar(item.objetivo, SLIDE_TEXT_MAX),
    }))

    return {
      data: {
        agent: 'cc_copywriter',
        titulo: limitar(`${tema} para ${publico}`, HEADLINE_MAX),
        slides,
        legenda: limitar(
          `${tema} explicado para ${publico}.${oferta ? ` ${oferta}.` : ''} Salve para consultar depois.`,
          LEGENDA_MAX,
        ),
        cta,
        // Derivadas do briefing, sem inventar nicho nem marca de terceiro.
        hashtags: [tema, publico, tom]
          .filter(Boolean)
          .map(t => `#${t.normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^A-Za-z0-9]/g, '').toLowerCase()}`)
          .filter(h => h.length > 2)
          .slice(0, 5),
        revision_cycle: readCycle(input),
        assinatura: stableHash({ estrategia, ciclo: readCycle(input) }),
      },
      artifacts: [{ kind: 'document', meta: { formato: 'carrossel', slides: slides.length } }],
      usage: { ...SEM_CUSTO },
    }
  },
}

/** Ciclo de revisão que o orquestrador gravou no `input` deste step. */
function readCycle(input: AgentInput): number {
  const raw = (input as { stepInput?: Record<string, unknown> }).stepInput?.revision_cycle
  return typeof raw === 'number' && raw > 0 ? raw : 0
}

// ─── Revisor ────────────────────────────────────────────────────────────────

export type ReviewVerdict = 'aprovado_para_revisao' | 'needs_revision'

/** Um item do checklist. `ok:false` vira aviso; `bloqueia` decide o veredito. */
export interface CheckItem {
  id: string
  label: string
  ok: boolean
  detalhe?: string
  bloqueia: boolean
}

/**
 * Padrões de número que aparentam dado de pesquisa.
 *
 * Não é um detector de mentira — é um detector de FORMA. "72% dos gestores",
 * "3 em cada 4", "estudo da Universidade X": nenhum deles pode existir num
 * material derivado só do briefing, então a presença do formato já é o defeito.
 */
const PADROES_INVENTADOS: { re: RegExp; nome: string }[] = [
  { re: /\b\d{1,3}\s*%/, nome: 'porcentagem' },
  { re: /\b\d+\s+em\s+cada\s+\d+/i, nome: 'proporção' },
  { re: /\b(estudo|pesquisa|levantamento|relat[óo]rio)\s+d[aeo]\b/i, nome: 'referência a estudo' },
  // "segundo" sozinho é palavra comum em português — unidade de tempo e
  // ordinal. Exigir o substantivo de fonte logo depois evita reprovar
  // "prender no primeiro segundo", que não cita fonte nenhuma.
  {
    re: /\bsegundo\s+(a|o|os|as)\s+(pesquisa|estudo|dados|relat[óo]rio|levantamento|instituto|fonte|especialista)/i,
    nome: 'citação de fonte',
  },
  { re: /\b\d[\d.,]*\s*(milh(ão|ões)|bilh(ão|ões))\b/i, nome: 'magnitude' },
]

/** Roda o checklist sobre o copy. Pura — é o coração testável do revisor. */
export function reviewCopy(
  copy: Record<string, unknown>,
  brief: Record<string, unknown>,
): { checklist: CheckItem[]; avisos: string[]; verdict: ReviewVerdict } {
  const check: CheckItem[] = []
  const add = (id: string, label: string, ok: boolean, bloqueia: boolean, detalhe?: string) =>
    check.push({ id, label, ok, bloqueia, detalhe })

  const titulo = typeof copy.titulo === 'string' ? copy.titulo.trim() : ''
  const slides = Array.isArray(copy.slides) ? (copy.slides as Slide[]) : []
  const legenda = typeof copy.legenda === 'string' ? copy.legenda.trim() : ''
  const cta = typeof copy.cta === 'string' ? copy.cta.trim() : ''

  add('titulo', 'Título presente', titulo.length > 0, true)
  add('titulo_tamanho', `Título com até ${HEADLINE_MAX} caracteres`,
    titulo.length <= HEADLINE_MAX, false, `${titulo.length} caracteres`)

  add('slides_min', `Pelo menos ${SLIDES_MIN} slides`, slides.length >= SLIDES_MIN, true,
    `${slides.length} slides`)
  add('slides_max', `No máximo ${SLIDES_MAX} slides`, slides.length <= SLIDES_MAX, true,
    `${slides.length} slides`)

  const vazios = slides.filter(s => !s.headline?.trim() || !s.texto?.trim())
  add('sem_campos_vazios', 'Nenhum slide com campo vazio', vazios.length === 0, true,
    vazios.length ? `${vazios.length} slide(s) incompleto(s)` : undefined)

  const longos = slides.filter(s => (s.texto ?? '').length > SLIDE_TEXT_MAX)
  add('tamanho_slides', `Texto de cada slide com até ${SLIDE_TEXT_MAX} caracteres`,
    longos.length === 0, true, longos.length ? `${longos.length} slide(s) longo(s)` : undefined)

  add('cta', 'Chamada para ação clara', cta.length >= 2, true)
  add('legenda', 'Legenda presente', legenda.length > 0, false)
  add('legenda_tamanho', `Legenda com até ${LEGENDA_MAX} caracteres`,
    legenda.length <= LEGENDA_MAX, false, `${legenda.length} caracteres`)

  // Coerência com o briefing: o tema precisa aparecer em algum lugar do copy.
  const tema = typeof brief.tema === 'string' ? brief.tema.toLowerCase() : ''
  // Cada campo entra como uma LINHA. Juntar tudo com espaço formaria frases
  // que não existem em lugar nenhum — o fim de um slide colado no começo do
  // seguinte — e o detector reprovaria texto legítimo.
  const corpo = [titulo, legenda, ...slides.map(s => `${s.headline}\n${s.texto}`)]
    .join('\n').toLowerCase()
  const primeiraPalavra = tema.split(/\s+/).filter(p => p.length > 3)[0] ?? tema
  add('coerencia_briefing', 'Coerente com o tema do briefing',
    !primeiraPalavra || corpo.includes(primeiraPalavra), true)

  // Fatos inventados — com uma exceção deliberada: o que veio LITERALMENTE do
  // briefing não é invenção. Se a oferta diz "50% de desconto", o número é da
  // pessoa, não do agente; reprová-lo derrubaria briefings legítimos (e, com o
  // teto de uma revisão, a produção inteira). A régua é textual e estrita:
  // só isenta o trecho que aparece igual em algum campo do briefing.
  const briefTexto = Object.values(brief)
    .filter((v): v is string => typeof v === 'string')
    .join('\n')
    .toLowerCase()

  const encontrados: string[] = []
  for (const { re, nome } of PADROES_INVENTADOS) {
    const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of corpo.matchAll(global)) {
      if (!briefTexto.includes(m[0])) { encontrados.push(nome); break }
    }
  }
  add('sem_dados_inventados', 'Sem estatística ou fonte inventada',
    encontrados.length === 0, true,
    encontrados.length ? `padrões detectados: ${encontrados.join(', ')}` : undefined)

  const avisos = check.filter(c => !c.ok).map(c => `${c.label}${c.detalhe ? ` (${c.detalhe})` : ''}`)
  const bloqueado = check.some(c => !c.ok && c.bloqueia)

  return {
    checklist: check,
    avisos,
    verdict: bloqueado ? 'needs_revision' : 'aprovado_para_revisao',
  }
}

export const CAROUSEL_REVIEWER: AgentDefinition = {
  key: 'cc_reviewer',
  version: 1,
  label: CAROUSEL_AGENT_LABELS.cc_reviewer,

  validateInput(input) {
    if (!input.upstream.cc_copywriter) {
      throw new Error('reviewer: o texto do Copywriter não chegou')
    }
  },

  async run(input, ctx): Promise<AgentOutput> {
    const copy = input.upstream.cc_copywriter.data
    await reportar(ctx, ['Conferindo estrutura', 'Checando limites', 'Fechando o parecer'])

    const { checklist, avisos, verdict } = reviewCopy(copy, input.brief ?? {})

    return {
      data: {
        agent: 'cc_reviewer',
        verdict,
        checklist,
        avisos,
        itens_ok: checklist.filter(c => c.ok).length,
        itens_total: checklist.length,
        assinatura: stableHash({ verdict, avisos }),
      },
      artifacts: [],
      usage: { ...SEM_CUSTO },
      // O orquestrador decide o que fazer com isto — e impõe o teto de 1.
      nextHint: verdict === 'needs_revision' ? { suggestRevise: ['cc_copywriter'] } : undefined,
    }
  },
}

// ─── Aprovação ──────────────────────────────────────────────────────────────

/**
 * Fecha o trabalho automático. NÃO aprova nada.
 *
 * Existe como step (e não como "fim do pipeline") para que a espera por uma
 * pessoa seja uma linha em cs_steps, visível na timeline e auditável, em vez de
 * um estado implícito. Aprovar de fato é Fase 2B.
 */
export const CAROUSEL_APPROVAL: AgentDefinition = {
  key: 'cc_approval',
  version: 1,
  label: CAROUSEL_AGENT_LABELS.cc_approval,

  validateInput(input) {
    const parecer = input.upstream.cc_reviewer?.data
    if (!parecer) throw new Error('approval: o parecer do Revisor não chegou')
    if (parecer.verdict !== 'aprovado_para_revisao') {
      throw new Error('approval: o material não passou na revisão')
    }
  },

  async run(input): Promise<AgentOutput> {
    const parecer = input.upstream.cc_reviewer.data
    return {
      data: {
        agent: 'cc_approval',
        estado: 'aguardando_aprovacao',
        aprovado_automaticamente: false,
        mensagem: 'Material pronto para revisão humana.',
        itens_ok: parecer.itens_ok ?? null,
        itens_total: parecer.itens_total ?? null,
      },
      artifacts: [],
      usage: { ...SEM_CUSTO },
    }
  },
}

export const CAROUSEL_AGENTS: AgentDefinition[] = [
  CAROUSEL_RESEARCHER,
  CAROUSEL_STRATEGIST,
  CAROUSEL_COPYWRITER,
  CAROUSEL_REVIEWER,
  CAROUSEL_APPROVAL,
]
