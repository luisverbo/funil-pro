'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import {
  getQuizLeads, getQuizStats, resetQuizLeads, getAnswerBreakdown,
  getExportStructure, exportLeadsTable,
  type ExportPageInfo, type ExportTable, type ExportPublico,
  type QuizLead, type QuizLeadWithEvents,
} from '@/app/actions/quiz-leads'
import type { QuizPage } from '@/app/actions/quiz-v2'

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

function StatsBar({ quizId, pages }: { quizId: string; pages: QuizPage[] }) {
  const [stats, setStats] = useState<{
    total: number; completed: number; inProgress: number; completionRate: number; topDropOffPageId: string | null
  } | null>(null)

  useEffect(() => {
    getQuizStats(quizId).then(r => {
      if ('total' in r) setStats(r)
    })
  }, [quizId])

  if (!stats) return <div className="h-20 bg-white rounded-xl border border-gray-200 animate-pulse mb-4" />

  const dropOffPage = stats.topDropOffPageId ? pages.find(p => p.id === stats.topDropOffPageId) : null

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {[
        { label: 'Total iniciado', value: stats.total, color: 'text-gray-900' },
        { label: 'Concluíram', value: stats.completed, color: 'text-emerald-600' },
        { label: 'Taxa de conclusão', value: `${Math.round(stats.completionRate)}%`, color: 'text-indigo-600' },
        { label: 'Maior abandono', value: dropOffPage ? dropOffPage.title : '—', color: 'text-amber-600' },
      ].map(s => (
        <div key={s.label} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
          <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">{s.label}</p>
          <p className={`text-xl font-bold ${s.color} truncate`}>{s.value}</p>
        </div>
      ))}
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
  const [searchInput, setSearchInput] = useState('')

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

  /** Abre o seletor de exportação já sabendo quais páginas existem. */
  async function abrirExport() {
    setErroExport(null)
    setExportOpen(true)
    if (paginasExport.length === 0) {
      const r = await getExportStructure(quizId)
      if ('error' in r) { setErroExport(r.error); return }
      setPaginasExport(r.paginas)
      // Começa marcando o que TEM resposta: coluna que ninguém preencheu só
      // atrapalha a planilha, mas continua visível para ser marcada à mão.
      const comResposta = r.paginas.flatMap(p => p.colunas.filter(c => c.respostas > 0).map(c => c.chave))
      const todas = r.paginas.flatMap(p => p.colunas.map(c => c.chave))
      setColunasSel(new Set([...COLUNAS_LEAD_CHAVES, ...(comResposta.length > 0 ? comResposta : todas)]))
    }
  }

  /** CSV com escape correto (vírgula, aspas e quebra de linha no valor). */
  function montarCsv(t: ExportTable): string {
    const esc = (v: string) =>
      /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    return [t.colunas.map(c => esc(c.rotulo)), ...t.linhas.map(l => l.map(esc))]
      .map(l => l.join(','))
      .join('\n')
  }

  /**
   * PDF sem dependência nova: uma janela de impressão com a tabela pronta e o
   * diálogo do navegador em "Salvar como PDF". Todo o conteúdo é escapado —
   * resposta de lead nunca vira HTML.
   */
  function abrirPdf(t: ExportTable) {
    const esc = (v: string) => v
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    const cab = t.colunas.map(c => `<th>${esc(c.rotulo)}</th>`).join('')
    const corpo = t.linhas
      .map(l => `<tr>${l.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`)
      .join('')
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(t.titulo)} — respostas</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111827; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  p.sub { font-size: 11px; color: #6b7280; margin: 0 0 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th, td { border: 1px solid #d1d5db; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 700; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
</style></head><body>
<h1>${esc(t.titulo)}</h1>
<p class="sub">${t.linhas.length} ${t.linhas.length === 1 ? 'resposta' : 'respostas'} · gerado em ${esc(new Date().toLocaleString('pt-BR'))}</p>
<table><thead><tr>${cab}</tr></thead><tbody>${corpo}</tbody></table>
</body></html>`
    const janela = window.open('', '_blank')
    if (!janela) { setErroExport('O navegador bloqueou a janela. Libere pop-ups para gerar o PDF.'); return }
    janela.document.write(html)
    janela.document.close()
    janela.focus()
    setTimeout(() => janela.print(), 400)
  }

  async function handleExport(formato: 'csv' | 'pdf') {
    setExporting(true)
    setErroExport(null)
    try {
      const t = await exportLeadsTable(quizId, {
        columnKeys: [...colunasSel],
        incluirLead: incluirLeadExport,
        publico: publicoExport,
      })
      if ('error' in t) { setErroExport(t.error); return }
      if (t.linhas.length === 0) {
        setErroExport(publicoExport === 'todos'
          ? 'Nenhuma resposta para exportar.'
          : 'Nenhum lead se encaixa nesse filtro. Tente uma opção mais aberta em "Quem entra".')
        return
      }

      if (formato === 'csv') {
        // BOM: o Excel em pt-BR precisa dele para não quebrar acentuação.
        const blob = new Blob(['\uFEFF' + montarCsv(t)], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = `quiz-${quizId.slice(0, 6)}.csv`; a.click()
        URL.revokeObjectURL(url)
      } else {
        abrirPdf(t)
      }
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
        <StatsBar quizId={quizId} pages={pages} />

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
                        <span className="min-w-0">
                          <span className="block text-sm text-gray-800">{titulo}</span>
                          <span className="block text-[11px] text-gray-500">{ajuda}</span>
                        </span>
                      </label>
                    ))}
                  </div>
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
      {selectedLead && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setSelectedLead(null)} />
          <LeadDetailPanel lead={selectedLead} pages={pages} onClose={() => setSelectedLead(null)} />
        </>
      )}
    </div>
  )
}
