// ============================================================================
// Estúdio IA — o cérebro da Ana (API da Anthropic, Claude)
// ----------------------------------------------------------------------------
// A máquina de estados decide a venda; aqui a IA só:
//   1) entende uma mensagem livre DENTRO da etapa e devolve uma resposta
//      ESTRUTURADA (intenção, dados extraídos, texto, precisa de humano?,
//      está na base?) — o sistema decide o que fazer com ela;
//   2) confere a foto do rosto (pessoa real, de frente, nítida, adulta);
//   3) lê o comprovante do Pix (valor, data, recebedor, pagador, E2E).
// Modelos: Sonnet 5.5 em toda resposta livre de venda e em toda leitura de
// comprovante/foto do rosto; Haiku 5.5 só no mecânico (classificar foto,
// separar preferências). Cada chamada devolve o uso de
// tokens e o custo em US$ (gravado em estudio_ia_uso).
// `fetchFn` injetável: os testes nunca chamam a API de verdade.
// ============================================================================
import type { IdiomaAna } from './textos'
import type { LeituraComprovante } from '../pix'

export const MODELO_RAPIDO = 'claude-haiku-5-5'
export const MODELO_FORTE = 'claude-sonnet-5-5'
type Fetch = typeof fetch

/** US$ por 1 milhão de tokens (entrada, saída). Cache: leitura 0,1× e escrita 1,25× da entrada. */
export const PRECO_POR_MILHAO: Record<string, { entrada: number; saida: number }> = {
  [MODELO_RAPIDO]: { entrada: 0.10, saida: 0.50 },
  [MODELO_FORTE]: { entrada: 2.00, saida: 10.00 },
}

export interface UsoIa { modelo: string; input_tokens: number; output_tokens: number; cache_read: number; cache_write: number; custo_usd: number }

export function custoDoUso(modelo: string, u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }): UsoIa {
  const p = PRECO_POR_MILHAO[modelo] ?? PRECO_POR_MILHAO[MODELO_FORTE]
  const i = u.input_tokens ?? 0, o = u.output_tokens ?? 0, cr = u.cache_read_input_tokens ?? 0, cw = u.cache_creation_input_tokens ?? 0
  const custo = (i * p.entrada + o * p.saida + cr * p.entrada * 0.1 + cw * p.entrada * 1.25) / 1e6
  return { modelo, input_tokens: i, output_tokens: o, cache_read: cr, cache_write: cw, custo_usd: Math.round(custo * 1e6) / 1e6 }
}

const NOME_IDIOMA: Record<IdiomaAna, string> = {
  'pt-BR': 'português do Brasil (informal, carinhoso, "amiga")',
  'pt-PT': 'português de Portugal (tratamento por "tu", sem gírias brasileiras)',
  es: 'espanhol neutro (cercano, cariñoso)',
  'es-ES': 'espanhol DE ESPANHA (sempre "tú" — escríbeme, elige, recibes, tienes, puedes; NUNCA voseo como podés/tenés/elegí/escribime/acá; vocabulário de Espanha: "sesión de fotos", "retoque" em vez de "ajuste", "móvil", "vale"; preços em euros com IVA incluido; prazo: "en menos de 1 hora")',
  en: 'English (warm, friendly)',
}

export interface ItemBase { tipo: 'faq' | 'regra' | 'nao_dizer'; pergunta?: string | null; resposta: string }

export interface ContextoIa {
  idioma: IdiomaAna
  objetivo: string            // o que a etapa precisa (ex.: "escolher um pacote")
  tabelaPrecos: string        // texto pronto (moeda do país)
  prazoMin: number
  temas: string               // "Aniversário, Corporativo, Casual, Sensual"
  historico: { de: 'cliente' | 'ana'; texto: string }[]
  base?: ItemBase[]
  /** O que tem em cada foto do tema escolhido ("01: sentada na poltrona…"). */
  poses?: string
  /** Como ESTA cliente paga (Pix no Brasil / cartão pela Hotmart, na moeda dela). */
  pagamento?: string
  /** A cliente já usou o (único) ajuste deste pedido. */
  ajusteUsado?: boolean
}

