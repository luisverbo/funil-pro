'use client'
// ============================================================================
// Estúdio IA — Fase 7: telas da Hotmart (pagamento internacional)
//   CartaoHotmart   → hottok (só de escrita), produto, URL do webhook
//   CartaoPrecos    → estudio_precos (BR em BRL/Pix · INT em USD/Hotmart)
//   Faturamento     → por moeda (nunca soma moedas) + total estimado em R$
// ============================================================================
import { useEffect, useState } from 'react'
import { lerHotmartConfig, salvarHotmartConfig, listarPrecosEstudio, salvarPrecoEstudio, excluirPrecoEstudio, resumoFaturamento } from '@/lib/estudio/client'

type Preco = Awaited<ReturnType<typeof listarPrecosEstudio>>['precos'][number]
type Fat = Awaited<ReturnType<typeof resumoFaturamento>>['periodos'][number]

const dinheiro = (c: number, m: string) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: m })

export function CartaoHotmart() {
  const [c, setC] = useState<Awaited<ReturnType<typeof lerHotmartConfig>> | null>(null)
  const [hottok, setHottok] = useState('')
  const [produto, setProduto] = useState('8794754')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const carregar = () => lerHotmartConfig().then(r => { setC(r); setProduto(r.produto_id); if (r.error) setMsg({ ok: false, t: r.error }) })
  useEffect(() => { void carregar() }, [])
  if (!c) return null
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">🌎 Hotmart (clientes fora do Brasil)</h2>
      <p className="text-xs text-slate-500">Quem não é do Brasil recebe o link da oferta do pacote (USD) com o pedido no <code>sck</code>. O webhook confirma sozinho e o pedido entra na fila igual ao Pix.</p>
      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
        <p className="font-semibold text-slate-700">URL do webhook (cole na Hotmart):</p>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-slate-800 ring-1 ring-slate-200">{c.url_webhook}</code>
          <button onClick={() => { void navigator.clipboard?.writeText(c.url_webhook); setMsg({ ok: true, t: 'URL copiada.' }) }} className="rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700">copiar</button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm"><span className="text-xs font-medium text-slate-600">Hottok (Hotmart → Ferramentas → Webhook)</span>
          <input type="password" autoComplete="off" value={hottok} onChange={e => setHottok(e.target.value)} placeholder={c.tem_hottok ? '•••••••• (já salvo — cole outro para trocar)' : 'cole o hottok'} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" /></label>
        <label className="text-sm"><span className="text-xs font-medium text-slate-600">ID do produto na Hotmart</span>
          <input value={produto} onChange={e => setProduto(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" /></label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={async () => { const r = await salvarHotmartConfig(hottok || null, produto); if (r.success) { setHottok(''); setMsg({ ok: true, t: 'Salvo.' }); void carregar() } else setMsg({ ok: false, t: r.error ?? 'falhou' }) }}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Salvar Hotmart</button>
        <span className={`text-xs ${c.tem_hottok ? 'text-emerald-700' : 'text-amber-700'}`}>{c.tem_hottok ? '✅ hottok configurado' : '⚠️ sem hottok: o webhook recusa tudo (401)'}</span>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.t}</span>}
      </div>
    </section>
  )
}

