// ============================================================================
// Estúdio IA — Fase 4: Pix do Luís conferido pelo COMPROVANTE (puro, sem rede)
// ----------------------------------------------------------------------------
// A IA de visão só LÊ o comprovante; quem decide é esta régua:
//   valor = valor do pacote · recebedor = o Luís (nome OU chave) ·
//   data/hora até 24 h antes · ID da transação (E2E) nunca usado.
// Tudo bate → 'pago' (pago_por='comprovante'). Qualquer dúvida →
// 'aguardando_conferencia' e o Luís decide com um clique.
// ============================================================================

export interface LeituraComprovante {
  e_comprovante: boolean
  legivel: boolean
  valor_cents: number | null
  data_hora: string | null          // ISO 8601 (com fuso, se o comprovante mostrar)
  recebedor_nome: string | null
  recebedor_chave: string | null
  pagador_nome: string | null
  e2e_id: string | null
}

export interface PixDoLuis { chave: string | null; tipo: string | null; recebedor: string | null }

export type Decisao = { aprovar: true } | { aprovar: false; motivos: string[] }

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'ltda', 'me', 'eireli', 'sa'])
const palavras = (s: string) => semAcento(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(p => p.length > 1 && !PARTICULAS.has(p))

/**
 * Nome do recebedor confere? Bancos abreviam ("LUIS C DA SILVA") e cortam:
 * basta o 1º nome bater e as demais palavras do comprovante existirem no
 * nome cadastrado (inteiras ou como inicial). A abreviação pode estar dos
 * DOIS lados: cadastro "Mary Ellen S M da Silva" × comprovante com o nome
 * inteiro também confere (cada inicial do cadastro casa uma palavra, em ordem).
 */
export function nomeConfere(lido: string | null, cadastrado: string | null): boolean {
  if (!lido || !cadastrado) return false
  const a = palavras(lido); const b = palavras(cadastrado)
  if (a.length === 0 || b.length === 0 || a[0] !== b[0]) return false
  const casa = (x: string, y: string) => x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y))
  // Lado mais curto inteiro dentro do mais longo, na mesma ordem.
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a]
  if (curto.length < 2 && a.length !== b.length) return false   // só o 1º nome não basta
  let j = 0
  for (const p of curto) {
    while (j < longo.length && !casa(p, longo[j])) j++
    if (j >= longo.length) return false
    j++
  }
  return true
}

/** Chave confere? Comprovantes costumam mascarar CPF/telefone (***.123.456-**). */
export function chaveConfere(lida: string | null, cadastrada: string | null): boolean {
  if (!lida || !cadastrada) return false
  const l = semAcento(lida).trim(); const c = semAcento(cadastrada).trim()
  if (l.includes('@') || c.includes('@')) return l === c
  const dl = l.replace(/[^0-9*]/g, ''); const dc = c.replace(/\D/g, '').replace(/^55(?=\d{11}$)/, '')
  const dlSem55 = dl.replace(/^55(?=[0-9*]{11}$)/, '')
  if (!dlSem55 || dlSem55.replace(/\*/g, '').length < 4) return l === c   // aleatória ou mascarada demais
  if (dlSem55.length !== dc.length) return false
  return [...dlSem55].every((ch, i) => ch === '*' || ch === dc[i])
}

/** E2E do Pix: "E" + 31 caracteres. Outros IDs (autenticação) aceitos se tiverem 10+. */
export function normalizarE2E(id: string | null): string | null {
  const t = (id ?? '').replace(/\s/g, '').toUpperCase()
  return t.length >= 10 ? t.slice(0, 64) : null
}

export function decidirComprovante(
  l: LeituraComprovante, esperado: { valor_cents: number; pix: PixDoLuis },
  agora: Date, e2eJaUsado: boolean,
): Decisao {
  const motivos: string[] = []
  if (!l.e_comprovante) return { aprovar: false, motivos: ['a imagem não parece um comprovante de Pix'] }
  if (!l.legivel) motivos.push('comprovante ilegível')
  if (l.valor_cents === null) motivos.push('não consegui ler o valor')
  else if (l.valor_cents !== esperado.valor_cents) motivos.push(`valor ${(l.valor_cents / 100).toFixed(2)} ≠ ${(esperado.valor_cents / 100).toFixed(2)} do pacote`)
  if (!nomeConfere(l.recebedor_nome, esperado.pix.recebedor) && !chaveConfere(l.recebedor_chave, esperado.pix.chave)) {
    motivos.push(`recebedor não confere (${l.recebedor_nome ?? l.recebedor_chave ?? 'não lido'})`)
  }
  const quando = l.data_hora ? new Date(l.data_hora) : null
  if (!quando || Number.isNaN(quando.getTime())) motivos.push('não consegui ler a data/hora')
  else {
    const dif = agora.getTime() - quando.getTime()
    if (dif > 24 * 3600e3) motivos.push('comprovante com mais de 24 h')
    else if (dif < -15 * 60e3) motivos.push('data/hora no futuro')
  }
  const e2e = normalizarE2E(l.e2e_id)
  if (!e2e) motivos.push('sem ID da transação (E2E)')
  else if (e2eJaUsado) motivos.push('este comprovante já foi usado em outro pedido')
  return motivos.length ? { aprovar: false, motivos } : { aprovar: true }
}

/** Texto da chave para a cliente copiar (a chave numa linha só, sem enfeite). */
export function linhasDoPix(pix: PixDoLuis): { chave: string; recebedor: string } | null {
  if (!pix.chave?.trim()) return null
  return { chave: pix.chave.trim(), recebedor: (pix.recebedor ?? '').trim() }
}

// ── Dados de venda gravados no pedido pago (o Painel da Fase 6 lê daqui) ────

export interface ContatoVenda { origem?: string | null; referral?: Record<string, unknown> | null; pais?: string | null; idioma?: string | null; ad_id?: string | null; ctwa_clid?: string | null }

export function dadosDeVenda(c: ContatoVenda, veioDePrevia: boolean) {
  const ref = (c.referral ?? {}) as Record<string, unknown>
  // Colunas do último clique (rastreio por anúncio) valem sobre o referral bruto.
  const adId = c.ad_id ?? (typeof ref.source_id === 'string' ? ref.source_id : typeof ref.ad_id === 'string' ? ref.ad_id : null)
  return {
    origem: c.origem === 'anuncio' || adId ? 'anuncio' : 'organico',
    ad_id: adId,
    pais: c.pais ?? null,
    idioma: c.idioma ?? null,
    veio_de_previa: veioDePrevia,
  }
}
