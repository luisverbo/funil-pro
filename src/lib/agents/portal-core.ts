// ============================================================================
// Portal do cliente — o AGENTE como fonte de leads
// ----------------------------------------------------------------------------
// O portal (link + senha) que entrega leads de quiz passa a entregar as
// conversas do agente. WhatsApp, web e Instagram caem todos em
// agent_conversations com o campo `channel` — UMA fonte, um painel, uma
// coluna "canal".
//
// O centro daqui é a régua do LEAD QUENTE: no quiz, quente = chegou ao final;
// no agente não existe "última página" — quente = ATINGIU O OBJETIVO do
// agente (agendou reunião, comprou, foi qualificado ou roteado, conforme o
// objetivo configurado). A régua é determinística e testada — não depende de
// a IA "avisar".
//
// Tudo que decide o que o cliente vê é função PURA (montarLeadsAgente); o
// acesso a banco fica só em conversasParaPortal. Mesmo desenho do
// leads-core.ts do quiz — e o retorno usa os MESMOS contratos (LeadPortal,
// ExportTable, funil), então a tela do portal não precisa de um segundo
// caminho de renderização.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportTable, LeadPortal } from '@/lib/quiz/leads-core'
import { extractContact, nomeNoTranscript } from './contato'

// ─── Públicos ───────────────────────────────────────────────────────────────

/** O que o dono libera para o cliente ver de cada agente. */
export const PUBLICOS_AGENTE = ['quentes', 'agendados', 'com_contato', 'todos'] as const
export type PublicoAgente = (typeof PUBLICOS_AGENTE)[number]

export function publicoAgenteValido(v: unknown): v is PublicoAgente {
  return typeof v === 'string' && (PUBLICOS_AGENTE as readonly string[]).includes(v)
}

// ─── A régua do lead quente ─────────────────────────────────────────────────

export type ObjetivoAgente = 'qualify' | 'route_to_funnel' | 'sell_direct'

/** Status de conversa que CONTAM como objetivo atingido, por objetivo. */
const STATUS_BONS: Record<ObjetivoAgente, string[]> = {
  sell_direct: ['sold'],
  route_to_funnel: ['routed_to_funnel', 'sold'],
  qualify: ['qualified', 'sold', 'routed_to_funnel'],
}

/**
 * O lead chegou ao objetivo do agente?
 *
 * Reunião marcada conta SEMPRE — em qualquer objetivo, um lead que sentou na
 * agenda do dono é o lead mais quente que o agente produz. Fora isso, vale a
 * lista do objetivo configurado (vender → só venda; rotear → roteado/vendido;
 * qualificar → qualificado ou melhor).
 */
export function atingiuObjetivo(
  objetivo: string | null | undefined,
  statusConversa: string,
  temReuniao: boolean,
): boolean {
  if (temReuniao || statusConversa === 'scheduled') return true
  const chave: ObjetivoAgente = objetivo === 'sell_direct' || objetivo === 'route_to_funnel'
    ? objetivo
    : 'qualify'
  return STATUS_BONS[chave].includes(statusConversa)
}

// ─── Rótulos ────────────────────────────────────────────────────────────────

export function canalRotulo(channel: string | null | undefined): string {
  switch (channel) {
    case 'whatsapp': return 'WhatsApp'
    case 'cloud': return 'WhatsApp Oficial'
    case 'web': return 'Site'
    case 'instagram': return 'Instagram'
    default: return channel ? channel : '—'
  }
}

export function situacaoConversaRotulo(status: string): string {
  switch (status) {
    case 'active': return 'Em conversa'
    case 'qualified': return 'Qualificado'
    case 'disqualified': return 'Fora do perfil'
    case 'sold': return 'Comprou'
    case 'routed_to_funnel': return 'Encaminhado'
    case 'scheduled': return 'Reunião marcada'
    case 'handed_to_human': return 'Pediu atendimento humano'
    case 'abandoned': return 'Abandonou'
    default: return status
  }
}

/**
 * Resumo curto da conversa para o cartão do lead. O outcome_summary (quando o
 * motor gravou) vem primeiro; senão, a primeira fala do lead — é onde ele diz
 * o que quer — encurtada.
 */
