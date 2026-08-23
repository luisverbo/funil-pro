'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import { abrirPdf, baixarCsv } from '@/components/quiz/export-files'
import {
  getQuizLeads, getQuizMetricas, resetQuizLeads, getAnswerBreakdown,
  getPortalDoQuiz, ativarPortal, desativarPortal, listarQuizzesDoTenant,
  listarInvestimentos, salvarInvestimento, excluirInvestimento, type InvestimentoDia,
  type QuizMetricas, type PortalInfo, type PortalQuizConfig,
  getExportStructure, exportLeadsTable,
  type ExportPageInfo, type ExportPublico, type ExportLeadResumo,
  type QuizLead, type QuizLeadWithEvents,
} from '@/app/actions/quiz-leads'
import type { QuizPage } from '@/app/actions/quiz-v2'
import { type PublicoPortal } from '@/lib/quiz/portal'

type Period = '24h' | '7d' | '30d' | 'all'

function shortId(id: string) { return id.slice(0, 6).toUpperCase() }
function fmtDate(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function statusBadge(status: QuizLead['status']) {
  const map = {
    completed:   'bg-emerald-100 text-emerald-700',
    in_progress: 'bg-yellow-100 text-yellow-700',
    abandoned:   'bg-gray-100 text-gray-500',
  }
  const labels = { completed: 'Concluído', in_progress: 'Em andamento', abandoned: 'Abandonou' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${map[status]}`}>
      {labels[status]}
    </span>
  )
}


/**
 * O que o lead respondeu NAQUELA página — nome do campo + valor.
 *
 * O defeito que isto conserta: a coluna de cada página mostrava o CONTATO do
 * lead (nome/telefone/e-mail) sempre que a página tivesse qualquer campo de
 * formulário. Com duas páginas de formulário, a página 3 repetia os dados da
 * página 2 e escondia o que realmente foi respondido ali — não havia como
 * saber a resposta.
 *
 * Agora a fonte é o EVENTO, que carrega `block_id`: cada valor volta ligado ao
 * bloco em que foi digitado, e só aparece na página a que aquele bloco
 * pertence.
 */
function pageAnswers(lead: QuizLeadWithEvents, page: QuizPage): { rotulo: string; valor: string; tipo: string }[] {
  const blocos = new Map((page.blocks ?? []).map(b => [b.id, b]))
  const porBloco = new Map<string, { rotulo: string; valor: string; tipo: string }>()

  for (const e of lead.events) {
    if (e.page_id !== page.id || !e.block_id) continue
    if (!['choice_selected', 'text_entered'].includes(e.event_type)) continue
    const bloco = blocos.get(e.block_id)
    if (!bloco) continue

    const bruto = (e.value as { selected?: unknown; text?: unknown } | null)
    const cru = bruto?.selected ?? bruto?.text
    const valor = Array.isArray(cru) ? cru.join(', ') : String(cru ?? '').trim()
    if (!valor) continue

    // O evento mais RECENTE do bloco vence: o lead pode corrigir o que digitou.
    porBloco.set(e.block_id, {
      rotulo: bloco.config.label ?? bloco.config.question ?? '',
      valor,
      tipo: bloco.type,
    })
  }
  // Ordem dos blocos na página, não a ordem dos eventos.
  return (page.blocks ?? []).map(b => porBloco.get(b.id)).filter((x): x is { rotulo: string; valor: string; tipo: string } => !!x)
}

/** Ícone por tipo de campo — ajuda a ler a coluna de relance. */
function iconeCampo(tipo: string): string {
  if (tipo === 'field_email') return '✉'
  if (tipo === 'field_phone') return '📱'
  if (tipo === 'field_text' || tipo === 'field_textarea') return '👤'
  if (tipo === 'field_number' || tipo === 'field_date') return '🔢'
  return '•'
}


/**
 * Leads JÁ EXPORTADOS, por quiz.
 *
 * Guardado no navegador, como as colunas ocultas: é preferência de trabalho,
 * não dado do lead — e não exige mudança no banco. Marcar acontece só depois
 * de um download bem-sucedido; limpar é um clique.
 */
function useJaExportados(quizId: string) {
  const chave = `quiz-leads-exportados:${quizId}`
  const cache = useRef<{ bruto: string | null; valor: Set<string> }>({ bruto: null, valor: new Set() })

  const subscribe = useCallback((notificar: () => void) => {
    const onChange = () => notificar()
    window.addEventListener('storage', onChange)
    window.addEventListener('quiz-leads-exportados', onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener('quiz-leads-exportados', onChange)
    }
  }, [])

  const getSnapshot = useCallback(() => {
    let bruto: string | null = null
    try { bruto = localStorage.getItem(chave) } catch { bruto = null }
    if (bruto !== cache.current.bruto) {
      let lista: string[] = []
      try { lista = bruto ? (JSON.parse(bruto) as string[]) : [] } catch { lista = [] }
      cache.current = { bruto, valor: new Set(lista) }
    }
    return cache.current.valor
  }, [chave])

  const VAZIO = useRef(new Set<string>())
  const exportados = useSyncExternalStore(subscribe, getSnapshot, () => VAZIO.current)

  const registrar = useCallback((ids: string[]) => {
    const novo = new Set([...getSnapshot(), ...ids])
    try { localStorage.setItem(chave, JSON.stringify([...novo])) } catch { /* sem persistência */ }
    window.dispatchEvent(new Event('quiz-leads-exportados'))
  }, [chave, getSnapshot])

  const limpar = useCallback(() => {
    try { localStorage.removeItem(chave) } catch { /* nada a limpar */ }
    window.dispatchEvent(new Event('quiz-leads-exportados'))
  }, [chave])

  return { exportados, registrar, limpar }
}

/** Chaves das colunas de lead — o servidor usa as mesmas na exportação. */
const COLUNAS_LEAD_CHAVES = [
  'lead:id', 'lead:data', 'lead:status', 'lead:nome', 'lead:email',
  'lead:telefone', 'lead:score', 'lead:resultado', 'lead:utm_source', 'lead:utm_campaign',
]

/**
 * Colunas ocultas, guardadas no navegador por quiz.
 *
 * `useSyncExternalStore` em vez de useEffect + setState: o localStorage é uma
 * fonte EXTERNA, e ler dela dentro de um efeito dispara renderização em
 * cascata (a regra de lint do projeto reprova, com razão). No servidor o
 * snapshot é sempre vazio — a primeira pintura nunca diverge da hidratação.
 */
function useColunasOcultas(quizId: string) {
  const chave = `quiz-colunas-ocultas:${quizId}`
  const cache = useRef<{ bruto: string | null; valor: Set<string> }>({ bruto: null, valor: new Set() })

  const subscribe = useCallback((notificar: () => void) => {
    const onChange = () => notificar()
    window.addEventListener('storage', onChange)
    window.addEventListener('quiz-colunas-ocultas', onChange)
    return () => {
      window.removeEventListener('storage', onChange)
      window.removeEventListener('quiz-colunas-ocultas', onChange)
    }
  }, [])

  const getSnapshot = useCallback(() => {
    // A MESMA referência precisa voltar enquanto o conteúdo não mudar, senão
    // o React re-renderiza para sempre.
    let bruto: string | null = null
    try { bruto = localStorage.getItem(chave) } catch { bruto = null }
    if (bruto !== cache.current.bruto) {
      let lista: string[] = []
      try { lista = bruto ? (JSON.parse(bruto) as string[]) : [] } catch { lista = [] }
      cache.current = { bruto, valor: new Set(lista) }
    }
    return cache.current.valor
  }, [chave])

  const VAZIO = useRef(new Set<string>())
  const ocultas = useSyncExternalStore(subscribe, getSnapshot, () => VAZIO.current)

  const gravar = useCallback((novo: Set<string>) => {
    try {
      if (novo.size === 0) localStorage.removeItem(chave)
      else localStorage.setItem(chave, JSON.stringify([...novo]))
    } catch { /* sem persistência: a sessão atual ainda funciona */ }
    window.dispatchEvent(new Event('quiz-colunas-ocultas'))
  }, [chave])

  const alternar = useCallback((pageId: string) => {
    const novo = new Set(getSnapshot())
    if (novo.has(pageId)) novo.delete(pageId); else novo.add(pageId)
    gravar(novo)
  }, [getSnapshot, gravar])

  const mostrarTodas = useCallback(() => gravar(new Set()), [gravar])

  return { ocultas, alternar, mostrarTodas }
}

// Derive what happened on a given page for a lead
function pageCellValue(lead: QuizLeadWithEvents, pageId: string): { state: 'none' | 'visited' | 'answered'; summary: string } {
  const pageEvents = lead.events.filter(e => e.page_id === pageId)
  if (pageEvents.length === 0) return { state: 'none', summary: '' }

  const answered = pageEvents.filter(e =>
    ['choice_selected','text_entered','button_clicked','form_submitted','quiz_completed'].includes(e.event_type)
  )
  if (answered.length === 0) return { state: 'visited', summary: 'Visitou' }

  const last = answered[answered.length - 1]
  let summary = ''
  if (last.event_type === 'choice_selected') {
    const choices = last.value as { selected?: unknown }
    summary = String(choices.selected ?? '').slice(0, 30)
  } else if (last.event_type === 'text_entered') {
    summary = String((last.value as { text?: unknown }).text ?? '').slice(0, 30)
  } else if (last.event_type === 'button_clicked') {
    const txt = String((last.value as { text?: unknown }).text ?? '').trim()
    summary = txt ? `🖱 ${txt.slice(0, 28)}` : 'Clicou'
  } else if (last.event_type === 'form_submitted') {
    summary = 'Formulário'
  } else if (last.event_type === 'quiz_completed') {
    summary = '✓ Fim'
  }
  return { state: 'answered', summary }
}

// ─── Respostas por pergunta (agregado) ───────────────────────────────────────
function AnswerBreakdown({ quizId, pages, refreshKey }: { quizId: string; pages: QuizPage[]; refreshKey: number }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Record<string, { value: string; count: number }[]>>({})
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!open) return
    getAnswerBreakdown(quizId).then(r => { setData(r.breakdown); setLoaded(true) })
  }, [open, quizId, refreshKey])

  // páginas que têm alguma resposta de escolha
  const pagesWithAnswers = pages.filter(p => (data[p.id]?.length ?? 0) > 0)

  return (
    <div className="bg-white rounded-xl border border-gray-200 mb-4 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50">
        <span className="text-sm font-semibold text-gray-800">📊 Respostas por pergunta</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-gray-100">
          {!loaded ? (
            <p className="text-xs text-gray-400 py-4 text-center">Carregando…</p>
          ) : pagesWithAnswers.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">Ainda não há respostas de escolha registradas.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4 mt-3">
              {pagesWithAnswers.map((p, pi) => {
                const answers = data[p.id]
                const totalP = answers.reduce((s, a) => s + a.count, 0) || 1
                return (
                  <div key={p.id} className="border border-gray-100 rounded-lg p-3">
                    <p className="text-xs font-bold text-gray-700 mb-2 truncate">Pág. {pi + 1} · {p.title}</p>
                    <div className="space-y-1.5">
                      {answers.map(a => {
                        const pct = Math.round((a.count / totalP) * 100)
                        return (
                          <div key={a.value}>
                            <div className="flex items-center justify-between text-[11px] mb-0.5">
                              <span className="text-gray-600 truncate max-w-[70%]" title={a.value}>{a.value}</span>
                              <span className="text-gray-400 shrink-0">{a.count} ({pct}%)</span>
                            </div>
                            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                              <div className="h-full rounded-full bg-indigo-400" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function LeadDetailPanel({ lead, pages, onClose }: { lead: QuizLeadWithEvents; pages: QuizPage[]; onClose: () => void }) {
  const pageMap = new Map(pages.map((p, i) => [p.id, { title: p.title, index: i }]))

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
        <div>
          <p className="text-sm font-bold text-gray-900">Lead #{shortId(lead.id)}</p>
          <p className="text-xs text-gray-400">{fmtDate(lead.started_at)}</p>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition text-xl leading-none">×</button>
      </div>

      {/* Contact info */}
      <div className="px-5 py-3 border-b border-gray-100 shrink-0">
        <div className="grid grid-cols-1 gap-1.5">
          {lead.name  && <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 w-14 shrink-0">Nome</span><span className="font-medium text-gray-800">{lead.name}</span></div>}
          {lead.email && <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 w-14 shrink-0">E-mail</span><span className="font-medium text-gray-800">{lead.email}</span></div>}
          {lead.phone && <div className="flex items-center gap-2 text-xs"><span className="text-gray-400 w-14 shrink-0">Telefone</span><span className="font-medium text-gray-800">{lead.phone}</span></div>}
        </div>
        <div className="flex items-center gap-3 mt-2">
          {statusBadge(lead.status)}
          {lead.score > 0 && (
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
              {lead.score} pts
            </span>
          )}
          {lead.result_shown && (
            <span className="text-xs text-gray-500 truncate max-w-[120px]">→ {lead.result_shown}</span>
          )}
        </div>
        {/* Origem (UTM) */}
        {(lead.utm_source || lead.utm_campaign || lead.referrer) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lead.utm_source && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">📣 {lead.utm_source}</span>}
            {lead.utm_campaign && <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">🎯 {lead.utm_campaign}</span>}
            {lead.utm_content && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">{lead.utm_content}</span>}
            {!lead.utm_source && lead.referrer && <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 truncate max-w-[180px]">de: {lead.referrer.replace(/^https?:\/\//, '').slice(0, 30)}</span>}
          </div>
        )}
      </div>

      {/* Event timeline */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Jornada</p>
        {lead.events.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhuma interação registrada</p>
        ) : (
          <div className="space-y-2">
            {lead.events.map((ev, i) => {
              const pageInfo = pageMap.get(ev.page_id)
              const eventLabels: Record<string, string> = {
                page_viewed: 'Visualizou',
                choice_selected: 'Escolheu',
                text_entered: 'Digitou',
                button_clicked: 'Clicou',
                form_submitted: 'Enviou formulário',
                quiz_completed: 'Concluiu',
              }
              const isKey = ev.event_type !== 'page_viewed'

              let valueStr = ''
              if (ev.event_type === 'choice_selected') valueStr = String((ev.value as { selected?: unknown }).selected ?? '')
              if (ev.event_type === 'text_entered') valueStr = String((ev.value as { text?: unknown }).text ?? '')
              if (ev.event_type === 'button_clicked') valueStr = String((ev.value as { text?: unknown }).text ?? '')

              return (
                <div key={i} className={`flex gap-2.5 ${isKey ? '' : 'opacity-60'}`}>
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`w-2 h-2 rounded-full mt-1 ${isKey ? 'bg-indigo-500' : 'bg-gray-300'}`} />
                    {i < lead.events.length - 1 && <div className="w-px flex-1 bg-gray-100 mt-0.5" />}
                  </div>
                  <div className="pb-2 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs font-medium text-gray-700 truncate">
                        {eventLabels[ev.event_type] ?? ev.event_type}
                        {pageInfo && <span className="font-normal text-gray-400 ml-1">· pg. {pageInfo.index + 1} {pageInfo.title}</span>}
                      </p>
                      <span className="text-[10px] text-gray-400 shrink-0">{fmtDate(ev.created_at)}</span>
                    </div>
                    {valueStr && <p className="text-xs text-gray-500 truncate mt-0.5">"{valueStr}"</p>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────
// Renovado: além dos totais, mostra hoje/7 dias, leads com contato e o funil
// página a página — onde as pessoas param. Os dados vêm de getQuizMetricas
// (o MESMO cálculo do painel compartilhado, para os dois nunca divergirem).

function StatsBar({ quizId }: { quizId: string }) {
  const [m, setM] = useState<QuizMetricas | null>(null)

  useEffect(() => {
    getQuizMetricas(quizId).then(r => {
      if ('total' in r) setM(r)
    })
  }, [quizId])

  if (!m) return <div className="h-24 bg-white rounded-2xl border border-gray-200 animate-pulse mb-4" />

  const cards = [
    { label: 'Leads', value: m.total, nota: `${m.hoje} hoje`, grad: 'from-slate-700 to-slate-900' },
    { label: 'Concluíram', value: m.completed, nota: `${m.completionRate}% de conclusão`, grad: 'from-emerald-500 to-teal-600' },
    { label: 'Com contato', value: m.comContato, nota: 'e-mail ou telefone', grad: 'from-indigo-500 to-violet-600' },
    { label: 'Últimos 7 dias', value: m.ultimos7d, nota: 'novos leads', grad: 'from-amber-500 to-orange-600' },
  ]

  return (
    <div className="mb-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map(c => (
          <div key={c.label} className={`rounded-2xl bg-gradient-to-br ${c.grad} px-4 py-3 text-white shadow-sm`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{c.label}</p>
            <p className="text-2xl font-bold leading-tight">{c.value}</p>
            <p className="text-[11px] opacity-75">{c.nota}</p>
          </div>
        ))}
      </div>

      {m.funil.length > 1 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-700 mb-2">Onde as pessoas param</p>
          <div className="space-y-1.5">
            {m.funil.map(e => (
              <div key={e.pageId} className="flex items-center gap-2">
                <span className="w-36 truncate text-[11px] text-gray-500" title={e.titulo}>{e.titulo}</span>
                <div className="h-4 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all"
                    style={{ width: `${Math.max(e.pct, e.leads > 0 ? 3 : 0)}%` }}
                  />
                </div>
                <span className="w-16 text-right text-[11px] tabular-nums text-gray-500">{e.leads} · {e.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Portal do cliente ───────────────────────────────────────────────────────
// Um acesso por CLIENTE, com vários funis dentro. O dono escolhe o que o
// cliente vê em cada funil (padrão: só quem concluiu — o lead quente) e se o
// cliente pode marcar o desfecho dos leads. A senha não volta do servidor:
// esquecer = gerar link novo (o antigo morre junto).

const PUBLICO_OPCOES: { valor: PublicoPortal; rotulo: string }[] = [
  { valor: 'concluidos', rotulo: '🔥 Só quem concluiu (lead quente)' },
  { valor: 'com_resposta', rotulo: 'Quem respondeu algo' },
  { valor: 'todos', rotulo: 'Todos (inclui quem só abriu)' },
]

function ShareModal({ quizId, onClose }: { quizId: string; onClose: () => void }) {
  const [info, setInfo] = useState<PortalInfo | null>(null)
  const [disponiveis, setDisponiveis] = useState<{ id: string; titulo: string }[]>([])
  const [carregado, setCarregado] = useState(false)

  const [nome, setNome] = useState('')
  const [senha, setSenha] = useState('')
  const [selecao, setSelecao] = useState<Map<string, PublicoPortal>>(new Map([[quizId, 'concluidos']]))
  const [permitirStatus, setPermitirStatus] = useState(true)
  const [mostrarMetricas, setMostrarMetricas] = useState(true)
  const [mostrarFunil, setMostrarFunil] = useState(false)

  const [novoToken, setNovoToken] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    Promise.all([getPortalDoQuiz(quizId), listarQuizzesDoTenant()]).then(([r, q]) => {
      if ('error' in r) setErro(r.error)
      else {
        setInfo(r)
        if (r.quizzes.length > 0) {
          setSelecao(new Map(r.quizzes.map((x: PortalQuizConfig) => [x.pageId, x.publico])))
          setNome(r.nome)
          setPermitirStatus(r.permitirStatus)
          setMostrarMetricas(r.mostrarMetricas)
          setMostrarFunil(r.mostrarFunil)
        }
      }
      if (Array.isArray(q)) setDisponiveis(q)
      setCarregado(true)
    })
  }, [quizId])

  const urlDe = (token: string) => `${window.location.origin}/ql/${token}`

  function alternarQuiz(id: string) {
    setSelecao(prev => {
      const novo = new Map(prev)
      if (novo.has(id)) novo.delete(id)
      else novo.set(id, 'concluidos')
      return novo
    })
  }

  async function gerar() {
    setSalvando(true); setErro(null)
    const r = await ativarPortal({
      nome,
      senha,
      quizzes: [...selecao].map(([pageId, publico]) => ({ pageId, publico })),
      mostrarMetricas, mostrarFunil, permitirStatus,
      ...(info?.portalId ? { portalId: info.portalId } : {}),
    })
    setSalvando(false)
    if ('error' in r) { setErro(r.error); return }
    setNovoToken(r.token)
    setInfo(prev => prev ? { ...prev, ativo: true, portalId: r.portalId, token: r.token } : prev)
  }

  async function desativar() {
    if (!info?.portalId) return
    setSalvando(true)
    await desativarPortal(info.portalId)
    setSalvando(false)
    setNovoToken(null)
    setInfo(prev => prev ? { ...prev, ativo: false, token: null } : prev)
  }

  function copiar(texto: string) {
    void navigator.clipboard.writeText(texto).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    })
  }

  const tokenAtivo = novoToken ?? (info?.ativo ? info.token : null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Portal do cliente</h3>
            <p className="mt-0.5 text-sm text-gray-500">
              Um link com senha onde SEU cliente vê os leads chegando prontos —
              com botão de WhatsApp e marcação de fechado/agendado.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {erro && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        {!carregado && <div className="mt-4 h-24 animate-pulse rounded-xl bg-gray-100" />}

        {carregado && (
          <div className="mt-4 space-y-4">
            {tokenAtivo && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Link ativo</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-white px-2 py-1.5 text-xs text-gray-700">{urlDe(tokenAtivo)}</code>
                  <button onClick={() => copiar(urlDe(tokenAtivo))}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                    {copiado ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
                {info && info.acessos > 0 && (
                  <p className="mt-2 text-[11px] text-emerald-700">
                    {info.acessos} acesso(s){info.ultimoAcesso ? ` · último ${new Date(info.ultimoAcesso).toLocaleString('pt-BR')}` : ''}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-700">Nome do cliente (aparece no topo do portal)</label>
              <input type="text" value={nome} onChange={e => setNome(e.target.value)}
                placeholder="Ex.: Clínica Sorriso"
                className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-700 mb-1.5">
                Funis deste portal — e o que o cliente vê em cada um
              </p>
              <div className="space-y-1.5 max-h-52 overflow-y-auto rounded-xl border border-gray-200 p-2">
                {disponiveis.map(q => {
                  const marcado = selecao.has(q.id)
                  return (
                    <div key={q.id} className={`rounded-lg p-2 ${marcado ? 'bg-indigo-50' : ''}`}>
                      <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                        <input type="checkbox" checked={marcado} onChange={() => alternarQuiz(q.id)} />
                        <span className="truncate">{q.titulo}</span>
                        {q.id === quizId && <span className="text-[10px] text-indigo-500">(este)</span>}
                      </label>
                      {marcado && (
                        <select
                          value={selecao.get(q.id)}
                          onChange={e => setSelecao(prev => new Map(prev).set(q.id, e.target.value as PublicoPortal))}
                          className="mt-1 ml-6 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700"
                        >
                          {PUBLICO_OPCOES.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                        </select>
                      )}
                    </div>
                  )
                })}
                {disponiveis.length === 0 && <p className="p-2 text-xs text-gray-400">Nenhum quiz encontrado</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-1.5">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={permitirStatus} onChange={e => setPermitirStatus(e.target.checked)} />
                Cliente pode marcar o lead (contactado, agendado, fechado…)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={mostrarMetricas} onChange={e => setMostrarMetricas(e.target.checked)} />
                Mostrar métricas (total, conclusão, últimos 7 dias)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={mostrarFunil} onChange={e => setMostrarFunil(e.target.checked)} />
                Mostrar as etapas do funil (desligado = cliente não vê o caminho)
              </label>
            </div>

            <div className="flex gap-2">
              <input type="text" value={senha} onChange={e => setSenha(e.target.value)}
                placeholder={tokenAtivo ? 'Nova senha (gera link novo)' : 'Crie uma senha para o cliente'}
                className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
              <button onClick={gerar} disabled={salvando || senha.trim().length === 0 || selecao.size === 0}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {salvando ? 'Salvando…' : tokenAtivo ? 'Renovar link' : 'Gerar link'}
              </button>
            </div>
            <p className="text-xs text-gray-500">
              A senha não fica salva aqui — anote e envie junto com o link. Renovar
              gera link novo e o antigo para de funcionar na hora.
            </p>

            {tokenAtivo && (
              <button onClick={desativar} disabled={salvando}
                className="w-full rounded-xl border border-red-200 py-2 text-sm font-medium text-red-600 hover:bg-red-50">
                Desativar portal
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Investimento manual ─────────────────────────────────────────────────────
// O dono lança "gastei R$ X no dia Y" — o portal do cliente calcula custo por
// lead e custo por lead quente sozinho. Lançar duas vezes no MESMO dia
// corrige o valor, não soma. Só o dono vê esta tela.

function fmtBrl(cents: number): string {
  return `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function hojeIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function SpendModal({ quizId, onClose }: { quizId: string; onClose: () => void }) {
  const [dias, setDias] = useState<InvestimentoDia[]>([])
  const [total, setTotal] = useState(0)
  const [data, setData] = useState(hojeIso())
  const [valor, setValor] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(() => {
    void listarInvestimentos(quizId).then(r => {
      if ('error' in r) setErro(r.error)
      else { setDias(r.dias); setTotal(r.totalCents); setErro(null) }
    })
  }, [quizId])

  useEffect(() => { carregar() }, [carregar])

  async function lancar() {
    // Aceita "300", "300,50" e "R$ 300,50".
    const limpo = valor.replace(/[^\d,\.]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.')
    const reais = Number.parseFloat(limpo)
    if (!Number.isFinite(reais) || reais <= 0) { setErro('Informe um valor válido, ex.: 300 ou 300,50'); return }
    setSalvando(true); setErro(null)
    const r = await salvarInvestimento(quizId, { date: data, amountCents: Math.round(reais * 100) })
    setSalvando(false)
    if ('error' in r) { setErro(r.error); return }
    setValor('')
    carregar()
  }

  async function excluir(id: string) {
    await excluirInvestimento(quizId, id)
    carregar()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">💰 Investimento em anúncios</h3>
            <p className="mt-0.5 text-sm text-gray-500">
              Lance o gasto por dia. O portal do seu cliente calcula sozinho o custo
              por lead e o custo por lead quente. Ele não vê esta tela.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {erro && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        <div className="mt-4 flex gap-2">
          <input type="date" value={data} max={hojeIso()} onChange={e => setData(e.target.value)}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
          <input type="text" inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)}
            placeholder="R$ 300,00"
            onKeyDown={e => { if (e.key === 'Enter') void lancar() }}
            className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
          <button onClick={lancar} disabled={salvando}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            Lançar
          </button>
        </div>
        <p className="mt-1.5 text-xs text-gray-400">
          Lançar de novo no mesmo dia corrige o valor daquele dia (não soma).
        </p>

        <div className="mt-4 max-h-56 space-y-1 overflow-y-auto">
          {dias.map(d => (
            <div key={d.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span className="text-gray-600">{new Date(`${d.date}T12:00:00`).toLocaleDateString('pt-BR')}</span>
              <span className="font-semibold text-gray-900">{fmtBrl(d.amountCents)}</span>
              <button onClick={() => void excluir(d.id)} title="Excluir"
                className="text-gray-300 hover:text-red-500">✕</button>
            </div>
          ))}
          {dias.length === 0 && !erro && (
            <p className="py-4 text-center text-xs text-gray-400">Nenhum lançamento ainda</p>
          )}
        </div>

        {total > 0 && (
          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-sm">
            <span className="font-semibold text-gray-700">Total investido</span>
            <span className="text-lg font-bold text-gray-900">{fmtBrl(total)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QuizLeadsView({ quizId, pages }: { quizId: string; pages: QuizPage[] }) {
  const [leads, setLeads] = useState<QuizLeadWithEvents[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState<Period>('all')
  const [loading, setLoading] = useState(true)
  const [selectedLead, setSelectedLead] = useState<QuizLeadWithEvents | null>(null)
  const [resetting, setResetting] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Seleção de exportação: quais páginas, se inclui os dados do lead, e erro.
  const [exportOpen, setExportOpen] = useState(false)
  const [paginasExport, setPaginasExport] = useState<ExportPageInfo[]>([])
  const [colunasSel, setColunasSel] = useState<Set<string>>(new Set())
  const [incluirLeadExport, setIncluirLeadExport] = useState(true)
  // QUEM entra no arquivo. Padrão 'todos' — não muda o que já existia.
  const [publicoExport, setPublicoExport] = useState<ExportPublico>('todos')
  const [erroExport, setErroExport] = useState<string | null>(null)
  const [leadsExport, setLeadsExport] = useState<ExportLeadResumo[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [spendOpen, setSpendOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await getQuizLeads(quizId, { search, period, page, pageSize })
    if ('leads' in result) {
      setLeads(result.leads)
      setTotal(result.total)
    }
    setLoading(false)
  }, [quizId, search, period, page, pageSize])

  useEffect(() => { load() }, [load])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const { ocultas, alternar: alternarOculta, mostrarTodas } = useColunasOcultas(quizId)
  const { exportados, registrar: registrarExportados, limpar: limparExportados } = useJaExportados(quizId)
  // Pular quem já foi exportado antes — desligado por padrão.
  const [pularExportados, setPularExportados] = useState(false)

  /** Abre o seletor de exportação já sabendo quais páginas existem. */
  async function abrirExport() {
    setErroExport(null)
    setExportOpen(true)
    if (paginasExport.length === 0) {
      const r = await getExportStructure(quizId)
      if ('error' in r) { setErroExport(r.error); return }
      setPaginasExport(r.paginas)
      setLeadsExport(r.leads)
      // Começa marcando o que TEM resposta: coluna que ninguém preencheu só
      // atrapalha a planilha, mas continua visível para ser marcada à mão.
      const comResposta = r.paginas.flatMap(p => p.colunas.filter(c => c.respostas > 0).map(c => c.chave))
      const todas = r.paginas.flatMap(p => p.colunas.map(c => c.chave))
      setColunasSel(new Set([...COLUNAS_LEAD_CHAVES, ...(comResposta.length > 0 ? comResposta : todas)]))
    }
  }

  /**
   * Quantos leads cada filtro pega COM A SELEÇÃO ATUAL de colunas.
   *
   * Calculado aqui, a partir do resumo que o servidor mandou: a contagem muda
   * junto com as caixas marcadas, sem uma ida ao servidor por clique.
   */
  function contarPublico(alvo: ExportPublico): number {
    const perguntas = [...colunasSel].filter(c => !c.startsWith('lead:'))
    // A contagem mostra o número REAL do arquivo: se "pular exportados" está
    // ligado, quem já saiu antes não conta aqui também.
    const base = pularExportados
      ? leadsExport.filter(l => !exportados.has(l.id))
      : leadsExport
    if (alvo === 'todos') return base.length
    if (alvo === 'concluidos') return base.filter(l => l.concluido).length
    if (alvo === 'com_resposta') {
      return base.filter(l => l.chaves.some(k => perguntas.includes(k))).length
    }
    if (perguntas.length === 0) return 0
    return base.filter(l => perguntas.every(k => l.chaves.includes(k))).length
  }

  async function handleExport(formato: 'csv' | 'pdf') {
    setExporting(true)
    setErroExport(null)
    try {
      const t = await exportLeadsTable(quizId, {
        columnKeys: [...colunasSel],
        incluirLead: incluirLeadExport,
        publico: publicoExport,
        ...(pularExportados ? { excluirIds: [...exportados] } : {}),
      })
      if ('error' in t) { setErroExport(t.error); return }
      if (t.linhas.length === 0) {
        setErroExport(
          pularExportados
            ? 'Todos os leads desse filtro já foram exportados antes. Desmarque "Pular quem já exportei antes" ou limpe o histórico.'
            : publicoExport === 'todos'
              ? 'Nenhuma resposta para exportar.'
              : 'Nenhum lead se encaixa nesse filtro. Tente uma opção mais aberta em "Quem entra".')
        return
      }

      if (formato === 'csv') {
        baixarCsv(t, `quiz-${quizId.slice(0, 6)}`)
      } else {
        const bloqueado = abrirPdf(t)
        if (bloqueado) { setErroExport(bloqueado); return }
      }
      // Só depois de gerar o arquivo: quem entrou nele passa a contar como
      // exportado, e pode ser pulado na próxima rodada.
      registrarExportados(t.ids)
      setExportOpen(false)
    } finally {
      setExporting(false)
    }
  }

  async function handleReset() {
    if (!confirm('Tem certeza? Todos os dados de leads deste quiz serão apagados permanentemente.')) return
    setResetting(true)
    await resetQuizLeads(quizId)
    setResetting(false)
    load()
  }

  // Build per-page drop rate (leads that reached each page / total)
  const reachCount: Record<string, number> = {}
  for (const lead of leads) {
    const visitedPages = new Set(lead.events.map(e => e.page_id))
    for (const pid of visitedPages) reachCount[pid] = (reachCount[pid] ?? 0) + 1
  }

  // Tempo médio por página (entre a visita de uma página e a da próxima)
  const timeSum: Record<string, number> = {}
  const timeCount: Record<string, number> = {}
  for (const lead of leads) {
    const views = lead.events
      .filter(e => e.event_type === 'page_viewed')
      .map(e => ({ pid: e.page_id, t: new Date(e.created_at).getTime() }))
      .sort((a, b) => a.t - b.t)
    for (let i = 0; i < views.length - 1; i++) {
      const dt = (views[i + 1].t - views[i].t) / 1000
      if (dt > 0 && dt < 3600) {
        timeSum[views[i].pid] = (timeSum[views[i].pid] ?? 0) + dt
        timeCount[views[i].pid] = (timeCount[views[i].pid] ?? 0) + 1
      }
    }
  }
  const avgTime = (pid: string): string | null => {
    if (!timeCount[pid]) return null
    const s = Math.round(timeSum[pid] / timeCount[pid])
    return s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? ' ' + (s % 60) + 's' : ''}` : `${s}s`
  }

  const totalPages = Math.ceil(total / pageSize)


  return (
    <div className="flex flex-col h-full overflow-hidden bg-gray-50">
      {/* Toolbar */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-48 max-w-72">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Buscar por nome, e-mail, telefone..."
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          {/* Period filter */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs font-medium shrink-0">
            {(['24h','7d','30d','all'] as Period[]).map(p => (
              <button key={p} onClick={() => { setPeriod(p); setPage(1) }}
                className={`px-3 py-1.5 transition ${period === p ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {p === 'all' ? 'Todos' : p}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Refresh */}
          <button onClick={load} className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition" title="Atualizar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
          </button>

          {/* Colunas ocultas: o estado precisa ser VISÍVEL e reversível. */}
          {ocultas.size > 0 && (
            <button
              onClick={mostrarTodas}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-amber-200 bg-amber-50 rounded-lg text-amber-700 hover:bg-amber-100 transition">
              {ocultas.size} {ocultas.size === 1 ? 'coluna oculta' : 'colunas ocultas'} · mostrar todas
            </button>
          )}

          {/* Investimento manual: alimenta o custo por lead do portal. */}
          <button onClick={() => setSpendOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition">
            💰 Investimento
          </button>

          {/* Compartilhar: link com senha para o cliente baixar os leads. */}
          <button onClick={() => setShareOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/>
            </svg>
            Compartilhar
          </button>

          {/* Export — abre a SELEÇÃO; nada é baixado antes da escolha. */}
          <button onClick={abrirExport} disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50 transition disabled:opacity-50">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {exporting ? 'Exportando…' : 'Exportar'}
          </button>

          {/* Reset */}
          <button onClick={handleReset} disabled={resetting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-red-200 rounded-lg text-red-500 hover:bg-red-50 transition disabled:opacity-50">
            {resetting ? 'Resetando…' : 'Resetar dados'}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        {/* Stats */}
        <StatsBar quizId={quizId} />

        {/* Resumo agregado de respostas */}
        <AnswerBreakdown quizId={quizId} pages={pages} refreshKey={total} />

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <svg className="animate-spin w-6 h-6 text-indigo-400" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/>
              </svg>
            </div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400">
              <p className="text-4xl mb-2">📭</p>
              <p className="text-sm font-medium">Nenhum lead encontrado</p>
              <p className="text-xs mt-1">Publique o quiz e compartilhe o link para começar a capturar dados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left px-4 py-3 font-semibold text-gray-500 whitespace-nowrap sticky left-0 bg-gray-50 z-10 w-28">
                      Lead / Data
                    </th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-500 whitespace-nowrap w-24">Status</th>
                    {pages.filter(p => !ocultas.has(p.id)).map(p => {
                      const reached = reachCount[p.id] ?? 0
                      const rate = total > 0 ? Math.round((reached / total) * 100) : 0
                      return (
                        <th key={p.id} className="text-left px-3 py-3 font-semibold text-gray-500 min-w-[120px]">
                          <div className="flex items-start gap-1">
                            <div className="truncate max-w-[120px]" title={p.title}>{p.title}</div>
                            {/* Ocultar esta coluna da leitura — não apaga nada. */}
                            <button
                              onClick={() => alternarOculta(p.id)}
                              title="Ocultar esta coluna"
                              className="ml-auto shrink-0 text-gray-300 hover:text-rose-500 transition-colors">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              </svg>
                            </button>
                          </div>
                          <div className="mt-0.5">
                            <div className="flex items-center gap-1">
                              <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-indigo-400" style={{ width: `${rate}%` }} />
                              </div>
                              <span className="text-[9px] text-gray-400 shrink-0">{rate}%</span>
                            </div>
                            {avgTime(p.id) && <div className="text-[9px] text-gray-400 mt-0.5">⏱ {avgTime(p.id)} em média</div>}
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {leads.map(lead => (
                    <tr
                      key={lead.id}
                      className="hover:bg-indigo-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedLead(lead)}
                    >
                      <td className="px-4 py-3 sticky left-0 bg-white hover:bg-indigo-50 z-10">
                        <p className="font-bold text-gray-800 font-mono">#{shortId(lead.id)}</p>
                        <p className="text-[10px] text-gray-400">{fmtDate(lead.started_at)}</p>
                        {(lead.name || lead.email) && (
                          <p className="text-[10px] text-indigo-600 truncate max-w-[96px]">{lead.name || lead.email}</p>
                        )}
                      </td>
                      <td className="px-3 py-3">{statusBadge(lead.status)}</td>
                      {pages.filter(p => !ocultas.has(p.id)).map(p => {
                        const cell = pageCellValue(lead, p.id)
                        const reached = cell.state !== 'none'
                        // O que foi respondido NESTA página — nunca o contato do
                        // lead repetido em toda página que tenha formulário.
                        const respostas = pageAnswers(lead, p)
                        if (reached && respostas.length > 0) {
                          return (
                            <td key={p.id} className="px-3 py-3 align-top">
                              <div className="flex flex-col gap-0.5 rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1.5">
                                {respostas.map((r, i) => {
                                  const ehTelefone = r.tipo === 'field_phone'
                                  return (
                                    <span key={i} className="flex items-start gap-1 text-emerald-800">
                                      <span className="shrink-0">{iconeCampo(r.tipo)}</span>
                                      {ehTelefone ? (
                                        <a
                                          href={`https://wa.me/${r.valor.replace(/\D/g, '')}`}
                                          target="_blank" rel="noopener noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="text-emerald-700 hover:underline truncate max-w-[150px]"
                                        >{r.valor}</a>
                                      ) : (
                                        <span
                                          className="truncate max-w-[150px]"
                                          title={r.rotulo ? `${r.rotulo}: ${r.valor}` : r.valor}
                                        >{r.valor}</span>
                                      )}
                                    </span>
                                  )
                                })}
                              </div>
                            </td>
                          )
                        }
                        // Captura final (bloco único que junta os campos): aí sim
                        // o contato do lead É a resposta daquela página.
                        const ehCapturaFinal = (p.blocks ?? []).some(b => b.type === 'final_capture')
                        if (ehCapturaFinal && reached && (lead.name || lead.email || lead.phone)) {
                          return (
                            <td key={p.id} className="px-3 py-3 align-top">
                              <div className="flex flex-col gap-0.5 rounded-lg bg-emerald-50 border border-emerald-100 px-2 py-1.5">
                                {lead.name && <span className="font-semibold text-emerald-800 truncate max-w-[150px]">👤 {lead.name}</span>}
                                {lead.phone && <a href={`https://wa.me/${lead.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-emerald-700 hover:underline">📱 {lead.phone}</a>}
                                {lead.email && <span className="text-emerald-700 truncate max-w-[150px]" title={lead.email}>✉ {lead.email}</span>}
                              </div>
                            </td>
                          )
                        }
                        return (
                          <td key={p.id} className="px-3 py-3">
                            {cell.state === 'none' ? (
                              <span className="text-gray-200">—</span>
                            ) : cell.state === 'visited' ? (
                              <span className="flex items-center gap-1 text-amber-500">
                                <span className="w-4 h-4 rounded-full bg-amber-100 flex items-center justify-center text-[9px]">!</span>
                                <span className="text-gray-400">Visitou</span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-emerald-600">
                                <span className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5"><polyline points="20 6 9 17 4 12"/></svg>
                                </span>
                                <span className="text-gray-600 truncate max-w-[100px]" title={cell.summary}>{cell.summary}</span>
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-xs text-gray-500">
            <span>Mostrando {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total} leads</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Anterior</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-2.5 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Próxima →</button>
            </div>
          </div>
        )}
      </div>

      {/* Seleção de exportação: páginas + formato */}
      {exportOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setExportOpen(false)} />
          <div className="fixed z-50 inset-0 flex items-center justify-center p-4 pointer-events-none">
            <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-white shadow-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-900">Exportar respostas</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Escolha o que entra no arquivo. Cada pergunta vira uma coluna.
                </p>
              </div>

              <div className="px-5 py-4 max-h-[50vh] overflow-y-auto space-y-3">
                <div>
                  <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    Quem entra
                  </span>
                  <div className="space-y-1">
                    {([
                      ['todos', 'Todos os leads', 'inclusive quem só visitou'],
                      ['com_resposta', 'Só quem respondeu algo', 'pelo menos uma das colunas escolhidas'],
                      ['completos', 'Só quem preencheu tudo', 'todas as colunas escolhidas'],
                      ['concluidos', 'Só quem concluiu o quiz', 'chegou até o fim'],
                    ] as const).map(([valor, titulo, ajuda]) => (
                      <label key={valor}
                        className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 cursor-pointer transition ${
                          publicoExport === valor ? 'border-indigo-300 bg-indigo-50/60' : 'border-gray-200 hover:border-indigo-200'
                        }`}>
                        <input type="radio" name="publico-export" checked={publicoExport === valor}
                          onChange={() => setPublicoExport(valor)}
                          className="w-4 h-4 mt-0.5 accent-indigo-600" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-800">{titulo}</span>
                          <span className="block text-[11px] text-gray-500">{ajuda}</span>
                        </span>
                        {/* A contagem some a dúvida: dá para ver o zero ANTES de clicar. */}
                        <span className={`shrink-0 text-[11px] font-semibold ${
                          contarPublico(valor) === 0 ? 'text-amber-600' : 'text-gray-500'
                        }`}>
                          {contarPublico(valor)} {contarPublico(valor) === 1 ? 'lead' : 'leads'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Não repetir quem já saiu numa exportação anterior. */}
                <div className="rounded-lg border border-gray-200 px-2.5 py-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={pularExportados}
                      onChange={e => setPularExportados(e.target.checked)}
                      className="w-4 h-4 accent-indigo-600" />
                    <span>Pular quem já exportei antes</span>
                    <span className="ml-auto text-[11px] text-gray-400">
                      {exportados.size} {exportados.size === 1 ? 'marcado' : 'marcados'}
                    </span>
                  </label>
                  {exportados.size > 0 && (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-gray-500">
                        A marca fica neste navegador, por quiz.
                      </span>
                      <button onClick={limparExportados}
                        className="text-[11px] font-semibold text-gray-500 hover:text-rose-600 hover:underline">
                        Limpar histórico
                      </button>
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={incluirLeadExport}
                    onChange={e => setIncluirLeadExport(e.target.checked)}
                    className="w-4 h-4 accent-indigo-600" />
                  <span>Dados do lead <span className="text-gray-400">(ID, data, status, contato, origem)</span></span>
                </label>

                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Colunas</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setColunasSel(atual => {
                          const novo = new Set(atual)
                          for (const p of paginasExport) {
                            for (const c of p.colunas) if (c.respostas === 0) novo.delete(c.chave)
                          }
                          return novo
                        })}
                        className="text-[11px] font-semibold text-gray-500 hover:text-gray-700 hover:underline">
                        Desmarcar vazias
                      </button>
                      <button
                        onClick={() => {
                          const todas = paginasExport.flatMap(p => p.colunas.map(c => c.chave))
                          setColunasSel(atual => {
                            const marcadas = todas.filter(c => atual.has(c)).length
                            const base = new Set([...atual].filter(c => c.startsWith('lead:')))
                            return marcadas === todas.length ? base : new Set([...base, ...todas])
                          })
                        }}
                        className="text-[11px] font-semibold text-indigo-600 hover:underline">
                        Marcar/desmarcar todas
                      </button>
                    </div>
                  </div>

                  {paginasExport.length === 0 ? (
                    <p className="text-xs text-gray-400">Carregando colunas…</p>
                  ) : (
                    <div className="space-y-2.5">
                      {paginasExport.filter(p => p.colunas.length > 0).map(p => {
                        const chaves = p.colunas.map(c => c.chave)
                        const marcadas = chaves.filter(c => colunasSel.has(c)).length
                        return (
                          <div key={p.id} className="rounded-lg border border-gray-200 overflow-hidden">
                            {/* Cabeçalho da página: marca/desmarca as colunas dela de uma vez */}
                            <label className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 cursor-pointer">
                              <input type="checkbox"
                                checked={marcadas === chaves.length}
                                ref={el => { if (el) el.indeterminate = marcadas > 0 && marcadas < chaves.length }}
                                onChange={() => setColunasSel(atual => {
                                  const novo = new Set(atual)
                                  if (marcadas === chaves.length) chaves.forEach(c => novo.delete(c))
                                  else chaves.forEach(c => novo.add(c))
                                  return novo
                                })}
                                className="w-4 h-4 accent-indigo-600" />
                              <span className="text-xs font-bold text-gray-700 truncate">{p.titulo}</span>
                              <span className="ml-auto text-[10px] text-gray-400">{marcadas}/{chaves.length}</span>
                            </label>

                            {/* Uma linha por PERGUNTA — é a coluna que sai no arquivo */}
                            <div className="divide-y divide-gray-100">
                              {p.colunas.map(c => (
                                <label key={c.chave}
                                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-indigo-50/40">
                                  <input type="checkbox" checked={colunasSel.has(c.chave)}
                                    onChange={() => setColunasSel(atual => {
                                      const novo = new Set(atual)
                                      if (novo.has(c.chave)) novo.delete(c.chave); else novo.add(c.chave)
                                      return novo
                                    })}
                                    className="w-4 h-4 accent-indigo-600" />
                                  <span className="text-sm text-gray-700 truncate">{c.rotulo}</span>
                                  <span className={`ml-auto text-[10px] shrink-0 ${c.respostas === 0 ? 'text-amber-600 font-semibold' : 'text-gray-400'}`}>
                                    {c.respostas === 0 ? 'sem respostas' : `${c.respostas} resp.`}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {erroExport && (
                  <p className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
                    {erroExport}
                  </p>
                )}
              </div>

              <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between gap-2">
                <button onClick={() => setExportOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800">
                  Cancelar
                </button>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleExport('csv')} disabled={exporting}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {exporting ? 'Gerando…' : 'Baixar CSV'}
                  </button>
                  <button onClick={() => handleExport('pdf')} disabled={exporting}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                    {exporting ? 'Gerando…' : 'Gerar PDF'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Detail panel */}
      {shareOpen && <ShareModal quizId={quizId} onClose={() => setShareOpen(false)} />}
      {spendOpen && <SpendModal quizId={quizId} onClose={() => setSpendOpen(false)} />}

      {selectedLead && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedLead(null)} />
          <LeadDetailPanel lead={selectedLead} pages={pages} onClose={() => setSelectedLead(null)} />
        </>
      )}
    </div>
  )
}