export function promptDaAna(c: ContextoIa): string {
  const base = c.base ?? []
  const faq = base.filter(b => b.tipo === 'faq').map(b => `P: ${b.pergunta ?? ''}\nR: ${b.resposta}`).join('\n\n')
  const regras = base.filter(b => b.tipo === 'regra').map(b => `- ${b.resposta}`).join('\n')
  const proibido = base.filter(b => b.tipo === 'nao_dizer').map(b => `- ${b.resposta}`).join('\n')
  return `Você é a Ana, assistente virtual do Estúdio (ensaio fotográfico feito com IA, vendido pelo WhatsApp).
Escreva a "resposta" SEMPRE em ${NOME_IDIOMA[c.idioma]}. Frases curtas, no máximo 3 linhas, emojis com moderação.

FATOS (a única fonte de verdade, junto com a BASE abaixo):
- O ensaio é 100% on-line: a cliente manda 2 fotos (rosto de frente e corpo inteiro), escolhe tema e poses num catálogo numerado e recebe as fotos prontas.
- Temas disponíveis: ${c.temas}. Outros temas: "em breve".
- Preços: ${c.tabelaPrecos}
- Prazo: até ${c.prazoMin} minutos após o pagamento e as fotos, no horário de produção.
- 1 ajuste grátis por pacote — UM SÓ, em até 24 h após a entrega. Nunca ofereça um 2º ajuste nem diga "qualquer ajuste é só pedir"/"se quiser mudar mais alguma coisa, me fala".
- A prévia grátis é de UMA foto só (uma pose). Nunca ofereça uma 2ª prévia nem mais fotos de prévia.
${c.ajusteUsado ? '- ESTA cliente JÁ USOU o ajuste grátis deste pedido: não ofereça outro ajuste. Se pedir mais mudanças, explique com carinho que o pacote inclui 1 ajuste e ofereça um pacote novo.\n' : ''}- Sensual: só maiores de 18 e sem nudez. Só fotos da própria cliente.
- Pagamento DESTA cliente: ${c.pagamento ?? 'Pix (Brasil), conferido pelo comprovante'}. Nunca fale de Pix com quem paga com cartão pela Hotmart, nem de cartão com quem paga por Pix.
- As imagens são geradas por IA; uma pessoa da equipe revisa todas.
- De onde somos: estúdio 100% on-line, atendemos clientes de vários países pelo WhatsApp. NUNCA diga que o estúdio fica no país ou na cidade da cliente. Se perguntarem, diga com naturalidade que é tudo on-line e que atendemos clientes do país dela.
${c.poses ? `\nCATÁLOGO DO TEMA ESCOLHIDO (o que aparece em cada foto — use para descrever, orientar e sugerir; a pose marcada [leva o NÚMERO da idade] precisa da idade da cliente):\n${c.poses.slice(0, 4000)}\n` : ''}${faq ? `\nBASE — PERGUNTAS E RESPOSTAS:\n${faq}\n` : ''}${regras ? `\nBASE — REGRAS:\n${regras}\n` : ''}${proibido ? `\nNUNCA DIGA:\n${proibido}\n` : ''}
PROIBIDO: inventar preço, valor, desconto, cupom, brinde, prazo, garantia ou qualquer promessa que não esteja acima. Nada de currículo, depoimentos ou anos de experiência.
PROIBIDO dizer que vai "confirmar com a equipe", "verificar", "chamar alguém" ou "já te respondo": VOCÊ resolve agora.

COMO RESOLVER (você é vendedora, conduz até a compra):
- Pediu algo que não existe (tema, pacote, quantidade de fotos/poses, formato, prazo menor): diga com carinho que não temos e ofereça a opção mais próxima que EXISTE.
- Quer comprar / "como pago": diga que é só escolher o pacote (ou que o pagamento já foi enviado logo acima) — o sistema manda o Pix ou o link.
- Objeção de preço ("caro"): mostre o valor por foto do pacote maior, que é ensaio de estúdio sem sair de casa, 1 ajuste grátis e que a equipe revisa todas. Sem desconto.
- Desconfiança ("é golpe?", "é confiável?"): ensaio 100% on-line, ajuste grátis, revisão humana de todas as fotos, pagamento conferido pelo comprovante.
- Demora / prazo: até ${c.prazoMin} minutos depois do pagamento e das fotos.
- Assunto fora do ensaio ou que você não sabe: responda curto o que sabe dos FATOS e volte para o passo da venda.

AGORA a etapa precisa de: ${c.objetivo}.
Responda SÓ a dúvida, curto. NÃO termine repetindo o que falta: o sistema já manda o lembrete da etapa logo depois.

Campos:
- intencao: duvida | objecao (caro, desconfiança, "é golpe?") | reclamacao | reembolso | quer_humano | compra | fora_da_base | nao_entendi | outro
- na_base: false se a pergunta pede um fato que NÃO está nos FATOS nem na BASE (mesmo assim escreva a melhor resposta honesta, sem inventar)
- precisa_humano: true SÓ para reclamação de pedido, reembolso, ameaça ou pedido explícito de falar com uma pessoa
- dados: o que a cliente informou nesta mensagem (null quando não disse)`
}

