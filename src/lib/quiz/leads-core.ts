// ============================================================================
// Painel de leads do quiz — o miolo, sem autenticação
// ----------------------------------------------------------------------------
// Este módulo existe porque o MESMO painel agora tem dois donos:
//
//   • o dono do quiz, logado, dentro do editor;
//   • o cliente dele, sem conta, através do link compartilhado com senha.
//
// A lógica de montar tabela, contagens e métricas era das server actions
// (que exigem sessão). Duplicá-la na rota pública faria as duas telas
// divergirem na primeira mudança. Aqui vive o miolo: cada chamador faz a SUA
// autenticação (sessão+tenant, ou token+senha) e passa `admin` + `tenantId`
// já verificados.
//
// NADA aqui decide quem pode ver — decidir acesso é papel de quem chama.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { temContato } from './portal'

export interface ExportColumn {
  chave: string
  rotulo: string
  /** Quantos leads responderam esta coluna — 0 = coluna vazia. */
  respostas: number
  /** Tipo do bloco de origem (field_phone, field_email…) — some nas colunas de lead. */
  tipo?: string
}
export interface ExportPageInfo { id: string; titulo: string; colunas: ExportColumn[] }
export interface ExportTable {
  titulo: string
  colunas: ExportColumn[]
  linhas: string[][]
  /** IDs dos leads, NA MESMA ORDEM das linhas — a tela marca quem já saiu. */
  ids: string[]
}
export interface ExportLeadResumo { id: string; chaves: string[]; concluido: boolean }
export type ExportPublico = 'todos' | 'com_resposta' | 'completos' | 'concluidos'

/** Blocos que produzem RESPOSTA — os únicos que viram coluna. */
export const BLOCOS_DE_RESPOSTA = new Set([
  'single_choice', 'multi_choice', 'yes_no', 'scale', 'video_answer',
  'field_text', 'field_email', 'field_phone', 'field_number', 'field_textarea',
  'field_date', 'field_height', 'field_weight',
])

type QuizDataBruto = {
  pages?: { id: string; title?: string; blocks?: { id: string; type: string; config?: { label?: string; question?: string } }[] }[]
} | null

export function estruturaDePaginas(quizData: unknown): ExportPageInfo[] {
  const dados = (quizData ?? null) as QuizDataBruto
  return (dados?.pages ?? []).map((p, i) => ({
    id: p.id,
    titulo: p.title || `Página ${i + 1}`,
    colunas: (p.blocks ?? [])
      .filter(b => BLOCOS_DE_RESPOSTA.has(b.type))
      .map(b => ({
        chave: b.id,
        rotulo: (b.config?.label || b.config?.question || 'Pergunta').replace(/\s+/g, ' ').trim().slice(0, 60),
        respostas: 0,
        tipo: b.type,
      })),
  }))
}

/** Colunas de identificação/origem do lead — opcionais na exportação. */
export const COLUNAS_LEAD: ExportColumn[] = [
  { chave: 'lead:id', rotulo: 'ID', respostas: 0 },
  { chave: 'lead:data', rotulo: 'Data', respostas: 0 },
  { chave: 'lead:status', rotulo: 'Status', respostas: 0 },
  { chave: 'lead:nome', rotulo: 'Nome', respostas: 0 },
  { chave: 'lead:email', rotulo: 'E-mail', respostas: 0 },
  { chave: 'lead:telefone', rotulo: 'Telefone', respostas: 0 },
  { chave: 'lead:score', rotulo: 'Score', respostas: 0 },
  { chave: 'lead:resultado', rotulo: 'Resultado', respostas: 0 },
  { chave: 'lead:utm_source', rotulo: 'Origem', respostas: 0 },
  { chave: 'lead:utm_campaign', rotulo: 'Campanha', respostas: 0 },
]

/**
 * Busca TODOS os eventos, em páginas — o PostgREST corta em 1000 linhas por
 * padrão, e esse corte já fez a exportação "perder" leads uma vez.
 */
