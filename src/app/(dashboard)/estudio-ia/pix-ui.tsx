'use client'
// ============================================================================
// Estúdio IA — Fase 4: peças de tela do Pix por comprovante
//   CartaoPix          → Configurações: chave, tipo, nome do recebedor
//   ConferenciaPix     → ao lado da conversa: comprovante + Aprovar/Recusar
//   CustoDaConversa    → gasto de IA da conversa
//   AbaPainelPix       → subaba Painel (parte da Fase 4): conferências
//                        pendentes + lista diária "Pix por comprovante"
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import {
  lerPixConfig, salvarPixConfig, listarConferenciasPix, listarPixDoDia, aprovarPagamentoPix,
  recusarPagamentoPix, cancelarPedidoEstudio, custoIaDaConversa, custoIaDoDia, listarAvisosEstudio, enviarTesteAvisos,
} from '@/lib/estudio/client'

type PedidoPix = Awaited<ReturnType<typeof listarConferenciasPix>>['pedidos'][number]
type Custo = Awaited<ReturnType<typeof custoIaDaConversa>>

const reais = (c: number | null | undefined, moeda = 'BRL') => c === null || c === undefined ? '—'
  : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: moeda })
const hora = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const usd = (v: number) => `US$ ${v.toFixed(v < 0.01 ? 4 : 2)}`
const hojeBrasilia = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)

const TIPOS = [['celular', 'Celular'], ['cpf', 'CPF'], ['cnpj', 'CNPJ'], ['email', 'E-mail'], ['aleatoria', 'Aleatória']] as const