export function resumoDaConversa(
  outcome: string | null | undefined,
  mensagens: { role: string; content: string }[],
): string | null {
  const corta = (t: string) => (t.length > 180 ? `${t.slice(0, 177)}…` : t)
  const limpo = (outcome ?? '').trim()
  if (limpo.length > 0) return corta(limpo)
  const primeira = mensagens.find(m => m.role === 'lead' && m.content.trim().length > 3)
  return primeira ? corta(primeira.content.trim()) : null
}

// ─── Montagem (pura) ────────────────────────────────────────────────────────

export interface ConversaRow {
  id: string
  status: string
  channel: string | null
  started_at: string | null
  qualification_score: number | null
  outcome_summary: string | null
  lead: { name: string | null; email: string | null; phone: string | null } | null
}

export interface ReuniaoRow {
  conversation_id: string | null
  scheduled_at: string | null
  status: string
}

/** LeadPortal + o que só o agente tem — a tela usa os extras quando existem. */
export interface LeadAgentePortal extends LeadPortal {
  canal: string
  situacao: string
  /** LeadPortal já tem `score: number` — aqui é 0 quando não há. */
  scoreAgente: number | null
  /** ISO da reunião confirmada, se houver. */
  reuniaoEm: string | null
}

export interface MontagemAgente {
  /** Só o público liberado — é o que o cliente vê e onde marca o desfecho. */
  leads: LeadAgentePortal[]
  /** TODAS as conversas (respeitando o corte de data) — alimenta as métricas. */
  base: { data: string | null; concluiu: boolean; temContato: boolean }[]
  tabela: ExportTable
  /** Funil de conversão do agente: conversas → contato → quente → reunião. */
  funil: { pageId: string; titulo: string; leads: number; pct: number }[]
}