const SCHEMA_RESPOSTA = {
  type: 'object',
  additionalProperties: false,
  required: ['intencao', 'dados', 'resposta', 'precisa_humano', 'na_base'],
  properties: {
    intencao: { type: 'string', enum: ['duvida', 'objecao', 'reclamacao', 'reembolso', 'quer_humano', 'compra', 'fora_da_base', 'nao_entendi', 'outro'] },
    dados: {
      type: 'object', additionalProperties: false,
      required: ['nome', 'tema', 'pacote_qtd', 'poses', 'idade'],
      properties: {
        nome: { type: ['string', 'null'] }, tema: { type: ['string', 'null'] }, pacote_qtd: { type: ['integer', 'null'] },
        poses: { type: ['array', 'null'], items: { type: 'string' } }, idade: { type: ['integer', 'null'] },
      },
    },
    resposta: { type: 'string' },
    precisa_humano: { type: 'boolean' },
    na_base: { type: 'boolean' },
  },
} as const

export type Intencao = 'duvida' | 'objecao' | 'reclamacao' | 'reembolso' | 'quer_humano' | 'compra' | 'fora_da_base' | 'nao_entendi' | 'outro'
export interface RespostaEstruturada {
  intencao: Intencao
  dados: { nome: string | null; tema: string | null; pacote_qtd: number | null; poses: string[] | null; idade: number | null }
  resposta: string
  precisa_humano: boolean
  na_base: boolean
}

/** O que o SISTEMA faz com a resposta da IA. */
export type RespostaIa =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'nao_entendi' }
  | { tipo: 'humano' }
  | { tipo: 'confirmar_equipe'; motivo: string }

const OBJECAO = /\b(caro|cara demais|desconto|cupom|promo|golpe|confi[aá]ve|confian|seguro|garantia|medo|desconfi|nao confio|demor|atras|reclama|horr[ií]vel|p[eé]ssim|nao gostei|feio|estorn|reembols|devolv|procon|advogad|expensive|scam|trust|refund|estafa)/i

/** Haiku no dia a dia; Sonnet em objeção/reclamação ou mensagem longa (ambígua). */
/**
 * Resposta livre de venda = Sonnet 5.5 SEMPRE (objeção, dúvida, "não existe",
 * conduzir até o pagamento: é onde a qualidade decide a venda; ~US$ 0,005 por
 * resposta). O Haiku 5.5 fica no que é mecânico: classificar foto e separar
 * preferências. `OBJECAO` segue marcando a intenção no custo de IA.
 */
export function modeloParaMensagem(texto: string): string {
  void OBJECAO.test(texto ?? '')
  return MODELO_FORTE
}

const VALOR = /(?:R\$|€|US\$|\$|USD|EUR|BRL)\s*\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s*(?:reais|euros?|d[oó]lares?|dollars?)/gi
const PROMESSA = /\b(desconto|cupom|cupon|coupon|discount|gr[aá]tis|free|brinde|de presente|garanto|garantimos|guarantee|reembolso garantido|dinheiro de volta|money back)\b/i
const TEMPO = /(\d+)\s*(min(?:utos?)?|minutes?|h(?:oras?)?|hours?|dias?|days?)\b/gi