export async function buscarEventosPaginado<T>(
  montarConsulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const TAMANHO = 1000
  const todos: T[] = []
  for (let pagina = 0; pagina < 200; pagina++) {
    const de = pagina * TAMANHO
    const { data, error } = await montarConsulta(de, de + TAMANHO - 1)
    if (error || !data) break
    todos.push(...data)
    if (data.length < TAMANHO) break
  }
  return todos
}

interface EventoResposta {
  lead_id: string; block_id: string | null; event_type: string; value: unknown
}

function lerEventosDeResposta(admin: SupabaseClient, quizId: string) {
  return buscarEventosPaginado<EventoResposta>(
    (de, ate) => admin
      .from('quiz_lead_events')
      .select('lead_id, block_id, event_type, value, created_at')
      .eq('quiz_id', quizId)
      .in('event_type', ['choice_selected', 'text_entered'])
      .order('created_at', { ascending: true })
      .range(de, ate),
  )
}

function valorDoEvento(ev: EventoResposta, separador = ' | '): string {
  const v = ev.value as { selected?: unknown; text?: unknown } | null
  const cru = v?.selected ?? v?.text
  return Array.isArray(cru) ? (cru as unknown[]).join(separador) : String(cru ?? '').trim()
}

/** Estrutura de páginas com contagem REAL de respostas por coluna. */
export async function estruturaComContagens(
  admin: SupabaseClient,
  quizId: string,
  tenantId: string,
): Promise<{ paginas: ExportPageInfo[]; leads: ExportLeadResumo[] }> {
  const { data: pageRow } = await admin.from('pages').select('quiz_data').eq('id', quizId).single()
  const paginas = estruturaDePaginas(pageRow?.quiz_data)

  const eventos = await lerEventosDeResposta(admin, quizId)

  const respondentes: Record<string, Set<string>> = {}
  for (const ev of eventos) {
    if (!ev.block_id) continue
    const valor = valorDoEvento(ev, '')
    if (!valor) continue
    ;(respondentes[ev.block_id] = respondentes[ev.block_id] ?? new Set()).add(ev.lead_id)
  }
  for (const pagina of paginas) {
    for (const coluna of pagina.colunas) {
      coluna.respostas = respondentes[coluna.chave]?.size ?? 0
    }
  }

  const porLead: Record<string, Set<string>> = {}
  for (const [chave, conjunto] of Object.entries(respondentes)) {
    for (const leadId of conjunto) (porLead[leadId] = porLead[leadId] ?? new Set()).add(chave)
  }
  const { data: leadsRows } = await admin
    .from('quiz_leads').select('id, status')
    .eq('quiz_id', quizId).eq('tenant_id', tenantId)

  const leads: ExportLeadResumo[] = (leadsRows ?? []).map(l => ({
    id: String(l.id),
    chaves: [...(porLead[l.id as string] ?? [])],
    concluido: l.status === 'completed',
  }))

  return { paginas, leads }
}

export interface OpcoesTabela {
  pageIds?: string[]
  columnKeys?: string[]
  incluirLead?: boolean
  publico?: ExportPublico
  excluirIds?: string[]
  /**
   * Restringe a EXATAMENTE estes leads. O portal usa isto para garantir que o
   * arquivo baixado tenha as mesmas pessoas da tela — filtrar duas vezes por
   * regras parecidas é como as duas listas divergem sem ninguém perceber.
   */
  apenasIds?: string[]
}

/**
 * Tabela pronta para exportar, com as PÁGINAS ESCOLHIDAS.
 *
 * Lista branca em DOIS níveis (página e coluna): chave que não pertence a
 * este quiz simplesmente não vira coluna — o cliente não escolhe conteúdo,
 * só filtra o que o servidor já conhece.
 */
