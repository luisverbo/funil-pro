'use client'

// ============================================================================
// Conteúdos Instagram — calendário de agendamento
// ----------------------------------------------------------------------------
// A tela principal é um CALENDÁRIO DO MÊS, como numa ferramenta de
// agendamento: cada post é um bloco compacto (miniatura, horário, tipo e
// status). Clicar abre o painel de detalhe com o vídeo/carrossel, a edição e
// todas as ações (aprovar, descartar e puxar a fila, editar data, tentar de
// novo, publicar agora). Visões extras: Semana (slots 06:00/15:00 grandes) e
// Lista (as abas Pendentes/Agendados/Publicados/Erros). A fila de aprovação
// fica ao lado, com "Aprovar todos".
//
// Toda ação vai pelo cliente HTTP (src/lib/conteudos-ig/client.ts).
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  listarConteudos, contagemPorStatus, aprovarConteudo, aprovarTodosPendentes, descartarConteudo,
  voltarParaPendente, editarConteudo, tentarDeNovo, publicarAgora,
} from '@/lib/conteudos-ig/client'
import {
  recorteVisivel, rotuloDataHora, paraInputLocal, gradeDaSemana, inicioDaSemana, somarDias,
  CORTE_VISIVEL, MAX_LEGENDA, HORA_DO_SLOT, acoesPermitidas, montarLegenda,
  gradeDoMes, somarMeses, itensPorDia, horaEmBrasilia, vagasLivres, miniaturaDe, diaEmBrasilia,
  partesEmBrasilia, NOMES_MES, DIAS_SEMANA_CURTO, normalizarHashtags,
  type Conteudo, type StatusConteudo, type TipoConteudo,
} from '@/lib/conteudos-ig/regras'
import { explicarErroDeToken } from '@/lib/instagram/token'

type Aba = 'pendente' | 'agendado' | 'publicado' | 'erro'
type Visao = 'mes' | 'semana' | 'lista'

const ABAS: { id: Aba; rotulo: string; status: StatusConteudo[] }[] = [
  { id: 'pendente',  rotulo: 'Pendentes',  status: ['pendente'] },
  { id: 'agendado',  rotulo: 'Agendados',  status: ['agendado', 'publicando'] },
  { id: 'publicado', rotulo: 'Publicados', status: ['publicado'] },
  { id: 'erro',      rotulo: 'Erros',      status: ['erro'] },
]

/** Cor de cada status — a mesma em todo o calendário, na legenda e no painel. */
const COR: Record<StatusConteudo, { barra: string; fundo: string; texto: string; ponto: string; rotulo: string }> = {
  pendente:   { barra: 'bg-amber-400',   fundo: 'bg-amber-50 hover:bg-amber-100/80',     texto: 'text-amber-900',   ponto: 'bg-amber-400',   rotulo: 'Pendente' },
  agendado:   { barra: 'bg-violet-500',  fundo: 'bg-violet-50 hover:bg-violet-100/80',   texto: 'text-violet-900',  ponto: 'bg-violet-500',  rotulo: 'Agendado' },
  publicando: { barra: 'bg-sky-500',     fundo: 'bg-sky-50 hover:bg-sky-100/80',         texto: 'text-sky-900',     ponto: 'bg-sky-500',     rotulo: 'Publicando' },
  publicado:  { barra: 'bg-emerald-500', fundo: 'bg-emerald-50 hover:bg-emerald-100/80', texto: 'text-emerald-900', ponto: 'bg-emerald-500', rotulo: 'Publicado' },
  erro:       { barra: 'bg-rose-500',    fundo: 'bg-rose-50 hover:bg-rose-100/80',       texto: 'text-rose-900',    ponto: 'bg-rose-500',    rotulo: 'Erro' },
  descartado: { barra: 'bg-gray-300',    fundo: 'bg-gray-50 hover:bg-gray-100',          texto: 'text-gray-500',    ponto: 'bg-gray-300',    rotulo: 'Descartado' },
}

interface Props {
  itensIniciais: Conteudo[]
  erroInicial: string | null
  contagemInicial: Record<StatusConteudo, number>
  conexao: { connected: boolean; username?: string; accountId?: string; error?: string }
}