/**
 * Trava final: a resposta da IA só sai se não trouxer valor fora da tabela,
 * promessa (desconto/brinde/garantia) que não esteja na base, nem prazo
 * diferente do prometido. Devolve o motivo do bloqueio ou null.
 */
const ADIA = /\b(confirm\w* com a equip|verific\w* com a equip|vou (ver|verificar|checar|confirmar)|ja te (respondo|retorno)|check with (the )?team|get back to you|confirm\w* con el equipo|te (respondo|aviso) enseguida|lo confirmo)/i

export function bloqueioDaResposta(texto: string, permitido: { tabelaPrecos: string; prazoMin: number; base?: ItemBase[] }): string | null {
  if (ADIA.test(texto.normalize('NFD').replace(/[̀-ͯ]/g, ''))) return 'resposta que adia ("vou confirmar")'
  const baseTxt = [permitido.tabelaPrecos, ...(permitido.base ?? []).map(b => `${b.pergunta ?? ''} ${b.resposta}`)].join(' ')
  const norm = (v: string) => v.replace(/[^\d.,]/g, '').replace(',', '.').replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')
  const valoresOk = new Set((baseTxt.match(VALOR) ?? []).map(norm))
  for (const v of texto.match(VALOR) ?? []) if (!valoresOk.has(norm(v))) return `valor fora da tabela (${v.trim()})`
  if (PROMESSA.test(texto)) {
    const p = texto.match(PROMESSA)![1].toLowerCase()
    if (!baseTxt.toLowerCase().includes(p)) return `promessa fora da base (${p})`
  }
  for (const m of texto.matchAll(TEMPO)) {
    const n = Number(m[1]); const u = m[2].toLowerCase()
    const emMin = u.startsWith('h') ? n * 60 : u.startsWith('d') ? n * 1440 : n
    if (emMin !== permitido.prazoMin && emMin !== 24 * 60 && !baseTxt.includes(m[0])) return `prazo diferente do prometido (${m[0]})`
  }
  return null
}

/** Lê a saída estruturada (JSON). Inválida → não entendi. */
export function lerEstruturada(bruto: string): RespostaEstruturada | null {
  try {
    const m = (bruto ?? '').match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0]) as RespostaEstruturada
    if (typeof j.intencao !== 'string' || typeof j.resposta !== 'string') return null
    return { ...j, dados: j.dados ?? { nome: null, tema: null, pacote_qtd: null, poses: null, idade: null } }
  } catch { return null }
}

/** Decisão do sistema sobre a resposta estruturada (pura). */
export function decidirResposta(r: RespostaEstruturada | null, permitido: { tabelaPrecos: string; prazoMin: number; base?: ItemBase[] }): RespostaIa {
  if (!r || r.intencao === 'nao_entendi' || !r.resposta.trim()) return { tipo: 'nao_entendi' }
  // Só passa para o Luís o que é dele: reclamação, reembolso ou pedido de pessoa.
  if (['reclamacao', 'reembolso', 'quer_humano'].includes(r.intencao)) return { tipo: 'humano' }
  // Fora da base NÃO trava: a resposta honesta sai, desde que passe pela trava de valores/promessas.
  const bloqueio = bloqueioDaResposta(r.resposta, permitido)
  if (bloqueio) return { tipo: 'confirmar_equipe', motivo: `a IA tentou responder com ${bloqueio}` }
  return { tipo: 'texto', texto: r.resposta.trim().slice(0, 900) }
}

type Corpo = { content?: { type: string; text?: string }[]; usage?: Record<string, number>; stop_reason?: string; error?: { message?: string } }

export async function chamarClaude(modelo: string, body: Record<string, unknown>, f: Fetch = fetch): Promise<{ texto: string; uso: UsoIa }> {
  const chave = process.env.ANTHROPIC_API_KEY
  if (!chave) throw new Error('ANTHROPIC_API_KEY ausente')
  const r = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelo, ...body }),
  })
  const j = await r.json().catch(() => null) as Corpo | null
  if (!r.ok || !j) throw new Error(j?.error?.message ?? `Anthropic HTTP ${r.status}`)
  const uso = custoDoUso(modelo, j.usage ?? {})
  if (j.stop_reason === 'refusal') return { texto: '', uso }
  return { texto: (j.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join(''), uso }
}

