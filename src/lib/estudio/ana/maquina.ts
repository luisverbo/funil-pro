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
  | 'idade_prefs' | 'aguardando_pagamento' | 'conferindo' | 'pago' | 'previa_fotos' | 'humano'

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
  /** Quando a Ana fez a última pergunta (base das cobranças). */
  aguardando_desde?: string
}

export interface Entrada {
  tipo: string               // texto | imagem | video | audio | documento | figurinha | localizacao | outro
  texto: string
  /** Resultado da conferência da foto (o executor roda a visão antes). */
  foto?: 'ok' | 'ruim' | 'recusada'
}

export interface Preco { pacote_qtd: number; valor_cents: number; moeda: string }

export interface Contexto {
  idioma: IdiomaAna
  precos: Preco[]
  /** Números de pose ATIVOS por tema. */
  posesDoTema: (slug: string) => string[]
  temasAtivos: string[]
  /** Pix por comprovante disponível (Brasil, chave cadastrada). */
  pix?: boolean
}

export type Acao =
  | { t: 'texto'; chave: string; vars?: Record<string, string | number> }
  | { t: 'audio'; chave: string }
  | { t: 'menu_imagem' }
  | { t: 'catalogo'; tema: string }
  | { t: 'criar_pedido'; tipo: 'pacote' | 'previa' }
  | { t: 'guardar_foto'; papel: 'rosto' | 'corpo' | 'extra' }
  | { t: 'atualizar_pedido' }
  | { t: 'fechar_pedido'; tipo: 'pacote' | 'previa' }
  | { t: 'ia'; objetivo: string }
  | { t: 'humano'; motivo: string }
  | { t: 'idioma'; idioma: IdiomaAna }
  | { t: 'pix' }
  | { t: 'comprovante' }

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

/** Pacote: opção 1–N da tabela OU "5 fotos"/"10" igual a uma quantidade. */
export function pacoteDoTexto(texto: string, precos: Preco[]): Preco | null {
  const ord = [...precos].sort((a, b) => a.pacote_qtd - b.pacote_qtd)
  const fotos = sem(texto).match(/(\d{1,2})\s*(?:fotos?|photos?)/)
  if (fotos) return ord.find(p => p.pacote_qtd === Number(fotos[1])) ?? null
  const n = numeroDaOpcao(texto)
  if (n === null) return null
  if (n >= 1 && n <= ord.length) return ord[n - 1]
  return ord.find(p => p.pacote_qtd === n) ?? null
}

/** Números de pose numa mensagem ("03, 12 e 45", "pose 7") → ['03','12','45','07']. */
export function posesDoTexto(texto: string): string[] {
  const nums = (texto.match(/\b\d{1,3}\b/g) ?? []).map(n => n.padStart(2, '0'))
  return [...new Set(nums)]
}