export function CartaoPrecos() {
  const [lista, setLista] = useState<Preco[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [novo, setNovo] = useState({ pais: 'INT', moeda: 'USD', pacote_qtd: '', valor: '', link: '' })
  const carregar = () => listarPrecosEstudio().then(r => { setLista(r.precos); setErro(r.error ?? null) })
  useEffect(() => { void carregar() }, [])
  if (!lista) return null
  const salvar = async (l: { id?: string; pais: string; moeda: string; pacote_qtd: number; valor_cents: number; link_pagamento: string | null }) => {
    const r = await salvarPrecoEstudio(l); if (!r.success) setErro(r.error ?? 'falhou'); else { setErro(null); void carregar() }
  }
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">💲 Preços</h2>
      <p className="text-xs text-slate-500"><strong>BR</strong> = Brasil (BRL, Pix). <strong>INT</strong> = qualquer país fora do Brasil (USD, Hotmart). Um país com linhas próprias (ex.: PT) vence a INT. A Ana nunca usa valor fixo: sempre esta tabela.</p>
      {erro && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{erro}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="py-2">País</th><th>Moeda</th><th>Fotos</th><th>Valor</th><th>Link de pagamento (Hotmart)</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lista.map(p => <LinhaPrecoEditavel key={p.id} p={p} salvar={salvar} excluir={async () => { const r = await excluirPrecoEstudio(p.id); if (!r.success) setErro(r.error ?? 'falhou'); else void carregar() }} />)}
            <tr>
              <td className="py-2"><input value={novo.pais} onChange={e => setNovo({ ...novo, pais: e.target.value })} className="w-16 rounded border border-slate-200 p-1 text-xs" /></td>
              <td><input value={novo.moeda} onChange={e => setNovo({ ...novo, moeda: e.target.value })} className="w-16 rounded border border-slate-200 p-1 text-xs" /></td>
              <td><input value={novo.pacote_qtd} onChange={e => setNovo({ ...novo, pacote_qtd: e.target.value })} placeholder="5" className="w-14 rounded border border-slate-200 p-1 text-xs" /></td>
              <td><input value={novo.valor} onChange={e => setNovo({ ...novo, valor: e.target.value })} placeholder="11,90" className="w-20 rounded border border-slate-200 p-1 text-xs" /></td>
              <td><input value={novo.link} onChange={e => setNovo({ ...novo, link: e.target.value })} placeholder="https://pay.hotmart.com/…?off=…" className="w-full rounded border border-slate-200 p-1 text-xs" /></td>
              <td><button onClick={() => void salvar({ pais: novo.pais, moeda: novo.moeda, pacote_qtd: Number(novo.pacote_qtd), valor_cents: Math.round(Number(novo.valor.replace(',', '.')) * 100), link_pagamento: novo.link || null })} className="rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-white">Adicionar</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function LinhaPrecoEditavel({ p, salvar, excluir }: { p: Preco; salvar: (l: { id?: string; pais: string; moeda: string; pacote_qtd: number; valor_cents: number; link_pagamento: string | null }) => Promise<void>; excluir: () => Promise<void> }) {
  const [valor, setValor] = useState((p.valor_cents / 100).toFixed(2).replace('.', ','))
  const [link, setLink] = useState(p.link_pagamento ?? '')
  const sujo = valor !== (p.valor_cents / 100).toFixed(2).replace('.', ',') || link !== (p.link_pagamento ?? '')
  return (
    <tr>
      <td className="py-2 font-medium text-slate-800">{p.pais}</td>
      <td className="text-slate-600">{p.moeda}</td>
      <td className="text-slate-600">{p.pacote_qtd}</td>
      <td><input value={valor} onChange={e => setValor(e.target.value)} className="w-20 rounded border border-slate-200 p-1 text-xs" /></td>
      <td><input value={link} onChange={e => setLink(e.target.value)} placeholder={p.pais === 'BR' ? '(Pix — sem link)' : ''} className="w-full rounded border border-slate-200 p-1 text-xs" /></td>
      <td className="whitespace-nowrap text-right">
        {sujo && <button onClick={() => void salvar({ id: p.id, pais: p.pais, moeda: p.moeda, pacote_qtd: p.pacote_qtd, valor_cents: Math.round(Number(valor.replace(',', '.')) * 100), link_pagamento: link || null })} className="mr-2 rounded bg-violet-600 px-2 py-0.5 text-[11px] font-semibold text-white">Salvar</button>}
        <button onClick={() => { if (confirm(`Excluir ${p.pais} · ${p.pacote_qtd} fotos?`)) void excluir() }} className="text-[11px] text-slate-400 hover:text-red-600">excluir</button>
      </td>
    </tr>
  )
}

/** Faturamento por moeda: BRL e USD separados + total estimado em R$ (cotações). */
export function Faturamento() {
  const [p, setP] = useState<Fat[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    resumoFaturamento().then(r => { if (!vivo) return; setP(r.periodos); setErro(r.error ?? null) }).catch(e => setErro(String(e)))
    return () => { vivo = false }
  }, [])
  if (!p && !erro) return null
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">💰 Faturamento</h2>
      {erro && <p className="mt-2 text-xs text-red-600">{erro}</p>}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(p ?? []).map(x => (
          <div key={x.periodo} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{x.periodo}</p>
            {x.por_moeda.length === 0 ? <p className="mt-1 text-sm text-slate-400">sem vendas</p> : x.por_moeda.map(m => (
              <p key={m.moeda} className="mt-1 text-sm"><strong className="text-slate-900">{dinheiro(m.total_cents, m.moeda)}</strong> <span className="text-xs text-slate-500">· {m.vendas} venda{m.vendas === 1 ? '' : 's'}</span></p>
            ))}
            {x.por_moeda.some(m => m.moeda !== 'BRL') && <p className="mt-1 text-[11px] text-slate-500">≈ {dinheiro(x.total_brl_cents, 'BRL')} no total (estimado: US$ 1 = R$ {String(x.cotacoes.USD ?? '').replace('.', ',')})</p>}
          </div>
        ))}
      </div>
    </section>
  )
}
