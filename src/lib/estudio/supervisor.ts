// ============================================================================
// Estúdio IA — Supervisor da Ana (puro, sem rede)
// ----------------------------------------------------------------------------
// Um 2º agente lê a conversa INTEIRA e devolve, em JSON: nota 0–10, resumo,
// onde a cliente parou, e cada problema (travou, robótica, errada, faltou
// informação, venda perdida, fluxo) com "como deveria ter sido" e a correção:
//   regra | faq | nao_dizer → o Luís aplica com 1 clique (Base de conhecimento)
//   codigo                  → vai para a lista "levar para o Claude Code"
// O Supervisor nunca muda a Ana sozinho: o Luís decide.
// ============================================================================

export interface MsgRevisao { direcao: 'entrada' | 'saida'; tipo: string; texto: string | null; criado_em: string; autor?: string | null }

/** Revisa só conversa com mensagem nova desde a última revisão, parada há 20 min, dos últimos 3 dias. */
export function precisaRevisar(c: { ultima_msg_em: string | null; revisado_ate: string | null; modo?: string | null }, agora = new Date()): boolean {
  if (!c.ultima_msg_em) return false
  const ult = new Date(c.ultima_msg_em).getTime()
  if (c.revisado_ate && new Date(c.revisado_ate).getTime() >= ult) return false
  const parada = agora.getTime() - ult
  return parada >= 20 * 60e3 && parada <= 3 * 86400e3
}

const ROTULO: Record<string, string> = { imagem: '[foto]', audio: '[áudio]', video: '[vídeo]', documento: '[arquivo]', figurinha: '[figurinha]', reacao: '[reação]', localizacao: '[localização]' }

/** "[14:02] CLIENTE: oi" / "[14:02] ANA: …" — a conversa como o Supervisor lê (máx. ~12 mil caracteres, fim preservado). */
export function transcricao(msgs: MsgRevisao[]): string {
  const linhas = msgs.map(m => {
    const hora = new Date(m.criado_em).toISOString().slice(11, 16)
    const quem = m.direcao === 'entrada' ? 'CLIENTE' : m.autor === 'humano' ? 'LUÍS' : 'ANA'
    const corpo = (m.texto ?? '').trim()
    const rot = m.tipo !== 'texto' ? ROTULO[m.tipo] ?? `[${m.tipo}]` : ''
    return `[${hora}] ${quem}: ${[rot, corpo.startsWith('[') && rot ? '' : corpo].filter(Boolean).join(' ')}`.trim()
  })
  let txt = linhas.join('\n')
  if (txt.length > 12000) txt = `(…início cortado…)\n${txt.slice(-12000)}`
  return txt
}

export const TIPOS_ACHADO = ['travou', 'robotica', 'errada', 'faltou_info', 'venda_perdida', 'fluxo'] as const
export type TipoAchado = (typeof TIPOS_ACHADO)[number]
export type Destino = 'regra' | 'faq' | 'nao_dizer' | 'codigo'

export interface Achado {
  gravidade: 'alta' | 'media' | 'baixa'
  tipo: TipoAchado
  trecho: string
  problema: string
  deveria: string
  correcao: { destino: Destino; pergunta: string | null; texto: string }
}
export interface Analise { nota: number; resumo: string; parou_em: string; venda: 'vendeu' | 'perdeu' | 'em_andamento'; achados: Achado[] }

export const SCHEMA_SUPERVISOR = {
  type: 'object', additionalProperties: false,
  required: ['nota', 'resumo', 'parou_em', 'venda', 'achados'],
  properties: {
    nota: { type: 'integer' }, resumo: { type: 'string' }, parou_em: { type: 'string' },
    venda: { type: 'string', enum: ['vendeu', 'perdeu', 'em_andamento'] },
    achados: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['gravidade', 'tipo', 'trecho', 'problema', 'deveria', 'correcao'],
        properties: {
          gravidade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
          tipo: { type: 'string', enum: [...TIPOS_ACHADO] },
          trecho: { type: 'string' }, problema: { type: 'string' }, deveria: { type: 'string' },
          correcao: {
            type: 'object', additionalProperties: false, required: ['destino', 'pergunta', 'texto'],
            properties: { destino: { type: 'string', enum: ['regra', 'faq', 'nao_dizer', 'codigo'] }, pergunta: { type: ['string', 'null'] }, texto: { type: 'string' } },
          },
        },
      },
    },
  },
} as const

