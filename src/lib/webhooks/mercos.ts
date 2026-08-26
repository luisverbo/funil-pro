// ============================================================================
// Mercos — leitura TOLERANTE do payload do webhook
// ----------------------------------------------------------------------------
// A documentação técnica do Mercos não é acessível daqui e o formato pode
// variar por evento. Em vez de apostar em nomes exatos de campo, estas
// funções VARREM o JSON inteiro:
//
//   • evento: campo 'evento'/'event' em qualquer nível
//   • contato: e-mails por formato, telefones BR por dígitos, nome por
//     chaves conhecidas (nome/razao_social/nome_fantasia/name)
//   • valor: a MAIOR ocorrência de chave de dinheiro (valor_total/total/
//     valor) — pedidos carregam itens com valores parciais; o total domina
//   • cliente_id: chave 'cliente_id' (o pedido do Mercos referencia o
//     cliente por id; o cadastro com contato chega no evento cliente.*)
//
// Tudo puro e testável. Quem decide o que fazer com isso é a rota.
// ============================================================================

type Json = unknown

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/

/** Percorre o JSON inteiro chamando visita(chave, valor) em cada folha. */
function varrer(node: Json, visita: (chave: string, valor: unknown) => void, chave = ''): void {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const item of node) varrer(item, visita, chave)
    return
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) varrer(v, visita, k)
    return
  }
  visita(chave, node)
}

/** 'evento' em qualquer nível do payload ("pedido.faturado", "cliente.cadastrado"…). */
export function extrairEvento(payload: Json): string | null {
  let achado: string | null = null
  varrer(payload, (chave, valor) => {
    if (achado) return
    if ((chave === 'evento' || chave === 'event' || chave === 'tipo_evento') && typeof valor === 'string' && valor.trim()) {
      achado = valor.trim().toLowerCase()
    }
  })
  return achado
}

export interface ContatoMercos {
  nome: string | null
  email: string | null
  telefone: string | null
}

const CHAVES_NOME = new Set(['nome', 'razao_social', 'nome_fantasia', 'name', 'nome_cliente', 'cliente_nome', 'contato_nome'])
const CHAVES_FONE = new Set(['telefone', 'celular', 'fone', 'phone', 'whatsapp', 'telefone_principal', 'numero'])

/** Nome, e-mail e telefone de qualquer canto do payload. */
export function extrairContato(payload: Json): ContatoMercos {
  let nome: string | null = null
  let email: string | null = null
  let telefone: string | null = null
  varrer(payload, (chave, valor) => {
    if (typeof valor !== 'string' && typeof valor !== 'number') return
    const texto = String(valor).trim()
    if (!texto) return
    if (!email) {
      const m = texto.match(EMAIL_RE)
      if (m) { email = m[0].toLowerCase(); return }
    }
    if (!telefone && CHAVES_FONE.has(chave.toLowerCase())) {
      const digitos = texto.replace(/\D/g, '')
      if (digitos.length >= 10 && digitos.length <= 13) telefone = digitos
    }
    if (!nome && CHAVES_NOME.has(chave.toLowerCase()) && texto.length >= 2 && texto.length <= 80 && !EMAIL_RE.test(texto)) {
      nome = texto
    }
  })
  return { nome, email, telefone }
}

const CHAVE_VALOR_RE = /^(valor_total|total|valor|total_pedido|valor_pedido|valor_liquido)$/i

/**
 * Valor da venda em CENTAVOS — a MAIOR ocorrência entre as chaves de
 * dinheiro: o total do pedido sempre domina os subtotais de item.
 * Aceita número (1234.5) e texto BR ("1.234,50").
 */
export function extrairValorCents(payload: Json): number | null {
  let maior: number | null = null
  varrer(payload, (chave, valor) => {
    if (!CHAVE_VALOR_RE.test(chave)) return
    let n: number | null = null
    if (typeof valor === 'number' && isFinite(valor)) n = valor
    else if (typeof valor === 'string') {
      const limpo = valor.trim().replace(/[^\d.,-]/g, '')
      if (limpo) {
        // "1.234,56" → 1234.56 ; "1234.56" → 1234.56
        const brl = /,\d{1,2}$/.test(limpo)
        const num = Number(brl ? limpo.replace(/\./g, '').replace(',', '.') : limpo.replace(/,/g, ''))
        if (isFinite(num)) n = num
      }
    }
    if (n === null || n <= 0) return
    const cents = Math.round(n * 100)
    if (maior === null || cents > maior) maior = cents
  })
  return maior
}

/** cliente_id do payload (o pedido referencia o cliente por id). */
export function extrairClienteId(payload: Json): string | null {
  let achado: string | null = null
  varrer(payload, (chave, valor) => {
    if (achado) return
    if (chave.toLowerCase() === 'cliente_id' && (typeof valor === 'string' || typeof valor === 'number')) {
      const v = String(valor).trim()
      if (v) achado = v
    }
  })
  return achado
}

/** O token de validação aparece na requisição? Header, query ou corpo. */
export function tokenConfere(
  esperado: string,
  headers: { get(nome: string): string | null },
  urlBusca: URLSearchParams,
  payload: Json,
): boolean {
  const candidatos = [
    headers.get('x-mercos-token'),
    headers.get('x-webhook-token'),
    headers.get('x-chave-validacao'),
    (headers.get('authorization') ?? '').replace(/^(Bearer|Token)\s+/i, ''),
    urlBusca.get('chave'),
    urlBusca.get('token'),
  ]
  if (candidatos.some(c => c && c === esperado)) return true
  // Último recurso: a chave veio dentro do corpo, em qualquer campo.
  let noCorpo = false
  varrer(payload, (_chave, valor) => {
    if (!noCorpo && typeof valor === 'string' && valor === esperado) noCorpo = true
  })
  return noCorpo
}

/** Classificação do evento para a rota decidir o destino do lead. */
export type DestinoMercos = 'fechar' | 'perder' | 'cliente' | 'ignorar'

export function destinoDoEvento(evento: string | null): DestinoMercos {
  if (!evento) return 'ignorar'
  if (evento.startsWith('cliente.')) return evento === 'cliente.excluido' ? 'ignorar' : 'cliente'
  if (evento === 'pedido.cancelado') return 'perder'
  if (evento.startsWith('pedido.') || evento.startsWith('pagamento.')) return 'fechar'
  return 'ignorar'
}
