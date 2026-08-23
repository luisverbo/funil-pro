// ============================================================================
// Portal do cliente — regras puras
// ----------------------------------------------------------------------------
// O cenário: o Luís faz tráfego pago para clientes. O lead entra pelo quiz,
// esquenta no funil, e o CLIENTE precisa receber esse lead pronto — sem ver o
// sistema, as etapas ou os outros clientes. O portal é a vitrine disso:
//
//   • UM acesso por cliente (link + senha), com VÁRIOS funis dentro;
//   • o dono decide o que o cliente vê em cada funil (só quem concluiu, por
//     padrão — o lead "quente");
//   • o cliente clica e cai no WhatsApp do lead, e marca o desfecho
//     (contactado, agendado, fechado...) — isso vira feedback para o dono.
// ============================================================================

/** O que o cliente pode marcar num lead. Lista FECHADA: status é dado que o
 *  cliente escreve no banco do dono — texto livre viraria lixo e injeção. */
export const STATUS_PORTAL = ['novo', 'contactado', 'agendado', 'fechado', 'perdido'] as const
export type StatusPortal = typeof STATUS_PORTAL[number]

export const STATUS_PORTAL_META: Record<StatusPortal, { rotulo: string; cor: string }> = {
  novo:       { rotulo: 'Novo',       cor: 'bg-slate-100 text-slate-700' },
  contactado: { rotulo: 'Contactado', cor: 'bg-blue-100 text-blue-700' },
  agendado:   { rotulo: 'Agendado',   cor: 'bg-amber-100 text-amber-700' },
  fechado:    { rotulo: 'Fechado ✓',  cor: 'bg-emerald-100 text-emerald-700' },
  perdido:    { rotulo: 'Perdido',    cor: 'bg-red-100 text-red-600' },
}

/** Tem como o cliente falar com essa pessoa? É o que decide o lead útil. */
export function temContato(lead: { email?: string | null; phone?: string | null }): boolean {
  return (lead.email ?? '').trim().length > 0 || (lead.phone ?? '').trim().length > 0
}

export function statusPortalValido(s: unknown): s is StatusPortal {
  return typeof s === 'string' && (STATUS_PORTAL as readonly string[]).includes(s)
}

/**
 * O que o dono pode liberar por funil.
 *
 * 'com_contato' é o padrão e o mais importante: em funil que pede telefone
 * ANTES da última página, muita gente deixa o contato e nunca clica no botão
 * final — pelo status do quiz essa pessoa "não concluiu", mas para quem vai
 * ligar ela é o melhor lead que existe. Filtrar por conclusão escondia
 * justamente quem podia ser atendido.
 */
export const PUBLICOS_PORTAL = ['com_contato', 'concluidos', 'com_resposta', 'todos'] as const
export type PublicoPortal = typeof PUBLICOS_PORTAL[number]

export function publicoPortalValido(p: unknown): p is PublicoPortal {
  return typeof p === 'string' && (PUBLICOS_PORTAL as readonly string[]).includes(p)
}

/**
 * Telefone → link do WhatsApp, com o jeito brasileiro de anotar número.
 *
 * O wa.me exige DDI. Quem preenche formulário raramente põe o +55: chega
 * "(88) 99999-8888", "088999998888", "5588999998888"... A regra:
 *   10–11 dígitos  -> DDD + número: entra o 55
 *   12–13 com 55   -> já completo
 *   fora disso     -> null (link quebrado é pior que sem link)
 */
export function linkWhatsApp(telefone: string | null | undefined): string | null {
  if (!telefone) return null
  let d = telefone.replace(/\D/g, '')
  d = d.replace(/^0+/, '')                        // 088... -> 88...
  if (d.length === 10 || d.length === 11) d = `55${d}`
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) {
    return `https://wa.me/${d}`
  }
  return null
}

/** Nome de exibição do lead no portal — nunca em branco. */
export function nomeDoLead(lead: { name?: string | null; email?: string | null; phone?: string | null }): string {
  const nome = (lead.name ?? '').trim()
  if (nome) return nome
  const email = (lead.email ?? '').trim()
  if (email) return email.split('@')[0]
  const fone = (lead.phone ?? '').trim()
  if (fone) return fone
  return 'Lead sem nome'
}

/**
 * Custo por lead, em centavos. `null` quando não há lead — o portal mostra
 * "—" em vez de Infinity/zero mentiroso.
 */
export function custoPorLead(gastoCents: number, leads: number): number | null {
  if (!Number.isFinite(gastoCents) || gastoCents <= 0 || leads <= 0) return null
  return Math.round(gastoCents / leads)
}