export function CartaoPix() {
  const [v, setV] = useState<{ chave: string; tipo: string; recebedor: string } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  useEffect(() => {
    let vivo = true
    lerPixConfig().then(r => { if (!vivo) return; setV({ chave: r.chave, tipo: r.tipo, recebedor: r.recebedor }); if (r.error) setMsg({ ok: false, t: r.error }) })
    return () => { vivo = false }
  }, [])
  if (!v) return null
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">💸 Pix (Brasil)</h2>
      <p className="text-xs text-slate-500">No fechamento a Ana manda esta chave e o valor exato. O comprovante é lido pela IA e aprovado sozinho quando valor, recebedor, data (até 24 h) e ID da transação batem; senão vem para você conferir.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm"><span className="text-xs font-medium text-slate-600">Tipo da chave</span>
          <select value={v.tipo} onChange={e => setV({ ...v, tipo: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm">
            {TIPOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <label className="text-sm"><span className="text-xs font-medium text-slate-600">Chave Pix</span>
          <input value={v.chave} onChange={e => setV({ ...v, chave: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" placeholder="+55 21 9…" /></label>
        <label className="text-sm"><span className="text-xs font-medium text-slate-600">Nome do recebedor (como sai no comprovante)</span>
          <input value={v.recebedor} onChange={e => setV({ ...v, recebedor: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" placeholder="Luís Carlos da Silva" /></label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={async () => { const r = await salvarPixConfig(v.chave, v.tipo, v.recebedor); setMsg(r.success ? { ok: true, t: 'Salvo.' } : { ok: false, t: r.error ?? 'falhou' }) }}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Salvar Pix</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.t}</span>}
      </div>
    </section>
  )
}

function CartaoConferencia({ p, onMudou }: { p: PedidoPix; onMudou: () => void }) {
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const agir = async (f: () => Promise<{ success: boolean; error?: string }>) => {
    setOcupado(true); setErro(null)
    const r = await f(); setOcupado(false)
    if (!r.success) setErro(r.error ?? 'falhou'); else onMudou()
  }
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex gap-3">
        {p.comprovante_url ? (
          <a href={p.comprovante_url} target="_blank" rel="noreferrer" className="block h-24 w-20 shrink-0 overflow-hidden rounded border border-amber-200 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.comprovante_url} alt="comprovante" className="h-full w-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          </a>
        ) : <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded bg-white text-xl">🧾</div>}
        <div className="min-w-0 text-xs">
          <p className="font-semibold text-slate-900">{p.cliente_nome ?? `+${p.wa_id}`} · {reais(p.valor_cents, p.moeda)}</p>
          <p className="text-slate-600">{p.pacote_qtd} fotos · {p.tema_slug ?? '—'} · {hora(p.criado_em)}</p>
          {p.pagador && <p className="text-slate-600">Pagador: {p.pagador}</p>}
          <p className="mt-1 text-amber-800">{p.conferencia_motivo ?? 'conferir'}</p>
          {p.comprovante_url && <a href={p.comprovante_url} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-amber-900 underline">abrir comprovante</a>}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button disabled={ocupado} onClick={() => agir(() => aprovarPagamentoPix(p.id))} className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white disabled:opacity-50">✅ Aprovar</button>
        <button disabled={ocupado} onClick={() => { const m = prompt('Motivo da recusa (só você vê):', 'valor ou recebedor não confere'); if (m !== null) void agir(() => recusarPagamentoPix(p.id, m)) }}
          className="flex-1 rounded-lg border border-red-200 bg-white py-1.5 text-xs font-semibold text-red-700 disabled:opacity-50">Recusar</button>
      </div>
      {erro && <p className="mt-1 text-[11px] text-red-600">{erro}</p>}
    </div>
  )
}

/** Comprovantes deste contato esperando conferência (vai ao lado da conversa). */
export function ConferenciaPix({ contatoId, onMudou }: { contatoId: string; onMudou: () => void }) {
  const [lista, setLista] = useState<PedidoPix[]>([])
  const [versao, setVersao] = useState(0)
  useEffect(() => {
    let vivo = true
    listarConferenciasPix().then(r => { if (vivo) setLista(r.pedidos.filter(p => p.contato_id === contatoId)) }).catch(() => {})
    return () => { vivo = false }
  }, [contatoId, versao])
  if (lista.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-amber-800">🧾 Comprovante para conferir</p>
      {lista.map(p => <CartaoConferencia key={p.id} p={p} onMudou={() => { setVersao(v => v + 1); onMudou() }} />)}
    </div>
  )
}

export function CustoDaConversa({ contatoId }: { contatoId: string }) {
  const [c, setC] = useState<Custo | null>(null)
  useEffect(() => {
    let vivo = true
    custoIaDaConversa(contatoId).then(r => { if (vivo) setC(r) }).catch(() => {})
    return () => { vivo = false }
  }, [contatoId])
  if (!c || c.error) return null
  return (
    <div>
      <p className="text-xs font-semibold text-slate-700">Custo de IA desta conversa</p>
      <p className="mt-1 text-sm text-slate-900">{usd(c.total_usd)} <span className="text-xs text-slate-500">· {c.chamadas} chamada(s)</span></p>
      {c.por_modelo.map(m => <p key={m.modelo} className="text-[11px] text-slate-500">{m.modelo}: {m.chamadas}× · {usd(m.custo_usd)} · {m.tokens.toLocaleString('pt-BR')} tokens</p>)}
    </div>
  )
}

/** Subaba Painel (parte da Fase 4). O painel completo de vendas é a Fase 6. */
export function AbaPainelPix() {
  const [dia, setDia] = useState(hojeBrasilia)
  const [pend, setPend] = useState<PedidoPix[]>([])
  const [doDia, setDoDia] = useState<{ pedidos: PedidoPix[]; total_cents: number }>({ pedidos: [], total_cents: 0 })
  const [custo, setCusto] = useState<Custo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const recarregar = useCallback(() => setVersao(v => v + 1), [])

  useEffect(() => {
    let vivo = true
    Promise.all([listarConferenciasPix(), listarPixDoDia(dia), custoIaDoDia(dia)]).then(([a, b, c]) => {
      if (!vivo) return
      setPend(a.pedidos); setDoDia(b); setCusto(c)
      setErro(a.error ?? b.error ?? c.error ?? null)
    }).catch(e => setErro(String(e)))
    return () => { vivo = false }
  }, [dia, versao])

  return (
    <div className="mt-5 space-y-5">
      {erro && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      <PainelAvisos versao={versao} />
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">🧾 Comprovantes para conferir {pend.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{pend.length}</span>}</h2>
        {pend.length === 0 ? <p className="mt-2 text-sm text-slate-500">Nada pendente. 🎉</p>
          : <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{pend.map(p => <CartaoConferencia key={p.id} p={p} onMudou={recarregar} />)}</div>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Pix por comprovante</h2>
            <p className="text-xs text-slate-500">Bata com o extrato do banco. Achou comprovante falso? Cancele o pedido.</p>
          </div>
          <input type="date" value={dia} onChange={e => setDia(e.target.value)} className="rounded-lg border border-slate-200 p-2 text-sm" />
        </div>
        <div className="mt-3 flex flex-wrap gap-6 text-sm">
          <p><span className="text-slate-500">Recebido no dia:</span> <strong>{reais(doDia.total_cents)}</strong></p>
          <p><span className="text-slate-500">Pedidos:</span> <strong>{doDia.pedidos.filter(p => p.status !== 'cancelado').length}</strong></p>
          {custo && <p><span className="text-slate-500">Custo de IA no dia:</span> <strong>{usd(custo.total_usd)}</strong> <span className="text-xs text-slate-400">({custo.chamadas} chamadas)</span></p>}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-2">Horário</th><th>Cliente</th><th>Pagador</th><th>Valor</th><th>ID da transação</th><th>Como</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {doDia.pedidos.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-slate-500">Nenhum Pix neste dia.</td></tr>}
              {doDia.pedidos.map(p => (
                <tr key={p.id} className={p.status === 'cancelado' ? 'text-slate-400 line-through' : ''}>
                  <td className="py-2">{hora(p.pago_em)}</td>
                  <td>{p.cliente_nome ?? `+${p.wa_id}`}</td>
                  <td>{p.pagador ?? '—'}</td>
                  <td className="font-medium">{reais(p.valor_pago_cents, p.moeda)}</td>
                  <td className="font-mono text-[11px]">{p.pix_e2e_id ?? '—'}</td>
                  <td>{p.pago_por === 'manual' ? 'aprovado por você' : 'automático'}{p.comprovante_url && <> · <a href={p.comprovante_url} target="_blank" rel="noreferrer" className="text-sky-700 underline">ver</a></>}</td>
                  <td className="text-right">{p.status !== 'cancelado' && (
                    <button onClick={async () => {
                      const m = prompt('Cancelar/estornar este pedido? Motivo:', 'comprovante falso')
                      if (m === null) return
                      const r = await cancelarPedidoEstudio(p.id, m); if (!r.success) setErro(r.error ?? 'falhou'); else recarregar()
                    }} className="text-xs font-medium text-red-600 hover:underline">cancelar/estornar</button>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-slate-400">O painel completo de vendas (faturamento por período e moeda, rankings, funil, origem, custos e lucro) chega na Fase 6 — os dados já estão sendo gravados em cada pedido pago.</p>
    </div>
  )
}

type Avisos = Awaited<ReturnType<typeof listarAvisosEstudio>>

/** "Pedidos na fila" bem visível + cada aviso ao Luís (enviado/erro com o motivo) + teste. */
function PainelAvisos({ versao }: { versao: number }) {
  const [a, setA] = useState<Avisos | null>(null)
  const [teste, setTeste] = useState<{ ok: boolean; t: string } | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let vivo = true
    const carregar = () => listarAvisosEstudio().then(r => { if (vivo) setA(r) }).catch(() => {})
    carregar()
    const t = setInterval(carregar, 20000)
    return () => { vivo = false; clearInterval(t) }
  }, [versao, n])
  const cor = (s: string) => s === 'enviado' ? 'text-emerald-700' : s === 'pulado' ? 'text-slate-500' : 'text-red-600'
  return (
    <section className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <a href="/estudio-ia?aba=pedidos" className={`flex flex-col items-center justify-center rounded-xl border p-5 text-center shadow-sm ${a && a.na_fila > 0 ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white'}`}>
        <span className="text-5xl font-bold tabular-nums text-slate-900">{a?.na_fila ?? '—'}</span>
        <span className="mt-1 text-sm font-semibold text-slate-700">pedidos na fila</span>
        <span className="text-[11px] text-slate-500">aguardando produção · gerando · ajuste</span>
      </a>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">🔔 Avisos para você</h2>
          <button onClick={async () => { setTeste(null); const r = await enviarTesteAvisos(); setTeste({ ok: r.success, t: [r.success ? 'Enviado.' : r.error, (r as { detalhe?: string }).detalhe].filter(Boolean).join(' · ') }); setN(x => x + 1) }}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Enviar aviso de teste</button>
        </div>
        {teste && <p className={`mt-1 text-xs ${teste.ok ? 'text-emerald-700' : 'text-red-600'}`}>{teste.t}</p>}
        {a?.error && <p className="mt-2 text-xs text-red-600">{a.error}</p>}
        <ul className="mt-2 max-h-56 divide-y divide-slate-100 overflow-y-auto text-xs">
          {(a?.avisos ?? []).length === 0 && <li className="py-2 text-slate-500">Nenhum aviso registrado ainda.</li>}
          {(a?.avisos ?? []).map(v => (
            <li key={v.id} className="flex gap-2 py-1.5">
              <span className="w-24 shrink-0 text-slate-500">{hora(v.criado_em)}</span>
              <span className="w-16 shrink-0 font-medium text-slate-700">{v.canal === 'whatsapp' ? 'WhatsApp' : v.canal === 'modelo' ? 'Modelo' : 'Push'}</span>
              <span className={`w-16 shrink-0 font-semibold ${cor(v.status)}`}>{v.status}</span>
              <span className="min-w-0 flex-1 truncate text-slate-700" title={v.texto ?? ''}>{(v.texto ?? '').split('\n')[0]}{v.erro ? <span className="text-red-600"> — {v.erro}</span> : null}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
