// ============================================================================
// Comandos do DONO dentro da conversa — "/" silencia o agente
// ----------------------------------------------------------------------------
// Cena real que motivou isto: um amigo mandou mensagem no direct e o agente
// respondeu. O dono precisa de um jeito de calar o agente SEM abrir o painel:
// ele responde a conversa pelo próprio WhatsApp/Instagram começando com "/",
// e o agente sai daquela conversa na hora.
//
//   • QUALQUER mensagem sua começando com "/" → agente PARA nesta conversa
//     ("/", "/off", "/para", "/eu assumo"…)
//   • "/on", "/voltar", "/agente" ou "/ia"    → agente VOLTA a responder
//
// O comando vem do eco da SUA mensagem (fromMe no Evolution, is_echo no
// Instagram) — o lead nunca dispara isto, porque a mensagem dele não é eco.
// O texto do comando não é enviado a ninguém: é instrução, não resposta.
// ============================================================================

export type ComandoDono = 'pausar' | 'retomar'

const RETOMAR = new Set(['/on', '/voltar', '/agente', '/ia'])

/** Interpreta a mensagem que o DONO digitou. null = mensagem normal dele. */
export function comandoDoDono(texto: string | null | undefined): ComandoDono | null {
  const t = (texto ?? '').trim().toLowerCase()
  if (!t.startsWith('/')) return null
  return RETOMAR.has(t) ? 'retomar' : 'pausar'
}

/**
 * Marca gravada em outcome_summary quando o dono assume: é ela que faz o
 * motor ficar em SILÊNCIO TOTAL (sem mensagem de despedida) — o dono está
 * conversando; o agente não pode se meter nem para se despedir.
 */
export const MARCA_ASSUMIDA = 'Conversa assumida pelo dono (comando /)'

export function conversaAssumidaPeloDono(outcome: string | null | undefined): boolean {
  return (outcome ?? '').includes('assumida pelo dono')
}

/** Marca quando o dono assume PELO PAINEL (chat web) — mesma família da "/" */
export const MARCA_ASSUMIDA_PAINEL = 'Conversa assumida pelo dono (painel)'