export function montarLeadsAgente(entrada: {
  tituloAgente: string
  objetivo: string | null | undefined
  conversas: ConversaRow[]
  reunioes: ReuniaoRow[]
  mensagensPorConversa: Map<string, { role: string; content: string }[]>
  publico: PublicoAgente
  desde: string | null
  mostrarConversa: boolean
}): MontagemAgente {
  const {
    tituloAgente, objetivo, conversas, reunioes, mensagensPorConversa,
    publico, desde, mostrarConversa,
  } = entrada

  // Reunião confirmada (ou já realizada) por conversa — cancelada não conta.
  const reuniaoDe = new Map<string, string>()
  for (const r of reunioes) {
    if (!r.conversation_id || !r.scheduled_at) continue
    if (r.status !== 'confirmed' && r.status !== 'done') continue
    reuniaoDe.set(String(r.conversation_id), r.scheduled_at)
  }

  // Corte de data + fora conversas de teste (test drive não é lead).
  const validas = conversas.filter(c => {
    if (c.channel === 'test') return false
    if (desde && c.started_at && c.started_at.slice(0, 10) < desde) return false
    return true
  })

  const todos: LeadAgentePortal[] = validas.map(c => {
    const msgs = mensagensPorConversa.get(c.id) ?? []
    const falas = msgs.filter(m => m.role === 'lead').map(m => m.content)
    const doTranscript = falas.length > 0
      ? extractContact(falas, msgs, '', null)
      : { name: null, email: null, phone: null }
    const nome = c.lead?.name?.trim() || nomeNoTranscript(msgs) || null
    const email = c.lead?.email?.trim() || doTranscript.email
    const telefone = c.lead?.phone?.trim() || doTranscript.phone
    const reuniaoEm = reuniaoDe.get(c.id) ?? null
    const quente = atingiuObjetivo(objetivo, c.status, reuniaoEm !== null)
    return {
      id: c.id,
      nome,
      email,
      telefone,
      data: c.started_at,
      quente,
      // "Concluiu" no agente É o objetivo atingido — a barra de conversão do
      // portal mede exatamente o que o dono prometeu entregar.
      concluiu: quente,
      resultado: null,
      canal: canalRotulo(c.channel),
      situacao: situacaoConversaRotulo(c.status),
      score: c.qualification_score ?? 0,
      scoreAgente: c.qualification_score,
      reuniaoEm,
    }
  })

  const visiveis = todos.filter(l => {
    if (publico === 'todos') return true
    if (publico === 'quentes') return l.quente
    if (publico === 'agendados') return l.reuniaoEm !== null
    return Boolean(l.email || l.telefone)          // com_contato
  })

  // Tabela no MESMO contrato do quiz: as colunas extras (canal, situação,
  // resumo, reunião, conversa) aparecem no "Ver respostas" do cartão e saem
  // no CSV/PDF — tela e arquivo nunca divergem.
  const colunas = [
    { chave: 'lead:nome', rotulo: 'Nome', respostas: 0 },
    { chave: 'lead:telefone', rotulo: 'Telefone', respostas: 0 },
    { chave: 'lead:email', rotulo: 'E-mail', respostas: 0 },
    { chave: 'ag:canal', rotulo: 'Canal', respostas: 0 },
    { chave: 'ag:situacao', rotulo: 'Situação da conversa', respostas: 0 },
    { chave: 'ag:resumo', rotulo: 'Resumo', respostas: 0 },
    { chave: 'ag:reuniao', rotulo: 'Reunião', respostas: 0 },
    ...(mostrarConversa ? [{ chave: 'ag:conversa', rotulo: 'Conversa completa', respostas: 0 }] : []),
  ]
  const linhas = visiveis.map(l => {
    const msgs = mensagensPorConversa.get(l.id) ?? []
    const conversa = mostrarConversa
      ? msgs.map(m => `${m.role === 'lead' ? '👤' : '🤖'} ${m.content}`).join('\n')
      : ''
    const c = validas.find(x => x.id === l.id)
    return [
      l.nome ?? '',
      l.telefone ?? '',
      l.email ?? '',
      l.canal,
      l.situacao,
      resumoDaConversa(c?.outcome_summary, msgs) ?? '',
      l.reuniaoEm ? new Date(l.reuniaoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '',
      ...(mostrarConversa ? [conversa] : []),
    ]
  })

  // Funil de MEDIÇÃO do agente — é aqui que o dono presta contas:
  // quantas conversas viraram contato, quantas viraram lead quente, quantas
  // sentaram na agenda.
  const total = todos.length
  const comContato = todos.filter(l => Boolean(l.email || l.telefone)).length
  const quentes = todos.filter(l => l.quente).length
  const agendadas = todos.filter(l => l.reuniaoEm !== null).length
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
  const funil = [
    { pageId: 'ag:conversas', titulo: 'Conversas iniciadas', leads: total, pct: 100 },
    { pageId: 'ag:contato', titulo: 'Deixaram contato', leads: comContato, pct: pct(comContato) },
    { pageId: 'ag:quentes', titulo: '🔥 Atingiram o objetivo', leads: quentes, pct: pct(quentes) },
    { pageId: 'ag:reuniao', titulo: 'Reunião marcada', leads: agendadas, pct: pct(agendadas) },
  ]

  return {
    leads: visiveis,
    base: todos.map(l => ({ data: l.data, concluiu: l.quente, temContato: Boolean(l.email || l.telefone) })),
    tabela: { titulo: tituloAgente, colunas, linhas, ids: visiveis.map(l => l.id) },
    funil,
  }
}

// ─── Acesso a banco ─────────────────────────────────────────────────────────

type Admin = SupabaseClient

const LOTE = 1000

/** Conversas do agente com paginação — PostgREST corta em 1000 linhas. */
async function buscarConversas(admin: Admin, agentId: string, tenantId: string): Promise<ConversaRow[]> {
  const todas: ConversaRow[] = []
  for (let pagina = 0; pagina < 10; pagina++) {
    const de = pagina * LOTE
    const { data, error } = await admin
      .from('agent_conversations')
      .select('id, status, channel, started_at, qualification_score, outcome_summary, leads(name, email, phone)')
      .eq('agent_id', agentId)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .range(de, de + LOTE - 1)
    if (error) {
      // `channel` pode não existir em banco antigo — segunda tentativa sem ela.
      const r2 = await admin
        .from('agent_conversations')
        .select('id, status, started_at, qualification_score, outcome_summary, leads(name, email, phone)')
        .eq('agent_id', agentId)
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false })
        .range(de, de + LOTE - 1)
      if (r2.error || !r2.data) break
      for (const c of r2.data) todas.push(paraConversaRow({ ...c, channel: null }))
      if (r2.data.length < LOTE) break
      continue
    }
    for (const c of data ?? []) todas.push(paraConversaRow(c))
    if (!data || data.length < LOTE) break
  }
  return todas
}

