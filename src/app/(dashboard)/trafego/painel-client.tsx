'use client'
// ============================================================================
// Gestor de Tráfego — painel profissional, uma conta por vez
// ----------------------------------------------------------------------------
// Pedido do dono (29/09): "quero selecionar uma conta de anúncio e ver a
// métrica daquela conta", com cara de ferramenta oficial. Tudo vem de
// /api/trafego (painelTrafego), recortado por conta e período. A URL guarda
// conta/período/nível — F5 e link compartilhado abrem no mesmo lugar.
// ============================================================================
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  buscarContasDoToken, conectarContas, listarContasConectadas, desconectarConta,
  sincronizarAgora, painelTrafego, parecerDoChefe,
} from '@/lib/trafego/client'
import type { ContaDisponivel } from '@/lib/meta/conectar'
import type { ContaConectadaResumo } from '@/app/actions/trafego-conexao'
import type { SerieDia } from '@/lib/trafego/mesa-loader'
import {
  brl, resultadoPrincipal, ROTULO_RESULTADO,
  type Especialista, type LinhaMesa, type PlanoMesa, type Recomendacao, type TipoResultado,
} from '@/lib/trafego/mesa'
import type { NivelAnuncio } from '@/lib/meta/sync-v2'

type Painel = Awaited<ReturnType<typeof painelTrafego>>

