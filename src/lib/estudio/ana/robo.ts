// ============================================================================
// Robô do outro lado — detecção PURA (sem IA, custo zero)
// ----------------------------------------------------------------------------
// Empresa clica no anúncio e o atendente automático DELA responde a Ana: os
// dois robôs conversam para sempre e cada volta gasta IA. Antes de chamar a
// Ana, as últimas mensagens da cliente passam por aqui; robô → a conversa é
// ENCERRADA (Ana para de responder até o Luís reabrir).
//
// Sinais: aviso explícito ("mensagem automática"), saudação de empresa
// ("obrigado por entrar em contato", "em breve retornaremos", horário de
// atendimento), menu numerado ("digite 1"), e a MESMA mensagem repetida.
// Um sinal fraco sozinho não fecha (gente de verdade também agradece).
// ============================================================================

const EXPLICITO = /mensagem autom[aá]tica|resposta autom[aá]tica|respuesta autom[aá]tica|mensaje autom[aá]tico|auto[- ]?reply|automatic reply|automated (message|reply)|this is an automated|(é|e) uma mensagem autom|soy un (bot|asistente virtual)|sou (um|uma) (bot|assistente virtual)|i'?m a (bot|virtual assistant)/i

const EMPRESA = /(obrigad[oa]|agradecemos)\s+(por|pelo)\s+(entrar em |seu |o )?contato|gracias por (comunicarte|contactarnos|escribirnos|tu mensaje|su mensaje|contactar)|thanks? (you )?for (contacting|your message|reaching out)|em breve (retornaremos|responderemos|entraremos|um atendente)|en breve (te |le )?(responderemos|atenderemos|contactaremos|nos comunicaremos|un asesor)|we('| wi)ll (get back|reply|respond)|nosso hor[aá]rio de atendimento|hor[aá]rio de atendimento [ée]|horario de atenci[oó]n|fora do hor[aá]rio|fuera (del|de) horario|out of (office|business hours)|no momento n[aã]o (podemos|estamos)|estamos (fora|ausentes|cerrados)|seja bem[- ]vind[oa] (a|à|ao)|bienvenid[oa] a /i

const MENU_PEDIDO = /digite (o n[uú]mero|a op[cç][aã]o|\d)|escolha uma (das )?op[cç]|selecione uma op|responda com o n[uú]mero|elige una opci|selecciona una opci|marque? una opci|escrib[ae] el n[uú]mero|reply with the number|choose an option|select an option/i
const LINHA_DE_MENU = /^\s*(\d{1,2}|[0-9]️?⃣)\s*[-.):–]?\s+\S/gmu

const normal = (t: string) => t.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

function temMenu(t: string): boolean {
  return MENU_PEDIDO.test(t) || (t.match(LINHA_DE_MENU)?.length ?? 0) >= 3
}

export interface Veredito { robo: boolean; motivo: string | null }

/** `textos` = últimas mensagens de TEXTO da cliente, a mais nova por último. */
export function pareceRobo(textos: (string | null | undefined)[]): Veredito {
  const msgs = textos.map(t => (t ?? '').trim()).filter(Boolean).slice(-8)
  if (msgs.length === 0) return { robo: false, motivo: null }
  const ultima = msgs[msgs.length - 1]

  if (EXPLICITO.test(ultima)) return { robo: true, motivo: 'aviso de mensagem automática' }
  if (EMPRESA.test(ultima) && temMenu(ultima)) return { robo: true, motivo: 'saudação de empresa com menu de opções' }

  const vistas = new Map<string, number>()
  for (const t of msgs) { const n = normal(t); if (n.length >= 15) vistas.set(n, (vistas.get(n) ?? 0) + 1) }
  const repetida = [...vistas.values()].some(v => v >= 2)
  const parecidas = msgs.filter(t => EXPLICITO.test(t) || EMPRESA.test(t) || temMenu(t)).length

  if (repetida && parecidas >= 1) return { robo: true, motivo: 'mesma resposta automática repetida' }
  if (parecidas >= 2) return { robo: true, motivo: 'respostas de atendente automático' }
  if (repetida && msgs.filter(t => normal(t) === normal(ultima)).length >= 3) return { robo: true, motivo: 'mesma mensagem 3 vezes' }
  return { robo: false, motivo: null }
}
