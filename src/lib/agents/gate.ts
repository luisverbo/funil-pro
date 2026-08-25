// ============================================================================
// Gate de qualificação — o lead já se qualificou nesta conversa?
// ----------------------------------------------------------------------------
// Por que isto existe: pedir contato ANTES de qualificar desperdiça o momento
// mais caro da conversa. Se a pessoa responde "menos de R$ 250 por dia" e o
// dono não vai atender esse perfil, o contato dela não serve para nada — e a
// pergunta ainda queima a chance de a conversa continuar leve.
//
// A leitura é DETERMINÍSTICA: comparamos o que o lead digitou com os rótulos
// das faixas configuradas. Não depende de o modelo "lembrar" de avisar, que é
// justamente o que falhava.
// ============================================================================

export interface OpcaoGate {
  label: string
  /** true = essa faixa qualifica (o dono quer atender). */
  qualifies?: boolean
}

export type StatusGate = 'sem_gate' | 'nao_respondido' | 'qualificado' | 'desqualificado'

const normalizar = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Situação do lead no gate, a partir de TUDO que ele já disse na conversa.
 *
 * A última faixa respondida vence: se a pessoa se corrigir ("na verdade são
 * R$ 1.000/dia"), a correção é o que vale.
 */
export function statusDoGate(
  opcoes: OpcaoGate[] | undefined | null,
  falasDoLead: string[],
  gateAtivo = true,
): StatusGate {
  const lista = (opcoes ?? []).filter(o => typeof o?.label === 'string' && o.label.trim())
  if (!gateAtivo || lista.length === 0) return 'sem_gate'

  const porRotulo = new Map(lista.map(o => [normalizar(o.label), o.qualifies !== false]))

  // De trás para frente: a resposta mais recente é a que vale.
  for (let i = falasDoLead.length - 1; i >= 0; i--) {
    const fala = normalizar(falasDoLead[i] ?? '')
    if (!fala) continue
    // Igualdade primeiro (clique no botão); depois "contém" (digitou junto de
    // outras palavras: "acho que menos de R$ 250 por dia").
    if (porRotulo.has(fala)) return porRotulo.get(fala) ? 'qualificado' : 'desqualificado'
    for (const [rotulo, qualifica] of porRotulo) {
      if (rotulo.length >= 4 && fala.includes(rotulo)) {
        return qualifica ? 'qualificado' : 'desqualificado'
      }
    }
  }
  return 'nao_respondido'
}

/**
 * Pode pedir o contato agora?
 *
 * 'qualified' (novo padrão recomendado): só depois de passar no gate.
 * 'inline': depois de N mensagens, como antes.
 * 'gate': logo na entrada. 'none': nunca.
 *
 * Sem gate configurado, 'qualified' se comporta como 'inline' — senão o
 * contato nunca seria pedido em quem não usa faixas.
 */
export function podePedirContato(
  modo: 'inline' | 'gate' | 'none' | 'qualified' | undefined,
  status: StatusGate,
  mensagensDoAgente: number,
  depoisDe: number,
): boolean {
  if (modo === 'none') return false
  if (modo === 'gate') return true
  if (modo === 'qualified') {
    if (status === 'sem_gate') return mensagensDoAgente >= depoisDe
    return status === 'qualificado'
  }
  // 'inline' (padrão antigo): contagem de mensagens.
  return mensagensDoAgente >= depoisDe
}