/** "meu nome é Maryana Silva" → "Maryana Silva". Vazio se não parecer nome. */
export function nomeDoTexto(texto: string): string | null {
  let t = texto.trim().replace(/[!.,;:]+$/g, '')
  t = t.replace(/^(?:oi+|ol[aá]|hola|hi|hello|hey|bom dia|boa tarde|boa noite|buenas)[,!\s]+/i, '')
  t = t.replace(/^(?:(?:o\s+)?meu nome [eé]|me chamo|sou (?:a|o)|eu sou|aqui [eé] (?:a|o)?|my name is|i'?m|i am|me llamo|mi nombre es|soy)\s+/i, '')
  if (!t || /\d|@|http/.test(t) || t.length > 40) return null
  const palavras = t.split(/\s+/).filter(Boolean).slice(0, 3)
  if (palavras.length === 0) return null
  return palavras.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

const AFIRMATIVO = /^(sim+|s|quero|pode( ser)?|claro|bora|vamos|ok|okay|yes|yeah|sure|si|sí|vale|dale|isso|aceito|por favor)\b/
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
  en: { rosto: 'the face photo', corpo: 'the full-body photo', ambas: 'the 2 photos (face and full body)' },
}

function explicarTema(tema: string): Acao[] {
  return [
    { t: 'audio', chave: 'a2' },
    { t: 'audio', chave: 'a3' },
    { t: 'catalogo', tema },
    { t: 'audio', chave: 'a4' },
    { t: 'texto', chave: 'tabela_precos' },
  ]
}

/** Quanto falta para fechar as fotos/poses do pedido. */
function avaliarFotosPoses(d: Dados, qtd: number, ctx: Contexto): { completo: boolean; acoes: Acao[] } {
  const poses = d.poses ?? []
  if (d.tem_rosto && d.tem_corpo && poses.length === qtd) return { completo: true, acoes: [] }
  const f = FALTA[ctx.idioma]
  const faltaFoto = !d.tem_rosto && !d.tem_corpo ? f.ambas : !d.tem_rosto ? f.rosto : !d.tem_corpo ? f.corpo : null
  if (poses.length === qtd && faltaFoto) return { completo: false, acoes: [{ t: 'texto', chave: 'falta_foto', vars: { faltam: faltaFoto } }] }
  if (poses.length > 0 && poses.length < qtd) return { completo: false, acoes: [{ t: 'texto', chave: 'poses_faltam', vars: { poses: poses.join(', '), faltam: qtd - poses.length } }] }
  return { completo: false, acoes: [] }
}

export function proximoPasso(etapa: Etapa, dadosIn: Dados, e: Entrada, ctx: Contexto): Resultado {
  const d: Dados = { ...dadosIn }
  const txt = (e.texto ?? '').trim()
  const fim = (proxima: Etapa, acoes: Acao[]): Resultado => ({ etapa: proxima, dados: d, acoes })

  // Humano: a Ana não fala.
  if (etapa === 'humano') return fim('humano', [])

  // ── Regras globais (valem em qualquer etapa) ─────────────────────────────
  if (e.tipo === 'texto' && pedeHumano(txt)) {
    return fim('humano', [{ t: 'texto', chave: 'humano' }, { t: 'humano', motivo: `pedido da cliente: "${txt.slice(0, 120)}"` }])
  }
  const novoIdioma = e.tipo === 'texto' ? idiomaPedido(txt) : null
  if (novoIdioma && novoIdioma !== ctx.idioma) {
    return fim(etapa, [{ t: 'idioma', idioma: novoIdioma }, { t: 'texto', chave: 'idioma_trocado' }, ...repetirPergunta(etapa, d)])
  }
  if (e.tipo === 'texto' && perguntaSeERobo(txt)) {
    return fim(etapa, [{ t: 'texto', chave: 'sou_assistente' }, ...repetirPergunta(etapa, d)])
  }

  // Aceitou a prévia oferecida na cobrança.
  if (d.previa_oferecida && !d.previa_feita && !['previa_fotos', 'aguardando_pagamento', 'conferindo', 'pago'].includes(etapa) && e.tipo === 'texto' && afirmativo(txt) && d.tema) {
    d.etapa_antes_previa = etapa
    d.previa_oferecida = false
    return fim('previa_fotos', [{ t: 'criar_pedido', tipo: 'previa' }, { t: 'texto', chave: 'previa_pede_fotos' }])
  }

  switch (etapa) {
    case 'inicio':
      return fim('nome', [{ t: 'texto', chave: 'boas_vindas' }, { t: 'audio', chave: 'a1' }, { t: 'texto', chave: 'pede_nome' }])

    case 'nome': {
      const nome = e.tipo === 'texto' ? nomeDoTexto(txt) : null
      if (!nome) return fim('nome', [{ t: 'ia', objetivo: 'descobrir o nome da cliente' }])
      d.nome = nome
      return fim('tema', [{ t: 'menu_imagem' }, { t: 'texto', chave: 'menu', vars: { nome } }])
    }

    case 'tema': {
      const r = e.tipo === 'texto' ? temaDoTexto(txt, ctx.temasAtivos) : null
      if (!r) return fim('tema', [{ t: 'ia', objetivo: 'a cliente escolher um dos 4 temas (1 a 4)' }])
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
      const p = e.tipo === 'texto' ? pacoteDoTexto(txt, ctx.precos) : null
      if (!p) return fim('pacote', [{ t: 'ia', objetivo: 'a cliente escolher um pacote pelo número da opção (1 a 5)' }])
      d.pacote_qtd = p.pacote_qtd; d.valor_cents = p.valor_cents; d.moeda = p.moeda
      d.poses = []; d.tem_rosto = false; d.tem_corpo = false
      return fim('fotos_poses', [{ t: 'criar_pedido', tipo: 'pacote' }, { t: 'texto', chave: 'pede_fotos_poses', vars: { qtd: p.pacote_qtd } }])
    }

    case 'fotos_poses':
    case 'previa_fotos': {
      const previa = etapa === 'previa_fotos'
      const qtd = previa ? 1 : (d.pacote_qtd ?? 0)
      const acoes: Acao[] = []

      if (e.tipo === 'video') return fim(etapa, [{ t: 'texto', chave: 'video_nao' }])
      if (e.tipo === 'imagem') {
        if (e.foto === 'recusada') return fim(etapa, [{ t: 'texto', chave: 'foto_recusada' }])
        if (!d.tem_rosto) {
          if (e.foto === 'ruim') return fim(etapa, [{ t: 'texto', chave: 'foto_ruim' }])
          d.tem_rosto = true
          acoes.push({ t: 'guardar_foto', papel: 'rosto' }, { t: 'texto', chave: d.tem_corpo ? 'foto_corpo_ok' : 'foto_rosto_ok' })
        } else if (!d.tem_corpo) {
          d.tem_corpo = true
          acoes.push({ t: 'guardar_foto', papel: 'corpo' }, { t: 'texto', chave: 'foto_corpo_ok' })
        } else {
          acoes.push({ t: 'guardar_foto', papel: 'extra' })
        }
      }

      // Números (no texto ou na legenda da foto).
      const nums = txt && !(e.tipo === 'imagem' && txt.startsWith('[')) ? posesDoTexto(txt) : []
      if (nums.length > 0 && d.tema) {
        const validas = new Set(ctx.posesDoTema(d.tema))
        const invalidas = nums.filter(n => !validas.has(n))
        if (invalidas.length > 0) {
          acoes.push({ t: 'texto', chave: 'poses_invalidas', vars: { poses: invalidas.join(', ') } })
        } else {
          const juntas = [...new Set([...(d.poses ?? []), ...nums])]
          if (juntas.length > qtd) acoes.push({ t: 'texto', chave: 'poses_demais', vars: { qtd } })
          else d.poses = juntas
        }
      } else if (e.tipo === 'texto' && txt) {
        acoes.push({ t: 'ia', objetivo: `receber as 2 fotos e os números de ${qtd} pose(s)` })
      }

      const av = avaliarFotosPoses(d, qtd, ctx)
      if (!av.completo) {
        // Não repete o pedido se já respondeu algo específico agora.
        const jaFalou = acoes.some(a => a.t === 'texto' && ['poses_invalidas', 'poses_demais'].includes(a.chave)) || acoes.some(a => a.t === 'ia')
        return fim(etapa, [...acoes, ...(jaFalou ? [] : av.acoes)])
      }
      acoes.push({ t: 'atualizar_pedido' })
      if (previa) {
        d.previa_feita = true
        const volta = d.etapa_antes_previa ?? 'pacote'
        d.etapa_antes_previa = undefined
        return fim(volta, [...acoes, { t: 'fechar_pedido', tipo: 'previa' }, { t: 'texto', chave: 'previa_na_fila' }])
      }
      if (d.idade && d.cabelo !== undefined) return fechar(d, acoes, ctx)
      return fim('idade_prefs', [...acoes, { t: 'texto', chave: 'pede_idade_prefs' }])
    }

    case 'idade_prefs': {
      if (e.tipo !== 'texto') return fim('idade_prefs', [{ t: 'texto', chave: 'pede_idade_prefs' }])
      const idade = idadeDoTexto(txt) ?? d.idade ?? null
      if (idade === null) { d.preferencias = d.preferencias ?? txt; return fim('idade_prefs', [{ t: 'texto', chave: 'idade_falta' }]) }
      if (idade < 18) return fim('humano', [{ t: 'texto', chave: 'foto_recusada' }, { t: 'humano', motivo: `cliente informou idade ${idade}` }])
      d.idade = idade
      const cabelo = txt.match(/cabel[oa]s?\s*[:\-]?\s*([^\n,.;]{2,60})|pelo\s*[:\-]?\s*([^\n,.;]{2,60})|hair\s*[:\-]?\s*([^\n,.;]{2,60})/i)
      d.cabelo = (cabelo?.[1] ?? cabelo?.[2] ?? cabelo?.[3] ?? null)?.trim() ?? null
      const resto = txt.replace(/^\s*\d{1,3}\s*(anos|años|years?)?[\s,.;-]*/i, '').trim()
      d.preferencias = [d.preferencias && d.preferencias !== txt ? d.preferencias : null, resto || null].filter(Boolean).join(' · ') || null
      return fechar(d, [{ t: 'atualizar_pedido' }], ctx)
    }

    case 'aguardando_pagamento':
      if (e.tipo === 'imagem' || e.tipo === 'documento') return fim('aguardando_pagamento', [{ t: 'comprovante' }])
      if (e.tipo === 'texto' && FALA_DE_PAGAMENTO.test(sem(txt))) return fim('aguardando_pagamento', [{ t: 'texto', chave: ctx.pix ? 'pede_comprovante' : 'aguardando_pagamento' }])
      return fim('aguardando_pagamento', [{ t: 'ia', objetivo: ctx.pix
        ? 'a cliente pagar o Pix do valor do pedido e mandar o comprovante (imagem ou PDF) aqui'
        : 'tirar dúvidas; o pedido já está registrado e a forma de pagamento será enviada em seguida' }])

    case 'conferindo':
      if (e.tipo === 'imagem' || e.tipo === 'documento') return fim('conferindo', [{ t: 'comprovante' }])
      return fim('conferindo', [{ t: 'texto', chave: 'conferindo' }])

    case 'pago':
      if (e.tipo !== 'texto') return fim('pago', [{ t: 'texto', chave: 'pedido_pago_duvida' }])
      return fim('pago', [{ t: 'ia', objetivo: 'tirar dúvidas; o pedido já está PAGO e na fila de produção (não peça pagamento de novo)' }])
  }
  return fim(etapa, [])
}

const FALA_DE_PAGAMENTO = /\b(paguei|ja paguei|pago|pagamento|pix|comprovante|transferi|fiz a transferencia|i paid|paid|pague|ya pague)\b/

function fechar(d: Dados, acoes: Acao[], ctx: Contexto): Resultado {
  const fechamento: Acao[] = [...acoes, { t: 'fechar_pedido', tipo: 'pacote' }, { t: 'texto', chave: 'resumo_pedido' }]
  // Brasil: a Ana manda a chave Pix + o valor exato e pede o comprovante.
  if (ctx.pix && (d.moeda ?? 'BRL') === 'BRL') fechamento.push({ t: 'pix' }, { t: 'audio', chave: 'a5' }, { t: 'texto', chave: 'pede_comprovante' })
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
    case 'idade_prefs': return [{ t: 'texto', chave: 'pede_idade_prefs' }]
    default: return []
  }
}

// ── Cobranças (seção 5): 10 min, 30 min, 3 h — no máximo 3, só na janela ────

export const ETAPAS_SEM_COBRANCA: Etapa[] = ['inicio', 'humano', 'conferindo', 'pago']

export function cobrancaDevida(c: {
  etapa: Etapa; modo: string; cobrancas: number; janela_ate: string | null
  aguardando_desde: string | null; ultima_cliente_em: string | null; tema?: string | null; previa_feita?: boolean
}, agora: Date = new Date()): 'cobranca_1' | 'cobranca_2' | 'cobranca_3' | null {
  if (c.modo !== 'ana' || ETAPAS_SEM_COBRANCA.includes(c.etapa) || c.cobrancas >= 3) return null
  if (!c.janela_ate || new Date(c.janela_ate).getTime() <= agora.getTime()) return null
  if (!c.aguardando_desde) return null
  if (c.ultima_cliente_em && new Date(c.ultima_cliente_em).getTime() > new Date(c.aguardando_desde).getTime()) return null
  const min = (agora.getTime() - new Date(c.aguardando_desde).getTime()) / 60000
  if (c.cobrancas === 0 && min >= 10) return 'cobranca_1'
  if (c.cobrancas === 1 && min >= 30) {
    // A prévia só faz sentido com tema escolhido e antes de ter pedido fechado.
    const podePrevia = !!c.tema && !c.previa_feita && c.etapa !== 'aguardando_pagamento'
    return podePrevia ? 'cobranca_2' : (min >= 180 ? 'cobranca_3' : null)
  }
  if (c.cobrancas === 2 && min >= 180) return 'cobranca_3'
  return null
}