export interface ResultadoIa { resposta: RespostaIa; estruturada: RespostaEstruturada | null; usos: UsoIa[] }

export async function responderDuvida(c: ContextoIa, mensagem: string, f: Fetch = fetch): Promise<ResultadoIa> {
  const msgs = [...c.historico.slice(-8), { de: 'cliente' as const, texto: mensagem }]
    .map(m => ({ role: m.de === 'cliente' ? 'user' : 'assistant', content: m.texto || '…' }))
  // A API exige começar por 'user' e alternar papéis.
  const alternadas: { role: string; content: string }[] = []
  for (const m of msgs) {
    if (alternadas.length === 0 && m.role !== 'user') continue
    const ult = alternadas[alternadas.length - 1]
    if (ult && ult.role === m.role) ult.content += `\n${m.content}`
    else alternadas.push({ ...m })
  }
  const permitido = { tabelaPrecos: c.tabelaPrecos, prazoMin: c.prazoMin, base: c.base }
  const usos: UsoIa[] = []
  const rodar = async (modelo: string, nota?: string) => {
    const msgs = nota ? [...alternadas.slice(0, -1), { role: 'user', content: `${alternadas[alternadas.length - 1]?.content ?? ''}\n\n[SISTEMA: sua resposta anterior foi bloqueada (${nota}). Responda de novo SEM isso: use só valores da tabela, sem desconto/promoção/brinde e sem adiar. Se pediram promoção, diga com carinho que não há e mostre o pacote que sai mais em conta por foto.]` }] : alternadas
    const { texto, uso } = await chamarClaude(modelo, {
      max_tokens: 1024,
      system: [{ type: 'text', text: promptDaAna(c), cache_control: { type: 'ephemeral' } }],
      messages: msgs,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_RESPOSTA } },
    }, f)
    usos.push(uso)
    return lerEstruturada(texto)
  }
  try {
    const primeiro = modeloParaMensagem(mensagem)
    let est = await rodar(primeiro)
    // Caso ambíguo no Haiku (não entendeu / objeção / fora da base): o Sonnet olha de novo.
    if (primeiro === MODELO_RAPIDO && (!est || ['nao_entendi', 'objecao', 'fora_da_base', 'reclamacao'].includes(est.intencao))) {
      est = (await rodar(MODELO_FORTE)) ?? est
    }
    let resposta = decidirResposta(est, permitido)
    // Bloqueada (valor/promessa/"vou confirmar"): uma 2ª tentativa sabendo o motivo, antes da frase segura.
    if (resposta.tipo === 'confirmar_equipe') {
      const est2 = await rodar(MODELO_FORTE, resposta.motivo)
      const r2 = decidirResposta(est2, permitido)
      if (r2.tipo === 'texto') { resposta = r2; est = est2 }
    }
    return { resposta, estruturada: est, usos }
  } catch (err) {
    console.error('[estudio/ana] IA falhou:', String(err).slice(0, 200))
    return { resposta: { tipo: 'nao_entendi' }, estruturada: null, usos }
  }
}

// ── Conferência da foto do rosto (Sonnet, visão) ────────────────────────────

export interface ConferenciaFoto { ok: boolean; motivo: 'ok' | 'ruim' | 'recusada' }

export function lerConferencia(bruto: string): ConferenciaFoto {
  const m = (bruto ?? '').match(/\{[\s\S]*\}/)
  if (!m) return { ok: true, motivo: 'ok' }   // sem resposta legível: não trava a venda
  try {
    const j = JSON.parse(m[0]) as { pessoa?: boolean; rosto_visivel?: boolean; nitida?: boolean; parece_menor?: boolean; famosa_ou_print?: boolean }
    if (j.parece_menor || j.famosa_ou_print || j.pessoa === false) return { ok: false, motivo: 'recusada' }
    if (j.rosto_visivel === false || j.nitida === false) return { ok: false, motivo: 'ruim' }
    return { ok: true, motivo: 'ok' }
  } catch { return { ok: true, motivo: 'ok' } }
}