const PERIODOS = [7, 14, 30]
const NIVEIS: { chave: NivelAnuncio; label: string }[] = [
  { chave: 'campaign', label: 'Campanhas' }, { chave: 'adset', label: 'Conjuntos' }, { chave: 'ad', label: 'Anúncios' },
]
const TIME: { chave: Especialista; nome: string; icone: string; papel: string; cor: string }[] = [
  { chave: 'performance', nome: 'Performance', icone: '💸', papel: 'Onde o dinheiro está indo embora', cor: 'text-red-600' },
  { chave: 'escala', nome: 'Escala', icone: '🚀', papel: 'Onde colocar mais dinheiro', cor: 'text-emerald-600' },
  { chave: 'orcamento', nome: 'Orçamento', icone: '💰', papel: 'De onde tirar, para onde mover', cor: 'text-indigo-600' },
  { chave: 'criativo', nome: 'Criativo', icone: '🎨', papel: 'Anúncio fraco e público cansado', cor: 'text-fuchsia-600' },
  { chave: 'risco', nome: 'Risco', icone: '🛡️', papel: 'O que pode quebrar a operação', cor: 'text-amber-600' },
]
const ACAO: Record<Recomendacao['acao'], { rotulo: string; cor: string }> = {
  pausar: { rotulo: 'Pausar', cor: 'bg-red-50 text-red-700 ring-red-200' },
  reduzir: { rotulo: 'Reduzir', cor: 'bg-orange-50 text-orange-700 ring-orange-200' },
  escalar: { rotulo: 'Escalar', cor: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  mover_verba: { rotulo: 'Mover verba', cor: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  trocar_criativo: { rotulo: 'Trocar criativo', cor: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200' },
  ampliar_publico: { rotulo: 'Ampliar público', cor: 'bg-sky-50 text-sky-700 ring-sky-200' },
  corrigir_rastreamento: { rotulo: 'Corrigir rastreamento', cor: 'bg-amber-50 text-amber-700 ring-amber-200' },
  reconectar: { rotulo: 'Reconectar', cor: 'bg-red-50 text-red-700 ring-red-200' },
  revisar: { rotulo: 'Revisar', cor: 'bg-slate-100 text-slate-700 ring-slate-200' },
  observar: { rotulo: 'Observar', cor: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
const URG = { alta: 'bg-red-500', media: 'bg-amber-400', baixa: 'bg-slate-300' }

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  ACTIVE: { rotulo: 'Ativa', cor: 'bg-emerald-500' },
  PAUSED: { rotulo: 'Pausada', cor: 'bg-slate-300' },
  CAMPAIGN_PAUSED: { rotulo: 'Campanha pausada', cor: 'bg-slate-300' },
  ADSET_PAUSED: { rotulo: 'Conjunto pausado', cor: 'bg-slate-300' },
  DISAPPROVED: { rotulo: 'Reprovada', cor: 'bg-red-500' },
  WITH_ISSUES: { rotulo: 'Com problema', cor: 'bg-red-500' },
  PENDING_REVIEW: { rotulo: 'Em análise', cor: 'bg-amber-400' },
  IN_PROCESS: { rotulo: 'Processando', cor: 'bg-amber-400' },
  ARCHIVED: { rotulo: 'Arquivada', cor: 'bg-slate-200' },
  DELETED: { rotulo: 'Excluída', cor: 'bg-slate-200' },
}

const num = (n: number) => n.toLocaleString('pt-BR')
const curto = (cents: number) => {
  const r = cents / 100
  if (r >= 1_000_000) return `R$ ${(r / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (r >= 10_000) return `R$ ${(r / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return brl(cents)
}
const somaRes = (r: Record<TipoResultado, number>) => r.compra + r.lead + r.conversa + r.cadastro

function totaisDe(linhas: LinhaMesa[]) {
  const t = { gasto: 0, imp: 0, cli: 0, vendas: 0, receita: 0, res: { compra: 0, lead: 0, conversa: 0, cadastro: 0 } as Record<TipoResultado, number> }
  for (const l of linhas) {
    t.gasto += l.gastoCents; t.imp += l.impressoes; t.cli += l.cliques; t.vendas += l.vendasReais; t.receita += l.receitaRealCents
    for (const k of Object.keys(t.res) as TipoResultado[]) t.res[k] += l.resultados[k]
  }
  return t
}

export function PainelTrafego({ contaInicial, dias, nivel }: { contaInicial: string | null; dias: number; nivel: NivelAnuncio }) {
  const router = useRouter()
  const [contas, setContas] = useState<ContaConectadaResumo[] | null>(null)
  const [conta, setConta] = useState<string | null>(contaInicial)
  const [dados, setDados] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [versao, setVersao] = useState(0)
  const [modal, setModal] = useState(false)
  const [gerenciar, setGerenciar] = useState(false)
  const [sync, setSync] = useState<string | null>(null)

  const irPara = (p: { conta?: string | null; dias?: number; nivel?: NivelAnuncio }) => {
    const q = new URLSearchParams()
    const c = p.conta !== undefined ? p.conta : conta
    if (c) q.set('conta', c)
    q.set('dias', String(p.dias ?? dias)); q.set('nivel', p.nivel ?? nivel)
    router.replace(`/trafego?${q.toString()}`, { scroll: false })
  }

  useEffect(() => {
    let vivo = true
    listarContasConectadas().then(r => { if (vivo) setContas(r.contas) }).catch(() => { if (vivo) setContas([]) })
    return () => { vivo = false }
  }, [versao])

  useEffect(() => {
    let vivo = true
    painelTrafego(conta, dias).then(r => { if (vivo) { setDados(r); setCarregando(false) } })
      .catch(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [conta, dias, versao])

  function escolherConta(id: string | null) {
    setCarregando(true); setConta(id); irPara({ conta: id })
  }

  async function lerAgora() {
    setSync('Lendo a Meta…')
    const r = await sincronizarAgora(conta)
    setSync(r.error ?? (r.falhas > 0 ? `Falhou: ${r.erros.join(' · ')}` : `Atualizado agora · ${r.ok} conta(s)`))
    setCarregando(true); setVersao(v => v + 1)
  }

  const contaAtual = contas?.find(c => c.id === conta) ?? null
  const semConta = contas !== null && contas.length === 0
  const linhasNivel = useMemo(() => (dados?.linhas ?? []).filter(l => l.nivel === nivel), [dados, nivel])
  const campanhas = useMemo(() => (dados?.linhas ?? []).filter(l => l.nivel === 'campaign'), [dados])
  const t = totaisDe(campanhas)
  const tipo = resultadoPrincipal(t.res)
  const ultimaLeitura = (contaAtual ? [contaAtual] : contas ?? []).map(c => c.ultimaSync).filter(Boolean).sort().pop() ?? null

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* ─── Cabeçalho ───────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">Meta Ads</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Gestor de Tráfego</h1>
          <p className="mt-1 text-sm text-slate-500">
            {dados ? `${fmtData(dados.periodo.desde)} – ${fmtData(dados.periodo.ate)}` : ' '}
            {ultimaLeitura && <> · atualizado {desde(ultimaLeitura)}</>}
            {sync && <> · <span className="text-slate-700">{sync}</span></>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmento opcoes={PERIODOS.map(d => ({ v: d, l: `${d} dias` }))} valor={dias}
            onChange={d => { setCarregando(true); irPara({ dias: d }) }} />
          {!semConta && (
            <button onClick={lerAgora} disabled={sync === 'Lendo a Meta…'}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">
              <span className={sync === 'Lendo a Meta…' ? 'animate-spin' : ''}>↻</span> Atualizar
            </button>
          )}
          <button onClick={() => setModal(true)}
            className="inline-flex h-9 items-center rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
            + Conectar conta
          </button>
        </div>
      </header>

      {semConta ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-4xl">📊</p>
          <h2 className="mt-3 text-lg font-semibold text-slate-900">Nenhuma conta de anúncio conectada</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            Sem conta não há gasto para comparar — isso não é &quot;zero vendas&quot;. Conecte em 1 minuto: cole o token e escolha a conta da lista.
          </p>
          <button onClick={() => setModal(true)} className="mt-5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Conectar conta</button>
        </div>
      ) : (
        <>
          {/* ─── Seletor de conta ─────────────────────────────────────── */}
          <div className="mt-6 flex items-center gap-2">
            <div className="-mx-1 flex flex-1 gap-2 overflow-x-auto px-1 pb-1">
              <ContaChip ativo={!conta} onClick={() => escolherConta(null)} nome="Todas as contas" sub={`${contas?.length ?? 0} conectadas`} ok />
              {(contas ?? []).map(c => (
                <ContaChip key={c.id} ativo={conta === c.id} onClick={() => escolherConta(c.id)}
                  nome={c.nome} sub={`ID ${c.externalId}`} ok={c.status === 'active' && !c.erro} />
              ))}
            </div>
            <button onClick={() => setGerenciar(g => !g)} className="shrink-0 rounded-lg px-2 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100">
              {gerenciar ? 'Fechar' : 'Gerenciar'}
            </button>
          </div>

          {gerenciar && contas && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {contas.map(c => {
                const ruim = c.status !== 'active' || !!c.erro
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{c.nome}</p>
                      <p className="text-xs text-slate-500">ID {c.externalId}{c.moeda ? ` · ${c.moeda}` : ''} · {c.ultimaSync ? `lida ${desde(c.ultimaSync)}` : 'ainda não lida'}</p>
                      {ruim && <p className="text-xs text-red-600">{c.status === 'token_expired' ? 'Conexão caiu — reconecte.' : c.erro}</p>}
                    </div>
                    <button onClick={async () => { if (confirm(`Desconectar "${c.nome}"?`)) { await desconectarConta(c.id); if (conta === c.id) escolherConta(null); setVersao(v => v + 1) } }}
                      className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600">Desconectar</button>
                  </li>
                )
              })}
            </ul>
          )}

          {contaAtual && (contaAtual.status !== 'active' || contaAtual.erro) && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <strong>Esta conta está com problema</strong> — os números abaixo estão parados no tempo.{' '}
              {contaAtual.status === 'token_expired' ? 'A conexão caiu: clique em "Conectar conta" e cole um token novo.' : contaAtual.erro}
            </div>
          )}

          <div className={carregando ? 'pointer-events-none opacity-60 transition-opacity' : 'transition-opacity'}>
            {/* ─── KPIs ─────────────────────────────────────────────── */}
            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi rotulo="Investido" valor={curto(t.gasto)} />
              <Kpi rotulo={tipo ? ROTULO_RESULTADO[tipo].varios[0].toUpperCase() + ROTULO_RESULTADO[tipo].varios.slice(1) : 'Resultados'}
                valor={num(tipo ? t.res[tipo] : 0)}
                nota={resumoOutros(t.res, tipo)} />
              <Kpi rotulo={tipo ? `Custo por ${ROTULO_RESULTADO[tipo].um}` : 'Custo por resultado'}
                valor={tipo && t.res[tipo] > 0 ? brl(Math.round(t.gasto / t.res[tipo])) : '—'} />
              <Kpi rotulo="CTR" valor={t.imp > 0 ? `${((t.cli / t.imp) * 100).toFixed(2)}%` : '—'} nota={`${num(t.cli)} cliques`} />
              <Kpi rotulo="CPM" valor={t.imp > 0 ? brl(Math.round((t.gasto / t.imp) * 1000)) : '—'} nota={`${num(t.imp)} impressões`} />
              <Kpi rotulo="ROAS real" valor={t.receita > 0 && t.gasto > 0 ? `${(t.receita / t.gasto).toFixed(2)}x` : '—'}
                nota={t.receita > 0 ? `${brl(t.receita)} em ${t.vendas} venda(s)` : 'sem venda confirmada'} />
            </div>

            {!conta && dados && dados.semAtribuicao.vendas > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <strong>{dados.semAtribuicao.vendas} venda(s) sem anúncio de origem</strong> ({brl(dados.semAtribuicao.receitaCents)}).
                Ficam fora do ROAS de propósito. Gere os links dos anúncios de novo pelo funil, com <code>utm_ad_id</code>.
              </div>
            )}

            {/* ─── Gráfico diário ──────────────────────────────────── */}
            {dados && dados.serie.length > 0 && <Grafico serie={dados.serie} rotuloRes={tipo ? ROTULO_RESULTADO[tipo].varios : 'resultados'} />}

            {/* ─── Mesa de estrategistas ───────────────────────────── */}
            {dados?.plano && <Mesa plano={dados.plano} dias={dias} conta={conta} />}

            {/* ─── Tabela ──────────────────────────────────────────── */}
            <Tabela linhas={linhasNivel} nivel={nivel} onNivel={n => irPara({ nivel: n })} carregando={carregando && !dados} />
          </div>
        </>
      )}

      {modal && <ModalConectar onFechar={() => setModal(false)} onConectou={async () => { setModal(false); setVersao(v => v + 1); await lerAgora() }} />}
    </div>
  )
}

// ── Peças ──────────────────────────────────────────────────────────────────

function fmtData(iso: string) { const [a, m, d] = iso.split('-'); return `${d}/${m}/${a}` }
function desde(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 2) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)} dia(s)`
}
function resumoOutros(r: Record<TipoResultado, number>, principal: TipoResultado | null) {
  const o = (Object.keys(r) as TipoResultado[]).filter(k => k !== principal && r[k] > 0).map(k => `${num(r[k])} ${ROTULO_RESULTADO[k].varios}`)
  return o.length ? `+ ${o.join(' · ')}` : undefined
}

function Segmento<T extends string | number>({ opcoes, valor, onChange }: { opcoes: { v: T; l: string }[]; valor: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex h-9 rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
      {opcoes.map(o => (
        <button key={String(o.v)} onClick={() => onChange(o.v)}
          className={`rounded-md px-3 text-sm font-medium transition ${o.v === valor ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
          {o.l}
        </button>
      ))}
    </div>
  )
}

