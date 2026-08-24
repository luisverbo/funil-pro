'use client'

// ============================================================================
// Portal do cliente — a tela que o CLIENTE do dono do tenant vê
// ----------------------------------------------------------------------------
// Quem abre isto recebeu um link e uma senha, e não conhece o FunilPro. O
// portal existe para UMA coisa: entregar o lead pronto. Por isso:
//
//   • o lead quente (concluiu o funil) chega com 🔥 e botão de WhatsApp — um
//     clique e o cliente está falando com ele;
//   • o cliente marca o desfecho (contactado, agendado, fechado…) e isso fica
//     gravado — vira prestação de contas do tráfego para o dono;
//   • vários funis num acesso só, escolhidos um a um — nunca misturados.
//
// A senha vive apenas na memória do componente e é reenviada a cada ação;
// nada dela vai para URL, armazenamento do navegador ou cookie.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ExportTable, QuizMetricas, LeadPortal } from '@/lib/quiz/leads-core'
import { abrirPdf, baixarCsv } from '@/components/quiz/export-files'
import {
  STATUS_PORTAL, STATUS_PORTAL_META, linkWhatsApp, nomeDoLead, type StatusPortal,
} from '@/lib/quiz/portal'
import {
  calcularCustos, diaLocal, diaNoPeriodo, rotuloPeriodo,
  type FiltroPeriodo, type LancamentoDia,
} from '@/lib/quiz/custos'

interface Abertura {
  nome: string
  permitirStatus: boolean
  mostrarMetricas: boolean
  mostrarFunil: boolean
  quizzes: { id: string; titulo: string }[]
}

interface LeadComStatus extends LeadPortal { statusCliente: string }

interface DadosQuiz {
  quiz: { id: string; titulo: string; publico: string }
  leads: LeadComStatus[]
  metricas: QuizMetricas | null
  /** Metadados de TODOS os leads — a tela recalcula os números por período. */
  baseMetricas: { data: string | null; concluiu: boolean; temContato: boolean }[]
  /** Lançamentos por dia — a tela recalcula o custo junto com o filtro. */
  investimentos: LancamentoDia[]
  tabela: ExportTable | null
}

/** nomeDoLead espera name/phone (formato do banco); o portal fala nome/telefone.
 *  Foi ESTE descasamento que mostrava "Lead sem nome" com o nome logo abaixo,
 *  dentro de "Ver respostas". */
const tituloDoLead = (l: LeadComStatus) =>
  nomeDoLead({ name: l.nome, email: l.email, phone: l.telefone })