export async function montarTabelaLeads(
  admin: SupabaseClient,
  quizId: string,
  tenantId: string,
  opts?: OpcoesTabela,
): Promise<ExportTable | { error: string }> {
  const { data: pageRow } = await admin
    .from('pages').select('title, quiz_data').eq('id', quizId).single()
  const todas = estruturaDePaginas(pageRow?.quiz_data)

  const escolhidas = Array.isArray(opts?.pageIds) && opts!.pageIds!.length > 0
    ? todas.filter(p => opts!.pageIds!.includes(p.id))
    : todas

  const filtroColunas = Array.isArray(opts?.columnKeys) ? new Set(opts!.columnKeys!) : null
  const querColuna = (chave: string) => !filtroColunas || filtroColunas.has(chave)

  const incluirLead = opts?.incluirLead !== false
  const paginasComColuna = escolhidas.filter(p => p.colunas.some(c => querColuna(c.chave)))
  const colunas: ExportColumn[] = [
    ...(incluirLead ? COLUNAS_LEAD.filter(c => querColuna(c.chave)) : []),
    ...paginasComColuna.flatMap(p => p.colunas.filter(c => querColuna(c.chave)).map(c => ({
      chave: c.chave,
      rotulo: paginasComColuna.length > 1 ? `${p.titulo} — ${c.rotulo}` : c.rotulo,
      respostas: c.respostas,
    }))),
  ]
  if (colunas.length === 0) return { error: 'Selecione ao menos uma página com perguntas' }

  const { data: leads, error } = await admin
    .from('quiz_leads').select('*')
    .eq('quiz_id', quizId).eq('tenant_id', tenantId)
    .order('started_at', { ascending: false })
  if (error) return { error: error.message }

  // Respostas por BLOCO: o evento mais recente do bloco vence — o lead pode corrigir.
  const eventos = await lerEventosDeResposta(admin, quizId)
  const porLead: Record<string, Record<string, string>> = {}
  for (const ev of eventos) {
    const blockId = ev.block_id
    if (!blockId) continue
    const valor = valorDoEvento(ev)
    if (!valor) continue
    const lid = ev.lead_id
    porLead[lid] = porLead[lid] || {}
    porLead[lid][blockId] = valor
  }

  const chavesPergunta = colunas.map(c => c.chave).filter(c => !c.startsWith('lead:'))
  const publico: ExportPublico = opts?.publico ?? 'todos'
  const jaExportados = new Set(Array.isArray(opts?.excluirIds) ? opts!.excluirIds! : [])
  const restrito = Array.isArray(opts?.apenasIds) ? new Set(opts!.apenasIds!) : null

  const entra = (lead: { id: string; status?: string | null }): boolean => {
    if (restrito && !restrito.has(lead.id)) return false
    if (jaExportados.has(lead.id)) return false
    if (publico === 'todos') return true
    if (publico === 'concluidos') return lead.status === 'completed'
    const respostas = porLead[lead.id] ?? {}
    const respondidas = chavesPergunta.filter(c => (respostas[c] ?? '').trim().length > 0).length
    if (publico === 'com_resposta') return respondidas > 0
    return chavesPergunta.length > 0 && respondidas === chavesPergunta.length
  }

  const selecionados = (leads ?? []).filter(entra)
  const linhas = selecionados.map(lead => {
    const respostas = porLead[lead.id] ?? {}
    return colunas.map(c => {
      switch (c.chave) {
        case 'lead:id': return String(lead.id).slice(0, 8)
        case 'lead:data': return lead.started_at ? new Date(lead.started_at).toLocaleString('pt-BR') : ''
        case 'lead:status': return String(lead.status ?? '')
        case 'lead:nome': return String(lead.name ?? '')
        case 'lead:email': return String(lead.email ?? '')
        case 'lead:telefone': return String(lead.phone ?? '')
        case 'lead:score': return String(lead.score ?? 0)
        case 'lead:resultado': return String(lead.result_shown ?? '')
        case 'lead:utm_source': return String(lead.utm_source ?? '')
        case 'lead:utm_campaign': return String(lead.utm_campaign ?? '')
        default: return respostas[c.chave] ?? ''
      }
    })
  })

  return {
    titulo: String(pageRow?.title ?? 'Quiz'),
    colunas,
    linhas,
    ids: selecionados.map(l => String(l.id)),
  }
}

// ─── Métricas ───────────────────────────────────────────────────────────────

export interface EtapaFunil {
  pageId: string
  titulo: string
  /** Leads que responderam algo NESTA página. */
  leads: number
  /** % em relação à primeira etapa com gente. */
  pct: number
}

export interface QuizMetricas {
  total: number
  completed: number
  inProgress: number
  completionRate: number
  hoje: number
  ultimos7d: number
  comContato: number
  funil: EtapaFunil[]
}