function ContaChip({ ativo, onClick, nome, sub, ok }: { ativo: boolean; onClick: () => void; nome: string; sub: string; ok: boolean }) {
  return (
    <button onClick={onClick}
      className={`flex min-w-[170px] max-w-[240px] shrink-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
        ativo ? 'border-blue-600 bg-blue-50 ring-1 ring-blue-600' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <span className="min-w-0">
        <span className={`block truncate text-sm font-semibold ${ativo ? 'text-blue-900' : 'text-slate-900'}`}>{nome}</span>
        <span className="block truncate text-[11px] text-slate-500">{sub}</span>
      </span>
    </button>
  )
}

function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{rotulo}</p>
      <p className="mt-1.5 text-xl sm:text-2xl font-bold tabular-nums whitespace-nowrap tracking-tight text-slate-900">{valor}</p>
      <p className="mt-0.5 truncate text-xs text-slate-500">{nota ?? ' '}</p>
    </div>
  )
}

function Grafico({ serie, rotuloRes }: { serie: SerieDia[]; rotuloRes: string }) {
  const [foco, setFoco] = useState<number | null>(null)
  const max = Math.max(1, ...serie.map(s => s.gastoCents))
  const maxR = Math.max(1, ...serie.map(s => s.resultados))
  const W = 100 / serie.length
  const pontos = serie.map((s, i) => `${(i + 0.5) * W},${100 - (s.resultados / maxR) * 88}`).join(' ')
  const f = foco !== null ? serie[foco] : null
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Investimento × resultados por dia</h2>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-blue-500" /> Investido</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-emerald-500" /> {rotuloRes}</span>
        </div>
      </div>
      <p className="mt-1 h-5 text-xs text-slate-600">
        {f ? <><strong>{fmtData(f.date)}</strong> · {brl(f.gastoCents)} · {num(f.resultados)} {rotuloRes}{f.resultados > 0 ? ` · ${brl(Math.round(f.gastoCents / f.resultados))} cada` : ''}</> : 'Passe o dedo ou o mouse sobre o dia.'}
      </p>
      <div className="relative mt-2 h-40" onMouseLeave={() => setFoco(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {[25, 50, 75].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="#e2e8f0" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />)}
          {serie.map((s, i) => {
            const h = (s.gastoCents / max) * 88
            return <rect key={s.date} x={i * W + W * 0.18} width={W * 0.64} y={100 - h} height={h} rx="0.6"
              fill={foco === i ? '#2563eb' : '#93c5fd'} />
          })}
          <polyline points={pontos} fill="none" stroke="#10b981" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <div className="absolute inset-0 flex">
          {serie.map((s, i) => <div key={s.date} className="h-full flex-1" onMouseEnter={() => setFoco(i)} onClick={() => setFoco(i)} />)}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{fmtData(serie[0].date).slice(0, 5)}</span><span>{fmtData(serie[serie.length - 1].date).slice(0, 5)}</span>
      </div>
    </section>
  )
}

function Mesa({ plano, dias, conta }: { plano: PlanoMesa; dias: number; conta: string | null }) {
  const [aba, setAba] = useState<Especialista | 'todas'>('todas')
  const [parecer, setParecer] = useState<{ texto?: string; error?: string; carregando?: boolean }>({})
  const [todas, setTodas] = useState(false)
  const r = plano.resumo
  const lista = aba === 'todas' ? plano.recomendacoes : plano.porEspecialista[aba]
  const visiveis = todas ? lista : lista.slice(0, 6)

  async function pedirParecer() {
    setParecer({ carregando: true })
    setParecer(await parecerDoChefe(dias, conta))
  }

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Mesa de estrategistas</h2>
          <p className="text-xs text-slate-500">Cinco especialistas analisando cada campanha, conjunto e anúncio desta seleção.</p>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Dinheiro em risco</p>
            <p className={`text-lg font-bold tabular-nums ${r.dinheiroEmRiscoCents > 0 ? 'text-red-600' : 'text-slate-900'}`}>{brl(r.dinheiroEmRiscoCents)}</p>
          </div>
          <Saude valor={r.saude} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 lg:grid-cols-5">
        {TIME.map(t => {
          const n = plano.porEspecialista[t.chave].length
          const ativo = aba === t.chave
          return (
            <button key={t.chave} onClick={() => { setAba(ativo ? 'todas' : t.chave); setTodas(false) }}
              className={`bg-white px-4 py-3 text-left transition hover:bg-slate-50 ${ativo ? 'shadow-[inset_0_-2px_0_0_#2563eb]' : ''}`}>
              <p className="text-xs text-slate-500">{t.icone} {t.nome}</p>
              <p className={`mt-0.5 text-xl font-bold tabular-nums ${n > 0 ? t.cor : 'text-slate-300'}`}>{n}</p>
              <p className="truncate text-[11px] text-slate-400">{t.papel}</p>
            </button>
          )
        })}
      </div>

      <div className="p-4 sm:p-5">
        {lista.length === 0 ? (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {aba === 'todas' ? '✓ Nada fora da régua neste período. Siga rodando e reavalie em 3 dias.' : '✓ Este especialista não viu nada para mexer agora.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visiveis.map(x => {
              const t = TIME.find(tt => tt.chave === x.especialista)!
              return (
                <li key={x.chave} className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${URG[x.urgencia]}`} title={`Urgência ${x.urgencia}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold text-slate-900">{x.titulo}</p>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${ACAO[x.acao].cor}`}>{ACAO[x.acao].rotulo}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{t.icone} {t.nome} · <span className="font-medium text-slate-600">{x.alvo.nome}</span></p>
                    <p className="mt-1.5 text-sm text-slate-600">{x.porque}</p>
                    {x.impacto && <p className="mt-1 text-sm font-medium text-slate-900">→ {x.impacto}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {lista.length > 6 && (
          <button onClick={() => setTodas(v => !v)} className="mt-3 text-sm font-medium text-blue-600 hover:underline">
            {todas ? 'Mostrar menos' : `Ver todas as ${lista.length} recomendações`}
          </button>
        )}

        <div className="mt-5 rounded-xl bg-gradient-to-br from-slate-900 to-indigo-950 p-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">🧠 Parecer do estrategista-chefe</p>
              <p className="text-xs text-indigo-200">Junta tudo num plano: o que fazer hoje e nesta semana.</p>
            </div>
            <button onClick={pedirParecer} disabled={parecer.carregando}
              className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-indigo-50 disabled:opacity-60">
              {parecer.carregando ? 'Escrevendo…' : parecer.texto ? 'Gerar de novo' : 'Gerar parecer'}
            </button>
          </div>
          {parecer.error && <p className="mt-3 text-sm text-red-300">{parecer.error}</p>}
          {parecer.texto && <div className="mt-3 whitespace-pre-wrap border-t border-white/10 pt-3 text-sm leading-relaxed text-slate-100">{parecer.texto}</div>}
        </div>
      </div>
    </section>
  )
}

function Saude({ valor }: { valor: number | null }) {
  const v = valor ?? 0
  const cor = valor === null ? '#cbd5e1' : v >= 80 ? '#10b981' : v >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-11 w-11">
        <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="4" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke={cor} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(v / 100) * 97.4} 97.4`} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-900">{valor ?? '—'}</span>
      </div>
      <p className="text-[11px] font-semibold uppercase leading-tight tracking-wider text-slate-500">Saúde<br />da conta</p>
    </div>
  )
}

type Ordem = 'gasto' | 'res' | 'cpr' | 'ctr' | 'cpm' | 'freq' | 'roas'

function Tabela({ linhas, nivel, onNivel, carregando }: { linhas: LinhaMesa[]; nivel: NivelAnuncio; onNivel: (n: NivelAnuncio) => void; carregando: boolean }) {
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<Ordem>('gasto')
  const [soAtivas, setSoAtivas] = useState(false)
  const [limite, setLimite] = useState(25)

  const valor = (l: LinhaMesa, o: Ordem): number => {
    const tp = resultadoPrincipal(l.resultados); const n = tp ? l.resultados[tp] : 0
    switch (o) {
      case 'gasto': return l.gastoCents
      case 'res': return somaRes(l.resultados)
      case 'cpr': return n > 0 ? -(l.gastoCents / n) : -Infinity
      case 'ctr': return l.ctr ?? -1
      case 'cpm': return l.cpmCents ?? -1
      case 'freq': return l.frequencia ?? -1
      case 'roas': return l.receitaRealCents > 0 && l.gastoCents > 0 ? l.receitaRealCents / l.gastoCents : -1
    }
  }
  const filtradas = linhas
    .filter(l => l.gastoCents > 0 || somaRes(l.resultados) > 0)
    .filter(l => !soAtivas || (l.status ?? '').toUpperCase() === 'ACTIVE')
    .filter(l => !busca.trim() || l.nome.toLowerCase().includes(busca.trim().toLowerCase()) || l.id.includes(busca.trim()))
    .sort((a, b) => valor(b, ordem) - valor(a, ordem))
  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Segmento opcoes={NIVEIS.map(n => ({ v: n.chave, l: n.label }))} valor={nivel} onChange={onNivel} />
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou ID…"
          className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm focus:border-blue-500 focus:outline-none sm:max-w-xs" />
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={soAtivas} onChange={e => setSoAtivas(e.target.checked)} /> Só ativas
        </label>
      </div>

      {carregando ? <p className="p-6 text-sm text-slate-500">Carregando…</p> : filtradas.length === 0 ? (
        <p className="p-6 text-sm text-slate-500">Nenhum item com gasto neste período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-[11px] font-semibold tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left uppercase">{NIVEIS.find(n => n.chave === nivel)!.label}</th>
                <Cabecalho o="gasto" ordem={ordem} onOrdem={setOrdem}>Investido</Cabecalho><Cabecalho o="res" ordem={ordem} onOrdem={setOrdem}>Resultados</Cabecalho><Cabecalho o="cpr" ordem={ordem} onOrdem={setOrdem}>Custo/res.</Cabecalho>
                <Cabecalho o="ctr" ordem={ordem} onOrdem={setOrdem}>CTR</Cabecalho><Cabecalho o="cpm" ordem={ordem} onOrdem={setOrdem}>CPM</Cabecalho><Cabecalho o="freq" ordem={ordem} onOrdem={setOrdem}>Freq.</Cabecalho><Cabecalho o="roas" ordem={ordem} onOrdem={setOrdem}>ROAS</Cabecalho>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtradas.slice(0, limite).map(l => {
                const tp = resultadoPrincipal(l.resultados)
                const n = tp ? l.resultados[tp] : 0
                const st = STATUS[(l.status ?? '').toUpperCase()] ?? { rotulo: l.status ?? '—', cor: 'bg-slate-300' }
                const roas = l.receitaRealCents > 0 && l.gastoCents > 0 ? l.receitaRealCents / l.gastoCents : null
                return (
                  <tr key={`${l.nivel}:${l.id}`} className="hover:bg-slate-50/70">
                    <td className="max-w-[380px] px-4 py-3">
                      <p className="truncate font-medium text-slate-900" title={l.nome}>{l.nome}</p>
                      <p className="flex items-center gap-1.5 text-xs text-slate-500">
                        <span className={`h-1.5 w-1.5 rounded-full ${st.cor}`} />{st.rotulo}
                        {l.orcamentoDiarioCents ? <> · {brl(l.orcamentoDiarioCents)}/dia</> : null}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-900">{brl(l.gastoCents)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {n > 0 ? <>{num(n)} <span className="text-xs text-slate-500">{ROTULO_RESULTADO[tp!].varios}</span></> : <span className="text-slate-400">0</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{n > 0 ? brl(Math.round(l.gastoCents / n)) : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{l.ctr !== null ? `${l.ctr.toFixed(2)}%` : '—'}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{l.cpmCents !== null ? brl(l.cpmCents) : '—'}</td>
                    <td className={`px-3 py-3 text-right tabular-nums ${l.frequencia !== null && l.frequencia >= 3 ? 'font-semibold text-amber-600' : ''}`}>{l.frequencia !== null ? l.frequencia.toFixed(1) : '—'}</td>
                    <td className="px-3 py-3 text-right">
                      {roas === null ? <span className="text-slate-400">—</span> : (
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ${roas >= 3 ? 'bg-emerald-50 text-emerald-700' : roas >= 1 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>{roas.toFixed(2)}x</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {filtradas.length > limite && (
        <button onClick={() => setLimite(l => l + 50)} className="w-full border-t border-slate-100 py-3 text-sm font-medium text-blue-600 hover:bg-slate-50">
          Mostrar mais ({filtradas.length - limite} restantes)
        </button>
      )}
      <p className="border-t border-slate-100 px-4 py-2.5 text-xs text-slate-400">
        ROAS só aparece com venda confirmada no FunilPro. Campanha de conversa ou lead é julgada pelo custo por resultado.
      </p>
    </section>
  )
}

function Cabecalho({ o, ordem, onOrdem, children }: { o: Ordem; ordem: Ordem; onOrdem: (o: Ordem) => void; children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-right">
      <button onClick={() => onOrdem(o)} className={`inline-flex items-center gap-1 uppercase ${ordem === o ? 'text-slate-900' : 'hover:text-slate-700'}`}>
        {children}{ordem === o && <span>↓</span>}
      </button>
    </th>
  )
}

function ModalConectar({ onFechar, onConectou }: { onFechar: () => void; onConectou: () => void }) {
  const [token, setToken] = useState('')
  const [contas, setContas] = useState<ContaDisponivel[] | null>(null)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function buscar() {
    setOcupado(true); setErro(null)
    const r = await buscarContasDoToken(token)
    setOcupado(false)
    if (r.error && !r.contas?.length) { setErro(r.error); return }
    setContas(r.contas ?? [])
    setMarcadas(new Set((r.contas ?? []).filter(c => c.podeAnunciar).slice(0, 1).map(c => c.id)))
  }

  async function conectar() {
    setOcupado(true); setErro(null)
    const r = await conectarContas(token, [...marcadas])
    setOcupado(false)
    if (r.error) { setErro(r.error); return }
    onConectou()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-sm sm:items-center" onClick={onFechar}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Conectar Gerenciador de Anúncios</h3>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-700" aria-label="Fechar">✕</button>
        </div>

        {!contas ? (
          <>
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
              <li>Abra o <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-blue-600 underline">Explorador da Graph API</a> logado no Facebook dono dos anúncios.</li>
              <li>Em <strong>Permissões</strong>, digite e adicione <code className="rounded bg-slate-100 px-1">ads_read</code> (e <code className="rounded bg-slate-100 px-1">business_management</code>).</li>
              <li>Clique em <strong>Generate Access Token</strong>, autorize e copie o token.</li>
              <li>Cole abaixo — a lista de contas aparece sozinha.</li>
            </ol>
            <textarea value={token} onChange={e => setToken(e.target.value)} rows={4} placeholder="EAAB…"
              className="mt-4 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs focus:border-blue-500 focus:outline-none" />
            <button onClick={buscar} disabled={ocupado || token.trim().length < 20}
              className="mt-3 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {ocupado ? 'Perguntando à Meta…' : 'Ver minhas contas'}
            </button>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-600">Marque as contas que o time deve acompanhar:</p>
            <ul className="mt-3 space-y-2">
              {contas.map(c => (
                <li key={c.id}>
                  <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${marcadas.has(c.id) ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
                    <input type="checkbox" className="mt-1" checked={marcadas.has(c.id)}
                      onChange={() => setMarcadas(m => { const n = new Set(m); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900">{c.nome}</span>
                      <span className="block text-xs text-slate-500">ID {c.id}{c.moeda ? ` · ${c.moeda}` : ''}{c.empresa ? ` · ${c.empresa}` : ''}</span>
                      <span className={`text-xs ${c.podeAnunciar ? 'text-emerald-700' : 'text-amber-700'}`}>{c.situacao}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setContas(null)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">Voltar</button>
              <button onClick={conectar} disabled={ocupado || marcadas.size === 0}
                className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {ocupado ? 'Conectando…' : `Conectar ${marcadas.size} conta(s) e ler agora`}
              </button>
            </div>
          </>
        )}
        {erro && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
        <p className="mt-4 text-xs text-slate-400">O token fica só no servidor. Se o app da Meta estiver configurado no Admin, ele é trocado por um de 60 dias.</p>
      </div>
    </div>,
    document.body,
  )
}