const brl = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function SharePanelClient({ token }: { token: string }) {
  const [senha, setSenha] = useState('')
  const [senhaOk, setSenhaOk] = useState<string | null>(null)
  const [portal, setPortal] = useState<Abertura | null>(null)
  const [quizAtivo, setQuizAtivo] = useState<string | null>(null)
  const [dados, setDados] = useState<DadosQuiz | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [verificandoSessao, setVerificandoSessao] = useState(true)
  // Filtro por dia: chips rápidos + data específica. Vale para a lista E para
  // o arquivo baixado — baixar coisa diferente do que se vê é armadilha.
  const [periodo, setPeriodo] = useState<'tudo' | 'hoje' | '7d' | '30d'>('tudo')
  const [diaEspecifico, setDiaEspecifico] = useState('')

  const api = async (payload: Record<string, unknown>) => {
    const resp = await fetch(`/api/portal/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `credentials: same-origin` é o padrão, mas explicitar deixa claro que
      // é o COOKIE de sessão que sustenta o portal depois do login.
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    })
    const json = await resp.json()
    if (!resp.ok) throw Object.assign(new Error(json?.error ?? 'Falha'), { status: resp.status })
    return json
  }

  const entrar = async () => {
    setCarregando(true); setErro(null)
    try {
      const r = (await api({ senha, acao: 'abrir' })) as Abertura
      setSenhaOk(senha)
      setPortal(r)
      if (r.quizzes.length > 0) void abrirQuiz(r.quizzes[0].id, senha)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir')
    } finally {
      setCarregando(false)
    }
  }

  const abrirQuiz = async (quizId: string, senhaUsar?: string) => {
    const s = senhaUsar ?? senhaOk ?? ''
    setQuizAtivo(quizId)
    setCarregando(true); setErro(null)
    try {
      setDados((await api({ senha: s, acao: 'quiz', quizId })) as DadosQuiz)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o funil')
      setDados(null)
    } finally {
      setCarregando(false)
    }
  }

  const marcarStatus = async (leadId: string, status: StatusPortal) => {
    if (!dados) return
    // Otimista: a tela muda na hora; se o servidor recusar, volta.
    const anterior = dados
    setDados({
      ...dados,
      leads: dados.leads.map(l => l.id === leadId ? { ...l, statusCliente: status } : l),
    })
    try {
      await api({ senha: senhaOk ?? '', acao: 'status', leadId, status })
    } catch (e) {
      setDados(anterior)
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar o status')
    }
  }

  // F5 não pode deslogar: a sessão vive num cookie assinado, então a
  // primeira tentativa é SEM senha. Só quando ela é recusada a tela de senha
  // aparece — e aí sem piscar "erro" para quem apenas chegou pelo link.
  const tentouSessao = useRef(false)
  useEffect(() => {
    if (tentouSessao.current) return
    tentouSessao.current = true
    void (async () => {
      try {
        const r = (await api({ acao: 'abrir' })) as Abertura
        setPortal(r)
        if (r.quizzes.length > 0) void abrirQuiz(r.quizzes[0].id, '')
      } catch {
        setVerificandoSessao(false)   // sem sessão: pede a senha
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const leadsFiltrados = useMemo(() => {
    if (!dados) return []
    const q = busca.trim().toLowerCase()
    const agora = new Date()
    const inicioHoje = new Date(agora); inicioHoje.setHours(0, 0, 0, 0)

    return dados.leads.filter(l => {
      if (q && !((l.nome ?? '').toLowerCase().includes(q)
        || (l.email ?? '').toLowerCase().includes(q)
        || (l.telefone ?? '').includes(q))) return false

      if (diaEspecifico) {
        if (!l.data) return false
        const d = new Date(l.data)
        const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        return local === diaEspecifico
      }
      if (periodo === 'tudo') return true
      if (!l.data) return false
      const t = new Date(l.data).getTime()
      if (periodo === 'hoje') return t >= inicioHoje.getTime()
      const dias = periodo === '7d' ? 7 : 30
      return t >= agora.getTime() - dias * 86_400_000
    })
  }, [dados, busca, periodo, diaEspecifico])

  /** Respostas do lead nas páginas que o dono liberou — vem da MESMA tabela
   *  do CSV, então tela e arquivo mostram o mesmo conteúdo. */
  const respostasDoLead = useMemo(() => {
    const mapa = new Map<string, { rotulo: string; valor: string }[]>()
    const t = dados?.tabela
    if (!t) return mapa
    t.ids.forEach((id, i) => {
      const linha = t.linhas[i] ?? []
      const itens = t.colunas
        .map((c, j) => ({ c, v: (linha[j] ?? '').trim() }))
        .filter(({ c, v }) => !c.chave.startsWith('lead:') && v.length > 0)
        .map(({ c, v }) => ({ rotulo: c.rotulo, valor: v }))
      if (itens.length > 0) mapa.set(id, itens)
    })
    return mapa
  }, [dados])

  /** CSV/PDF com a coluna "Situação" que o cliente marcou — os ids da tabela
   *  vêm NA MESMA ORDEM das linhas, então o merge é por posição. */
  const tabelaComStatus = (): ExportTable | null => {
    if (!dados?.tabela) return null
    const t = dados.tabela
    const statusDe = new Map(dados.leads.map(l => [l.id, STATUS_PORTAL_META[(l.statusCliente as StatusPortal)]?.rotulo ?? l.statusCliente]))
    // O arquivo sai com o MESMO filtro da tela (busca + dia).
    const visiveis = new Set(leadsFiltrados.map(l => l.id))
    const indices = t.ids.map((id, i) => ({ id, i })).filter(x => visiveis.has(x.id))
    // As colunas Nome/E-mail/Telefone saem com o dado ENRIQUECIDO (derivado
    // das respostas) — o cadastro cru fica vazio em muitos funis.
    const porId = new Map(dados.leads.map(l => [l.id, l]))
    const preencher = (chave: string, id: string, atual: string): string => {
      if (atual.trim()) return atual
      const l = porId.get(id)
      if (!l) return atual
      if (chave === 'lead:nome') return l.nome ?? atual
      if (chave === 'lead:email') return l.email ?? atual
      if (chave === 'lead:telefone') return l.telefone ?? atual
      return atual
    }
    return {
      ...t,
      colunas: [...t.colunas, { chave: 'portal:status', rotulo: 'Situação', respostas: 0 }],
      linhas: indices.map(({ id, i }) => [
        ...(t.linhas[i] ?? []).map((v, j) => preencher(t.colunas[j]?.chave ?? '', id, v)),
        statusDe.get(id) ?? 'Novo',
      ]),
      ids: indices.map(x => x.id),
    }
  }

  const m = dados?.metricas

  /** O MESMO filtro para lista, métricas, custos e arquivo baixado. */
  const filtro: FiltroPeriodo = useMemo(
    () => ({ modo: periodo, ...(diaEspecifico ? { dia: diaEspecifico } : {}) }),
    [periodo, diaEspecifico],
  )

  /**
   * Números do topo RECALCULADOS pelo período — antes vinham prontos do
   * servidor, sobre todo o histórico, e não mexiam ao trocar o filtro.
   */
  const resumo = useMemo(() => {
    const base = dados?.baseMetricas ?? []
    if (base.length === 0) return null
    const noPeriodo = base.filter(l => {
      if (!l.data) return filtro.modo === 'tudo' && !filtro.dia
      return diaNoPeriodo(diaLocal(l.data), filtro)
    })
    const concluiram = noPeriodo.filter(l => l.concluiu).length
    return {
      total: noPeriodo.length,
      concluiram,
      comContato: noPeriodo.filter(l => l.temContato).length,
      conversao: noPeriodo.length > 0 ? Math.round((concluiram / noPeriodo.length) * 100) : 0,
      rotulo: rotuloPeriodo(filtro),
    }
  }, [dados, filtro])

  /**
   * Custos DO PERÍODO ESCOLHIDO: gasto e leads recortados pelo mesmo filtro.
   * Antes o investido era o total de todos os tempos — misturava períodos.
   */
  const custos = useMemo(() => {
    if (!dados || dados.investimentos.length === 0) return null

    // Custo por lead sobre TODOS que entraram (o gasto trouxe todo mundo, não
    // só o recorte que o cliente enxerga); fechados vêm da lista visível, que
    // é onde o cliente marca o desfecho.
    const base = calcularCustos(
      dados.investimentos,
      dados.baseMetricas.map(l => ({ data: l.data, temContato: l.temContato, fechado: false })),
      filtro,
    )
    const fechados = calcularCustos(
      dados.investimentos,
      dados.leads.map(l => ({
        data: l.data,
        temContato: l.quente,
        fechado: l.statusCliente === 'fechado',
      })),
      filtro,
    )
    return {
      ...base,
      fechados: fechados.fechados,
      custoPorVendaCents: fechados.custoPorVendaCents,
    }
  }, [dados, filtro])

  const [visao, setVisao] = useState<'lista' | 'kanban'>('lista')
  // Arrastar e soltar do kanban: o id viaja no dataTransfer; a coluna sob o
  // mouse ganha destaque. O seletor continua nos cartões — celular não arrasta.
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [colunaAlvo, setColunaAlvo] = useState<StatusPortal | null>(null)

  /** O cartão do lead — o MESMO na lista e no kanban (compacto). */
  const cartaoDoLead = (l: LeadComStatus, compacto: boolean) => {
    const wa = linkWhatsApp(l.telefone)
    const st = (l.statusCliente as StatusPortal) in STATUS_PORTAL_META
      ? (l.statusCliente as StatusPortal) : 'novo'
    return (
      <div key={l.id}
        draggable={compacto}
        onDragStart={compacto ? (e => {
          e.dataTransfer.setData('text/plain', l.id)
          e.dataTransfer.effectAllowed = 'move'
          setArrastando(l.id)
        }) : undefined}
        onDragEnd={compacto ? (() => { setArrastando(null); setColunaAlvo(null) }) : undefined}
        className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${
          compacto ? 'cursor-grab p-3 active:cursor-grabbing' : 'flex flex-wrap items-center gap-3 p-4'
        } ${arrastando === l.id ? 'opacity-40' : ''}`}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-slate-900">{tituloDoLead(l)}</p>
            {l.quente && (
              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-bold text-orange-600">
                🔥 Quente
              </span>
            )}
            {l.concluiu && !compacto && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                ✓ concluiu
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {[l.telefone, l.email].filter(Boolean).join(' · ') || 'sem contato'}
            {l.data ? ` · ${new Date(l.data).toLocaleDateString('pt-BR')}` : ''}
          </p>
          {l.resultado && !compacto && <p className="mt-0.5 text-xs text-indigo-600">Resultado: {l.resultado}</p>}

          {(respostasDoLead.get(l.id) ?? []).length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-xs font-medium text-indigo-600">
                Ver respostas ({respostasDoLead.get(l.id)!.length})
              </summary>
              <div className={`mt-2 grid gap-1.5 rounded-xl bg-slate-50 p-3 ${compacto ? '' : 'sm:grid-cols-2'}`}>
                {respostasDoLead.get(l.id)!.map((r, i) => (
                  <div key={i} className="min-w-0">
                    <p className="truncate text-[11px] uppercase tracking-wide text-slate-400" title={r.rotulo}>{r.rotulo}</p>
                    <p className="break-words text-sm text-slate-800">{r.valor}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className={compacto ? 'mt-2 flex items-center gap-2' : 'contents'}>
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer"
              className={`flex items-center gap-1.5 rounded-xl bg-emerald-500 font-semibold text-white transition-colors hover:bg-emerald-600 ${
                compacto ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'
              }`}>
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M17.5 14.4c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07a8.2 8.2 0 0 1-2.4-1.49 9 9 0 0 1-1.66-2.07c-.17-.3-.02-.46.13-.61.14-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.9 1.22 3.1.15.2 2.11 3.22 5.1 4.51.71.31 1.27.5 1.7.63.72.23 1.37.2 1.88.12.58-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.58-.35zM12.04 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.56.93.95-3.47-.22-.36a9.42 9.42 0 1 1 7.98 4.41zM12.05 1.25C6.11 1.25 1.3 6.07 1.3 12c0 1.9.5 3.74 1.44 5.37L1.25 22.75l5.52-1.45a10.7 10.7 0 0 0 5.27 1.38h.01c5.93 0 10.75-4.82 10.75-10.75S17.98 1.25 12.05 1.25z"/>
              </svg>
              WhatsApp
            </a>
          )}

          {portal?.permitirStatus && (
            <select value={st}
              onChange={e => void marcarStatus(l.id, e.target.value as StatusPortal)}
              className={`rounded-xl border-0 font-semibold ${STATUS_PORTAL_META[st].cor} ${
                compacto ? 'px-2 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'
              }`}>
              {STATUS_PORTAL.map(opt => (
                <option key={opt} value={opt}>{STATUS_PORTAL_META[opt].rotulo}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    )
  }

  // ── Conferindo a sessão ───────────────────────────────────────────────────
  if (!portal && verificandoSessao) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    )
  }

  // ── Tela de senha ─────────────────────────────────────────────────────────
  if (!portal) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
        <form onSubmit={e => { e.preventDefault(); void entrar() }}
          className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
          <div className="mb-1 text-3xl">🎯</div>
          <h1 className="text-xl font-bold text-gray-900">Portal de leads</h1>
          <p className="mt-1 text-sm text-gray-500">
            Digite a senha que você recebeu para acessar seus leads.
          </p>
          <input type="password" value={senha} onChange={e => setSenha(e.target.value)}
            placeholder="Senha" autoFocus
            className="mt-5 w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          {erro && <p className="mt-3 text-sm text-red-600">{erro}</p>}
          <button type="submit" disabled={carregando || senha.trim().length === 0}
            className="mt-4 w-full rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-50">
            {carregando ? 'Abrindo…' : 'Entrar'}
          </button>
        </form>
      </div>
    )
  }

  // ── Portal ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh bg-slate-100">
      <header className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-4 pb-16 pt-8 text-white">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-medium uppercase tracking-widest text-indigo-300">Portal de leads</p>
          <h1 className="mt-1 text-2xl font-bold">{portal.nome}</h1>
          {portal.quizzes.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {portal.quizzes.map(q => (
                <button key={q.id} onClick={() => void abrirQuiz(q.id)}
                  className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                    q.id === quizAtivo ? 'bg-white text-slate-900 font-semibold' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}>
                  {q.titulo}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto -mt-8 max-w-5xl px-4 pb-10">
        {erro && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}

        {/* A conta que interessa: entrou X, chegou ao final Y (Z%) — do PERÍODO */}
        {resumo && resumo.total > 0 && (
          <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center">
              <div>
                <p className="text-3xl font-bold text-slate-900">{resumo.total}</p>
                <p className="text-xs uppercase tracking-wide text-slate-500">entraram</p>
              </div>
              <span className="text-2xl text-slate-300">→</span>
              <div>
                <p className="text-3xl font-bold text-orange-600">🔥 {resumo.concluiram}</p>
                <p className="text-xs uppercase tracking-wide text-slate-500">chegaram ao final</p>
              </div>
              <span className="text-2xl text-slate-300">=</span>
              <div>
                <p className="text-3xl font-bold text-indigo-600">{resumo.conversao}%</p>
                <p className="text-xs uppercase tracking-wide text-slate-500">de conversão</p>
              </div>
            </div>
            <div className="mx-auto mt-3 h-2.5 max-w-md overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gradient-to-r from-orange-500 to-indigo-500"
                style={{ width: `${Math.max(resumo.conversao, resumo.concluiram > 0 ? 3 : 0)}%` }} />
            </div>
            <p className="mt-2 text-center text-xs text-slate-400">
              De cada 100 pessoas que entram no funil, {resumo.conversao} chegam ao final — {resumo.rotulo}.
            </p>

            {/* Custo — só quando o dono lançou investimento. */}
            {custos && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <p className="mb-2 text-center text-[11px] uppercase tracking-wide text-slate-400">
                  Custos {custos.rotulo} · {custos.leads} lead(s)
                </p>
                <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                  <div>
                    <p className="text-lg font-bold text-slate-900">{brl(custos.investidoCents)}</p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">investido</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-slate-900">
                      {custos.cplCents === null ? '—' : brl(custos.cplCents)}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">custo por lead</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-orange-600">
                      {custos.cplQuenteCents === null ? '—' : brl(custos.cplQuenteCents)}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      custo por lead 🔥{custos.comContato > 0 ? ` (${custos.comContato})` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-emerald-600">
                      {custos.custoPorVendaCents === null ? '—' : brl(custos.custoPorVendaCents)}
                    </p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      custo por venda{custos.fechados > 0 ? ` (${custos.fechados})` : ''}
                    </p>
                  </div>
                </div>
                {custos.investidoCents === 0 && (
                  <p className="mt-2 text-center text-[11px] text-slate-400">
                    Nenhum investimento lançado neste período.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Métricas */}
        {resumo && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { r: 'Leads', v: resumo.total, n: resumo.rotulo },
              { r: '🔥 Com contato', v: resumo.comContato, n: 'dá para atender' },
              { r: 'Chegaram ao final', v: resumo.concluiram, n: `${resumo.conversao}% de conversão` },
              { r: 'Fechados', v: custos?.fechados ?? leadsFiltrados.filter(l => l.statusCliente === 'fechado').length, n: 'marcados por você' },
            ].map(c => (
              <div key={c.r} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.r}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{c.v}</p>
                <p className="mt-0.5 text-xs text-slate-400">{c.n}</p>
              </div>
            ))}
          </div>
        )}

        {/* Funil (só se o dono liberou) */}
        {m && m.funil.length > 1 && (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">
              Etapas do funil <span className="font-normal text-slate-400">· todo o período</span>
            </h2>
            <div className="mt-3 space-y-2">
              {m.funil.map(e => (
                <div key={e.pageId} className="flex items-center gap-3">
                  <span className="w-40 truncate text-xs text-slate-600" title={e.titulo}>{e.titulo}</span>
                  <div className="h-5 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                      style={{ width: `${Math.max(e.pct, e.leads > 0 ? 4 : 0)}%` }} />
                  </div>
                  <span className="w-20 text-right text-xs tabular-nums text-slate-600">{e.leads} · {e.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Barra: busca + downloads */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome, e-mail ou telefone…"
              className="w-full max-w-xs rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none" />
            <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {([['tudo', 'Tudo'], ['hoje', 'Hoje'], ['7d', '7 dias'], ['30d', '30 dias']] as const).map(([v, r]) => (
                <button key={v}
                  onClick={() => { setPeriodo(v); setDiaEspecifico('') }}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    periodo === v && !diaEspecifico ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}>
                  {r}
                </button>
              ))}
            </div>
            <input type="date" value={diaEspecifico}
              onChange={e => setDiaEspecifico(e.target.value)}
              title="Ver um dia específico"
              className={`rounded-xl border bg-white px-3 py-2 text-xs shadow-sm focus:outline-none ${
                diaEspecifico ? 'border-indigo-500 text-indigo-700' : 'border-slate-200 text-slate-500'
              }`} />
            {diaEspecifico && (
              <button onClick={() => setDiaEspecifico('')} className="text-xs text-slate-400 hover:text-slate-600">
                limpar dia
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <div className="flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {([['lista', '☰ Lista'], ['kanban', '▦ Kanban']] as const).map(([v, r]) => (
                <button key={v} onClick={() => setVisao(v)}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    visao === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}>
                  {r}
                </button>
              ))}
            </div>
            <button
              onClick={() => { const t = tabelaComStatus(); if (t) baixarCsv(t, `leads-${dados?.quiz.titulo.slice(0, 20) ?? 'funil'}`) }}
              disabled={!dados?.tabela || dados.tabela.linhas.length === 0}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              ⬇ Baixar CSV
            </button>
            <button
              onClick={() => { const t = tabelaComStatus(); if (t) { const b = abrirPdf(t); if (b) setErro(b) } }}
              disabled={!dados?.tabela || dados.tabela.linhas.length === 0}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              📄 PDF
            </button>
          </div>
        </div>

        {/* Leads */}
        <div className="mt-3 space-y-2">
          {carregando ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
              Carregando…
            </div>
          ) : leadsFiltrados.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
              <p className="text-3xl">📭</p>
              <p className="mt-2 text-sm font-medium text-slate-700">Nenhum lead por aqui ainda</p>
              <p className="mt-1 text-xs text-slate-400">
                Assim que um lead {dados?.quiz.publico === 'concluidos' ? 'concluir o funil' : 'chegar'}, ele aparece nesta lista.
              </p>
            </div>
          ) : visao === 'kanban' ? (
            /* Kanban em LARGURA TOTAL da tela — dentro da coluna central as
               últimas colunas ficavam cortadas. Arraste o cartão para mover;
               o seletor continua valendo (celular não arrasta). */
            <div className="relative left-1/2 w-screen -translate-x-1/2 overflow-x-auto px-4 pb-3">
              <div className="mx-auto flex w-max gap-3 pr-8">
                {STATUS_PORTAL.map(coluna => {
                  const doGrupo = leadsFiltrados.filter(l =>
                    ((l.statusCliente as StatusPortal) in STATUS_PORTAL_META
                      ? l.statusCliente : 'novo') === coluna)
                  return (
                    <div
                      key={coluna}
                      onDragOver={e => { e.preventDefault(); setColunaAlvo(coluna) }}
                      onDragLeave={() => setColunaAlvo(alvo => (alvo === coluna ? null : alvo))}
                      onDrop={e => {
                        e.preventDefault()
                        const id = e.dataTransfer.getData('text/plain') || arrastando
                        setColunaAlvo(null); setArrastando(null)
                        if (id) void marcarStatus(id, coluna)
                      }}
                      className={`w-72 shrink-0 rounded-2xl p-2 transition-colors ${
                        colunaAlvo === coluna && arrastando
                          ? 'bg-indigo-100 ring-2 ring-indigo-400'
                          : 'bg-slate-200/60'
                      }`}
                    >
                      <div className="flex items-center justify-between px-2 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_PORTAL_META[coluna].cor}`}>
                          {STATUS_PORTAL_META[coluna].rotulo}
                        </span>
                        <span className="text-xs font-semibold text-slate-500">{doGrupo.length}</span>
                      </div>
                      <div className="mt-1 space-y-2">
                        {doGrupo.map(l => cartaoDoLead(l, true))}
                        {doGrupo.length === 0 && (
                          <p className={`px-2 py-6 text-center text-xs ${
                            colunaAlvo === coluna && arrastando ? 'text-indigo-500' : 'text-slate-400'
                          }`}>
                            {arrastando ? 'solte aqui' : 'vazio'}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            leadsFiltrados.map(l => cartaoDoLead(l, false))
          )}
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">Portal gerado com FunilPro</p>
      </main>
    </div>
  )
}