/**
 * Funil por página: quantos leads chegaram a RESPONDER cada uma.
 *
 * Função pura — a mesma conta serve ao painel logado e ao compartilhado, e o
 * teste roda sem banco. Página sem pergunta (só conteúdo) fica fora: não há
 * como medir passagem por ela.
 */
export function funilPorPagina(
  paginas: ExportPageInfo[],
  leads: ExportLeadResumo[],
): EtapaFunil[] {
  const etapas = paginas
    .filter(p => p.colunas.length > 0)
    .map(p => {
      const chaves = new Set(p.colunas.map(c => c.chave))
      const quantos = leads.filter(l => l.chaves.some(c => chaves.has(c))).length
      return { pageId: p.id, titulo: p.titulo, leads: quantos, pct: 0 }
    })
  const base = etapas.find(e => e.leads > 0)?.leads ?? 0
  for (const e of etapas) e.pct = base > 0 ? Math.round((e.leads / base) * 100) : 0
  return etapas
}

/** Métricas completas do quiz — cartões + funil, numa passada. */
export async function metricasDoQuiz(
  admin: SupabaseClient,
  quizId: string,
  tenantId: string,
  agora = new Date(),
): Promise<QuizMetricas> {
  const [{ paginas, leads: resumos }, { data: leadsRows }] = await Promise.all([
    estruturaComContagens(admin, quizId, tenantId),
    admin
      .from('quiz_leads')
      .select('id, status, started_at, email, phone')
      .eq('quiz_id', quizId)
      .eq('tenant_id', tenantId)
      .range(0, 49_999),
  ])

  const all = leadsRows ?? []
  const total = all.length
  const completed = all.filter(l => l.status === 'completed').length
  const inicioHoje = new Date(agora); inicioHoje.setHours(0, 0, 0, 0)
  const corte7d = agora.getTime() - 7 * 86_400_000

  return {
    total,
    completed,
    inProgress: all.filter(l => l.status === 'in_progress').length,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    hoje: all.filter(l => l.started_at && new Date(l.started_at) >= inicioHoje).length,
    ultimos7d: all.filter(l => l.started_at && new Date(l.started_at).getTime() >= corte7d).length,
    comContato: all.filter(l => (l.email ?? '').trim() || (l.phone ?? '').trim()).length,
    funil: funilPorPagina(paginas, resumos),
  }
}

/**
 * Nome, e-mail e telefone a partir das RESPOSTAS do quiz.
 *
 * O DEFEITO que isto conserta: o portal mostrava "Lead sem nome" para quem
 * PREENCHEU o nome — porque o nome digitado vive nos eventos de resposta
 * (bloco field_text), e a tela só olhava o cadastro do lead (quiz_leads.name),
 * que muitos funis nunca preenchem.
 *
 * Regra: e-mail vem do primeiro bloco field_email respondido; telefone do
 * field_phone; nome do field_text cujo RÓTULO fala "nome" — e, sem esse, do
 * primeiro field_text. Função pura: os testes cobrem sem banco.
 */
export function contatoDasRespostas(
  paginas: ExportPageInfo[],
  respostas: Record<string, string>,
): { nome: string | null; email: string | null; telefone: string | null } {
  const colunas = paginas.flatMap(p => p.colunas)
  const valor = (c: ExportColumn) => (respostas[c.chave] ?? '').trim() || null

  let nome: string | null = null
  let primeiroTexto: string | null = null
  let email: string | null = null
  let telefone: string | null = null

  for (const c of colunas) {
    const v = valor(c)
    if (!v) continue
    if (c.tipo === 'field_email' && !email) email = v
    if (c.tipo === 'field_phone' && !telefone) telefone = v
    if (c.tipo === 'field_text') {
      if (!primeiroTexto) primeiroTexto = v
      if (!nome && /nome/i.test(c.rotulo)) nome = v
    }
  }
  return { nome: nome ?? primeiroTexto, email, telefone }
}

