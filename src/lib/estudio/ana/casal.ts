// ============================================================================
// Estúdio IA — tema CASAL (duas pessoas na mesma cena) — regras puras
// ----------------------------------------------------------------------------
// Pessoa 1 = quem conversa; pessoa 2 = parceiro/a. A Ana precisa das 4 fotos
// (rosto + corpo inteiro de CADA um, cada foto com uma pessoa só). Aqui ficam
// os entendedores: os nomes do casal, "essa foto é de quem?", as duas idades
// e a lista do que ainda falta. Sem rede, sem banco.
// ============================================================================
import type { IdiomaAna } from './textos'
import type { FotoRecebida } from './fotos'

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

const PARCEIRO = /\b(marido|esposo|esposa|mulher|namorad[oa]|noiv[oa]|parceir[oa]|companheir[oa]|amor|meu bem|minha mina|meu boy|pareja|novi[oa]|marido|mi amor|husband|wife|boyfriend|girlfriend|fianc[eé]e?|partner)\b/
const RUIDO = /\b(eu|sou|me chamo|meu nome|nome|e|o|a|do|da|de|dele|dela|ele|ela|meu|minha|mi|my|and|y|is|se chama|chama|llama|the|o meu|a minha|dos|das|ok|sim|oi|ola|hola)\b/g

/**
 * "Maria e João", "eu sou a Maria e ele é o João", "meu marido se chama João"
 * → { p1, p2 }. Com o nome de quem conversa já conhecido, um nome só = parceiro/a.
 */