export function promptSupervisor(c: { pais: string | null; idioma: string; tabelaPrecos: string; base: { tipo: string; pergunta?: string | null; resposta: string }[] }): string {
  const base = c.base.map(b => b.tipo === 'faq' ? `- FAQ: ${b.pergunta} → ${b.resposta}` : `- ${b.tipo.toUpperCase()}: ${b.resposta}`).join('\n') || '(vazia)'
  return `Você é o SUPERVISOR de qualidade da Ana, vendedora virtual de um estúdio de ensaio fotográfico feito com IA, vendido pelo WhatsApp (100% on-line).
Leia a conversa inteira e avalie como um gerente de vendas exigente avaliaria uma vendedora HUMANA.

O fluxo de venda: nome → tema (4 temas) → catálogo → pacote → pagamento (Pix no Brasil / cartão pela Hotmart fora) → 2 fotos (rosto + corpo) → poses → preferências → produção → entrega. Prévia grátis de 1 foto existe como cartada de retomada.
Cliente: país ${c.pais ?? 'desconhecido'}, idioma ${c.idioma}. Preços: ${c.tabelaPrecos}
Base de conhecimento atual da Ana:
${base}

Aponte SÓ problemas reais, com o trecho exato:
- travou: a cliente ficou sem resposta útil, a Ana repetiu pergunta, ou não conduziu ao próximo passo
- robotica: frase que nenhuma pessoa diria, repetição, texto longo demais, mensagens em excesso
- errada: informação errada, idioma errado, ignorou o que a cliente disse ou mandou (foto, número, pergunta)
- faltou_info: a cliente perguntou algo que a Ana não sabia responder bem
- venda_perdida: sinal de compra que a Ana não aproveitou
- fluxo: algo do processo fora de ordem / fora de hora
Para cada um diga "deveria" (a mensagem ideal, no idioma da cliente, curta e humana) e a "correcao":
- destino "regra": comportamento que a Ana deve seguir sempre (texto = a regra, em português, imperativa e curta)
- destino "faq": pergunta recorrente (pergunta = como a cliente pergunta; texto = a resposta ideal)
- destino "nao_dizer": algo que a Ana nunca pode falar
- destino "codigo": problema de fluxo/sistema que só um programador resolve (texto = o que mudar, em português)
NUNCA sugira mentir (ex.: dizer que o estúdio fica no país da cliente — ele é 100% on-line), inventar desconto, prazo ou garantia.
Nota: 10 = venda conduzida como uma ótima vendedora humana; 0 = cliente perdida por erro da Ana. Se a conversa estiver boa, achados = [].
resumo e parou_em em português, curtos.`
}

/** JSON do Supervisor → análise validada (descarta o que vier torto). */
export function lerAnalise(bruto: string): Analise | null {
  try {
    const m = (bruto ?? '').match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0]) as Partial<Analise>
    if (typeof j.nota !== 'number' || !Array.isArray(j.achados)) return null
    const achados = j.achados.filter((a): a is Achado =>
      !!a && ['alta', 'media', 'baixa'].includes(a.gravidade) && (TIPOS_ACHADO as readonly string[]).includes(a.tipo)
      && typeof a.problema === 'string' && !!a.problema.trim() && !!a.correcao && ['regra', 'faq', 'nao_dizer', 'codigo'].includes(a.correcao.destino))
      .slice(0, 15)
    return {
      nota: Math.max(0, Math.min(10, Math.round(j.nota))), resumo: String(j.resumo ?? '').slice(0, 600), parou_em: String(j.parou_em ?? '').slice(0, 200),
      venda: (['vendeu', 'perdeu', 'em_andamento'] as const).includes(j.venda as 'vendeu') ? j.venda as Analise['venda'] : 'em_andamento', achados,
    }
  } catch { return null }
}

/** O que o botão "Aplicar" grava na Base de conhecimento (null = vai para o Claude Code). */
export function linhaDaBase(correcao: Achado['correcao']): { tipo: 'faq' | 'regra' | 'nao_dizer'; pergunta: string | null; resposta: string } | null {
  const texto = (correcao.texto ?? '').trim()
  if (!texto || correcao.destino === 'codigo') return null
  if (correcao.destino === 'faq') return correcao.pergunta?.trim() ? { tipo: 'faq', pergunta: correcao.pergunta.trim().slice(0, 300), resposta: texto.slice(0, 1500) } : { tipo: 'regra', pergunta: null, resposta: texto.slice(0, 1500) }
  return { tipo: correcao.destino, pergunta: null, resposta: texto.slice(0, 1500) }
}

/** Problemas de código agrupados, prontos para colar no Claude Code. */
export function textoParaClaude(itens: { tipo: string; gravidade: string; problema: string; trecho: string | null; correcao: { texto?: string } }[]): string {
  if (!itens.length) return ''
  return ['Supervisor da Ana — problemas de fluxo para corrigir no código:', ...itens.map((a, i) =>
    `${i + 1}. [${a.gravidade}/${a.tipo}] ${a.problema}${a.trecho ? `\n   Trecho: "${a.trecho.slice(0, 200)}"` : ''}\n   Sugestão: ${a.correcao.texto ?? ''}`)].join('\n')
}