const SCHEMA_FOTO = {
  type: 'object', additionalProperties: false,
  required: ['pessoa', 'rosto_visivel', 'nitida', 'parece_menor', 'famosa_ou_print'],
  properties: { pessoa: { type: 'boolean' }, rosto_visivel: { type: 'boolean' }, nitida: { type: 'boolean' }, parece_menor: { type: 'boolean' }, famosa_ou_print: { type: 'boolean' } },
} as const

const tipoImagem = (mime: string) => /png/.test(mime) ? 'image/png' : /webp/.test(mime) ? 'image/webp' : 'image/jpeg'

/** Confere a foto; sem chave da IA ou com erro, ACEITA (o Luís revisa depois). */
export async function conferirFoto(bytes: Uint8Array, mime: string, f: Fetch = fetch): Promise<ConferenciaFoto & { uso?: UsoIa }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: true, motivo: 'ok' }
  try {
    const { texto, uso } = await chamarClaude(MODELO_FORTE, {
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_FOTO } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: tipoImagem(mime), data: Buffer.from(bytes).toString('base64') } },
        { type: 'text', text: 'Esta foto será usada como referência do ROSTO para um ensaio fotográfico. rosto_visivel = rosto de frente e inteiro; famosa_ou_print = celebridade, foto de revista, print de rede social de outra pessoa ou desenho.' },
      ] }],
    }, f)
    return { ...lerConferencia(texto), uso }
  } catch (err) {
    console.error('[estudio/ana] conferência de foto falhou:', String(err).slice(0, 200))
    return { ok: true, motivo: 'ok' }
  }
}

// ── Leitura do comprovante do Pix (Sonnet, visão; imagem ou PDF) ────────────

const SCHEMA_COMPROVANTE = {
  type: 'object', additionalProperties: false,
  required: ['e_comprovante', 'legivel', 'valor_cents', 'data_hora', 'recebedor_nome', 'recebedor_chave', 'pagador_nome', 'e2e_id'],
  properties: {
    e_comprovante: { type: 'boolean' }, legivel: { type: 'boolean' },
    valor_cents: { type: ['integer', 'null'] }, data_hora: { type: ['string', 'null'] },
    recebedor_nome: { type: ['string', 'null'] }, recebedor_chave: { type: ['string', 'null'] },
    pagador_nome: { type: ['string', 'null'] }, e2e_id: { type: ['string', 'null'] },
  },
} as const

export const LEITURA_VAZIA: LeituraComprovante = {
  e_comprovante: false, legivel: false, valor_cents: null, data_hora: null,
  recebedor_nome: null, recebedor_chave: null, pagador_nome: null, e2e_id: null,
}

export function lerLeitura(bruto: string): LeituraComprovante {
  const m = (bruto ?? '').match(/\{[\s\S]*\}/)
  if (!m) return LEITURA_VAZIA
  try { return { ...LEITURA_VAZIA, ...(JSON.parse(m[0]) as Partial<LeituraComprovante>) } } catch { return LEITURA_VAZIA }
}

/** Sem chave ou com erro devolve leitura vazia → vai para a conferência do Luís (nunca aprova sozinho). */
export async function lerComprovante(bytes: Uint8Array, mime: string, f: Fetch = fetch): Promise<{ leitura: LeituraComprovante; uso?: UsoIa }> {
  if (!process.env.ANTHROPIC_API_KEY) return { leitura: LEITURA_VAZIA }
  const b64 = Buffer.from(bytes).toString('base64')
  const arquivo = /pdf/.test(mime)
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: tipoImagem(mime), data: b64 } }
  try {
    const { texto, uso } = await chamarClaude(MODELO_FORTE, {
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_COMPROVANTE } },
      messages: [{ role: 'user', content: [arquivo, { type: 'text', text:
        'Leia este comprovante de Pix (Brasil). Copie os dados EXATAMENTE como aparecem; não invente nada (use null quando não houver). ' +
        'valor_cents = valor pago em centavos (R$ 49,90 → 4990). data_hora = data e hora da transação em ISO 8601 com fuso -03:00 se não houver outro. ' +
        'recebedor_nome/recebedor_chave = quem RECEBEU (destino). pagador_nome = quem pagou. e2e_id = ID da transação / End-to-End (começa com E) ou código de autenticação. ' +
        'e_comprovante = false se não for um comprovante de pagamento; legivel = false se estiver cortado, borrado ou rasurado.' }] }],
    }, f)
    return { leitura: lerLeitura(texto), uso }
  } catch (err) {
    console.error('[estudio/ana] leitura do comprovante falhou:', String(err).slice(0, 200))
    return { leitura: LEITURA_VAZIA }
  }
}