export default function ConteudosClient({ itensIniciais, erroInicial, contagemInicial, conexao }: Props) {
  const [itens, setItens] = useState<Conteudo[]>(itensIniciais)
  const [contagem, setContagem] = useState(contagemInicial)
  const [visao, setVisao] = useState<Visao>('mes')
  const [aba, setAba] = useState<Aba>('pendente')
  const [erro, setErro] = useState<string | null>(erroInicial)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)   // id em ação
  const [hoje] = useState(() => diaEmBrasilia(new Date()))
  const [mes, setMes] = useState(() => { const p = partesEmBrasilia(new Date()); return { ano: p.ano, mes: p.mes } })
  const [semana, setSemana] = useState(() => inicioDaSemana(new Date()))
  const [ocultos, setOcultos] = useState<Set<StatusConteudo>>(() => new Set<StatusConteudo>(['descartado']))
  const [abertoId, setAbertoId] = useState<string | null>(null)
  const [descartando, setDescartando] = useState<Conteudo | null>(null)

  const recarregar = useCallback(async () => {
    try {
      const [{ itens: novos, error }, cont] = await Promise.all([listarConteudos(), contagemPorStatus()])
      if (error) setErro(error)
      else { setItens(novos); setErro(null) }
      setContagem(cont)
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
  }, [])

  // Enquanto há item "publicando", a tela acompanha sozinha.
  useEffect(() => {
    if (!itens.some(i => i.status === 'publicando')) return
    const t = setInterval(() => { void recarregar() }, 8000)
    return () => clearInterval(t)
  }, [itens, recarregar])

  const visiveis = useMemo(() => itens.filter(i => !ocultos.has(i.status)), [itens, ocultos])
  const porDia = useMemo(() => itensPorDia(visiveis, !ocultos.has('descartado')), [visiveis, ocultos])
  const pendentes = useMemo(() => itens.filter(i => i.status === 'pendente'), [itens])
  const aberto = abertoId ? itens.find(i => i.id === abertoId) ?? null : null

  // Navegação ←/→ dentro do painel, na ordem do calendário.
  const ordemDoPainel = useMemo(() => [...visiveis].sort((a, b) => a.data_agendada.localeCompare(b.data_agendada)), [visiveis])
  const posAberto = aberto ? ordemDoPainel.findIndex(i => i.id === aberto.id) : -1

  useEffect(() => {
    if (!aberto) return
    function tecla(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null
      if (alvo && /INPUT|TEXTAREA|SELECT/.test(alvo.tagName)) return
      if (e.key === 'Escape') setAbertoId(null)
      if (e.key === 'ArrowRight' && posAberto >= 0 && posAberto < ordemDoPainel.length - 1) setAbertoId(ordemDoPainel[posAberto + 1].id)
      if (e.key === 'ArrowLeft' && posAberto > 0) setAbertoId(ordemDoPainel[posAberto - 1].id)
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aberto, posAberto, ordemDoPainel])

  const daAba = useMemo(() => {
    const st = ABAS.find(a => a.id === aba)!.status
    const lista = itens.filter(i => st.includes(i.status))
    return aba === 'publicado'
      ? [...lista].sort((a, b) => (b.publicado_em ?? '').localeCompare(a.publicado_em ?? ''))
      : lista
  }, [itens, aba])

  function avisar(msg: string) { setAviso(msg); setTimeout(() => setAviso(null), 3500) }

  async function agir(id: string, fn: () => Promise<{ success: boolean; error?: string } | unknown>, okMsg?: string) {
    setOcupado(id); setErro(null)
    try {
      const r = await fn() as { success?: boolean; error?: string }
      if (r && r.success === false) setErro(r.error ?? 'Não deu certo')
      else if (okMsg) avisar(okMsg)
      await recarregar()
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)) }
    finally { setOcupado(null) }
  }

  async function aprovarTodos() {
    setOcupado('todos'); setErro(null)
    try {
      const r = await aprovarTodosPendentes()
      if (!r.success) setErro(r.error ?? 'Não deu certo')
      else avisar(`${r.aprovados ?? 0} aprovados`)
      await recarregar()
    } finally { setOcupado(null) }
  }

  function alternarFiltro(st: StatusConteudo) {
    setOcultos(prev => {
      const n = new Set(prev)
      if (n.has(st)) n.delete(st)
      else n.add(st)
      return n
    })
  }

  function irParaHoje() {
    const p = partesEmBrasilia(new Date())
    setMes({ ano: p.ano, mes: p.mes })
    setSemana(inicioDaSemana(new Date()))
  }

  const grade = useMemo(() => gradeDaSemana(visiveis, semana), [visiveis, semana])
  const diasDoMes = useMemo(() => gradeDoMes(mes.ano, mes.mes), [mes])
  const noMes = useMemo(() => {
    const prefixo = `${mes.ano}-${String(mes.mes).padStart(2, '0')}`
    return visiveis.filter(i => diaEmBrasilia(i.data_agendada).startsWith(prefixo)).length
  }, [visiveis, mes])

  const tituloPeriodo = visao === 'semana'
    ? `${semana.slice(8, 10)}/${semana.slice(5, 7)} – ${somarDias(semana, 6).slice(8, 10)}/${somarDias(semana, 6).slice(5, 7)}`
    : `${NOMES_MES[mes.mes - 1]} ${mes.ano}`

  return (
    <div className="mx-auto max-w-[1400px] pb-24">
      {/* ── Cabeçalho ─────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl text-xl text-white shadow-lg shadow-fuchsia-500/20"
            style={{ background: 'linear-gradient(135deg,#f58529,#dd2a7b 50%,#8134af)' }}>📅</div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">Calendário de conteúdo</h1>
            <p className="text-xs text-gray-500 sm:text-sm">Reel às 06:00 · carrossel às 15:00 · horário de Brasília</p>
          </div>
        </div>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${conexao.connected ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          <span className={`h-2 w-2 rounded-full ${conexao.connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          {conexao.connected ? `@${conexao.username}` : 'Instagram não conectado'}
        </div>
      </div>

      {!conexao.connected && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Sem conexão com o Instagram, nada será publicado.{' '}
          {explicarErroDeToken(conexao.error) ?? <>Conecte em <a href="/instagram" className="font-semibold underline">Instagram</a>.</>}
          {conexao.error && conexao.error !== 'token_missing' && <span className="block text-xs opacity-80">{conexao.error.slice(0, 140)}</span>}
        </div>
      )}
      {erro && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}
      {aviso && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-xl">{aviso}</div>
      )}

      {/* ── Números (clicáveis: abrem a lista naquela aba) ─────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ABAS.map(a => {
          const n = a.status.reduce((s, st) => s + (contagem[st] ?? 0), 0)
          const cor = COR[a.status[0]]
          return (
            <button key={a.id} onClick={() => { setVisao('lista'); setAba(a.id) }}
              className="group flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <span className={`h-9 w-1.5 rounded-full ${cor.barra}`} />
              <span>
                <span className="block text-2xl font-bold leading-none text-gray-900">{n}</span>
                <span className="mt-1 block text-xs font-medium text-gray-500">{a.rotulo}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Barra do calendário ───────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {visao !== 'lista' && (
            <>
              <button aria-label="Anterior"
                onClick={() => visao === 'semana' ? setSemana(s => somarDias(s, -7)) : setMes(m => somarMeses(m.ano, m.mes, -1))}
                className="grid h-9 w-9 place-items-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">‹</button>
              <button aria-label="Próximo"
                onClick={() => visao === 'semana' ? setSemana(s => somarDias(s, 7)) : setMes(m => somarMeses(m.ano, m.mes, 1))}
                className="grid h-9 w-9 place-items-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">›</button>
              <h2 className="ml-1 text-lg font-bold tracking-tight text-gray-900">{tituloPeriodo}</h2>
              {visao === 'mes' && <span className="text-xs text-gray-400">{noMes} {noMes === 1 ? 'post' : 'posts'}</span>}
              <button onClick={irParaHoje} className="ml-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50">Hoje</button>
            </>
          )}
          {visao === 'lista' && <h2 className="text-lg font-bold tracking-tight text-gray-900">Todos os conteúdos</h2>}
        </div>
        <div className="flex rounded-xl border border-gray-200 bg-white p-1 text-xs font-medium shadow-sm">
          {([['mes', 'Mês'], ['semana', 'Semana'], ['lista', 'Lista']] as const).map(([v, r]) => (
            <button key={v} onClick={() => setVisao(v)}
              className={`rounded-lg px-3 py-1.5 transition ${visao === v ? 'bg-gray-900 text-white shadow' : 'text-gray-600 hover:text-gray-900'}`}>{r}</button>
          ))}
        </div>
      </div>

      {/* Legenda = filtro */}
      {visao !== 'lista' && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {(['pendente', 'agendado', 'publicado', 'erro', 'descartado'] as StatusConteudo[]).map(st => (
            <button key={st} onClick={() => alternarFiltro(st)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${ocultos.has(st) ? 'border-gray-200 bg-white text-gray-400 line-through' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
              <span className={`h-2 w-2 rounded-full ${COR[st].ponto} ${ocultos.has(st) ? 'opacity-40' : ''}`} />{COR[st].rotulo}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {/* ── MÊS ─────────────────────────────────────────────────────────── */}
          {visao === 'mes' && (
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50/70">
                {DIAS_SEMANA_CURTO.map(d => (
                  <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {diasDoMes.map((d, i) => {
                  const doDia = porDia.get(d.dia) ?? []
                  const ehHoje = d.dia === hoje
                  const passado = d.dia < hoje
                  const livres = d.doMes && !passado ? vagasLivres(doDia) : []
                  return (
                    <div key={d.dia}
                      className={`min-h-[92px] border-gray-100 p-1.5 sm:min-h-[124px] sm:p-2 ${i % 7 !== 6 ? 'border-r' : ''} ${i < 35 ? 'border-b' : ''} ${d.doMes ? '' : 'bg-gray-50/60'}`}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold ${
                          ehHoje ? 'text-white shadow' : d.doMes ? (passado ? 'text-gray-400' : 'text-gray-700') : 'text-gray-300'
                        }`} style={ehHoje ? { background: 'linear-gradient(135deg,#dd2a7b,#8134af)' } : undefined}>{d.numero}</span>
                      </div>
                      <div className="space-y-1">
                        {doDia.map(c => <BlocoPost key={c.id} c={c} onAbrir={() => setAbertoId(c.id)} />)}
                        {livres.map(t => (
                          <div key={t} className="hidden items-center gap-1 rounded-md border border-dashed border-gray-200 px-1.5 py-1 text-[10px] text-gray-300 lg:flex">
                            <span>{t === 'reel' ? '🎬' : '🖼️'}</span>{HORA_DO_SLOT[t].rotulo} livre
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── SEMANA ──────────────────────────────────────────────────────── */}
          {visao === 'semana' && (
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="grid min-w-[760px] grid-cols-7">
                {Array.from({ length: 7 }, (_, i) => {
                  const dia = somarDias(semana, i)
                  const slots = grade.filter(g => g.dia === dia)
                  const ehHoje = dia === hoje
                  return (
                    <div key={dia} className={`p-2 ${i < 6 ? 'border-r border-gray-100' : ''}`}>
                      <div className="mb-2 text-center">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{DIAS_SEMANA_CURTO[i]}</div>
                        <div className={`mx-auto mt-0.5 grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${ehHoje ? 'text-white' : 'text-gray-800'}`}
                          style={ehHoje ? { background: 'linear-gradient(135deg,#dd2a7b,#8134af)' } : undefined}>{dia.slice(8, 10)}</div>
                      </div>
                      <div className="space-y-2">
                        {slots.map(s => s.conteudo ? (
                          <button key={s.tipo} onClick={() => setAbertoId(s.conteudo!.id)}
                            className="group block w-full overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                            <div className="relative aspect-[9/14] w-full">
                              <Miniatura c={s.conteudo} className="h-full w-full object-cover opacity-95 transition group-hover:opacity-100" />
                              <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                                {s.tipo === 'reel' ? '🎬' : `🖼️ ${s.conteudo.midia_urls.length}`}
                              </span>
                              <span className={`absolute right-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white shadow ${COR[s.conteudo.status].barra}`}>{COR[s.conteudo.status].rotulo}</span>
                              <span className={`absolute bottom-0 left-0 right-0 h-1 ${COR[s.conteudo.status].barra}`} />
                            </div>
                            <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                              <span className="text-[12px] font-bold text-gray-900">{horaEmBrasilia(s.conteudo.data_agendada)}</span>
                              <span className="whitespace-nowrap text-[10px] font-medium text-gray-400">{s.tipo === 'reel' ? 'Reel' : `${s.conteudo.midia_urls.length} fotos`}</span>
                            </div>
                          </button>
                        ) : (
                          <div key={s.tipo} className="grid aspect-[9/14] place-items-center rounded-xl border border-dashed border-gray-200 text-center text-[11px] text-gray-300">
                            <span>{s.tipo === 'reel' ? '🎬' : '🖼️'}<br />{s.rotulo}<br />livre</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── LISTA (as abas de sempre) ───────────────────────────────────── */}
          {visao === 'lista' && (
            <div>
              <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
                {ABAS.map(a => {
                  const n = a.status.reduce((s, st) => s + (contagem[st] ?? 0), 0)
                  return (
                    <button key={a.id} onClick={() => setAba(a.id)}
                      className={`flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${aba === a.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                      {a.rotulo}{n > 0 && <span className={`ml-1.5 rounded-full px-1.5 text-[11px] ${a.id === 'erro' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-700'}`}>{n}</span>}
                    </button>
                  )
                })}
              </div>
              {aba === 'pendente' && daAba.length > 1 && (
                <button onClick={aprovarTodos} disabled={ocupado !== null}
                  className="mb-3 w-full rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white shadow-sm hover:bg-black disabled:opacity-50">
                  {ocupado === 'todos' ? 'Aprovando…' : `Aprovar todos os ${daAba.length} pendentes`}
                </button>
              )}
              {daAba.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white py-16 text-center">
                  <p className="text-3xl">{aba === 'erro' ? '✅' : '📭'}</p>
                  <p className="mt-2 text-sm font-medium text-gray-600">
                    {aba === 'pendente' ? 'Nada para aprovar. As skills vão trazer conteúdo novo aqui.'
                      : aba === 'agendado' ? 'Nenhum conteúdo na fila.'
                      : aba === 'publicado' ? 'Nada publicado ainda.'
                      : 'Nenhum erro. Tudo em ordem.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                  {daAba.map(c => (
                    <button key={c.id} onClick={() => setAbertoId(c.id)}
                      className="group overflow-hidden rounded-2xl border border-gray-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="relative aspect-[4/5]">
                        <Miniatura c={c} className="h-full w-full object-cover" />
                        <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                          {c.tipo === 'reel' ? '🎬 Reel' : `🖼️ ${c.midia_urls.length}`}
                        </span>
                        <span className={`absolute right-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-white ${COR[c.status].barra}`}>{COR[c.status].rotulo}</span>
                      </div>
                      <div className="p-2.5">
                        <p className="text-xs font-semibold text-gray-900">{rotuloDataHora(c.data_agendada)}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-500">{c.descricao || 'Sem descrição'}</p>
                        {c.status === 'erro' && c.erro && <p className="mt-1 line-clamp-2 text-[10px] text-rose-600">{c.erro}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Fila de aprovação ─────────────────────────────────────────────── */}
        <aside className="h-fit rounded-2xl border border-gray-200 bg-white shadow-sm xl:sticky xl:top-6">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Para aprovar</h3>
              <p className="text-[11px] text-gray-400">{pendentes.length === 0 ? 'Tudo revisado' : `${pendentes.length} esperando você`}</p>
            </div>
            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-amber-100 px-2 text-xs font-bold text-amber-800">{pendentes.length}</span>
          </div>
          {pendentes.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">✅ Nenhum pendente.<br />As skills trazem conteúdo novo aqui.</div>
          ) : (
            <>
              <ul className="max-h-[520px] divide-y divide-gray-100 overflow-y-auto">
                {pendentes.map(c => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                    <button onClick={() => setAbertoId(c.id)} className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg">
                      <Miniatura c={c} className="h-full w-full object-cover" />
                      <span className="absolute bottom-0.5 right-0.5 text-[10px]">{c.tipo === 'reel' ? '🎬' : '🖼️'}</span>
                    </button>
                    <button onClick={() => setAbertoId(c.id)} className="min-w-0 flex-1 text-left">
                      <p className="text-xs font-semibold text-gray-900">{rotuloDataHora(c.data_agendada)}</p>
                      <p className="truncate text-[11px] text-gray-500">{c.tema || c.descricao || 'Sem descrição'}</p>
                    </button>
                    <button onClick={() => agir(c.id, () => aprovarConteudo(c.id), 'Aprovado')} disabled={ocupado !== null}
                      title="Aprovar" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                      {ocupado === c.id ? '…' : '✓'}
                    </button>
                  </li>
                ))}
              </ul>
              {pendentes.length > 1 && (
                <div className="border-t border-gray-100 p-3">
                  <button onClick={aprovarTodos} disabled={ocupado !== null}
                    className="w-full rounded-xl bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">
                    {ocupado === 'todos' ? 'Aprovando…' : `Aprovar todos os ${pendentes.length} pendentes`}
                  </button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {/* ── Painel do post (abre ao clicar no bloco) ──────────────────────── */}
      {aberto && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[2px]" onClick={() => setAbertoId(null)}>
          <div className="flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl sm:rounded-l-3xl" onClick={e => e.stopPropagation()}
            style={{ animation: 'painelEntra 220ms ease-out both' }}>
            <style>{`@keyframes painelEntra { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${COR[aberto.status].ponto}`} />
                <span className="text-sm font-bold text-gray-900">{aberto.tipo === 'reel' ? 'Reel' : 'Carrossel'} · {rotuloDataHora(aberto.data_agendada)}</span>
              </div>
              <div className="flex items-center gap-1">
                <button aria-label="Anterior" disabled={posAberto <= 0} onClick={() => setAbertoId(ordemDoPainel[posAberto - 1].id)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">‹</button>
                <button aria-label="Próximo" disabled={posAberto < 0 || posAberto >= ordemDoPainel.length - 1} onClick={() => setAbertoId(ordemDoPainel[posAberto + 1].id)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">›</button>
                <button aria-label="Fechar" onClick={() => setAbertoId(null)} className="grid h-8 w-8 place-items-center rounded-lg text-lg text-gray-400 hover:bg-gray-100">×</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <CardConteudo key={`${aberto.id}|${aberto.status}|${aberto.data_agendada}|${aberto.descricao.length}|${aberto.hashtags.length}|${aberto.alt_text ?? ''}|${aberto.palavra_chave ?? ''}`} c={aberto} ocupado={ocupado === aberto.id}
                onAprovar={() => agir(aberto.id, () => aprovarConteudo(aberto.id), 'Aprovado')}
                onDescartar={() => setDescartando(aberto)}
                onVoltar={() => agir(aberto.id, () => voltarParaPendente(aberto.id))}
                onTentar={() => agir(aberto.id, () => tentarDeNovo(aberto.id), 'De volta à fila')}
                onPublicarAgora={() => {
                  if (!confirm('Publicar AGORA no Instagram? Isto é para testar a integração — o post sai de verdade.')) return
                  void agir(aberto.id, () => publicarAgora(aberto.id), 'Publicado no Instagram')
                }}
                onSalvar={patch => agir(aberto.id, () => editarConteudo(aberto.id, patch), 'Salvo')}
              />
            </div>
          </div>
        </div>
      )}

      {/* Descartar + puxar a fila */}
      {descartando && (
        <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => setDescartando(null)}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Descartar este {descartando.tipo}?</h3>
            <p className="mt-1 text-sm text-gray-500">Ele sai da fila e libera a vaga de {rotuloDataHora(descartando.data_agendada)}.</p>
            <div className="mt-4 grid gap-2">
              <button onClick={() => { const c = descartando; setDescartando(null); void agir(c.id, () => descartarConteudo(c.id, { puxarFila: true }), 'Descartado · fila puxada') }}
                className="rounded-xl bg-gray-900 py-3 text-sm font-semibold text-white hover:bg-black">
                Descartar e puxar a fila
                <span className="block text-[11px] font-normal opacity-80">os próximos {descartando.tipo === 'reel' ? 'reels' : 'carrosséis'} sobem um dia</span>
              </button>
              <button onClick={() => { const c = descartando; setDescartando(null); void agir(c.id, () => descartarConteudo(c.id), 'Descartado') }}
                className="rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                Só descartar
                <span className="block text-[11px] font-normal text-gray-400">a vaga fica vazia</span>
              </button>
              <button onClick={() => setDescartando(null)} className="py-2 text-sm text-gray-500">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Bloco do calendário ─────────────────────────────────────────────────────

/** O post dentro do dia: miniatura + horário + tipo, com a cor do status. */
function BlocoPost({ c, onAbrir }: { c: Conteudo; onAbrir: () => void }) {
  const cor = COR[c.status]
  return (
    <button onClick={onAbrir} title={`${cor.rotulo} · ${rotuloDataHora(c.data_agendada)}`}
      className={`group relative flex w-full items-center gap-2 overflow-hidden rounded-lg py-1 pl-2 pr-1.5 text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition hover:-translate-y-px ${cor.fundo}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${cor.barra} ${c.status === 'publicando' ? 'animate-pulse' : ''}`} />
      <span className="relative h-8 w-6 shrink-0 overflow-hidden rounded-[6px] ring-1 ring-black/5 sm:h-10 sm:w-8 xl:h-11 xl:w-9">
        <Miniatura c={c} className="h-full w-full object-cover" />
      </span>
      <span className="hidden min-w-0 flex-1 sm:block">
        <span className={`block text-[12px] font-bold leading-tight ${cor.texto}`}>{horaEmBrasilia(c.data_agendada)}</span>
        <span className="block truncate text-[10px] leading-tight text-gray-500">{c.tipo === 'reel' ? 'Reel' : `Carrossel · ${c.midia_urls.length}`}</span>
      </span>
    </button>
  )
}

/**
 * Capa do reel / 1ª imagem do carrossel; reel sem capa mostra o 1º quadro do
 * vídeo. Por baixo sempre há um degradê com o ícone do tipo: enquanto o
 * quadro não carrega (ou se o arquivo falhar) o bloco continua bonito, nunca
 * um retângulo preto.
 */
function Miniatura({ c, className }: { c: Conteudo; className?: string }) {
  const [falhou, setFalhou] = useState(false)
  const img = miniaturaDe(c)
  const fundo = c.tipo === 'reel'
    ? 'linear-gradient(160deg,#833ab4 0%,#c13584 45%,#fd1d1d 80%,#fcaf45 100%)'
    : 'linear-gradient(160deg,#4f46e5 0%,#7c3aed 55%,#db2777 100%)'
  return (
    <span className="relative block h-full w-full overflow-hidden" style={{ background: fundo }}>
      <span className="absolute inset-0 grid place-items-center text-white/80">
        {c.tipo === 'reel'
          ? <svg viewBox="0 0 24 24" className="h-1/3 max-h-6 w-1/3 max-w-6" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          : <svg viewBox="0 0 24 24" className="h-1/3 max-h-6 w-1/3 max-w-6" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>}
      </span>
      {!falhou && (img
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={img} alt="" loading="lazy" onError={() => setFalhou(true)}
            ref={el => { if (el && el.complete && el.naturalWidth === 0) setFalhou(true) }}
            className={`relative ${className ?? ''}`} />
        : <video src={`${c.midia_urls[0]}#t=0.5`} muted playsInline preload="metadata" onError={() => setFalhou(true)}
            className={`pointer-events-none relative ${className ?? ''}`} />)}
    </span>
  )
}

// ── Card ────────────────────────────────────────────────────────────────────

function CardConteudo({ c, ocupado, onAprovar, onDescartar, onVoltar, onTentar, onPublicarAgora, onSalvar }: {
  c: Conteudo
  ocupado: boolean
  onAprovar: () => void
  onDescartar: () => void
  onVoltar: () => void
  onTentar: () => void
  onPublicarAgora: () => void
  onSalvar: (patch: { descricao?: string; alt_text?: string | null; hashtags?: string[]; palavra_chave?: string | null; data_local?: string }) => void
}) {
  const [editando, setEditando] = useState(false)
  const [descricao, setDescricao] = useState(c.descricao)
  const [alt, setAlt] = useState(c.alt_text ?? '')
  const [tags, setTags] = useState(normalizarHashtags(c.hashtags).map(h => `#${h}`).join(' '))
  const [palavra, setPalavra] = useState(c.palavra_chave ?? '')
  const [dataLocal, setDataLocal] = useState(paraInputLocal(c.data_agendada))
  const [slide, setSlide] = useState(0)
  const [verMais, setVerMais] = useState(false)

  const acoes = acoesPermitidas(c.status)
  const { visivel, resto } = recorteVisivel(c.descricao)
  const legenda = montarLegenda(descricao, tags.split(/[\s,]+/))
  const ehReel = c.tipo === 'reel'

  function salvar() {
    onSalvar({
      descricao,
      alt_text: alt || null,
      hashtags: tags.split(/[\s,]+/).filter(Boolean),
      palavra_chave: palavra || null,
      ...(dataLocal !== paraInputLocal(c.data_agendada) ? { data_local: dataLocal } : {}),
    })
    setEditando(false)
  }

  return (
    <article className="overflow-hidden bg-white">
      {/* Preview */}
      <div className="relative bg-black">
        {ehReel ? (
          <video src={c.midia_urls[0]} poster={c.capa_url ?? undefined} controls muted playsInline preload="metadata"
            className="mx-auto aspect-[9/16] max-h-[58vh] w-full object-contain" />
        ) : (
          <div className="relative">
            <div className="flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto scroll-smooth" onScroll={e => {
              const el = e.currentTarget
              setSlide(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)))
            }}>
              {c.midia_urls.map((u, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={u} src={u} alt={c.alt_text ?? `imagem ${i + 1}`} className="h-full w-full shrink-0 snap-center object-contain" />
              ))}
            </div>
            <div className="pointer-events-none absolute bottom-2 left-0 right-0 flex justify-center gap-1">
              {c.midia_urls.map((_, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === slide ? 'bg-white' : 'bg-white/40'}`} />)}
            </div>
            <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">{slide + 1}/{c.midia_urls.length}</span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">
          {ehReel ? '🎬 Reel' : '🖼️ Carrossel'}
        </span>
      </div>

      <div className="p-4">
        {/* Data + status */}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <StatusPill status={c.status} />
          {editando && acoes.includes('editar') ? (
            <input type="datetime-local" value={dataLocal} onChange={e => setDataLocal(e.target.value)}
              className="rounded-lg border border-indigo-300 px-2 py-1 text-sm" />
          ) : (
            <span className="font-semibold text-gray-800">📅 {rotuloDataHora(c.data_agendada)}</span>
          )}
          <span className="text-xs text-gray-400">· slot {HORA_DO_SLOT[c.tipo as TipoConteudo].rotulo} · Brasília</span>
          {c.ig_permalink && <a href={c.ig_permalink} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs font-semibold text-indigo-600 hover:underline">Ver no Instagram ↗</a>}
        </div>

        {c.status === 'erro' && c.erro && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <b>Erro ({c.tentativas} tentativa{c.tentativas === 1 ? '' : 's'}):</b> {c.erro}
          </div>
        )}
        {c.status === 'publicando' && (
          <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">⏳ Publicando… a Meta está processando a mídia.</div>
        )}

        {/* Descrição */}
        {editando ? (
          <div className="space-y-3">
            <div>
              <textarea value={descricao} onChange={e => setDescricao(e.target.value.slice(0, MAX_LEGENDA))} rows={6}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none" />
              <div className="mt-1 flex justify-between text-[11px] text-gray-400">
                <span>{Math.min(descricao.length, CORTE_VISIVEL)}/{CORTE_VISIVEL} visíveis antes do &quot;mais&quot;</span>
                <span className={legenda.length > MAX_LEGENDA - 100 ? 'text-amber-600' : ''}>{legenda.length}/{MAX_LEGENDA} com hashtags</span>
              </div>
            </div>
            <label className="block text-xs font-semibold text-gray-500">Hashtags
              <input value={tags} onChange={e => setTags(e.target.value)} placeholder="#marketing #vendas" className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="block text-xs font-semibold text-gray-500">Alt text (acessibilidade)
              <input value={alt} onChange={e => setAlt(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
            <label className="block text-xs font-semibold text-gray-500">Palavra-chave
              <input value={palavra} onChange={e => setPalavra(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-normal" />
            </label>
            <div className="flex gap-2">
              <button onClick={salvar} disabled={ocupado} className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Salvar</button>
              <button onClick={() => setEditando(false)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600">Cancelar</button>
            </div>
          </div>
        ) : (
          <div>
            <p className="whitespace-pre-line text-sm leading-relaxed text-gray-800">
              <span className="rounded bg-yellow-50 box-decoration-clone">{visivel}</span>
              {resto && !verMais && <button onClick={() => setVerMais(true)} className="ml-1 text-gray-400">… mais</button>}
              {resto && verMais && <span className="text-gray-600">{resto}</span>}
            </p>
            {c.hashtags.length > 0 && (
              <p className="mt-2 text-xs text-indigo-600">{normalizarHashtags(c.hashtags).map(h => `#${h}`).join(' ')}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-gray-500">
              {c.palavra_chave && <span className="rounded-full bg-gray-100 px-2 py-0.5">🔑 {c.palavra_chave}</span>}
              {c.alt_text && <span className="rounded-full bg-gray-100 px-2 py-0.5" title={c.alt_text}>♿ alt text</span>}
              {c.tema && <span className="rounded-full bg-gray-100 px-2 py-0.5">🏷 {c.tema}</span>}
              {c.nota !== null && <span className="rounded-full bg-gray-100 px-2 py-0.5">⭐ {c.nota}/10</span>}
              {c.origem_url && <a href={c.origem_url} target="_blank" rel="noopener noreferrer" className="rounded-full bg-gray-100 px-2 py-0.5 hover:underline">🔗 fonte</a>}
            </div>
            {c.origem_trecho && (
              <details className="mt-2 text-xs text-gray-500">
                <summary className="cursor-pointer">Trecho de origem</summary>
                <p className="mt-1 whitespace-pre-line rounded-lg bg-gray-50 p-2">{c.origem_trecho}</p>
              </details>
            )}
          </div>
        )}

        {/* Botões — grandes, na base, para o dedão */}
        {!editando && acoes.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            {acoes.includes('aprovar') && (
              <button onClick={onAprovar} disabled={ocupado} className="col-span-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {ocupado ? '…' : '✓ Aprovar'}
              </button>
            )}
            {acoes.includes('tentar_de_novo') && (
              <button onClick={onTentar} disabled={ocupado} className="col-span-2 rounded-xl bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                ↻ Tentar de novo
              </button>
            )}
            {acoes.includes('editar') && (
              <button onClick={() => setEditando(true)} disabled={ocupado} className="rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">✏️ Editar</button>
            )}
            {acoes.includes('descartar') && (
              <button onClick={onDescartar} disabled={ocupado} className="rounded-xl border border-red-200 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">🗑 Descartar</button>
            )}
            {acoes.includes('voltar_para_pendente') && (
              <button onClick={onVoltar} disabled={ocupado} className="rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">↩ Voltar para pendente</button>
            )}
            {acoes.includes('publicar_agora') && (
              <button onClick={onPublicarAgora} disabled={ocupado} className="col-span-2 rounded-xl border border-dashed border-gray-300 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50">
                🧪 Publicar agora (teste)
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function StatusPill({ status }: { status: StatusConteudo }) {
  const map: Record<StatusConteudo, string> = {
    pendente: 'bg-amber-100 text-amber-800',
    agendado: 'bg-indigo-100 text-indigo-800',
    publicando: 'bg-indigo-600 text-white',
    publicado: 'bg-emerald-100 text-emerald-800',
    erro: 'bg-red-100 text-red-800',
    descartado: 'bg-gray-100 text-gray-600',
  }
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${map[status]}`}>{status}</span>
}
