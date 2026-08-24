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
export const PUBLICOS_PORTAL = ['com_contato', 'paginas', 'concluidos', 'com_resposta', 'todos'] as const
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

// ─── Equipe de vendedores ───────────────────────────────────────────────────

/**
 * Rodízio: reparte os leads SEM responsável um-para-cada entre os vendedores
 * ativos, continuando de onde a última distribuição parou (quem tem menos
 * recebe primeiro). Determinístico: mesmo estado, mesmo resultado.
 */
export function distribuirRodizio(
  leadsSemDono: string[],
  vendedores: string[],
  jaAtribuidos: Record<string, number> = {},
): { leadId: string; memberId: string }[] {
  if (vendedores.length === 0 || leadsSemDono.length === 0) return []
  const carga = new Map(vendedores.map(v => [v, jaAtribuidos[v] ?? 0]))
  const out: { leadId: string; memberId: string }[] = []
  for (const leadId of leadsSemDono) {
    // O vendedor com MENOS leads recebe o próximo; empate segue a ordem.
    let escolhido = vendedores[0]
    for (const v of vendedores) {
      if ((carga.get(v) ?? 0) < (carga.get(escolhido) ?? 0)) escolhido = v
    }
    carga.set(escolhido, (carga.get(escolhido) ?? 0) + 1)
    out.push({ leadId, memberId: escolhido })
  }
  return out
}

/** Link do WhatsApp com a mensagem padrão ({nome} vira o nome do lead). */
export function linkWhatsAppComMensagem(
  telefone: string | null | undefined,
  template: string | null | undefined,
  nomeLead: string,
): string | null {
  const base = linkWhatsApp(telefone)
  if (!base) return null
  const msg = (template ?? '').trim()
  if (!msg) return base
  const texto = msg.replace(/\{nome\}/gi, nomeLead.split(' ')[0] ?? '')
  return `${base}?text=${encodeURIComponent(texto)}`
}

/** Lead quente parado: sem atendimento (status novo) há mais de 24h. */
export function leadParado(
  data: string | null,
  statusCliente: string,
  quente: boolean,
  agora = Date.now(),
): boolean {
  if (!quente || statusCliente !== 'novo' || !data) return false
  return agora - new Date(data).getTime() > 24 * 60 * 60 * 1000
}

/** Cor estável para o avatar do vendedor, derivada do nome. */
export function corDoVendedor(nome: string): string {
  let h = 0
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) % 360
  return `hsl(${h}, 65%, 45%)`
}

/**
 * Só os dígitos do telefone, para comparar números anotados de jeitos
 * diferentes: "(88) 99999-8888", "88999998888" e "5588999998888" são a mesma
 * pessoa. Compara pelos ÚLTIMOS 8 dígitos — é o que sobra igual quando um
 * anotou com DDI/DDD e o outro não.
 */
export function chaveTelefone(bruto: string | null | undefined): string | null {
  const d = (bruto ?? '').replace(/\D/g, '')
  if (d.length < 8) return null
  return d.slice(-8)
}

/**
 * Qual vendedor está entrando, pelo telefone digitado na tela de senha.
 *
 * É identificação, NÃO autenticação: a senha do portal continua sendo a
 * barreira. O telefone só decide QUAL fila a pessoa vê — o que evita o
 * gestor e cinco vendedores olhando a mesma lista bagunçada.
 */
export function identificarMembro<T extends { id: string; whatsapp?: string | null }>(
  membros: T[],
  telefoneDigitado: string,
): T | null {
  const chave = chaveTelefone(telefoneDigitado)
  if (!chave) return null
  return membros.find(m => chaveTelefone(m.whatsapp) === chave) ?? null
}

// ─── Modo do funil: vendas ou vaga de emprego ───────────────────────────────

export const MODOS_PORTAL = ['vendas', 'vagas'] as const
export type ModoPortal = typeof MODOS_PORTAL[number]

export function modoPortalValido(m: unknown): m is ModoPortal {
  return typeof m === 'string' && (MODOS_PORTAL as readonly string[]).includes(m)
}

export interface VocabularioPortal {
  um: string          // "lead" | "candidato"
  varios: string      // "Leads" | "Candidatos"
  quente: string      // selo de quem dá para atender
  status: Record<StatusPortal, string>
}

/**
 * O texto que o CLIENTE lê, por modo. Para quem recebe currículo, "lead
 * fechado" soa errado — a estrutura é a mesma, o vocabulário é que vende.
 */
export function vocabulario(modo: ModoPortal): VocabularioPortal {
  if (modo === 'vagas') {
    return {
      um: 'candidato',
      varios: 'Candidatos',
      quente: 'Completo',
      status: {
        novo: 'Novo',
        contactado: 'Contactado',
        agendado: 'Entrevista marcada',
        fechado: 'Contratado ✓',
        perdido: 'Descartado',
      },
    }
  }
  return {
    um: 'lead',
    varios: 'Leads',
    quente: 'Quente',
    status: {
      novo: 'Novo',
      contactado: 'Contactado',
      agendado: 'Agendado',
      fechado: 'Fechado ✓',
      perdido: 'Perdido',
    },
  }
}

// ─── Etapas do kanban, configuráveis por portal ─────────────────────────────

export interface EtapaPortal {
  chave: StatusPortal
  rotulo: string
  ativo: boolean
}

/**
 * As etapas que o portal mostra, misturando o padrão do MODO com o que o
 * gestor configurou.
 *
 * Duas regras que protegem o histórico:
 *   • as CHAVES são fixas — renomear "Agendado" para "Orçamento enviado" não
 *     reescreve o que já foi marcado, só troca o texto;
 *   • 'novo' e 'fechado' não podem ser desligados: sem entrada e sem desfecho
 *     o quadro deixa de ser um funil.
 */
export function etapasDoPortal(
  modo: ModoPortal,
  config: unknown,
): EtapaPortal[] {
  const voc = vocabulario(modo)
  const salvas = Array.isArray(config) ? config as Record<string, unknown>[] : []
  const porChave = new Map<string, Record<string, unknown>>()
  for (const e of salvas) {
    const c = String(e?.chave ?? '')
    if (statusPortalValido(c)) porChave.set(c, e)
  }

  return STATUS_PORTAL.map(chave => {
    const salva = porChave.get(chave)
    const rotulo = typeof salva?.rotulo === 'string' && salva.rotulo.trim()
      ? salva.rotulo.trim().slice(0, 30)
      : voc.status[chave]
    const obrigatoria = chave === 'novo' || chave === 'fechado'
    const ativo = obrigatoria ? true : salva?.ativo !== false
    return { chave, rotulo, ativo }
  })
}

/** Só o que aparece no quadro. */
export function etapasAtivas(etapas: EtapaPortal[]): EtapaPortal[] {
  return etapas.filter(e => e.ativo)
}

/** Limpa o que veio da tela antes de gravar — lista fechada de chaves. */
export function normalizarEtapas(bruto: unknown): EtapaPortal[] {
  const lista = Array.isArray(bruto) ? bruto as Record<string, unknown>[] : []
  const out: EtapaPortal[] = []
  for (const e of lista) {
    const chave = String(e?.chave ?? '')
    if (!statusPortalValido(chave)) continue
    if (out.some(x => x.chave === chave)) continue
    out.push({
      chave,
      rotulo: String(e?.rotulo ?? '').trim().slice(0, 30),
      ativo: chave === 'novo' || chave === 'fechado' ? true : e?.ativo !== false,
    })
  }
  return out
}