// ── Classificação das fotos da cliente (Haiku 5.5, visão) ───────────────────
// rosto (de frente, ocupa boa parte) · corpo_inteiro (cabeça aos pés) ·
// rosto_e_corpo (uma foto só serve para os dois) · invalida (sem pessoa,
// várias pessoas, escura/borrada, print, famosa). A ESCOLHA de qual vira
// rosto.jpg/corpo.jpg é feita depois, sobre todas as fotos (ana/fotos.ts).

export interface ClasseFoto {
  tipo: 'rosto' | 'corpo_inteiro' | 'rosto_e_corpo' | 'invalida'
  motivo: string | null              // por que é inválida (curto, pt-BR)
  recusada: boolean                  // parece menor / famosa / print de outra pessoa
  fracao_corpo: number               // 0 = só rosto … 1 = corpo inteiro
  rosto_caixa: { x: number; y: number; w: number; h: number } | null   // normalizado 0–1
  cabelo: string | null              // "loiro, longo"
}

const SCHEMA_CLASSE = {
  type: 'object', additionalProperties: false,
  required: ['tipo', 'motivo', 'pessoas', 'nitida', 'parece_menor', 'famosa_ou_print', 'fracao_corpo', 'rosto_caixa', 'cabelo'],
  properties: {
    tipo: { type: 'string', enum: ['rosto', 'corpo_inteiro', 'rosto_e_corpo', 'invalida'] },
    motivo: { type: ['string', 'null'] },
    pessoas: { type: 'integer' }, nitida: { type: 'boolean' }, parece_menor: { type: 'boolean' }, famosa_ou_print: { type: 'boolean' },
    fracao_corpo: { type: 'number' },
    rosto_caixa: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'], properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } }] },
    cabelo: { type: ['string', 'null'] },
  },
} as const

export const CLASSE_DESCONHECIDA: ClasseFoto = { tipo: 'rosto_e_corpo', motivo: null, recusada: false, fracao_corpo: 0.5, rosto_caixa: null, cabelo: null }

export function lerClasse(bruto: string): ClasseFoto | null {
  const m = (bruto ?? '').match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { tipo?: string; motivo?: string | null; pessoas?: number; nitida?: boolean; parece_menor?: boolean; famosa_ou_print?: boolean; fracao_corpo?: number; rosto_caixa?: ClasseFoto['rosto_caixa']; cabelo?: string | null }
    const recusada = !!(j.parece_menor || j.famosa_ou_print)
    let tipo = (['rosto', 'corpo_inteiro', 'rosto_e_corpo', 'invalida'].includes(String(j.tipo)) ? j.tipo : 'invalida') as ClasseFoto['tipo']
    let motivo = j.motivo ?? null
    if ((j.pessoas ?? 1) !== 1 && tipo !== 'invalida') { tipo = 'invalida'; motivo = motivo ?? ((j.pessoas ?? 0) === 0 ? 'não aparece ninguém' : 'tem mais de uma pessoa') }
    if (j.nitida === false && tipo !== 'invalida') { tipo = 'invalida'; motivo = motivo ?? 'ficou escura ou borrada' }
    const fr = Number(j.fracao_corpo)
    return { tipo, motivo: tipo === 'invalida' ? (motivo ?? 'não deu para usar') : null, recusada, fracao_corpo: Number.isFinite(fr) ? Math.max(0, Math.min(1, fr)) : 0.5, rosto_caixa: j.rosto_caixa ?? null, cabelo: j.cabelo ?? null }
  } catch { return null }
}

