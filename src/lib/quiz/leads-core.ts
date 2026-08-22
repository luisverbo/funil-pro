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

export interface ExportColumn {
  chave: string
  rotulo: string
  /** Quantos leads responderam esta coluna — 0 = coluna vazia. */
  respostas: number
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

  const entra = (lead: { id: string; status?: string | null }): boolean => {
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
