'use client'
// ============================================================================
// Estúdio IA — estado da Meta (CAPI); "de onde vem a venda" está no painel-ui
//   CartaoMetaCapi   → Configurações: dataset do WhatsApp, último erro,
//                      código do "Testar eventos"
// ============================================================================
import { useEffect, useState } from 'react'
import { estadoMetaCapi, obterDatasetMeta, salvarCodigoTesteMeta } from '@/lib/estudio/client'

type Estado = Awaited<ReturnType<typeof estadoMetaCapi>>

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
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
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