export function nomesDoCasal(texto: string, nome1?: string | null): { p1: string | null; p2: string | null } {
  const t = texto.trim().replace(/[!.?]+$/g, '')
  if (!t || /\d|@|http/.test(t) || t.length > 80) return { p1: nome1 ?? null, p2: null }
  // "eu sou a Maria e ele é o João" / "Maria e João" / "Maria, João"
  const partes = t.split(/\s*(?:\be\b|\by\b|\band\b|,|&|\+|\/)\s*/i).map(x => x.trim()).filter(Boolean)
  const limpar = (x: string) => {
    const semParceiro = x.replace(new RegExp(PARCEIRO.source, 'gi'), ' ')
    const palavras = sem(semParceiro).replace(RUIDO, ' ').replace(/[^a-z' -]/g, ' ').split(/\s+/).filter(p => p.length >= 2)
    if (!palavras.length) return null
    // devolve com a grafia original (acentos) da 1ª palavra que sobrou
    const orig = semParceiro.split(/\s+/).find(w => sem(w).replace(/[^a-z']/g, '') === palavras[0])
    return cap((orig ?? palavras[0]).replace(/[^\p{L}'-]/gu, ''))
  }
  const nomes = partes.map(limpar).filter((x): x is string => !!x)
  const meu = sem(nome1 ?? '')
  // Tira o próprio nome da lista (ela pode repetir "Maria e João" mesmo já tendo dito Maria).
  const outros = nomes.filter(n => !meu || sem(n) !== meu.split(' ')[0])
  if (nome1) return { p1: nome1, p2: outros[0] ?? null }
  if (nomes.length >= 2) return { p1: nomes[0], p2: nomes[1] }
  // Um nome só sem saber o de quem conversa: se citou o parceiro ("meu marido João"), é o p2.
  if (nomes.length === 1) return PARCEIRO.test(sem(t)) ? { p1: null, p2: nomes[0] } : { p1: nomes[0], p2: null }
  return { p1: null, p2: null }
}

/**
 * "Essa é de quem?" → de quem é CADA foto pendente, na ordem: "minha" → 1,
 * "dele"/"do João" → 2, "a primeira é minha e a segunda dele" → [1, 2].
 * null = não deu para entender.
 */
export function donoDoTexto(texto: string, nomes: { p1?: string | null; p2?: string | null }, quantas: number): (1 | 2)[] | null {
  const t = ` ${sem(texto)} `
  const n1 = sem(nomes.p1 ?? '').split(' ')[0], n2 = sem(nomes.p2 ?? '').split(' ')[0]
  const EU = /\b(minha|minhas|sou eu|eu|mim|mia|mias|yo|soy yo|mine|me|myself)\b/
  const OUTRO = new RegExp(`\\b(dele|dela|ele|ela|${PARCEIRO.source.slice(2, -2)}|him|her|his|hers|el|ella|suyo|suya)\\b`)
  const diz1 = EU.test(t) || (!!n1 && t.includes(` ${n1} `))
  const diz2 = OUTRO.test(t) || (!!n2 && t.includes(` ${n2} `))
  const ORD: [RegExp, number][] = [[/\b(primeir[ao]|1[ªa]?|first|primer[ao])\b/, 0], [/\b(segund[ao]|2[ªa]?|second)\b/, 1], [/\b(terceir[ao]|3[ªa]?|third|tercer[ao])\b/, 2], [/\b(quart[ao]|4[ªa]?|fourth|cuart[ao])\b/, 3]]
  if (quantas > 1 && diz1 && diz2) {
    // Ordem citada: "a primeira é minha, a segunda do João" / "João a primeira, minha a segunda".
    // Cada ordinal olha o trecho até o próximo ordinal; se não houver dono ali, o trecho de antes.
    const marcas = ORD.map(([re, i]) => { const m = re.exec(t); return m ? { i, ini: m.index, fim: m.index + m[0].length } : null })
      .filter((x): x is { i: number; ini: number; fim: number } => !!x && x.i < quantas).sort((a, b) => a.ini - b.ini)
    if (marcas.length) {
      const out: (1 | 2)[] = Array.from({ length: quantas }, () => 1 as 1 | 2)
      const dono = (trecho: string): 1 | 2 | null => {
        const seg = (!!n2 && trecho.includes(` ${n2} `)) || OUTRO.test(trecho)
        const pri = EU.test(trecho) || (!!n1 && trecho.includes(` ${n1} `))
        return seg && !pri ? 2 : pri && !seg ? 1 : null
      }
      marcas.forEach((m, k) => {
        const depois = ` ${t.slice(m.fim, marcas[k + 1]?.ini ?? t.length)} `
        const antes = ` ${t.slice(marcas[k - 1]?.fim ?? 0, m.ini)} `
        out[m.i] = dono(depois) ?? dono(antes) ?? 1
      })
      return out
    }
    // "uma de cada": a 1ª é minha, a 2ª dele
    if (quantas === 2 && /\b(uma de cada|cada um|cada uma|one each|una de cada)\b/.test(t)) return [1, 2]
    return null
  }
  if (diz1 && !diz2) return Array.from({ length: quantas }, () => 1 as const)
  if (diz2 && !diz1) return Array.from({ length: quantas }, () => 2 as const)
  if (quantas === 2 && /\b(uma de cada|cada um|cada uma|one each|una de cada)\b/.test(t)) return [1, 2]
  return null
}

/**
 * Dono automático de uma foto nova (quando a cliente não disse): só quando
 * uma pessoa já está COMPLETA (rosto + corpo) e a outra não — a foto é da outra.
 * Senão null (a Ana pergunta).
 */
export function donoAutomatico(lista: FotoRecebida[]): 1 | 2 | null {
  const completa = (n: 1 | 2) => {
    const de = lista.filter(f => f.pessoa === n && !f.extra && f.tipo !== 'invalida' && !f.recusada)
    const rosto = de.some(f => f.tipo === 'rosto' || f.tipo === 'rosto_e_corpo'), corpo = de.some(f => f.tipo === 'corpo_inteiro' || f.tipo === 'rosto_e_corpo')
    return rosto && corpo && de.length >= 2
  }
  if (completa(1) && !completa(2)) return 2
  if (completa(2) && !completa(1)) return 1
  return null
}

/** "eu 32 e ele 35", "32 e 35", "tenho 40, ela 38" → [idade1, idade2] (null onde não disse). */
export function idadesDoCasal(texto: string, nomes: { p1?: string | null; p2?: string | null }): { idade1: number | null; idade2: number | null } {
  const t = sem(texto)
  const nums = [...t.matchAll(/\b(\d{1,3})\b/g)].map(m => Number(m[1])).filter(n => n >= 5 && n <= 120)
  if (!nums.length) return { idade1: null, idade2: null }
  if (nums.length === 1) {
    const n2 = sem(nomes.p2 ?? '').split(' ')[0]
    const soDoOutro = /\b(dele|dela|ele|ela|el|ella|him|her)\b/.test(t) && !/\b(eu|minha|mim|yo|me|i)\b/.test(t)
    return (n2 && t.includes(n2) && !/\b(eu|yo|i)\b/.test(t)) || soDoOutro ? { idade1: null, idade2: nums[0] } : { idade1: nums[0], idade2: null }
  }
  // Dois números: se o parceiro veio primeiro ("ele 35 e eu 32"), inverte.
  const iEu = t.search(/\b(eu|minha|mim|yo|me|i)\b/), iOutro = t.search(/\b(dele|dela|ele|ela|el|ella|him|her)\b/)
  const invertido = iOutro >= 0 && (iEu < 0 || iOutro < iEu)
  return invertido ? { idade1: nums[1], idade2: nums[0] } : { idade1: nums[0], idade2: nums[1] }
}

/** Lista humana do que falta das 4 fotos: "o rosto de Maria e o corpo inteiro de João". */
export function faltaDoCasal(f: { p1: { rosto: boolean; corpo: boolean }; p2: { rosto: boolean; corpo: boolean } }, nomes: { p1?: string | null; p2?: string | null }, idioma: IdiomaAna): string[] {
  const T = {
    'pt-BR': { rosto: 'o rosto', corpo: 'o corpo inteiro', de: 'de', seu: 'seu', p2: 'do(a) seu(sua) parceiro(a)' },
    'pt-PT': { rosto: 'o rosto', corpo: 'o corpo inteiro', de: 'de', seu: 'teu', p2: 'do(a) teu(tua) parceiro(a)' },
    es: { rosto: 'la cara', corpo: 'el cuerpo entero', de: 'de', seu: 'tuya', p2: 'de tu pareja' },
    'es-ES': { rosto: 'la cara', corpo: 'el cuerpo entero', de: 'de', seu: 'tuya', p2: 'de tu pareja' },
    en: { rosto: 'the face', corpo: 'the full body', de: 'of', seu: 'yours', p2: "your partner's" },
  }[idioma]
  const quem = (n: 1 | 2) => {
    const nome = n === 1 ? nomes.p1 : nomes.p2
    if (nome) return `${T.de} ${nome}`
    return n === 1 ? (idioma === 'en' ? '(yours)' : idioma.startsWith('es') ? '(tuya)' : `(${T.seu})`) : T.p2
  }
  const out: string[] = []
  for (const n of [1, 2] as const) {
    const p = n === 1 ? f.p1 : f.p2
    if (!p.rosto) out.push(`${T.rosto} ${quem(n)}`)
    if (!p.corpo) out.push(`${T.corpo} ${quem(n)}`)
  }
  return out
}

/** "a, b e c" no idioma. */
export function juntar(itens: string[], idioma: IdiomaAna): string {
  const e = idioma === 'en' ? 'and' : idioma.startsWith('es') ? 'y' : 'e'
  if (itens.length <= 1) return itens[0] ?? ''
  return `${itens.slice(0, -1).join(', ')} ${e} ${itens[itens.length - 1]}`
}

/** Texto livre que pede o tema casal ("eu e meu marido", "nós dois", "pra mim e pro meu amor"). */
export const PEDE_CASAL = /\b(casal|couple|pareja|en pareja|nos dois|nós dois|nosotros dos|the two of us|eu e (o |a )?(meu|minha)|mim e (o |a |pro |pra |para o |para a )?(meu|minha)|yo y mi|me and my|com (o |a )?(meu|minha) (marido|esposa|namorad[oa]|noiv[oa]|amor)|(meu|minha) (marido|esposa|namorad[oa]|noiv[oa]) e eu)\b/
