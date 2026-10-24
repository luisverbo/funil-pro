// ============================================================================
// Estúdio IA — a Ana como MÁQUINA DE ESTADOS (seção 5) — puro, sem rede
// ----------------------------------------------------------------------------
// A venda NÃO é improvisada pela IA: cada etapa tem um objetivo e um
// entendedor determinístico (número do tema, do pacote, das poses, idade…).
// A IA (ação 'ia') só entra para responder dúvida livre DENTRO da etapa, e o
// executor lembra a cliente do que falta.
//
// Etapas: inicio → nome → tema → [idade_sensual] → pacote → fotos_poses →
//         idade_prefs → aguardando_pagamento → [conferindo] → pago
//         (Pix do Luís conferido pelo comprovante — Fase 4)
//         prévia grátis: previa_fotos → volta para onde estava
// ============================================================================
import type { IdiomaAna } from './textos'

export type Etapa =
  | 'inicio' | 'nome' | 'tema' | 'idade_sensual' | 'pacote' | 'fotos_poses'
  | 'idade_prefs' | 'aguardando_pagamento' | 'conferindo' | 'pago' | 'entregue' | 'ajuste_detalhe'
  | 'previa_fotos' | 'humano'

export interface Dados {
  nome?: string
  tema?: string
  pacote_qtd?: number
  valor_cents?: number
  moeda?: string
  poses?: string[]
  tem_rosto?: boolean
  tem_corpo?: boolean
  idade?: number
  cabelo?: string | null
  preferencias?: string | null
  previa_oferecida?: boolean
  previa_feita?: boolean
  etapa_antes_previa?: Etapa
  /** Ajuste: poses já apontadas pela cliente, esperando o que mudar. */
  ajuste_poses?: string[]
  upsell_oferecido?: boolean
  /** Só uma foto com rosto E corpo: o rosto sai por recorte (pede close). */
  rosto_recortado?: boolean
  close_pedido?: boolean
  /** Pacote entendido com dúvida ("três"): espera o sim/não. */
  pacote_confirmar?: number
  /** Preferências, uma pergunta por vez. */
  maquiagem?: boolean | null
  decote?: boolean | null
  cores?: string | null
  /** Reação (❤️) no lugar de texto: no máximo 1 a cada 10 min. */
  ultima_reacao_em?: string
  /** Fora do Brasil: link da oferta da Hotmart do pacote e o link já com o pedido (sck). */
  pagar_link?: string | null
  hotmart_link?: string | null
  /** Quando a Ana fez a última pergunta (base das cobranças). */
  aguardando_desde?: string
  /** Pix/link da Hotmart já enviado (logo depois da escolha do pacote). */
  pagamento_enviado?: boolean
  /** Escolheu mais poses que o pacote: oferta de trocar para o pacote maior (1 = fica, 2 = troca). */
  troca_pacote?: { qtd: number; valor_cents: number; moeda: string; link: string | null; poses: string[] }
  /** Prévia pedida no meio da venda: o que volta quando ela termina. */
  poses_antes_previa?: string[]
  pedido_antes_previa?: string | null
  /** Poses mandadas antes de escolher o pacote. */
  poses_cedo?: string[]
  /** "Depois te falo": quando respondeu e por quantos minutos adiar a retomada. */
  pausa_em?: string
  adiar_retomada_min?: number
  /** Prévia na fila: as retomadas esperam ela ser entregue. */
  aguardando_previa?: boolean
  /** "Vou falar com a minha filha": uma retomada suave no dia seguinte, sem prévia. */
  pausa_longa?: boolean
  /** Retomadas já enviadas (nunca repete a mesma). */
  retomadas?: string[]
}

export interface Entrada {
  tipo: string               // texto | imagem | video | audio | documento | figurinha | localizacao | outro
  texto: string
  /** Resultado da conferência da foto (o executor roda a visão antes). */
  foto?: 'ok' | 'ruim' | 'recusada'
  /** Fotos novas desta vez (o executor classifica e guarda TODAS antes). */
  fotos?: { novas: number; invalida?: string | null; recusada?: boolean }
  /** Preferências extraídas pela IA da resposta (campos separados). */
  prefs?: { maquiagem: boolean | null; decote: boolean | null; cores_acessorios: string | null; idade: number | null; cabelo_mudar: string | null } | null
}

export interface Preco { pacote_qtd: number; valor_cents: number; moeda: string; link_pagamento?: string | null }

export interface Contexto {
  idioma: IdiomaAna
  precos: Preco[]
  /** Números de pose ATIVOS por tema. */
  posesDoTema: (slug: string) => string[]
  temasAtivos: string[]
  /** Pix por comprovante disponível (Brasil, chave cadastrada). */
  pix?: boolean
  /** Pós-entrega do pedido atual (Fase 5). */
  entrega?: { pode_ajustar: boolean; poses: string[]; upsell_qtd: number; upsell_valor_cents: number; moeda: string }
  /** Fotos que a cliente JÁ mandou (todas, classificadas) — vale em qualquer etapa. */
  fotos?: { tem_rosto: boolean; tem_corpo: boolean; rosto_recortado: boolean; unica: boolean }
  /** Nome do perfil do WhatsApp (a Ana não pergunta o nome quando dá para usar). */
  nomePerfil?: string | null
  /** O pedido atual já está pago (pagou antes de mandar tudo). */
  pago?: boolean
  agoraMs?: number
}

export type Acao =
  | { t: 'texto'; chave: string; vars?: Record<string, string | number> }
  | { t: 'audio'; chave: string }
  | { t: 'menu_imagem' }
  | { t: 'catalogo'; tema: string }
  | { t: 'criar_pedido'; tipo: 'pacote' | 'previa' }
  | { t: 'fotos_escolher' }
  | { t: 'reagir'; emoji: string }
  | { t: 'atualizar_pedido'; poses?: string[] }
  | { t: 'fechar_pedido'; tipo: 'pacote' | 'previa' }
  | { t: 'ia'; objetivo: string }
  | { t: 'humano'; motivo: string }
  | { t: 'idioma'; idioma: IdiomaAna }
  | { t: 'pix' }
  | { t: 'comprovante' }
  | { t: 'ajuste'; poses: string[]; obs: string }
  | { t: 'upsell' }
  | { t: 'hotmart'; chave?: string }
  | { t: 'trocar_pacote' }
  | { t: 'fila' }

export interface Resultado { etapa: Etapa; dados: Dados; acoes: Acao[] }

// ── Entendedores puros ──────────────────────────────────────────────────────

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** "3", "opção 3", "a 3", "3️⃣" → 3. Só se o número for a resposta (até 2 dígitos, curto). */
export function numeroDaOpcao(texto: string): number | null {
  const t = sem(texto).replace(/️|⃣/g, '').trim()
  const m = t.match(/^(?:opcao|opção|option|opcion|numero|nº|n|o|a)?\s*(\d{1,2})\s*[.)!]*$/)
  return m ? Number(m[1]) : null
}

const TEMAS_PALAVRAS: [string, RegExp][] = [
  ['aniversario', /anivers|cumple|birthday|bday/],
  ['corporativo', /corpor|empresa|linkedin|profissional|profesional|business/],
  ['casual', /casual|dia a dia|lifestyle/],
  ['sensual', /sensual|sexy|boudoir|lingerie/],
]
const OUTROS_TEMAS = /\b(casal|couple|pareja|namorad|infantil|crianc|nino|nina|kid|child|bebe|baby|pet|cachorr|perro|dog|gat[oa]|cat\b|casamento|boda|wedding|noiva|country|gestante|gravida|embaraz|pregnan|familia|family)/

export function temaDoTexto(texto: string, ativos: string[]): { tema: string } | { outro: true } | null {
  const n = numeroDaOpcao(texto)
  const ordem = ['aniversario', 'corporativo', 'casual', 'sensual'].filter(t => ativos.includes(t))
  if (n !== null) return n >= 1 && n <= ordem.length ? { tema: ordem[n - 1] } : null
  const t = sem(texto)
  for (const [slug, re] of TEMAS_PALAVRAS) if (re.test(t) && ativos.includes(slug)) return { tema: slug }
  if (OUTROS_TEMAS.test(t)) return { outro: true }
  return null
}