function paraConversaRow(c: Record<string, unknown>): ConversaRow {
  const rel = c.leads as { name?: string | null; email?: string | null; phone?: string | null }
    | { name?: string | null; email?: string | null; phone?: string | null }[] | null
  const lead = Array.isArray(rel) ? rel[0] ?? null : rel
  return {
    id: String(c.id),
    status: String(c.status ?? 'active'),
    channel: typeof c.channel === 'string' ? c.channel : null,
    started_at: typeof c.started_at === 'string' ? c.started_at : null,
    qualification_score: typeof c.qualification_score === 'number' ? c.qualification_score : null,
    outcome_summary: typeof c.outcome_summary === 'string' ? c.outcome_summary : null,
    lead: lead
      ? { name: lead.name ?? null, email: lead.email ?? null, phone: lead.phone ?? null }
      : null,
  }
}

/** Mensagens das conversas indicadas, em lotes — ordem cronológica garantida. */
async function buscarMensagens(
  admin: Admin,
  conversationIds: string[],
): Promise<Map<string, { role: string; content: string }[]>> {
  const mapa = new Map<string, { role: string; content: string }[]>()
  // Lotes de ids (o IN tem limite de URL) e páginas dentro de cada lote.
  for (let i = 0; i < conversationIds.length; i += 100) {
    const ids = conversationIds.slice(i, i + 100)
    for (let pagina = 0; pagina < 10; pagina++) {
      const de = pagina * LOTE
      const { data } = await admin
        .from('agent_messages')
        .select('conversation_id, role, content, created_at')
        .in('conversation_id', ids)
        .order('created_at', { ascending: true })
        .range(de, de + LOTE - 1)
      for (const m of data ?? []) {
        const cid = String(m.conversation_id)
        const arr = mapa.get(cid) ?? []
        arr.push({ role: String(m.role), content: String(m.content ?? '') })
        mapa.set(cid, arr)
      }
      if (!data || data.length < LOTE) break
    }
  }
  return mapa
}

/**
 * Tudo que o portal precisa de UM agente, numa chamada: leads do público
 * liberado, base para métricas, tabela de export e funil de conversão.
 */
export async function conversasParaPortal(
  admin: Admin,
  agentId: string,
  tenantId: string,
  opts: { publico: PublicoAgente; desde: string | null; mostrarConversa: boolean },
): Promise<MontagemAgente> {
  const { data: agente } = await admin
    .from('ai_agents')
    .select('name, objective')
    .eq('id', agentId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const conversas = await buscarConversas(admin, agentId, tenantId)

  const { data: reunioesData } = await admin
    .from('agent_meetings')
    .select('conversation_id, scheduled_at, status')
    .eq('agent_id', agentId)
    .range(0, 9_999)

  // Mensagens só das conversas que podem aparecer (corte de data aplicado) —
  // limitadas às 500 mais recentes para a rota não estourar o tempo.
  const desde = opts.desde
  const candidatas = conversas
    .filter(c => c.channel !== 'test')
    .filter(c => !desde || !c.started_at || c.started_at.slice(0, 10) >= desde)
    .slice(0, 500)
  const mensagens = await buscarMensagens(admin, candidatas.map(c => c.id))

  return montarLeadsAgente({
    tituloAgente: String(agente?.name ?? 'Agente'),
    objetivo: (agente as { objective?: string } | null)?.objective ?? null,
    conversas,
    reunioes: (reunioesData ?? []).map(r => ({
      conversation_id: r.conversation_id ? String(r.conversation_id) : null,
      scheduled_at: r.scheduled_at ?? null,
      status: String(r.status ?? ''),
    })),
    mensagensPorConversa: mensagens,
    publico: opts.publico,
    desde: opts.desde,
    mostrarConversa: opts.mostrarConversa,
  })
}
