'use client'
// ============================================================================
// Estúdio IA — de onde vem a venda (por anúncio) + estado da Meta (CAPI)
//   OrigemDasVendas  → Painel: anúncio · conversas · pedidos · vendas ·
//                      faturamento (por moeda) · conversa→venda; Orgânico
//   CartaoMetaCapi   → Configurações: dataset do WhatsApp, último erro,
//                      código do "Testar eventos"
// ============================================================================
import { useEffect, useState } from 'react'
import { origemDasVendas, estadoMetaCapi, obterDatasetMeta, salvarCodigoTesteMeta } from '@/lib/estudio/client'

type Linha = Awaited<ReturnType<typeof origemDasVendas>>['linhas'][number]
type Estado = Awaited<ReturnType<typeof estadoMetaCapi>>

const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
const diasAtras = (n: number) => new Date(Date.now() - 3 * 3600e3 - n * 86400e3).toISOString().slice(0, 10)
const dinheiro = (c: number, m: string) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: m })

export function OrigemDasVendas() {
  const [de, setDe] = useState(() => diasAtras(29))
  const [ate, setAte] = useState(hoje)
  const [linhas, setLinhas] = useState<Linha[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    origemDasVendas(de, ate).then(r => { if (!vivo) return; setLinhas(r.linhas); setErro(r.error ?? null) }).catch(e => setErro(String(e)))
    return () => { vivo = false }
  }, [de, ate])
  const atalho = (n: number) => { setDe(diasAtras(n - 1)); setAte(hoje()) }
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">📣 De onde vem a venda</h2>
          <p className="text-xs text-slate-500">Conversa conta para o anúncio que a trouxe; pedido e venda, para o último clique. Faturamento separado por moeda.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {[[1, 'Hoje'], [7, '7 dias'], [30, '30 dias']].map(([n, t]) => <button key={t} onClick={() => atalho(Number(n))} className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">{t}</button>)}
          <input type="date" value={de} onChange={e => setDe(e.target.value)} className="rounded border border-slate-200 p-1" />
          <span>até</span>
          <input type="date" value={ate} onChange={e => setAte(e.target.value)} className="rounded border border-slate-200 p-1" />
        </div>
      </div>
      {erro && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{erro}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-2">Anúncio</th><th className="text-right">Conversas</th><th className="text-right">Pedidos</th><th className="text-right">Vendas</th><th className="text-right">Faturamento</th><th className="text-right">Conversa → venda</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {!linhas ? <tr><td colSpan={6} className="py-4 text-center text-slate-500">Carregando…</td></tr>
              : linhas.length === 0 ? <tr><td colSpan={6} className="py-4 text-center text-slate-500">Nenhuma conversa no período.</td></tr>
              : linhas.map(l => (
                <tr key={l.ad_id ?? 'organico'} className={l.ad_id ? '' : 'bg-slate-50'}>
                  <td className="py-2">
                    {l.ad_id ? <>
                      <p className="font-medium text-slate-900">{l.nome ?? l.headline ?? `Anúncio ${l.ad_id}`}</p>
                      <p className="text-[11px] text-slate-500">{l.campanha ? `${l.campanha} · ` : ''}ID {l.ad_id}</p>
                    </> : <p className="font-medium text-slate-700">🌱 Orgânico</p>}
                  </td>
                  <td className="text-right tabular-nums">{l.conversas}</td>
                  <td className="text-right tabular-nums">{l.pedidos}</td>
                  <td className="text-right font-semibold tabular-nums">{l.vendas}</td>
                  <td className="text-right tabular-nums">{Object.keys(l.faturamento).length ? Object.entries(l.faturamento).map(([m, c]) => <span key={m} className="block">{dinheiro(c, m)}</span>) : '—'}</td>
                  <td className="text-right tabular-nums">{l.taxa === null ? '—' : `${(l.taxa * 100).toFixed(1).replace('.', ',')}%`}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function CartaoMetaCapi() {
  const [e, setE] = useState<Estado | null>(null)
  const [codigo, setCodigo] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const carregar = () => estadoMetaCapi().then(r => { setE(r); setCodigo(r.codigo_teste ?? ''); if (r.error) setMsg({ ok: false, t: r.error }) })
  useEffect(() => { void carregar() }, [])
  if (!e) return null
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">📈 Meta — vendas do WhatsApp para os anúncios</h2>
      <p className="text-xs text-slate-500">Quem veio de anúncio &quot;clique para o WhatsApp&quot; gera <strong>LeadSubmitted</strong> quando o pedido é registrado e <strong>Purchase</strong> quando o pagamento confirma (Pix ou Hotmart). Orgânico não envia. Cada pedido manda cada evento uma vez só.</p>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        <div><dt className="text-[11px] uppercase tracking-wider text-slate-500">WABA</dt><dd className="font-mono text-slate-800">{e.waba_id ?? '—'}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wider text-slate-500">Dataset do WhatsApp</dt><dd className="font-mono text-slate-800">{e.dataset_id ?? <span className="text-amber-700">ainda não obtido</span>}</dd></div>
        <div><dt className="text-[11px] uppercase tracking-wider text-slate-500">Eventos com erro</dt><dd className={e.pendentes ? 'font-semibold text-red-600' : 'text-slate-800'}>{e.pendentes}</dd></div>
      </dl>
      {e.erro && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">⚠️ {e.erro}</p>}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {!e.dataset_id && <button onClick={async () => { const r = await obterDatasetMeta(); setMsg(r.success ? { ok: true, t: `Dataset ${r.dataset_id}` } : { ok: false, t: r.error ?? 'falhou' }); void carregar() }} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Obter dataset</button>}
        <label className="text-sm"><span className="text-xs font-medium text-slate-600">Código de teste (Gerenciador de Eventos → Testar eventos)</span>
          <div className="mt-1 flex gap-2">
            <input value={codigo} onChange={ev => setCodigo(ev.target.value)} placeholder="TEST12345 (vazio = produção)" className="w-56 rounded-lg border border-slate-200 p-2 text-sm" />
            <button onClick={async () => { const r = await salvarCodigoTesteMeta(codigo); setMsg(r.success ? { ok: true, t: codigo ? 'Modo teste ligado — os eventos aparecem em "Testar eventos".' : 'Modo teste desligado.' } : { ok: false, t: r.error ?? 'falhou' }) }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">Salvar</button>
          </div>
        </label>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.t}</p>}
    </section>
  )
}