/** "tenho 42 anos", "42", "I'm 35" → idade; ignora números fora de 5–120. */
export function idadeDoTexto(texto: string): number | null {
  const t = sem(texto)
  const m = t.match(/(\d{1,3})\s*(?:anos|ano|años|years?|yo|y\/o)\b/) ?? t.match(/(?:tenho|idade|edad|tengo|age|i'?m|i am|sou)\D{0,6}(\d{1,3})\b/) ?? t.match(/^\s*(\d{1,3})\s*$/)
  if (!m) return null
  const n = Number(m[1])
  return n >= 5 && n <= 120 ? n : null
}

const NUM_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, dez: 10, quinze: 15,
  one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, uno: 1, dos: 2, cuatro: 4, diez: 10, quince: 15,
}
const ORDINAL: Record<string, number> = {
  primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4, quinto: 5, quinta: 5,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, primero: 1, tercero: 3, cuarto: 4,
}

/**
 * Pacote escolhido. "5" = OPÇÃO 5 (15 fotos); "5 fotos"/"o de 5" = pacote de 5;
 * "o de 49,90" = pelo preço; "o terceiro" = opção 3. Número por extenso sozinho
 * ("três") é ambíguo → confirmar com a cliente.
 */
export function escolhaDePacote(texto: string, precos: Preco[]): { preco: Preco; confirmar: boolean } | null {
  const ord = [...precos].sort((a, b) => a.pacote_qtd - b.pacote_qtd)
  // "ok, quero o 3" / "bueno, el 2": a confirmação na frente não atrapalha a escolha.
  const t = sem(texto).replace(/[️⃣]/g, '').trim().replace(/^(ok+|okay|ta bom|ta|bom|bueno|vale|dale|sim|si|beleza|perfeito|perfecto|claro)[\s,.!]+/, '')
  const porQtd = (n: number) => ord.find(p => p.pacote_qtd === n)
  const porOpcao = (n: number) => (n >= 1 && n <= ord.length ? ord[n - 1] : undefined)
  const certo = (p: Preco | undefined) => (p ? { preco: p, confirmar: false } : null)
  if (ord.length && /\b(mais completo|completao|o maior|maior pacote|o mais caro|todas as fotos|biggest|largest|the most|mas completo|el mayor|el mas grande)\b/.test(t)) return certo(ord[ord.length - 1])
  if (ord.length && /\b(mais barato|o menor|menor pacote|mais simples|basico|cheapest|smallest|mas barato|el menor|el mas chico)\b/.test(t)) return certo(ord[0])
  // preço: "49,90", "R$ 49.90", "o de 18,90"
  const preco = t.match(/(\d{1,4})[,.](\d{2})\b/)
  if (preco) return certo(ord.find(p => p.valor_cents === Number(preco[1]) * 100 + Number(preco[2])))
  const extenso = (w: string) => NUM_EXTENSO[w] ?? (/^\d{1,2}$/.test(w) ? Number(w) : undefined)
  // "5 fotos", "cinco fotos", "o de 5", "pacote de três"
  const fotos = t.match(/\b(\d{1,2}|[a-z]+)\s*(?:fotos?|photos?)\b/)
  if (fotos && extenso(fotos[1]) !== undefined) return certo(porQtd(extenso(fotos[1])!))
  const de = t.match(/\b(?:o|a|pacote|plano|el|the)?\s*(?:de|of)\s+(\d{1,2}|[a-z]+)\b/)
  if (de && extenso(de[1]) !== undefined && porQtd(extenso(de[1])!)) return certo(porQtd(extenso(de[1])!))
  for (const [w, n] of Object.entries(ORDINAL)) if (new RegExp(`\\b${w}\\b`).test(t)) return certo(porOpcao(n))
  const n = numeroDaOpcao(t)
  if (n !== null) return certo(porOpcao(n) ?? porQtd(n))
  // só o número por extenso ("três", "quero o cinco"): pode ser opção ou quantidade → confirma
  const palavra = t.split(/\s+/).length <= 4 ? t.match(/\b(um|uma|dois|duas|tres|quatro|cinco|dez|quinze|one|two|three|four|five|ten|fifteen|dos|cuatro|diez|quince)\b/) : null
  if (palavra) {
    const v = NUM_EXTENSO[palavra[1]]
    const p = porOpcao(v) ?? porQtd(v)
    return p ? { preco: p, confirmar: true } : null
  }
  if (t.split(/\s+/).length > 4) return null
  const solto = t.match(/^(?:quero|queria|vou de|pode ser|fico com|quiero|i want)?\s*(?:o|a|el)?\s*(\d{1,2})\b/)
  if (solto) { const p = porOpcao(Number(solto[1])) ?? porQtd(Number(solto[1])); return p ? { preco: p, confirmar: true } : null }
  return null
}

/**
 * Pediu uma QUANTIDADE que não existe ("quero 11 fotos", "pacote de 8") →
 * o número pedido, para a Ana dizer na hora o que existe (nunca trava).
 */
export function pacoteInexistente(texto: string, precos: Preco[]): number | null {
  const t = sem(texto)
  const m = t.match(/\b(\d{1,3})\s*(?:fotos?|photos?|poses?|imagens?|imagenes?)\b/) ?? t.match(/\b(?:pacote|plano|paquete|package)\s*(?:de|of|com|con)?\s*(\d{1,3})\b/)
  if (!m) return null
  const n = Number(m[1])
  return n > 0 && !precos.some(p => p.pacote_qtd === n) ? n : null
}

/** "opção 3 (10 fotos) ou opção 4 (15 fotos)" — os 2 pacotes mais próximos do pedido. */
export function opcoesProximas(n: number, precos: Preco[]): { opcao: number; preco: Preco }[] {
  const ord = [...precos].sort((a, b) => a.pacote_qtd - b.pacote_qtd).map((preco, i) => ({ opcao: i + 1, preco }))
  return [...ord].sort((a, b) => Math.abs(a.preco.pacote_qtd - n) - Math.abs(b.preco.pacote_qtd - n) || b.preco.pacote_qtd - a.preco.pacote_qtd)
    .slice(0, 2).sort((a, b) => a.opcao - b.opcao)
}

const QUER_PAGAR = /\b(quero pagar|como (eu )?pago|como faco (o|para|pra) pag|manda (o |a )?(pix|chave|link)|qual (e )?(o |a )?(pix|chave)|passa (o |a )?(pix|chave)|link de pagamento|pagar agora|ja quero pagar|forma de pagamento|how (do i|can i|to) pay|payment link|send (me )?the link|como pago|quiero pagar|link de pago|como puedo pagar)\b/
export function querPagar(texto: string): boolean { return QUER_PAGAR.test(sem(texto)) }

/** Compatível: só a escolha certa (sem precisar confirmar). */
export function pacoteDoTexto(texto: string, precos: Preco[]): Preco | null {
  const e = escolhaDePacote(texto, precos)
  return e && !e.confirmar ? e.preco : null
}

const NEGATIVO = /^(nao+|não|n|nop|nope|no|negativo|errado|outro|nah)\b/
export function negativo(texto: string): boolean { return NEGATIVO.test(sem(texto).trim()) }


/** Números de pose numa mensagem ("03, 12 e 45", "pose 7") → ['03','12','45','07']. */
export function posesDoTexto(texto: string): string[] {
  const nums = (texto.match(/\b\d{1,3}\b/g) ?? []).map(n => n.padStart(2, '0'))
  return [...new Set(nums)]
}

const NAO_E_NOME = /\b(quero|quiero|queria|quisiera|informac\w*|info|mais|mas|gostaria|gustaria|posso|puedo|saber|preco|precio|price|valor|quanto|cuanto|want|more|information|fotos?|ensaio|sesion|catalogo|ola|hola|oi|hello|hi|obrigad\w*|gracias|thanks|sim|si|yes|nao|no|ok|okay|okey|oki|vale|dale|bueno|listo|claro|perfecto|perfeito|beleza|blz|ta|certo|genial|bien|bom|boa|buenas|buenos|dias|tardes|noches)\b/

/** Nome do perfil do WhatsApp utilizável ("Dulce Encanto" → "Dulce"); null se não parecer nome de pessoa. */
export function nomeDoPerfil(perfil: string | null | undefined): string | null {
  const p = (perfil ?? '').replace(/[\p{Extended_Pictographic}\u200d\ufe0f]/gu, ' ').trim()
  const primeira = p.split(/\s+/)[0] ?? ''
  if (!/^[\p{L}'’-]{2,14}$/u.test(primeira)) return null
  if (/\b(mi|la|el|sr|sra|dona|dra|academia|assessoria|loja|studio|estudio|empresa|null|ramo|flor|flores|floreria|tienda|shop|store|boutique|salon|salao|beauty|bazar|kiosco|negocio|ventas|vendas|oficial)\b/.test(sem(primeira))) return null
  return primeira.charAt(0).toUpperCase() + primeira.slice(1).toLowerCase()
}

/** "meu nome é Maryana Silva" → "Maryana Silva". Vazio se não parecer nome. */
export function nomeDoTexto(texto: string): string | null {
  let t = texto.trim().replace(/[!.,;:]+$/g, '')
  t = t.replace(/^(?:oi+|ol[aá]|hola|hi|hello|hey|bom dia|boa tarde|boa noite|buenas)[,!\s]+/i, '')
  t = t.replace(/^(?:(?:o\s+)?meu nome [eé]|me chamo|sou (?:a|o)|eu sou|aqui [eé] (?:a|o)?|my name is|i'?m|i am|me llamo|mi nombre es|soy)\s+/i, '')
  if (!t || /\d|@|http/.test(t) || t.length > 40) return null
  // "¡Hola! Quiero más información" (texto pronto do anúncio) não é nome.
  if (NAO_E_NOME.test(sem(t))) return null
  const palavras = t.split(/\s+/).filter(Boolean).slice(0, 3)
  if (palavras.length === 0) return null
  return palavras.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

const AFIRMATIVO = /^(sim+|s|quero|pode( ser)?|claro|bora|vamos|ok|okay|yes|yeah|yep|sure|of course|si+|sí|vale|dale|bueno|buenisimo|bien|perfecto|genial|me parece|de una|isso|aceito|fechado|beleza|por favor|please)\b/
export function afirmativo(texto: string): boolean { return AFIRMATIVO.test(sem(texto).trim()) }

const PEDE_HUMANO = /\b(atendente|humano|human|pessoa real|persona real|real person|falar com (alguem|voce|uma pessoa)|hablar con (alguien|una persona)|talk to (someone|a person)|gerente|manager|reembolso|estorno|devolu(cao|ção)|refund|reclama|queja|complain|procon|processo|processar|advogad|abogad|lawyer|denunci|policia|police)\b/
// "e aí?" NÃO é pergunta sobre robô: "ia"/"ai" só contam em "é uma IA", "are you an AI"…
const PERGUNTA_ROBO = /\b(robo|bot|inteligencia artificial|automatic|humana|eres humana|are you (a |an )?(human|real|bot|ai)|(e|eh) (uma )?ia|uma ia|eres (una )?ia|an ai)\b/

export function pedeHumano(texto: string): boolean { return PEDE_HUMANO.test(sem(texto)) }
export function perguntaSeERobo(texto: string): boolean { return PERGUNTA_ROBO.test(sem(texto)) && /\?|voce|vc|eres|are you|e um|é um|é uma/.test(sem(texto)) }

/** Troca de idioma pedida pela cliente. */
export function idiomaPedido(texto: string): IdiomaAna | null {
  const t = sem(texto)
  if (/\b(in english|english please|speak english|ingles|inglês|english)\b/.test(t) && t.length < 40) return 'en'
  if (/\b(en espanol|en español|espanol|español|spanish|castellano)\b/.test(t) && t.length < 40) return 'es'
  if (/\b(em portugues|portugues|português|portuguese)\b/.test(t) && t.length < 40) return 'pt-BR'
  return null
}

/** Idioma de uma 1ª mensagem quando ela é CLARAMENTE de outro idioma. */
export function idiomaDaMensagem(texto: string): IdiomaAna | null {
  const t = ` ${sem(texto)} `
  const es = (t.match(/ (hola|buenas|buenos|gracias|quiero|quisiera|cuanto|cuesta|precio|fotos de|por favor|estoy|tengo) /g) ?? []).length
  const en = (t.match(/ (hello|hi|hey|thanks|thank|want|would|how much|price|please|the|photos|i'm|i am) /g) ?? []).length
  const pt = (t.match(/ (oi|ola|obrigad|quero|gostaria|quanto|custa|preco|voce|vc|tudo bem|bom dia|boa) /g) ?? []).length
  if (es > pt && es > en) return 'es'
  if (en > pt && en > es) return 'en'
  return null
}

// ── Máquina ─────────────────────────────────────────────────────────────────

const FALTA: Record<IdiomaAna, { rosto: string; corpo: string; ambas: string }> = {
  'pt-BR': { rosto: 'a foto do rosto', corpo: 'a foto de corpo inteiro', ambas: 'as 2 fotos (rosto e corpo inteiro)' },
  'pt-PT': { rosto: 'a foto do rosto', corpo: 'a foto de corpo inteiro', ambas: 'as 2 fotos (rosto e corpo inteiro)' },
  es: { rosto: 'la foto de la cara', corpo: 'la foto de cuerpo entero', ambas: 'las 2 fotos (cara y cuerpo entero)' },
  'es-ES': { rosto: 'la foto de la cara', corpo: 'la foto de cuerpo entero', ambas: 'las 2 fotos (cara y cuerpo entero)' },
  en: { rosto: 'the face photo', corpo: 'the full-body photo', ambas: 'the 2 photos (face and full body)' },
}

function explicarTema(tema: string): Acao[] {
  // Menos é mais (Supervisor): 1 áudio de explicação, o catálogo e a tabela.
  // As 2 fotos (A3) são pedidas na hora certa, depois do pacote.
  return [
    { t: 'audio', chave: 'a2' },
    { t: 'catalogo', tema },
    { t: 'texto', chave: 'tabela_precos' },
  ]
}

export function proximoPasso(etapa: Etapa, dadosIn: Dados, e: Entrada, ctx: Contexto): Resultado {
  const d: Dados = { ...dadosIn }
  const txt = (e.texto ?? '').trim()
  const fim = (proxima: Etapa, acoes: Acao[]): Resultado => ({ etapa: proxima, dados: d, acoes })

  // Humano: a Ana não fala.
  if (etapa === 'humano') return fim('humano', [])

  // Reação do WhatsApp nunca recebe resposta. "ok"/"obrigada"/👍 sem pergunta
  // pendente: no máximo uma reação ❤️ (1 a cada 10 min), nunca texto.
  if (e.tipo === 'reacao') return fim(etapa, [])
  if (semPerguntaPendente(etapa, d) && (ehConfirmacao(txt) || e.tipo === 'figurinha')) {
    const agora = ctx.agoraMs ?? Date.now()
    if (d.ultima_reacao_em && agora - new Date(d.ultima_reacao_em).getTime() < 10 * 60e3) return fim(etapa, [])
    d.ultima_reacao_em = new Date(agora).toISOString()
    return fim(etapa, [{ t: 'reagir', emoji: '❤️' }])
  }

  // "Depois te falo" / "vou pensar" / "te aviso": responde UMA vez e adia a retomada para 3 h.
  if (e.tipo === 'texto' && (pausaPedida(txt) || consultaAlguem(txt)) && !['inicio', 'humano', 'pago', 'conferindo', 'entregue', 'ajuste_detalhe'].includes(etapa)) {
    const agora = ctx.agoraMs ?? Date.now()
    const longa = consultaAlguem(txt)
    d.adiar_retomada_min = longa ? 20 * 60 : 180
    if (longa) d.pausa_longa = true
    if (d.pausa_em && agora - new Date(d.pausa_em).getTime() < 3 * 3600e3) return fim(etapa, [])
    d.pausa_em = new Date(agora).toISOString()
    return fim(etapa, [{ t: 'texto', chave: 'pausa_ok' }])
  }

  // ── Regras globais (valem em qualquer etapa) ─────────────────────────────
  if (e.tipo === 'texto' && pedeHumano(txt)) {
    return fim('humano', [{ t: 'texto', chave: 'humano' }, { t: 'humano', motivo: `pedido da cliente: "${txt.slice(0, 120)}"` }])
  }
  const novoIdioma = e.tipo === 'texto' ? idiomaPedido(txt) : null
  // "en español" com quem já é da Espanha não troca para o espanhol geral.
  if (novoIdioma && novoIdioma !== ctx.idioma && !(novoIdioma === 'es' && ctx.idioma === 'es-ES')) {
    return fim(etapa, [{ t: 'idioma', idioma: novoIdioma }, { t: 'texto', chave: 'idioma_trocado' }, ...repetirPergunta(etapa, d)])
  }
  if (e.tipo === 'texto' && perguntaSeERobo(txt)) {
    return fim(etapa, [{ t: 'texto', chave: 'sou_assistente' }, ...repetirPergunta(etapa, d)])
  }

  // "No entiendo" / "???" / "qqq": explica o passo com calma (nunca "não entendi").
  if (e.tipo === 'texto' && confusa(txt) && !['inicio', 'humano'].includes(etapa)) {
    const extra: Acao[] = d.pagamento_enviado && !ctx.pago && ['fotos_poses', 'idade_prefs'].includes(etapa)
      ? [{ t: 'texto', chave: pagaPelaHotmart(d) ? 'explica_pagamento_hotmart' : 'explica_pagamento_pix' }] : []
    const passo = d.pacote_confirmar ? [{ t: 'texto', chave: 'pacote_confirmar', vars: { qtd: d.pacote_confirmar, valor_cents: ctx.precos.find(x => x.pacote_qtd === d.pacote_confirmar)?.valor_cents ?? 0 } } as Acao]
      : etapa === 'pacote' ? [{ t: 'texto', chave: 'tabela_precos' } as Acao] : [...lembreteDaEtapa(etapa, d, ctx), ...repetirPergunta(etapa, d)].slice(0, 1)
    return fim(etapa, [{ t: 'texto', chave: 'explico_passo' }, ...passo, ...extra])
  }

  // Quer pagar já (escolheu o pacote, ainda mandando fotos/poses): manda o pagamento na hora.
  if (e.tipo === 'texto' && querPagar(txt) && ['fotos_poses', 'idade_prefs'].includes(etapa) && d.pacote_qtd && !ctx.pago) {
    const pag = acoesDePagamento(d, ctx)
    if (pag.length) { d.pagamento_enviado = true; return fim(etapa, [...pag, ...lembreteDaEtapa(etapa, d, ctx)]) }
  }

  // A cliente PEDIU a prévia ("tem prévia grátis?", "¿puedo ver una muestra?"): vale como aceite.
  if (e.tipo === 'texto' && pedePrevia(txt) && d.tema && !d.previa_feita && !ctx.pago && !['previa_fotos', 'conferindo', 'pago', 'entregue', 'ajuste_detalhe', 'inicio', 'nome', 'tema'].includes(etapa)) {
    d.previa_oferecida = true
  }

  // Aceitou a prévia oferecida na cobrança.
  // Vale também para quem já recebeu o Pix e sumiu: a prévia ajuda a fechar.
  if (d.previa_oferecida && !d.previa_feita && !ctx.pago && !['previa_fotos', 'conferindo', 'pago', 'entregue', 'ajuste_detalhe'].includes(etapa) && e.tipo === 'texto' && (afirmativo(txt) || pedePrevia(txt)) && d.tema) {
    d.etapa_antes_previa = etapa
    d.previa_oferecida = false
    d.poses_antes_previa = d.poses ?? []
    // Já tem as 2 fotos: só falta escolher 1 pose.
    const temFotos = !!ctx.fotos?.tem_rosto && !!ctx.fotos?.tem_corpo
    if (temFotos) { d.tem_rosto = true; d.tem_corpo = true }
    // As fotos chegaram ANTES de existir o pedido da prévia: copia para ele já.
    return fim('previa_fotos', [{ t: 'criar_pedido', tipo: 'previa' }, ...(temFotos ? [{ t: 'fotos_escolher' } as Acao] : []), { t: 'texto', chave: temFotos ? 'previa_pede_pose' : 'previa_pede_fotos' }])
  }

  // Prévia oferecida e a cliente responde MANDANDO A FOTO: é o "sim" — já começa a prévia.
  if (e.tipo === 'imagem' && d.previa_oferecida && !d.previa_feita && !ctx.pago && d.tema && (e.fotos?.novas ?? 0) > 0
    && !['previa_fotos', 'aguardando_pagamento', 'conferindo', 'pago', 'entregue', 'ajuste_detalhe'].includes(etapa)) {
    if (e.fotos?.recusada) return fim(etapa, [{ t: 'texto', chave: 'foto_recusada' }])
    if (e.fotos?.invalida) return fim(etapa, [{ t: 'texto', chave: 'foto_ruim', vars: { motivo: e.fotos.invalida } }])
    d.etapa_antes_previa = etapa
    d.previa_oferecida = false
    d.poses_antes_previa = d.poses ?? []
    d.tem_rosto = !!ctx.fotos?.tem_rosto; d.tem_corpo = !!ctx.fotos?.tem_corpo; d.rosto_recortado = !!ctx.fotos?.rosto_recortado
    const pronta = d.tem_rosto && d.tem_corpo
    return fim('previa_fotos', [
      { t: 'criar_pedido', tipo: 'previa' }, { t: 'fotos_escolher' },
      // Falta uma das fotos: diz qual (a pose é pedida quando as 2 chegarem).
      { t: 'texto', chave: pronta ? 'previa_pede_pose' : d.tem_rosto ? 'foto_rosto_ok' : 'foto_so_corpo' },
    ])
  }

  // Foto fora da etapa das fotos: o executor já guardou e classificou; aqui
  // só segue a pergunta da etapa atual (não vai pedir de novo depois).
  if (['imagem', 'video', 'documento', 'figurinha'].includes(e.tipo) && ['nome', 'tema', 'idade_sensual', 'pacote'].includes(etapa)) {
    // Foto antes da hora: guarda (o executor já classificou) e diz o que recebeu, sem perder o passo.
    if (e.tipo === 'imagem' && (e.fotos?.novas ?? 0) > 0 && !e.fotos?.recusada && !e.fotos?.invalida) {
      const f = ctx.fotos
      const chave = f?.tem_rosto && f?.tem_corpo && !f.rosto_recortado ? 'foto_cedo_ambas' : f?.tem_rosto && !f?.tem_corpo ? 'foto_cedo_rosto' : 'foto_cedo_corpo'
      return fim(etapa, [{ t: 'texto', chave }, ...lembreteCurto(etapa, d)])
    }
    return fim(etapa, lembreteCurto(etapa, d))
  }

  switch (etapa) {
    case 'inicio': {
      // Perguntar o nome logo de cara fazia muita gente de anúncio sumir:
      // com um nome de perfil usável, vai direto para os temas.
      const nome = nomeDoPerfil(ctx.nomePerfil)
      if (nome) {
        d.nome = nome
        return fim('tema', [{ t: 'texto', chave: 'boas_vindas' }, { t: 'audio', chave: 'a1' }, { t: 'menu_imagem' }, { t: 'texto', chave: 'menu', vars: { nome } }])
      }
      return fim('nome', [{ t: 'texto', chave: 'boas_vindas' }, { t: 'audio', chave: 'a1' }, { t: 'texto', chave: 'pede_nome' }])
    }

    case 'nome': {
      const nome = e.tipo === 'texto' ? nomeDoTexto(txt) : null
      if (!nome) return fim('nome', ia('nome', d, 'descobrir o nome da cliente'))
      d.nome = nome
      return fim('tema', [{ t: 'menu_imagem' }, { t: 'texto', chave: 'menu', vars: { nome } }])
    }

    case 'tema': {
      const r = e.tipo === 'texto' ? temaDoTexto(txt, ctx.temasAtivos) : null
      if (!r) return fim('tema', ia('tema', d, 'a cliente escolher um dos 4 temas (1 a 4)'))
      if ('outro' in r) return fim('tema', [{ t: 'texto', chave: 'outro_tema' }])
      d.tema = r.tema
      if (r.tema === 'sensual' && !(d.idade && d.idade >= 18)) return fim('idade_sensual', [{ t: 'texto', chave: 'sensual_idade' }])
      return fim('pacote', explicarTema(r.tema))
    }

    case 'idade_sensual': {
      const idade = e.tipo === 'texto' ? idadeDoTexto(txt) : null
      if (idade === null) return fim('idade_sensual', [{ t: 'texto', chave: 'idade_falta' }])
      d.idade = idade
      if (idade < 18) { d.tema = undefined; return fim('tema', [{ t: 'texto', chave: 'sensual_menor' }]) }
      return fim('pacote', explicarTema('sensual'))
    }

    case 'pacote': {
      // Pode querer trocar de tema antes de escolher o pacote.
      const trocaTema = e.tipo === 'texto' && numeroDaOpcao(txt) === null ? temaDoTexto(txt, ctx.temasAtivos) : null
      if (trocaTema && 'tema' in trocaTema && trocaTema.tema !== d.tema) {
        d.tema = trocaTema.tema
        if (trocaTema.tema === 'sensual' && !(d.idade && d.idade >= 18)) return fim('idade_sensual', [{ t: 'texto', chave: 'sensual_idade' }])
        return fim('pacote', explicarTema(trocaTema.tema))
      }
      // Esperando o "sim" do pacote entendido com dúvida.
      let p: Preco | null = null
      if (d.pacote_confirmar && e.tipo === 'texto') {
        const pend = ctx.precos.find(x => x.pacote_qtd === d.pacote_confirmar)
        if (afirmativo(txt) && pend) p = pend
        else if (negativo(txt)) { d.pacote_confirmar = undefined; return fim('pacote', [{ t: 'texto', chave: 'tabela_precos' }]) }
      }
      if (!p) {
        // Mandou número(s) de POSE em vez do pacote ("22"): anota e pede o pacote.
        const nPoses = e.tipo === 'texto' && d.tema ? posesDoTexto(txt) : []
        const validas = d.tema ? new Set(ctx.posesDoTema(d.tema)) : new Set<string>()
        if (nPoses.length && nPoses.every(n => validas.has(n)) && (nPoses.length > 1 || Number(nPoses[0]) > ctx.precos.length) && !/fotos?|photos?|pacote|paquete|package/.test(sem(txt))) {
          d.poses_cedo = [...new Set([...(d.poses_cedo ?? []), ...nPoses])]
          return fim('pacote', [{ t: 'texto', chave: 'poses_antes_pacote', vars: { poses: d.poses_cedo.join(', ') } }, { t: 'texto', chave: 'tabela_precos' }])
        }
        const esc = e.tipo === 'texto' ? escolhaDePacote(txt, ctx.precos) : null
        const pediu = !esc && e.tipo === 'texto' ? pacoteInexistente(txt, ctx.precos) : null
        if (pediu !== null) {
          const opcoes = opcoesProximas(pediu, ctx.precos).map(o => `${o.opcao}️⃣ ${o.preco.pacote_qtd}`).join(' · ')
          return fim('pacote', [{ t: 'texto', chave: 'pacote_inexistente', vars: { pedido: pediu, opcoes } }])
        }
        if (!esc) return fim('pacote', ia('pacote', d, 'a cliente escolher um pacote pelo número da opção (1 a 5)'))
        if (esc.confirmar) {
          d.pacote_confirmar = esc.preco.pacote_qtd
          return fim('pacote', [{ t: 'texto', chave: 'pacote_confirmar', vars: { qtd: esc.preco.pacote_qtd, valor_cents: esc.preco.valor_cents } }])
        }
        p = esc.preco
      }
      d.pacote_confirmar = undefined
      d.pacote_qtd = p.pacote_qtd; d.valor_cents = p.valor_cents; d.moeda = p.moeda
      d.pagar_link = p.link_pagamento ?? null; d.hotmart_link = null
      // Poses que ela já mandou antes de escolher o pacote continuam valendo.
      d.poses = (d.poses_cedo ?? []).slice(0, p.pacote_qtd); d.poses_cedo = undefined
      // Fotos que ela já mandou antes continuam valendo (não pede de novo).
      d.tem_rosto = !!ctx.fotos?.tem_rosto; d.tem_corpo = !!ctx.fotos?.tem_corpo
      const jaTemFotos = d.tem_rosto && d.tem_corpo
      // Escolheu o pacote = já recebe o pagamento (Pix ou link), junto do pedido das fotos/poses.
      const pagamento = acoesDePagamento(d, ctx)
      if (pagamento.length) d.pagamento_enviado = true
      return fim('fotos_poses', [
        { t: 'criar_pedido', tipo: 'pacote' },
        ...(jaTemFotos ? [{ t: 'fotos_escolher' } as Acao, { t: 'texto', chave: 'pede_poses', vars: { qtd: p.pacote_qtd } } as Acao]
          : [{ t: 'texto', chave: 'pede_fotos_poses', vars: { qtd: p.pacote_qtd } } as Acao]),
        // O catálogo ficou lá em cima na conversa: manda o link de novo (pede_poses já traz o link).
        ...(jaTemFotos ? [] : [{ t: 'texto', chave: 'catalogo_de_novo' } as Acao]),
        ...pagamento,
      ])
    }

    case 'fotos_poses':
    case 'previa_fotos': {
      const previa = etapa === 'previa_fotos'
      const qtd = previa ? 1 : (d.pacote_qtd ?? 0)
      const acoes: Acao[] = []

      // Comprovante no meio das fotos (o pagamento já foi enviado): confere na hora.
      const comprov = comprovanteNaColeta(etapa, d, e, ctx)
      if (comprov) return fim(etapa, comprov)
      if (e.tipo === 'video') return fim(etapa, [{ t: 'texto', chave: 'video_nao' }])
      if (e.tipo === 'figurinha') return fim(etapa, [{ t: 'texto', chave: 'figurinha_nao' }])
      if (e.tipo === 'documento') return fim(etapa, [{ t: 'texto', chave: 'documento_nao' }])

      // Resposta à oferta "1 = fico com as primeiras · 2 = pacote maior".
      if (d.troca_pacote && e.tipo === 'texto') {
        const op = numeroDaOpcao(txt)
        const quer = op === 2 || (op === null && (afirmativo(txt) || /\b(maior|todas|upgrade|bigger|all|mayor|todas)\b/.test(sem(txt))) && !negativo(txt))
        const fica = op === 1 || negativo(txt)
        if (quer) {
          const tr = d.troca_pacote
          d.pacote_qtd = tr.qtd; d.valor_cents = tr.valor_cents; d.moeda = tr.moeda; d.pagar_link = tr.link; d.poses = tr.poses
          d.troca_pacote = undefined
          acoes.push({ t: 'trocar_pacote' }, { t: 'texto', chave: 'pacote_trocado', vars: { qtd: tr.qtd, valor_cents: tr.valor_cents } })
          if (d.pagamento_enviado) acoes.push(...acoesDePagamento(d, ctx))
          return seguirColeta(etapa, d, acoes, ctx, previa)
        }
        if (fica) { d.troca_pacote = undefined; return seguirColeta(etapa, d, acoes, ctx, previa) }
      }

      if (e.tipo === 'imagem') {
        const antes = { rosto: !!d.tem_rosto, corpo: !!d.tem_corpo }
        d.tem_rosto = !!ctx.fotos?.tem_rosto; d.tem_corpo = !!ctx.fotos?.tem_corpo; d.rosto_recortado = !!ctx.fotos?.rosto_recortado
        if (e.fotos?.recusada && !(d.tem_rosto && d.tem_corpo)) return fim(etapa, [{ t: 'texto', chave: 'foto_recusada' }])
        const mudou = d.tem_rosto !== antes.rosto || d.tem_corpo !== antes.corpo
        if (mudou) acoes.push({ t: 'fotos_escolher' })
        if (d.tem_rosto && d.tem_corpo) {
          if (mudou || !antes.rosto || !antes.corpo) acoes.push({ t: 'texto', chave: ctx.fotos?.unica ? 'foto_unica_ok' : 'foto_corpo_ok' })
        } else if (e.fotos?.invalida && !mudou) {
          return fim(etapa, [{ t: 'texto', chave: 'foto_ruim', vars: { motivo: e.fotos.invalida } }])
        } else if (d.tem_rosto) acoes.push({ t: 'texto', chave: 'foto_rosto_ok' })
        else if (d.tem_corpo) acoes.push({ t: 'texto', chave: 'foto_so_corpo' })
      }

      // Números (no texto ou na legenda da foto).
      const nums = txt && !(e.tipo === 'imagem' && txt.startsWith('[')) ? posesDoTexto(txt) : []
      let falou = false
      if (nums.length > 0 && d.tema) {
        const validas = new Set(ctx.posesDoTema(d.tema))
        const invalidas = nums.filter(n => !validas.has(n))
        if (invalidas.length > 0) { acoes.push({ t: 'texto', chave: 'poses_invalidas', vars: { poses: invalidas.join(', ') } }); falou = true }
        else {
          const juntas = [...new Set([...(d.poses ?? []), ...nums])]
          if (juntas.length > qtd) {
            // Nunca trava: fica com as primeiras e, se existir, oferece o pacote que cabe todas.
            d.poses = juntas.slice(0, qtd)
            const maior = previa || ctx.pago ? undefined : [...ctx.precos].sort((a, b) => a.pacote_qtd - b.pacote_qtd).find(x => x.pacote_qtd >= juntas.length && x.pacote_qtd > qtd)
            if (maior) {
              d.troca_pacote = { qtd: maior.pacote_qtd, valor_cents: maior.valor_cents, moeda: maior.moeda, link: maior.link_pagamento ?? null, poses: juntas.slice(0, maior.pacote_qtd) }
              acoes.push({ t: 'texto', chave: 'poses_demais_maior', vars: { n: juntas.length, qtd, primeiras: d.poses.join(', '), prox_qtd: maior.pacote_qtd, valor_cents: maior.valor_cents } })
              falou = true
            } else acoes.push({ t: 'texto', chave: 'poses_demais_corte', vars: { n: juntas.length, qtd, primeiras: d.poses.join(', ') } })
          } else d.poses = juntas
        }
      } else if (e.tipo === 'texto' && txt) {
        acoes.push(...ia(etapa, d, `receber as 2 fotos e os números de ${qtd} pose(s)`))
        return fim(etapa, acoes)
      }

      if (falou) return fim(etapa, acoes)
      return seguirColeta(etapa, d, acoes, ctx, previa)
    }

    case 'idade_prefs': {
      const pergunta = proximaPreferencia(d)
      if (!pergunta) return fechar(d, [{ t: 'atualizar_pedido' }], ctx)
      const comprov = comprovanteNaColeta(etapa, d, e, ctx)
      if (comprov) return fim('idade_prefs', comprov)
      if (e.tipo !== 'texto') return fim('idade_prefs', [{ t: 'texto', chave: pergunta }])
      const capt = aplicarPreferencias(d, pergunta, txt, e.prefs ?? null)
      if (d.idade !== undefined && d.idade !== null && d.idade < 18) return fim('humano', [{ t: 'texto', chave: 'foto_recusada' }, { t: 'humano', motivo: `cliente informou idade ${d.idade}` }])
      if (!capt) return fim('idade_prefs', [{ t: 'texto', chave: pergunta === 'pref_idade' ? 'idade_falta' : pergunta }])
      const prox = proximaPreferencia(d)
      if (prox) return fim('idade_prefs', [{ t: 'atualizar_pedido' }, { t: 'texto', chave: prox }])
      return fechar(d, [{ t: 'atualizar_pedido' }], ctx)
    }

    case 'aguardando_pagamento':
      // Hotmart: a confirmação chega sozinha pelo webhook — nada de comprovante.
      if (pagaPelaHotmart(d)) {
        if (e.tipo === 'imagem' || e.tipo === 'documento' || (e.tipo === 'texto' && FALA_DE_PAGAMENTO.test(sem(txt)))) return fim('aguardando_pagamento', [{ t: 'texto', chave: 'hotmart_print' }])
        return fim('aguardando_pagamento', ia('aguardando_pagamento', d, 'a cliente pagar pelo link seguro da Hotmart (cartão, na moeda dela); a confirmação chega sozinha em alguns minutos', ctx))
      }
      if (e.tipo === 'imagem' || e.tipo === 'documento') return fim('aguardando_pagamento', [{ t: 'comprovante' }])
      if (e.tipo === 'texto' && FALA_DE_PAGAMENTO.test(sem(txt))) return fim('aguardando_pagamento', [{ t: 'texto', chave: ctx.pix ? 'pede_comprovante' : 'aguardando_pagamento' }])
      return fim('aguardando_pagamento', ia('aguardando_pagamento', d, ctx.pix
        ? 'a cliente pagar o Pix do valor do pedido e mandar o comprovante (imagem ou PDF) aqui'
        : 'tirar dúvidas; o pedido já está registrado e a forma de pagamento será enviada em seguida', ctx))

    case 'conferindo':
      if (e.tipo === 'imagem' || e.tipo === 'documento') return fim('conferindo', [{ t: 'comprovante' }])
      return fim('conferindo', [{ t: 'texto', chave: 'conferindo' }])

    case 'entregue':
    case 'ajuste_detalhe': {
      const ent = ctx.entrega
      // Foto com legenda ("essa aqui, o cabelo") conta como texto do ajuste.
      const comTexto = e.tipo === 'texto' || (e.tipo === 'imagem' && !!txt && !txt.startsWith('['))
      if (!comTexto || !ent) return fim(etapa, [{ t: 'texto', chave: 'entrega_ajuste' }])
      const t = sem(txt)
      // "+5 fotos com desconto" (resposta à oferta enviada na entrega)
      if (etapa === 'entregue' && (QUER_MAIS.test(t) || (d.upsell_oferecido && afirmativo(txt) && !AJUSTE.test(t)))) {
        d.upsell_oferecido = false
        d.pacote_qtd = ent.upsell_qtd; d.valor_cents = ent.upsell_valor_cents; d.moeda = ent.moeda
        d.poses = []; d.tem_rosto = true; d.tem_corpo = true
        return fim('fotos_poses', [{ t: 'upsell' }, { t: 'texto', chave: 'upsell_poses', vars: { qtd: ent.upsell_qtd } }])
      }
      const nums = fotosCitadas(txt, ent.poses)
      const descricao = txt.replace(/\b\d{1,3}\b/g, '').replace(/\b(foto|fotos|photo|photos|numero|número|n[ºo°]|a|o|e|and|y)\b/gi, '').replace(/[\s,.;:-]+/g, ' ').trim()
      // Elogio ("amei meu cabelo!") não é ajuste — a menos que venha com "mas"/"só que"/"não".
      const soElogio = ELOGIO.test(t) && !/\b(nao|não|no|mas|pero|but|so que|só que|porem|aunque|however)\b/.test(t)
      const falaDeAjuste = etapa === 'ajuste_detalhe' || ((AJUSTE.test(t) || nums.length > 0) && !soElogio)
      if (!falaDeAjuste) return fim(etapa, [{ t: 'ia', objetivo: 'pós-venda: o ensaio já foi entregue; ajuste grátis em até 24 h dizendo o número da foto e o que mudar; oferta de mais fotos com desconto' }])
      if (!ent.pode_ajustar) return fim('entregue', [{ t: 'texto', chave: 'ajuste_expirado' }, { t: 'humano', motivo: 'cliente pediu ajuste fora do prazo/limite' }])
      const poses = nums.length ? nums : (d.ajuste_poses ?? [])
      if (poses.length === 0) return fim('ajuste_detalhe', [{ t: 'texto', chave: 'ajuste_pede_numero' }])
      if (descricao.length < 4 || (nums.length > 0 && !AJUSTE.test(t) && descricao.length < 8)) {
        d.ajuste_poses = poses
        return fim('ajuste_detalhe', [{ t: 'texto', chave: 'ajuste_pede_o_que', vars: { poses: poses.join(', ') } }])
      }
      d.ajuste_poses = undefined
      return fim('pago', [{ t: 'ajuste', poses, obs: txt.slice(0, 500) }, { t: 'texto', chave: 'ajuste_registrado', vars: { poses: poses.join(', ') } }])
    }

    case 'pago':
      if (e.tipo !== 'texto') return fim('pago', [{ t: 'texto', chave: 'pedido_pago_duvida' }])
      return fim('pago', [{ t: 'ia', objetivo: 'tirar dúvidas; o pedido já está PAGO e na fila de produção (não peça pagamento de novo)' }])
  }
  return fim(etapa, [])
}

const AJUSTE = /\b(ajust|mud[ae]|mudar|trocar|troca|refaz|refazer|corrig|arrum|ajeit|melhor|retoc|modific|alter|edit|tirar|tira |colocar|deixar mais|deixa mais|mais (magra|jovem|nova|clara|escura|bonita|natural)|menos (gorda|velha|maquiagem)|nao gostei|nao ficou|ficou estranh|ficou feio|ficou diferente|nao parece|nao sou eu|nao pareco|diferente de mim|cabelo|olho|nariz|boca|sorriso|dente|rosto|pele|maquiagem|roupa|vestido|fundo|mao|maos|dedo|change|fix|redo|adjust|edit|retouch|doesn'?t look like me|not me|cambiar|cambia|arreglar|arregla|retocar|mejorar|modificar|corregir|no me gust|no se parece|no soy yo|no parezco|pelo|ojos|nariz|cara|piel|maquillaje|ropa|fondo|manos)/

const ELOGIO = /\b(amei|adorei|ameii+|lind[ao]s?|perfeit[ao]s?|maravilh\w*|incrivel|me encant\w*|hermos[ao]s?|precios[ao]s?|me gusto|me gustaron|love it|loved|beautiful|amazing|perfect)\b/

const ORD_FOTO: Record<string, number> = { primeira: 1, primeiro: 1, segunda: 2, segundo: 2, terceira: 3, terceiro: 3, quarta: 4, quarto: 4, quinta: 5, quinto: 5, sexta: 6, setima: 7, oitava: 8, nona: 9, decima: 10, primera: 1, tercera: 3, cuarta: 4, first: 1, second: 2, third: 3, fourth: 4, fifth: 5 }

/**
 * Fotos citadas no pedido de ajuste: o número da POSE (07) se ela estiver no
 * pedido; senão a POSIÇÃO na entrega ("foto 2", "a segunda", "la última",
 * "todas") — a cliente não sabe o número da pose, sabe a ordem em que recebeu.
 */
export function fotosCitadas(texto: string, poses: string[]): string[] {
  const t = sem(texto)
  const diretas = posesDoTexto(texto).filter(n => poses.includes(n))
  if (diretas.length) return diretas
  if (/\b(todas|todos|all of them|all photos|all the photos)\b/.test(t)) return [...poses]
  const out: string[] = []
  for (const m of t.matchAll(/\b(\d{1,2})\b/g)) { const i = Number(m[1]); if (i >= 1 && i <= poses.length) out.push(poses[i - 1]) }
  for (const [w, i] of Object.entries(ORD_FOTO)) if (new RegExp(`\\b${w}\\b`).test(t) && i <= poses.length) out.push(poses[i - 1])
  if (/\b(ultima|ultimo|last)\b/.test(t) && poses.length) out.push(poses[poses.length - 1])
  if (poses.length === 1 && !out.length && /\b(foto|photo|essa|esta|ela|that|this)\b/.test(t)) out.push(poses[0])
  return [...new Set(out)]
}
const QUER_MAIS = /(\+\s*\d+\s*fotos?|mais \d+ fotos|quero mais|mais fotos|more photos|\d+ more|quiero mas|mas fotos)/

/** Cliente internacional: pacote em outra moeda com link da Hotmart. */
export function pagaPelaHotmart(d: Dados): boolean {
  return (d.moeda ?? 'BRL') !== 'BRL' && !!(d.pagar_link || d.hotmart_link)
}

const FALA_DE_PAGAMENTO = /\b(paguei|ja paguei|pago|pagamento|pix|comprovante|transferi|fiz a transferencia|i paid|paid|pague|ya pague)\b/

/** Pagamento do pacote escolhido: Pix (Brasil) ou link da Hotmart (fora). Vazio se não houver forma cadastrada. */
function acoesDePagamento(d: Dados, ctx: Contexto): Acao[] {
  if (ctx.pix && (d.moeda ?? 'BRL') === 'BRL') return [{ t: 'fechar_pedido', tipo: 'pacote' }, { t: 'texto', chave: 'pagar_ja' }, { t: 'pix' }, { t: 'audio', chave: 'a5' }]
  if (pagaPelaHotmart(d)) return [{ t: 'fechar_pedido', tipo: 'pacote' }, { t: 'hotmart', chave: 'hotmart_link_coleta' }]
  return []
}

/** Imagem/PDF que NÃO é foto de pessoa, depois do pagamento enviado = comprovante. */
function comprovanteNaColeta(etapa: Etapa, d: Dados, e: Entrada, ctx: Contexto): Acao[] | null {
  if (!d.pagamento_enviado || ctx.pago || etapa === 'previa_fotos') return null
  const naoEPessoa = e.tipo === 'documento' || (e.tipo === 'imagem' && !!e.fotos?.invalida && !e.fotos?.recusada)
  if (!naoEPessoa) return null
  if (pagaPelaHotmart(d)) return [{ t: 'texto', chave: 'hotmart_print' }, ...lembreteDaEtapa(etapa, d, ctx).filter(a => !(a.t === 'texto' && a.chave === 'hotmart_lembrete'))]
  return [{ t: 'comprovante' }]
}

/** Depois de anotar fotos/poses: pergunta o que falta ou avança (preferências → fechamento). */
function seguirColeta(etapa: Etapa, d: Dados, acoes: Acao[], ctx: Contexto, previa: boolean): Resultado {
  const qtd = previa ? 1 : (d.pacote_qtd ?? 0)
  // A frase da foto ("Recebi a do rosto ✅ Falta só a de corpo") já diz o que falta de foto.
  const jaDisseFoto = acoes.some(a => a.t === 'texto' && ['foto_rosto_ok', 'foto_so_corpo'].includes(a.chave))
  const faltaReal = oQueFalta(d, qtd, ctx)
  const falta = faltaReal.filter(a => !(jaDisseFoto && a.t === 'texto' && a.chave === 'lembrete_fotos'))
  if (faltaReal.length) return { etapa, dados: d, acoes: [...acoes, ...falta] }

  // Garante rosto.jpg/corpo.jpg no pedido antes de fechar (fotos podem ter vindo antes dele).
  if (!acoes.some(a => a.t === 'fotos_escolher')) acoes.push({ t: 'fotos_escolher' })
  // As poses vão FIXAS na ação: na prévia, `d.poses` volta a ser a do pacote logo abaixo
  // (antes da ação rodar) — sem isso a prévia ia para a fila sem a pose escolhida.
  acoes.push({ t: 'atualizar_pedido', poses: [...(d.poses ?? [])] })
  if (previa) {
    d.previa_feita = true
    const volta = d.etapa_antes_previa ?? 'pacote'
    d.etapa_antes_previa = undefined
    // Volta a venda como estava (as poses do pacote não se perdem).
    d.poses = d.poses_antes_previa ?? []
    d.poses_antes_previa = undefined
    // Enquanto a prévia não chega, nada de tabela/retomada (ela vem com o convite para o pacote).
    d.aguardando_previa = true
    return { etapa: volta, dados: d, acoes: [...acoes, { t: 'fechar_pedido', tipo: 'previa' }, { t: 'texto', chave: 'previa_na_fila' }] }
  }
  // Toda transição já manda a pergunta da etapa nova (preferências, uma por vez).
  const prox = proximaPreferencia(d)
  if (!prox) return fechar(d, acoes, ctx)
  return { etapa: 'idade_prefs', dados: d, acoes: [...acoes, { t: 'texto', chave: prox }] }
}

function fechar(d: Dados, acoes: Acao[], ctx: Contexto): Resultado {
  // Já pagou antes de mandar tudo: vai direto para a fila.
  if (ctx.pago) return { etapa: 'pago', dados: d, acoes: [...acoes, { t: 'fila' }, { t: 'texto', chave: 'tudo_certo_producao' }] }
  const fechamento: Acao[] = [...acoes, { t: 'fechar_pedido', tipo: 'pacote' }, { t: 'texto', chave: 'resumo_pedido' }]
  // O pagamento já foi enviado na escolha do pacote: só lembra (sem repetir a chave/link).
  if (d.pagamento_enviado) {
    fechamento.push(pagaPelaHotmart(d) ? { t: 'texto', chave: 'hotmart_lembrete' } : { t: 'texto', chave: 'pede_comprovante' })
    return { etapa: 'aguardando_pagamento', dados: d, acoes: fechamento }
  }
  // Brasil: a Ana manda a chave Pix + o valor exato e pede o comprovante.
  if (ctx.pix && (d.moeda ?? 'BRL') === 'BRL') fechamento.push({ t: 'pix' }, { t: 'audio', chave: 'a5' }, { t: 'texto', chave: 'pede_comprovante' })
  // Fora do Brasil: link da Hotmart com o pedido (sck) no lugar do Pix.
  else if (pagaPelaHotmart(d)) fechamento.push({ t: 'hotmart' })
  return { etapa: 'aguardando_pagamento', dados: d, acoes: fechamento }
}

/** Lembrete do que a etapa pede (depois de trocar idioma ou responder "é robô?"). */
export function repetirPergunta(etapa: Etapa, d: Dados): Acao[] {
  switch (etapa) {
    case 'inicio': case 'nome': return [{ t: 'texto', chave: 'pede_nome' }]
    case 'tema': return [{ t: 'texto', chave: 'menu', vars: { nome: d.nome ?? '' } }]
    case 'idade_sensual': return [{ t: 'texto', chave: 'sensual_idade' }]
    case 'pacote': return [{ t: 'texto', chave: 'tabela_precos' }]
    case 'fotos_poses': return [{ t: 'texto', chave: 'pede_fotos_poses', vars: { qtd: d.pacote_qtd ?? '' } }]
    case 'previa_fotos': return [{ t: 'texto', chave: 'previa_pede_fotos' }]
    case 'idade_prefs': { const p = proximaPreferencia(d); return p ? [{ t: 'texto', chave: p }] : [] }
    case 'aguardando_pagamento': return [{ t: 'texto', chave: 'pede_comprovante' }]
    default: return []
  }
}

/** Dúvida livre: a IA responde e o SISTEMA repete, curto, o que a etapa espera. */
function ia(etapa: Etapa, d: Dados, objetivo: string, ctx?: Contexto): Acao[] {
  return [{ t: 'ia', objetivo }, ...lembreteDaEtapa(etapa, d, ctx)]
}

export function lembreteDaEtapa(etapa: Etapa, d: Dados, ctx?: Contexto): Acao[] {
  switch (etapa) {
    case 'nome': return [{ t: 'texto', chave: 'lembrete_nome' }]
    case 'tema': return [{ t: 'texto', chave: 'lembrete_tema' }]
    case 'pacote': return [{ t: 'texto', chave: 'pacote_de_novo' }]
    case 'fotos_poses': case 'previa_fotos': {
      const qtd = etapa === 'previa_fotos' ? 1 : (d.pacote_qtd ?? 0)
      return oQueFalta(d, qtd, ctx).slice(0, 1)
    }
    case 'idade_prefs': return repetirPergunta(etapa, d)
    case 'aguardando_pagamento':
      if (pagaPelaHotmart(d)) return [{ t: 'texto', chave: 'hotmart_lembrete' }]
      return ctx?.pix ? [{ t: 'texto', chave: 'pede_comprovante' }] : []
    default: return []
  }
}

/** O que ainda falta nas fotos/poses — SEMPRE uma pergunta clara (nunca para calado). */
function oQueFalta(d: Dados, qtd: number, ctx?: Contexto): Acao[] {
  const poses = d.poses ?? []
  const f = FALTA[ctx?.idioma ?? 'pt-BR']
  const faltaFoto = !d.tem_rosto && !d.tem_corpo ? f.ambas : !d.tem_rosto ? f.rosto : !d.tem_corpo ? f.corpo : null
  if (faltaFoto && poses.length >= qtd) return [{ t: 'texto', chave: 'falta_foto', vars: { faltam: faltaFoto } }]
  if (!faltaFoto && poses.length === 0) return [{ t: 'texto', chave: 'pede_poses', vars: { qtd } }]
  if (!faltaFoto && poses.length < qtd) return [{ t: 'texto', chave: 'poses_faltam', vars: { poses: poses.join(', '), faltam: qtd - poses.length } }]
  if (faltaFoto && poses.length > 0) return [{ t: 'texto', chave: 'poses_faltam', vars: { poses: poses.join(', '), faltam: qtd - poses.length } }, { t: 'texto', chave: 'lembrete_fotos', vars: { faltam: faltaFoto } }]
  if (faltaFoto) return [{ t: 'texto', chave: 'lembrete_fotos', vars: { faltam: faltaFoto } }]
  return []
}

// ── Preferências: perguntas curtas, uma por vez ─────────────────────────────

export const PREFS_ORDEM = ['pref_maquiagem', 'pref_decote', 'pref_cores', 'pref_idade'] as const
export function proximaPreferencia(d: Dados): (typeof PREFS_ORDEM)[number] | null {
  if (d.maquiagem === undefined || d.maquiagem === null) return 'pref_maquiagem'
  if (d.decote === undefined || d.decote === null) return 'pref_decote'
  if (d.cores === undefined) return 'pref_cores'
  if (!d.idade) return 'pref_idade'
  return null
}

const ASSUNTO: Record<'maquiagem' | 'decote', RegExp> = { maquiagem: /\b(maquiagem|maquilhagem|make|maquillaje|makeup)\b/, decote: /\b(decote|escote|neckline|low.?cut)\b/ }

/**
 * Sim/não PARA UM ASSUNTO: "sem decote" responde o decote, não a maquiagem.
 * "sim"/"não" soltos valem para a pergunta atual.
 */
const SIM_NAO = (t: string, alvo: 'maquiagem' | 'decote'): boolean | null => {
  const s = sem(t).trim()
  const outro = alvo === 'maquiagem' ? ASSUNTO.decote : ASSUNTO.maquiagem
  const esse = ASSUNTO[alvo]
  if (new RegExp(`\\b(sem|nao|não|nada de)\\s+(quero\\s+)?${esse.source.slice(2, -2)}`).test(s)) return false
  if (new RegExp(`\\b(com|quero|sim,?)\\s+${esse.source.slice(2, -2)}`).test(s)) return true
  if (outro.test(s) && !esse.test(s)) return null          // falou só do outro assunto
  if (/^(nao+|não|n|nop|no|nunca|dispenso|sem|nenhum|nada)\b/.test(s)) return false
  if (/^(sim+|s|quero|pode|claro|ok|okay|yes|si|sí|com|bora|isso|adoro|amo|uhum|aham)\b/.test(s)) return true
  return null
}

/**
 * Preenche o que a resposta trouxe. A IA (prefs) separa vários campos de uma
 * vez ("42 loiros sem decote" → idade 42 · decote não); sem IA, o óbvio da
 * pergunta atual. Devolve se capturou algo.
 */
export function aplicarPreferencias(d: Dados, pergunta: string, txt: string, prefs: Entrada['prefs']): boolean {
  let capt = false
  const set = <K extends keyof Dados>(k: K, v: Dados[K]) => { if (v !== null && v !== undefined) { d[k] = v; capt = true } }
  if (prefs) {
    if (prefs.maquiagem !== null) set('maquiagem', prefs.maquiagem)
    if (prefs.decote !== null) set('decote', prefs.decote)
    if (prefs.cores_acessorios) set('cores', prefs.cores_acessorios)
    if (prefs.idade) set('idade', prefs.idade)
    if (prefs.cabelo_mudar) set('cabelo', prefs.cabelo_mudar)
  }
  // Cada assunto citado vale onde for ("sem decote" na pergunta da maquiagem já responde o decote).
  for (const alvo of ['maquiagem', 'decote'] as const) {
    if (d[alvo] !== undefined && d[alvo] !== null) continue
    const v = SIM_NAO(txt, alvo)
    const citou = ASSUNTO[alvo].test(sem(txt))
    if (v !== null && (citou || pergunta === `pref_${alvo}`)) set(alvo, v)
  }
  const sn = SIM_NAO(txt, 'maquiagem')
  if (pergunta === 'pref_cores' && d.cores === undefined && txt.trim()) {
    const livre = /\b(pode escolher|voce escolhe|tanto faz|qualquer|nao tenho|nenhum|nenhuma|nada|you choose|puedes elegir|da igual)\b/.test(sem(txt))
    set('cores', livre || sn === false ? 'a critério do estúdio' : txt.trim().slice(0, 200))
  }
  if (!d.idade) { const i = idadeDoTexto(txt); if (i) set('idade', i) }
  d.preferencias = [
    d.maquiagem === true ? 'com maquiagem' : d.maquiagem === false ? 'sem maquiagem' : null,
    d.decote === true ? 'com decote' : d.decote === false ? 'sem decote' : null,
    d.cores ? `cores/acessórios: ${d.cores}` : null,
  ].filter(Boolean).join(' · ') || null
  return capt
}

/** Etapas em que a Ana NÃO está esperando resposta (confirmação solta não recebe texto). */
export function semPerguntaPendente(etapa: Etapa, d: Dados): boolean {
  if (['pago', 'conferindo'].includes(etapa)) return true
  // Na venda, "ok"/👍 não responde nome/tema/pacote/poses: não repete a pergunta (evita ok ↔ Ana sem fim).
  // Pergunta de sim/não pendente (pacote a confirmar, prévia oferecida, pacote maior) → "ok" vale como SIM.
  if (['nome', 'tema', 'pacote', 'fotos_poses', 'previa_fotos'].includes(etapa)) return !d.pacote_confirmar && !d.previa_oferecida && !d.troca_pacote
  if (etapa === 'aguardando_pagamento') return true      // espera comprovante, não "ok"
  if (etapa === 'entregue') return !d.upsell_oferecido
  return false
}

const SO_CONFIRMACAO = /^(ok+|okay|okk+|blz|beleza|ta|ta bom|certo|certinho|show|top|perfeito|otimo|obrigad[ao]s?|obg|brigad[ao]|valeu|vlw|tmj|combinado|entendi|entendido|ah ok|aham|uhum|thanks?|thank you|ty|gracias|perfecto|genial)[\s!.…]*$/
const SO_EMOJI = /^[\p{Extended_Pictographic}\u200d\ufe0f\s]+$/u
export function ehConfirmacao(texto: string): boolean {
  const t = (texto ?? '').trim()
  if (!t) return false
  return SO_CONFIRMACAO.test(sem(t)) || (SO_EMOJI.test(t) && !/\d/.test(t))
}

// ── Cobranças (seção 5): 10 min, 30 min, 3 h — no máximo 3, só na janela ────

export const ETAPAS_SEM_COBRANCA: Etapa[] = ['inicio', 'humano', 'conferindo', 'pago', 'entregue', 'ajuste_detalhe']

export function cobrancaDevida(c: {
  etapa: Etapa; modo: string; cobrancas: number; janela_ate: string | null
  aguardando_desde: string | null; ultima_cliente_em: string | null; tema?: string | null; previa_feita?: boolean; aguardando_previa?: boolean
}, agora: Date = new Date()): 'cobranca_1' | 'cobranca_2' | 'cobranca_3' | null {
  if (c.aguardando_previa) return null
  if (c.modo !== 'ana' || ETAPAS_SEM_COBRANCA.includes(c.etapa) || c.cobrancas >= 3) return null
  if (!c.janela_ate || new Date(c.janela_ate).getTime() <= agora.getTime()) return null
  if (!c.aguardando_desde) return null
  if (c.ultima_cliente_em && new Date(c.ultima_cliente_em).getTime() > new Date(c.aguardando_desde).getTime()) return null
  const min = (agora.getTime() - new Date(c.aguardando_desde).getTime()) / 60000
  if (c.cobrancas === 0 && min >= 10) return 'cobranca_1'
  if (c.cobrancas === 1 && min >= 30) {
    // A prévia só faz sentido com tema escolhido e antes de ter pedido fechado.
    const podePrevia = !!c.tema && !c.previa_feita && c.etapa !== 'aguardando_pagamento'
    // Quem já recebeu o Pix ganha uma 2ª retomada (dúvida); a prévia fica para o fim.
    return podePrevia ? 'cobranca_2' : c.etapa === 'aguardando_pagamento' ? 'cobranca_2' : (min >= 180 ? 'cobranca_3' : null)
  }
  if (c.cobrancas === 2 && min >= 180) return 'cobranca_3'
  return null
}

/**
 * O que a Ana manda em cada retomada, conforme ONDE a conversa parou:
 * 1ª "e aí, já viu?" da etapa (com o link do catálogo / o valor do Pix);
 * 2ª prévia grátis (antes do Pix) ou "ficou alguma dúvida?" (depois);
 * 3ª prévia grátis como última cartada se ainda não fez, senão a vaga reservada.
 */
export function mensagensDaRetomada(chave: 'cobranca_1' | 'cobranca_2' | 'cobranca_3', etapa: Etapa, dIn: Dados, opts: { semPrevia?: boolean } = {}): { chaves: string[]; oferecePrevia: boolean; encerrar?: boolean } {
  // Espanha: a prévia grátis NÃO é oferecida (só se a cliente pedir) — as retomadas viram dúvida/link.
  const d: Dados = opts.semPrevia ? { ...dIn, previa_feita: true } : dIn
  // Prévia na fila: nada até ela ser entregue. Foi consultar a família: 1 mensagem suave e para.
  if (d.aguardando_previa) return { chaves: [], oferecePrevia: false }
  if (d.pausa_longa) return { chaves: ['rmk_suave'], oferecePrevia: false, encerrar: true }
  const r = mensagensDaRetomadaBase(chave, etapa, d)
  // Nunca a mesma retomada 2× na conversa: a repetida vira "ficou alguma dúvida?" (e essa, só 1×).
  const ja = new Set(d.retomadas ?? [])
  const chaves = r.chaves.map(k => (ja.has(k) && k !== 'hotmart_lembrete' ? (ja.has('rmk_duvida') ? '' : 'rmk_duvida') : k)).filter(Boolean)
  return { ...r, chaves }
}

function mensagensDaRetomadaBase(chave: 'cobranca_1' | 'cobranca_2' | 'cobranca_3', etapa: Etapa, d: Dados): { chaves: string[]; oferecePrevia: boolean } {
  const pagamento = etapa === 'aguardando_pagamento'
  const podePrevia = !!d.tema && !d.previa_feita
  if (chave === 'cobranca_1') {
    const k = pagamento ? 'rmk_pagamento'
      : ['fotos_poses', 'idade_prefs', 'previa_fotos'].includes(etapa) ? 'rmk_coleta'
      : ['pacote', 'idade_sensual'].includes(etapa) ? 'rmk_pacote'
      : etapa === 'tema' ? 'rmk_tema' : 'cobranca_1'
    return { chaves: pagamento && pagaPelaHotmart(d) ? ['rmk_duvida', 'hotmart_lembrete'] : [k], oferecePrevia: false }
  }
  if (chave === 'cobranca_2') {
    if (!pagamento && podePrevia) return { chaves: ['cobranca_2'], oferecePrevia: true }
    return { chaves: pagamento && pagaPelaHotmart(d) ? ['rmk_duvida', 'hotmart_lembrete'] : ['rmk_duvida'], oferecePrevia: false }
  }
  if (podePrevia) return { chaves: ['rmk_previa_final'], oferecePrevia: true }
  return { chaves: ['cobranca_3'], oferecePrevia: false }
}

const CONFUSA = /^(\?+|q+\?*|que\?+|qu[eé]\?*|como\?+|hein\?*|ahn\?*|what\?*|huh\?*)$|\b(no entiendo|no entendi|nao entendi|não entendi|nao entendo|não entendo|como assim|no comprendo|i don'?t understand|don'?t get it|confus[ao]|perdid[ao]|lost)\b/
export function confusa(texto: string): boolean { return CONFUSA.test(sem(texto).trim()) }

/** Lembrete curto (sem reenviar a tabela inteira): "me manda só o número do pacote". */
function lembreteCurto(etapa: Etapa, d: Dados): Acao[] {
  if (etapa === 'pacote') return [{ t: 'texto', chave: 'pacote_de_novo' }]
  return repetirPergunta(etapa, d)
}

const PAUSA = /\b(depois (eu )?(te )?(falo|chamo|vejo|respondo|mando|aviso)|falo (contigo|com voce) depois|vou pensar|vou ver( e te (falo|aviso))?|te aviso|te dou retorno|mais tarde (eu )?(te )?(falo|chamo|vejo)?|amanha (eu )?(te )?(falo|chamo|vejo|mando|aviso)|agora nao (posso|da)|estou ocupad[ao]|despues (te )?(hablo|escribo|aviso|veo|respondo)|luego (te )?(hablo|escribo|aviso)|lo (voy a )?pens\w*|te aviso|mas tarde|manana te (hablo|escribo|aviso)|ahora no puedo|estoy ocupad[ao]|i'?ll (think|let you know|get back)|let me think|talk (to you )?later|later today|not now|busy now)\b/
/** "Depois te falo", "vou pensar", "te aviso", "luego te escribo" — e sem pergunta/escolha junto. */
const CONSULTA = /\b(vou (falar|conversar|ver) com (a |o |minha |meu )?(filha|filho|marido|esposa|esposo|mae|mãe|pai|familia|família|neta|neto|irma|irmã|amiga)|vou consultar|vou perguntar (pra|para|a)|(voy a |tengo que )?(hablar|consultar|preguntar)(le)? (con|a) (mi |la |el )?(hija|hijo|marido|esposo|esposa|mama|mamá|madre|papa|papá|familia|nieta|nieto|hermana|amiga)|lo consulto|lo hablo con|i'?ll (ask|talk to|check with) my|talk to my (husband|wife|daughter|son|family))\b/
/** Vai consultar alguém / se despedindo para decidir com a família: retomada só no dia seguinte, suave. */
export function consultaAlguem(texto: string): boolean { return CONSULTA.test(sem(texto)) }

export function pausaPedida(texto: string): boolean {
  const t = sem(texto).trim()
  return PAUSA.test(t) && !/\?|\d/.test(t) && t.split(/\s+/).length <= 12
}

const PEDE_PREVIA = /\b(previa|preview|amostra|muestra|demo|prueba gratis|teste gratis|foto de teste|foto de prueba|ver como (fica|queda)|ver como quedaria|ver uma antes|ver una antes)\b/
/** A cliente pede para ver uma prévia/amostra antes de comprar. */
export function pedePrevia(texto: string): boolean { return PEDE_PREVIA.test(sem(texto)) }

