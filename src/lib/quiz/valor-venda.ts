// ============================================================================
// Valor da venda digitado à mão no portal
// ----------------------------------------------------------------------------
// Nem todo cliente tem ERP integrado (Mercos e afins). Sem integração, quem
// sabe quanto a venda valeu é o próprio cliente — então ele digita no cartão
// do lead, e o portal fecha as mesmas contas: faturado, ticket médio e custo
// por venda.
//
// O campo é digitado por gente apressada no celular: aceita "1500", "1.500",
// "1.500,00", "R$ 1500,50". O que NÃO pode é aceitar lixo em silêncio e
// gravar um número errado no lugar do faturamento.
// ============================================================================

/** Teto de sanidade: R$ 10.000.000 por venda. Acima disso é dedo escorregado. */
export const VALOR_VENDA_MAX_CENTS = 1_000_000_000

export type ValorDigitado =
  | { ok: true; cents: number | null }   // null = limpar o valor
  | { ok: false; erro: string }

/**
 * Lê o que a pessoa digitou e devolve CENTAVOS.
 *
 * Regra do separador (o ponto de erro clássico do formato brasileiro):
 *   • tem vírgula → a vírgula é o decimal e os pontos são milhar
 *     ("1.500,50" → 150050)
 *   • só ponto, com 1 ou 2 casas no fim → o ponto é decimal ("1500.5" → 150050)
 *   • só ponto, com 3 casas no fim → é separador de milhar ("1.500" → 150000)
 */
export function lerValorDigitado(texto: string | null | undefined): ValorDigitado {
  const bruto = (texto ?? '').trim()
  if (bruto === '') return { ok: true, cents: null }

  const limpo = bruto.replace(/R\$/gi, '').replace(/\s/g, '')
  if (!/^[\d.,]+$/.test(limpo)) {
    return { ok: false, erro: 'Digite só números (ex.: 1.500,00)' }
  }

  let normalizado: string
  if (limpo.includes(',')) {
    if ((limpo.match(/,/g) ?? []).length > 1) {
      return { ok: false, erro: 'Valor inválido' }
    }
    normalizado = limpo.replace(/\./g, '').replace(',', '.')
  } else {
    const partes = limpo.split('.')
    const ultima = partes.length > 1 ? partes[partes.length - 1] : ''
    // "1.500" é mil e quinhentos; "1500.50" é mil e quinhentos e cinquenta.
    normalizado = partes.length > 1 && (ultima.length === 1 || ultima.length === 2)
      ? partes.slice(0, -1).join('') + '.' + ultima
      : partes.join('')
  }

  const numero = Number(normalizado)
  if (!isFinite(numero) || numero < 0) return { ok: false, erro: 'Valor inválido' }

  const cents = Math.round(numero * 100)
  if (cents === 0) return { ok: true, cents: null }
  if (cents > VALOR_VENDA_MAX_CENTS) {
    return { ok: false, erro: 'Valor alto demais — confira o que digitou' }
  }
  return { ok: true, cents }
}

/** Centavos vindos do cliente pela rede: só inteiro, positivo e dentro do teto. */
export function valorVendaValido(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= VALOR_VENDA_MAX_CENTS
}

/** "150050" → "R$ 1.500,50" */
export function formatarCents(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