/** Sem chave/erro: aceita como "rosto_e_corpo" (o Luís confere no painel). */
export async function classificarFoto(bytes: Uint8Array, mime: string, f: Fetch = fetch): Promise<{ classe: ClasseFoto; uso?: UsoIa }> {
  if (!process.env.ANTHROPIC_API_KEY) return { classe: CLASSE_DESCONHECIDA }
  try {
    const { texto, uso } = await chamarClaude(MODELO_RAPIDO, {
      max_tokens: 1024,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_CLASSE } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: tipoImagem(mime), data: Buffer.from(bytes).toString('base64') } },
        { type: 'text', text: 'Foto enviada por uma cliente para um ensaio fotográfico feito com IA. Classifique: tipo = "rosto" (rosto de frente ocupando boa parte), "corpo_inteiro" (da cabeça aos pés), "rosto_e_corpo" (corpo inteiro E rosto nítido o bastante para servir de referência), "invalida" (sem pessoa, mais de uma pessoa, escura/borrada, print de tela, desenho). fracao_corpo = quanto do corpo aparece (0 só rosto, 1 corpo inteiro). rosto_caixa = caixa do rosto normalizada 0–1 (x,y do canto superior esquerdo). cabelo = cor e comprimento em português (ex.: "loiro, longo"). motivo = por que é inválida, curto, em português.' },
      ] }],
    }, f)
    return { classe: lerClasse(texto) ?? CLASSE_DESCONHECIDA, uso }
  } catch (err) {
    console.error('[estudio/ana] classificação de foto falhou:', String(err).slice(0, 200))
    return { classe: CLASSE_DESCONHECIDA }
  }
}

// ── Preferências: cada campo separado (Haiku 5.5, saída estruturada) ────────

export interface Preferencias { maquiagem: boolean | null; decote: boolean | null; cores_acessorios: string | null; idade: number | null; cabelo_mudar: string | null }

const SCHEMA_PREFS = {
  type: 'object', additionalProperties: false,
  required: ['maquiagem', 'decote', 'cores_acessorios', 'idade', 'cabelo_mudar'],
  properties: {
    maquiagem: { type: ['boolean', 'null'] }, decote: { type: ['boolean', 'null'] },
    cores_acessorios: { type: ['string', 'null'] }, idade: { type: ['integer', 'null'] }, cabelo_mudar: { type: ['string', 'null'] },
  },
} as const

export function lerPreferencias(bruto: string): Preferencias | null {
  const m = (bruto ?? '').match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as Partial<Preferencias>
    const idade = typeof j.idade === 'number' && j.idade >= 5 && j.idade <= 120 ? Math.round(j.idade) : null
    return { maquiagem: typeof j.maquiagem === 'boolean' ? j.maquiagem : null, decote: typeof j.decote === 'boolean' ? j.decote : null,
      cores_acessorios: j.cores_acessorios?.trim() || null, idade, cabelo_mudar: j.cabelo_mudar?.trim() || null }
  } catch { return null }
}

/** Uma resposta pode trazer várias coisas ("42 loiros sem decote"): separa cada campo. */
export async function extrairPreferencias(texto: string, pergunta: string, f: Fetch = fetch): Promise<{ prefs: Preferencias | null; uso?: UsoIa }> {
  if (!process.env.ANTHROPIC_API_KEY) return { prefs: null }
  try {
    const { texto: bruto, uso } = await chamarClaude(MODELO_RAPIDO, {
      max_tokens: 512,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_PREFS } },
      messages: [{ role: 'user', content: `A atendente perguntou: "${pergunta}"\nA cliente respondeu: "${texto.slice(0, 500)}"\n\nExtraia SÓ o que a cliente disse (null no que ela não falou): maquiagem (quer maquiagem?), decote (quer decote?), cores_acessorios (cores/acessórios/roupa pedidos; "pode escolher" = "a critério do estúdio"), idade (número), cabelo_mudar (só se ela pediu para MUDAR o cabelo; descrever o cabelo dela não conta). Não repita a idade em outro campo.` }],
    }, f)
    return { prefs: lerPreferencias(bruto), uso }
  } catch (err) {
    console.error('[estudio/ana] extração de preferências falhou:', String(err).slice(0, 200))
    return { prefs: null }
  }
}