/** Respostas por lead (bloco → valor), a MESMA leitura da exportação. */
export async function respostasPorLead(
  admin: SupabaseClient,
  quizId: string,
): Promise<Record<string, Record<string, string>>> {
  const eventos = await lerEventosDeResposta(admin, quizId)
  const porLead: Record<string, Record<string, string>> = {}
  for (const ev of eventos) {
    const blockId = ev.block_id
    if (!blockId) continue
    const valor = valorDoEvento(ev)
    if (!valor) continue
    const lid = ev.lead_id
    porLead[lid] = porLead[lid] || {}
    porLead[lid][blockId] = valor
  }
  return porLead
}

// ─── Portal do cliente ──────────────────────────────────────────────────────

export interface LeadPortal {
  id: string
  nome: string | null
  email: string | null
  telefone: string | null
  data: string | null
  /**
   * Lead que dá para ATENDER: deixou telefone ou e-mail. É este que o portal
   * marca com 🔥 — não "concluiu o quiz". Em funil que pede contato antes da
   * última página, quem deixou o telefone e não clicou no botão final é o
   * melhor lead que existe, e estava sendo escondido.
   */
  quente: boolean
  /** Chegou à última página do quiz — informação à parte, não o destaque. */
  concluiu: boolean
  resultado: string | null
  score: number
}

/**
 * Leads que o PORTAL do cliente pode ver, já filtrados pelo público que o
 * dono liberou para aquele funil.
 *
 * 'concluidos' (padrão) entrega só o lead quente; 'com_resposta' exige ao
 * menos uma resposta — quem só abriu a página nunca chega ao cliente.
 */
export async function leadsParaPortal(
  admin: SupabaseClient,
  quizId: string,
  tenantId: string,
  publico: 'com_contato' | 'concluidos' | 'com_resposta' | 'todos',
): Promise<LeadPortal[]> {
  const [{ data: rows }, { data: pageRow }, respostas] = await Promise.all([
    admin
      .from('quiz_leads')
      .select('id, name, email, phone, status, started_at, result_shown, score')
      .eq('quiz_id', quizId)
      .eq('tenant_id', tenantId)
      .order('started_at', { ascending: false })
      .range(0, 9_999),
    admin.from('pages').select('quiz_data').eq('id', quizId).single(),
    respostasPorLead(admin, quizId),
  ])
  const paginas = estruturaDePaginas(pageRow?.quiz_data)

  // O cadastro do lead (quiz_leads.name/email/phone) fica vazio em muitos
  // funis — o que a pessoa digitou vive nas RESPOSTAS. O derivado completa o
  // que faltar; o cadastro, quando existe, vence.
  const enriquecidos = (rows ?? []).map(l => {
    const derivado = contatoDasRespostas(paginas, respostas[String(l.id)] ?? {})
    return {
      ...l,
      nome: (l.name ?? '').trim() || derivado.nome,
      email: (l.email ?? '').trim() || derivado.email,
      telefone: (l.phone ?? '').trim() || derivado.telefone,
    }
  })

  let leads = enriquecidos
  if (publico === 'com_contato') {
    leads = leads.filter(l => temContato({ email: l.email, phone: l.telefone }))
  } else if (publico === 'concluidos') {
    leads = leads.filter(l => l.status === 'completed')
  } else if (publico === 'com_resposta') {
    leads = leads.filter(l => Object.keys(respostas[String(l.id)] ?? {}).length > 0)
  }

  return leads.map(l => ({
    id: String(l.id),
    nome: l.nome ?? null,
    email: l.email ?? null,
    telefone: l.telefone ?? null,
    data: l.started_at ?? null,
    quente: temContato({ email: l.email, phone: l.telefone }),
    concluiu: l.status === 'completed',
    resultado: l.result_shown ?? null,
    score: Number(l.score ?? 0),
  }))
}

/** Total investido no quiz (lançamentos manuais). 0 quando a tabela não existe. */
export async function investimentoDoQuiz(
  admin: SupabaseClient,
  quizId: string,
  tenantId: string,
): Promise<number> {
  const { data, error } = await admin
    .from('quiz_spend_entries')
    .select('amount_cents')
    .eq('page_id', quizId)
    .eq('tenant_id', tenantId)
    .range(0, 9_999)
  if (error || !data) return 0
  return data.reduce((soma, l) => soma + Number(l.amount_cents ?? 0), 0)
}
