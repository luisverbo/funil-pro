'use client'
// ============================================================================
// Estúdio IA — Painel de resultado: faturamento, lucro, custos (anúncio + IA),
// conversão, de onde vem a venda (anúncio e país), comparado ao período
// anterior de mesmo tamanho. Tudo em R$ (USD pela cotação das Configurações).
// ============================================================================
import { useEffect, useState } from 'react'
import { painelEstudio } from '@/lib/estudio/client'
import { bandeira } from '@/lib/estudio/chat'

type Dados = Awaited<ReturnType<typeof painelEstudio>>
type Kpis = NonNullable<Dados['atual']>

const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10)
const diasAtras = (n: number) => new Date(Date.now() - 3 * 3600e3 - n * 86400e3).toISOString().slice(0, 10)
const brl = (c: number | null) => c === null ? '—' : (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pct = (v: number | null, casas = 1) => v === null ? '—' : `${(v * 100).toFixed(casas).replace('.', ',')}%`
const NOMES_PAIS: Record<string, string> = { BR: 'Brasil', PT: 'Portugal', US: 'Estados Unidos', AR: 'Argentina', CO: 'Colômbia', MX: 'México', ES: 'Espanha', CL: 'Chile', PE: 'Peru', UY: 'Uruguai', PY: 'Paraguai', IT: 'Itália', FR: 'França', DE: 'Alemanha', GB: 'Reino Unido' }

function variacao(a: number | null, b: number | null) {
  if (a === null || b === null || b === 0) return null
  return (a - b) / Math.abs(b)
}

interface Cartao { titulo: string; icone: string; cor: string; valor: string; delta: number | null; pontos?: boolean; menorMelhor?: boolean; rodape: string }

function Card(c: Cartao) {
  const bom = c.delta === null ? null : c.menorMelhor ? c.delta < 0 : c.delta > 0
  return (
    <div className={`rounded-2xl border bg-slate-900 p-4 ${c.cor}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">{c.titulo}</p>
        <span className="text-lg" aria-hidden>{c.icone}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-white">{c.valor}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        {c.delta !== null && c.delta !== 0 && (
          <span className={`rounded-full px-2 py-0.5 font-semibold ${bom ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
            {c.delta > 0 ? '↗ +' : '↘ '}{c.pontos ? `${(c.delta * 100).toFixed(1).replace('.', ',')} pontos` : pct(c.delta)}
          </span>
        )}
        <span>{c.rodape}</span>
      </div>
    </div>
  )
}

function cartoes(a: Kpis, b: Kpis | null): Cartao[] {
  const d = (f: (k: Kpis) => number | null) => b ? variacao(f(a), f(b)) : null
  return [
    { titulo: 'Faturamento', icone: '💲', cor: 'border-emerald-500/40', valor: brl(a.faturamento_cents), delta: d(k => k.faturamento_cents), rodape: `${a.vendas} vendas` },
    { titulo: 'Lucro', icone: '📈', cor: a.lucro_cents >= 0 ? 'border-emerald-500/40' : 'border-red-500/50', valor: brl(a.lucro_cents), delta: d(k => k.lucro_cents), rodape: `margem ${pct(a.margem)} · faturamento − anúncio − IA` },
    { titulo: 'Vendas', icone: '✅', cor: 'border-blue-500/40', valor: String(a.vendas), delta: d(k => k.vendas), rodape: `${a.clientes} clientes compraram` },
    { titulo: 'Ticket médio', icone: '👛', cor: 'border-violet-500/40', valor: brl(a.ticket_cents), delta: d(k => k.ticket_cents), rodape: 'por venda' },
    { titulo: 'Gasto em anúncio', icone: '📣', cor: 'border-sky-500/40', valor: brl(a.gasto_anuncio_cents), delta: d(k => k.gasto_anuncio_cents), menorMelhor: true, rodape: a.roas === null ? 'sem gasto sincronizado' : `ROAS ${a.roas.toFixed(2).replace('.', ',')}×` },
    { titulo: 'Custo por venda', icone: '🎯', cor: 'border-amber-500/40', valor: brl(a.custo_por_venda_cents), delta: d(k => k.custo_por_venda_cents), menorMelhor: true, rodape: 'anúncio + IA ÷ vendas' },
    { titulo: 'Custo de IA', icone: '🤖', cor: 'border-rose-500/40', valor: brl(a.custo_ia_cents), delta: d(k => k.custo_ia_cents), menorMelhor: true, rodape: `fotos ${brl(a.custo_fotos_cents)} · conversa ${brl(a.custo_atendimento_cents)}` },
    { titulo: 'Leads novos', icone: '👤', cor: 'border-yellow-500/40', valor: String(a.leads), delta: d(k => k.leads), rodape: 'conversas que começaram' },
    { titulo: 'Conversão', icone: '🔻', cor: 'border-orange-500/40', valor: pct(a.conversao, 0), delta: b && a.conversao !== null && b.conversao !== null ? a.conversao - b.conversao : null, pontos: true, rodape: 'dos leads novos compraram' },
    { titulo: 'Vindos de anúncio', icone: '📢', cor: 'border-blue-500/40', valor: String(a.leads_anuncio), delta: d(k => k.leads_anuncio), rodape: `${a.vendas_anuncio} vendas de anúncio` },
    { titulo: 'Custo por lead', icone: '🧲', cor: 'border-cyan-500/40', valor: brl(a.custo_por_lead_cents), delta: d(k => k.custo_por_lead_cents), menorMelhor: true, rodape: 'gasto ÷ leads de anúncio' },
    { titulo: 'Custo por venda (anúncio)', icone: '🛒', cor: 'border-fuchsia-500/40', valor: brl(a.cac_anuncio_cents), delta: d(k => k.cac_anuncio_cents), menorMelhor: true, rodape: 'gasto ÷ vendas de anúncio' },
  ]
}

export function PainelResultado() {
  const [de, setDe] = useState(() => diasAtras(29))
  const [ate, setAte] = useState(hoje)
  const [res, setRes] = useState<{ chave: string; dados: Dados } | null>(null)
  const chave = `${de}|${ate}`
  const r = res?.chave === chave ? res.dados : null
  useEffect(() => {
    let vivo = true
    painelEstudio(de, ate).then(dados => { if (vivo) setRes({ chave: `${de}|${ate}`, dados }) })
      .catch(e => vivo && setRes({ chave: `${de}|${ate}`, dados: { atual: null, anterior: null, paises: [], anuncios: [], cotacao_usd: 0, gasto_sincronizado: false, avisos: [], error: String(e) } }))
    return () => { vivo = false }
  }, [de, ate])
  const atalho = (n: number) => { setDe(diasAtras(n - 1)); setAte(hoje()) }
  const ehOntem = de === diasAtras(1) && ate === diasAtras(1)

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">📊 Resultado do estúdio</h2>
          <p className="text-xs text-slate-400">Em R$ (US$ × {r?.cotacao_usd ? r.cotacao_usd.toFixed(2).replace('.', ',') : '—'}). Setas comparam com o período anterior de mesmo tamanho.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {[[1, 'Hoje'], [7, '7 dias'], [30, '30 dias'], [90, '90 dias']].map(([n, t]) => (
            <button key={t} onClick={() => atalho(Number(n))} className="rounded-full bg-slate-800 px-2.5 py-1 font-medium text-slate-200 hover:bg-slate-700">{t}</button>
          ))}
          <button onClick={() => { setDe(diasAtras(1)); setAte(diasAtras(1)) }} className={`rounded-full px-2.5 py-1 font-medium ${ehOntem ? 'bg-white text-slate-900' : 'bg-slate-800 text-slate-200'}`}>Ontem</button>
          <input type="date" value={de} max={ate} onChange={e => setDe(e.target.value)} className="rounded border border-slate-700 bg-slate-900 p-1 text-slate-200" />
          <span className="text-slate-400">até</span>
          <input type="date" value={ate} min={de} onChange={e => setAte(e.target.value)} className="rounded border border-slate-700 bg-slate-900 p-1 text-slate-200" />
        </div>
      </div>

      {r?.error && <p className="mt-3 rounded bg-red-500/15 p-2 text-xs text-red-300">{r.error}</p>}
      {r?.avisos.includes('anuncios') && <p className="mt-3 rounded bg-amber-500/15 p-2 text-xs text-amber-200">Falta rodar o SQL 20261101000000_estudio_ia_anuncios.sql — sem ele não dá para separar anúncio de orgânico.</p>}
      {r && !r.gasto_sincronizado && <p className="mt-3 rounded bg-amber-500/15 p-2 text-xs text-amber-200">Há conversas de anúncio, mas nenhum gasto da Meta sincronizado para esses anúncios. Conecte a conta de anúncio na aba <strong>Tráfego</strong> (ela sincroniza de hora em hora) — até lá lucro e custo por venda contam só a IA.</p>}

      {!r ? <p className="mt-6 text-center text-sm text-slate-400">Carregando…</p> : r.atual && <>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cartoes(r.atual, r.anterior).map(c => <Card key={c.titulo} {...c} />)}
        </div>

        <h3 className="mt-6 text-sm font-semibold text-white">📣 De onde vem a venda — por anúncio</h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[760px] text-sm text-slate-200">
            <thead><tr className="bg-slate-900 text-left text-[11px] uppercase tracking-wider text-slate-400"><th className="p-2">Anúncio</th><th className="p-2 text-right">Leads</th><th className="p-2 text-right">Vendas</th><th className="p-2 text-right">Faturamento</th><th className="p-2 text-right">Gasto</th><th className="p-2 text-right">Custo/venda</th><th className="p-2 text-right">ROAS</th><th className="p-2 text-right">Lucro*</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {r.anuncios.length === 0 ? <tr><td colSpan={8} className="p-4 text-center text-slate-400">Nenhuma conversa no período.</td></tr> : r.anuncios.map(l => (
                <tr key={l.ad_id ?? 'org'}>
                  <td className="p-2">{l.ad_id ? <><p className="font-medium text-white">{l.nome ?? `Anúncio ${l.ad_id}`}</p><p className="text-[11px] text-slate-400">{l.campanha ? `${l.campanha} · ` : ''}ID {l.ad_id}</p></> : <p className="font-medium">🌱 Orgânico</p>}</td>
                  <td className="p-2 text-right tabular-nums">{l.leads}</td>
                  <td className="p-2 text-right font-semibold tabular-nums">{l.vendas}</td>
                  <td className="p-2 text-right tabular-nums">{brl(l.faturamento_cents)}</td>
                  <td className="p-2 text-right tabular-nums">{l.ad_id ? brl(l.gasto_cents) : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{l.ad_id ? brl(l.custo_por_venda_cents) : '—'}</td>
                  <td className="p-2 text-right tabular-nums">{l.roas === null ? '—' : `${l.roas.toFixed(2).replace('.', ',')}×`}</td>
                  <td className={`p-2 text-right font-semibold tabular-nums ${l.lucro_cents < 0 ? 'text-red-400' : 'text-emerald-400'}`}>{brl(l.lucro_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">* Lucro do anúncio = faturamento − gasto (o custo de IA está no total acima). Lead conta para o anúncio que o trouxe; venda, para o último clique.</p>

        <h3 className="mt-6 text-sm font-semibold text-white">🌎 Por país</h3>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[560px] text-sm text-slate-200">
            <thead><tr className="bg-slate-900 text-left text-[11px] uppercase tracking-wider text-slate-400"><th className="p-2">País</th><th className="p-2 text-right">Leads</th><th className="p-2 text-right">Vendas</th><th className="p-2 text-right">Conversão</th><th className="p-2 text-right">Ticket</th><th className="p-2 text-right">Faturamento</th><th className="p-2">Participação</th></tr></thead>
            <tbody className="divide-y divide-slate-800">
              {r.paises.length === 0 ? <tr><td colSpan={7} className="p-4 text-center text-slate-400">Nenhuma conversa no período.</td></tr> : r.paises.map(p => (
                <tr key={p.pais ?? '??'}>
                  <td className="p-2">{bandeira(p.pais)} {p.pais ? NOMES_PAIS[p.pais] ?? p.pais : 'Não identificado'}</td>
                  <td className="p-2 text-right tabular-nums">{p.leads}</td>
                  <td className="p-2 text-right font-semibold tabular-nums">{p.vendas}</td>
                  <td className="p-2 text-right tabular-nums">{pct(p.conversao)}</td>
                  <td className="p-2 text-right tabular-nums">{brl(p.ticket_cents)}</td>
                  <td className="p-2 text-right tabular-nums">{brl(p.faturamento_cents)}</td>
                  <td className="p-2"><div className="h-2 w-28 rounded-full bg-slate-800"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${r.atual!.faturamento_cents ? Math.round(100 * p.faturamento_cents / r.atual!.faturamento_cents) : 0}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
    </section>
  )
}
