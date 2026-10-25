'use client'
// ============================================================================
// Estúdio IA — Fase 5: subaba Pedidos (fila de produção) + cartão do Motor
// ----------------------------------------------------------------------------
// Entrega é AUTOMÁTICA: pedido 'pronto' sai sozinho para a cliente (robô a
// cada minuto). Aqui o Luís acompanha, gera por API, refaz e reenvia.
// ============================================================================
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  listarPedidosEstudio, abrirPedidoEstudio, gerarPorApiAgora, aprovarEntregaEstudio, refazerPedidoEstudio,
  reenviarEntregaEstudio, cancelarPedidoEstudio, lerProducaoConfig, salvarProducaoConfig, fotosRecebidasDoPedido, usarFotoComoEstudio,
} from '@/lib/estudio/client'

type Lista = Awaited<ReturnType<typeof listarPedidosEstudio>>['pedidos']
type Detalhe = Awaited<ReturnType<typeof abrirPedidoEstudio>>
type Cfg = Awaited<ReturnType<typeof lerProducaoConfig>>

const STATUS: Record<string, [string, string]> = {
  novo: ['Novo', 'bg-slate-100 text-slate-700'], aguardando_pagamento: ['Aguardando Pix', 'bg-slate-100 text-slate-700'],
  aguardando_conferencia: ['Conferir Pix', 'bg-amber-100 text-amber-800'], pago: ['Pago', 'bg-emerald-100 text-emerald-800'],
  aguardando_fotos: ['Falta foto/pose', 'bg-amber-100 text-amber-800'], aguardando_producao: ['Na fila', 'bg-sky-100 text-sky-800'],
  gerando: ['Gerando', 'bg-violet-100 text-violet-800'], pronto: ['Pronto (enviando)', 'bg-emerald-100 text-emerald-800'],
  aguardando_aprovacao: ['Aprovação', 'bg-amber-100 text-amber-800'], entregue: ['Entregue', 'bg-emerald-600 text-white'],
  ajuste: ['Ajuste', 'bg-rose-100 text-rose-800'], finalizado: ['Finalizado', 'bg-slate-200 text-slate-700'], cancelado: ['Cancelado', 'bg-slate-100 text-slate-400'],
}
const FILTROS = [['fila', 'Em produção'], ['entregue', 'Entregues'], ['ajuste', 'Ajustes'], ['aguardando_pagamento', 'Aguardando Pix'], ['todos', 'Todos']] as const
const hora = (iso: unknown) => iso ? new Date(String(iso)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const reais = (c: unknown, moeda: unknown = 'BRL') => typeof c === 'number' ? (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: String(moeda || 'BRL') }) : '—'
const minutos = (de: string | null) => de ? Math.round((Date.now() - new Date(de).getTime()) / 60000) : null

function Selo({ s }: { s: string }) {
  const [t, cor] = STATUS[s] ?? [s, 'bg-slate-100 text-slate-700']
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cor}`}>{t}</span>
}

export function AbaPedidos() {
  const sp = useSearchParams()
  const [filtro, setFiltro] = useState<string>('fila')
  const [lista, setLista] = useState<Lista | null>(null)
  const [aberto, setAberto] = useState<string | null>(() => sp.get('p'))
  const [erro, setErro] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)

  useEffect(() => {
    let vivo = true
    const carregar = () => listarPedidosEstudio(filtro).then(r => { if (!vivo) return; setLista(r.pedidos); setErro(r.error ?? null) }).catch(e => setErro(String(e)))
    carregar()
    const t = setInterval(carregar, 15000)   // a fila anda sozinha (PC / API / entrega)
    return () => { vivo = false; clearInterval(t) }
  }, [filtro, versao])

  return (
    <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {FILTROS.map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${filtro === k ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-600 ring-1 ring-slate-200'}`}>{l}</button>
          ))}
        </div>
        {erro && <p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{erro}</p>}
        {!lista ? <p className="mt-3 text-sm text-slate-500">Carregando…</p> : lista.length === 0 ? <p className="mt-3 text-sm text-slate-500">Nenhum pedido aqui.</p> : (
          <ul className="mt-3 divide-y divide-slate-100">
            {lista.map(p => {
              const fila = ['aguardando_producao', 'gerando'].includes(p.status) ? minutos(p.fila_em ?? p.pago_em) : null
              return (
                <li key={p.id}>
                  <button onClick={() => setAberto(p.id)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-slate-50 ${aberto === p.id ? 'bg-slate-50' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{p.cliente_nome ?? `+${p.wa_id}`} {p.tipo === 'previa' && <span className="text-xs text-violet-600">· prévia</span>}</p>
                      <p className="truncate text-xs text-slate-500">{p.tema_slug ?? '—'} · {p.tipo === 'previa' ? '1 foto' : `${p.pacote_qtd} fotos`} · {p.motor === 'api_gemini' ? '🤖 API' : '💻 site'} · {hora(p.pago_em ?? p.criado_em)}</p>
                      {(p.entrega_erro || p.api_erro) && <p className="truncate text-[11px] text-red-600">{p.entrega_erro ?? p.api_erro}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Selo s={p.status} />
                      {fila !== null && <span className={`text-[11px] ${p.atraso_avisado_em ? 'font-semibold text-red-600' : 'text-slate-500'}`}>{fila} min</span>}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      {aberto ? <DetalhePedido id={aberto} onMudou={() => setVersao(v => v + 1)} /> : (
        <section className="hidden rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 lg:block">Escolha um pedido para ver as fotos, a produção e a entrega.</section>
      )}
    </div>
  )
}

function DetalhePedido({ id, onMudou }: { id: string; onMudou: () => void }) {
  const [d, setD] = useState<Detalhe | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [versao, setVersao] = useState(0)
  useEffect(() => {
    let vivo = true
    abrirPedidoEstudio(id).then(r => { if (vivo) setD(r) }).catch(e => setMsg({ ok: false, t: String(e) }))
    return () => { vivo = false }
  }, [id, versao])

  const agir = async (f: () => Promise<{ success: boolean; error?: string; enviadas?: number }>, ok: string) => {
    setOcupado(true); setMsg(null)
    const r = await f(); setOcupado(false)
    setMsg(r.success ? { ok: true, t: r.enviadas !== undefined ? `${ok} (${r.enviadas} foto(s))` : ok } : { ok: false, t: r.error ?? 'falhou' })
    setVersao(v => v + 1); onMudou()
  }
  if (!d) return <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">Carregando…</section>
  if (d.error) return <section className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{d.error}</section>
  const p = d.pedido as Record<string, unknown>
  const status = String(p.status)
  const poses = (p.poses as string[]) ?? []
  const notas = d.entregas.map(e => e.nota_rosto).filter((n): n is number => n !== null)

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{String(p.cliente_nome ?? `+${p.wa_id}`)} <Selo s={status} /></h2>
          <p className="text-xs text-slate-500">🆔 <span className="font-mono">{id}</span></p>
          <p className="mt-1 text-sm text-slate-700">{String(p.tema_slug ?? '—')} · {p.tipo === 'previa' ? 'prévia (1 pose)' : `${p.pacote_qtd} fotos`} · poses {poses.join(', ') || '—'}</p>
          <p className="text-xs text-slate-500">Idade {String(p.idade ?? '—')} · cabelo {String(p.cabelo ?? '—')} · {String(p.preferencias ?? 'sem preferências')}</p>
          {d.anuncio ? <p className="text-xs font-medium text-violet-800">📣 Veio do anúncio {d.anuncio.nome ?? d.anuncio.headline ?? d.anuncio.ad_id}{d.anuncio.campanha ? ` (campanha ${d.anuncio.campanha}${d.anuncio.conjunto ? ` › conjunto ${d.anuncio.conjunto}` : ''})` : ''}{p.meta_purchase_enviado_em ? ' · ✅ Purchase na Meta' : p.meta_erro ? ` · ⚠️ Meta: ${String(p.meta_erro).slice(0, 80)}` : ''}</p> : <p className="text-xs text-slate-400">🌱 Orgânico</p>}
          {p.forma_pagamento === 'hotmart' && p.hotmart_transacao ? <p className="text-xs font-medium text-sky-800">🌎 Pago via Hotmart · transação {String(p.hotmart_transacao)} · {reais(p.valor_pago_cents, p.moeda)}</p> : null}
          <p className="text-xs text-slate-500">Pago {reais(p.valor_pago_cents, p.moeda)} em {hora(p.pago_em)} ({String(p.pago_por ?? '—')}) · motor {p.motor === 'api_gemini' ? '🤖 API (Gemini)' : '💻 ChatGPT site'} · custo IA US$ {Number(p.custo_ia_usd ?? 0).toFixed(3)}</p>
          {Number(p.ajustes_usados ?? 0) > 0 && <p className="mt-1 whitespace-pre-line rounded bg-rose-50 p-2 text-xs text-rose-800">Ajustes ({String(p.ajustes_usados)}): {String(p.observacoes_ajuste ?? '')}</p>}
          {Boolean(p.entrega_erro || p.api_erro) && <p className="mt-1 rounded bg-red-50 p-2 text-xs text-red-700">{String(p.entrega_erro ?? p.api_erro)}</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {([['Rosto', d.fotos.rosto], ['Corpo', d.fotos.corpo], ['Comprovante', d.fotos.comprovante]] as const).map(([t, u]) => (
          <a key={t} href={u ?? undefined} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {u ? <img src={u} alt={t} className="aspect-[4/5] w-full object-cover" /> : <div className="flex aspect-[4/5] items-center justify-center text-xs text-slate-400">sem {t.toLowerCase()}</div>}
            <p className="px-2 py-1 text-[11px] text-slate-600">{t}</p>
          </a>
        ))}
      </div>

      <FotosRecebidas id={id} versao={versao} onMudou={() => { setVersao(v => v + 1); onMudou() }} />

      <div>
        <p className="text-xs font-semibold text-slate-700">Fotos geradas {notas.length > 0 && <span className="font-normal text-slate-500">· nota média do rosto {(notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1)}</span>}</p>
        {d.entregas.length === 0 ? <p className="mt-1 text-xs text-slate-500">Nenhuma ainda.</p> : (
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {d.entregas.map(e => (
              <a key={e.id} href={e.url ?? undefined} target="_blank" rel="noreferrer" className={`relative block overflow-hidden rounded-lg border ${e.status === 'refazer' ? 'border-slate-200 opacity-40' : 'border-slate-200'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {e.url ? <img src={e.url} alt={e.pose_numero} className="aspect-[4/5] w-full object-cover" /> : <div className="aspect-[4/5] bg-slate-100" />}
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{e.pose_numero}{e.enviada_em ? ' ✓' : ''}</span>
                {e.nota_rosto !== null && <span className={`absolute right-1 top-1 rounded px-1 text-[10px] font-bold text-white ${e.nota_rosto >= 7 ? 'bg-emerald-600' : 'bg-red-600'}`}>{e.nota_rosto}</span>}
                <span className="block px-1.5 py-0.5 text-[10px] text-slate-500">{e.motor === 'api_gemini' ? 'API' : 'site'} · {e.status}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {['pago', 'aguardando_fotos', 'aguardando_producao', 'gerando', 'ajuste'].includes(status) && (
          <button disabled={ocupado} onClick={() => agir(() => gerarPorApiAgora(id), 'A API começa em até 1 minuto e entrega sozinha.')} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">🤖 Gerar por API agora</button>
        )}
        {status === 'aguardando_aprovacao' && <button disabled={ocupado} onClick={() => agir(() => aprovarEntregaEstudio(id), 'Aprovado e entregue')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">✅ Aprovar e entregar</button>}
        {status === 'pronto' && <button disabled={ocupado} onClick={() => agir(() => reenviarEntregaEstudio(id), 'Entregue')} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">📤 Reenviar entrega</button>}
        {['entregue', 'pronto', 'aguardando_aprovacao', 'finalizado'].includes(status) && (
          <button disabled={ocupado} onClick={() => {
            const ps = prompt(`Refazer quais poses? (vazio = todas)\n${poses.join(', ')}`, '')
            if (ps === null) return
            const obs = prompt('O que mudar? (vai para a fila)', '')
            if (obs === null) return
            void agir(() => refazerPedidoEstudio(id, (ps.match(/\d{1,3}/g) ?? []).map(n => n.padStart(2, '0')), obs), 'Voltou para a fila')
          }} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">🔁 Refazer</button>
        )}
        {status !== 'cancelado' && <button disabled={ocupado} onClick={() => { const m = prompt('Cancelar/estornar este pedido? Motivo:', ''); if (m !== null) void agir(() => cancelarPedidoEstudio(id, m), 'Cancelado') }} className="rounded-lg px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">Cancelar</button>}
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.t}</p>}

      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">Histórico</summary>
        <ul className="mt-1 space-y-0.5">{d.eventos.map((e, i) => <li key={i}>{hora(e.criado_em)} · {e.tipo}</li>)}</ul>
      </details>
    </section>
  )
}

/** Configurações → Motor de produção (seção 8b). */
export function CartaoMotor() {
  const [c, setC] = useState<Cfg | null>(null)
  const [chave, setChave] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  useEffect(() => {
    let vivo = true
    lerProducaoConfig().then(r => { if (!vivo) return; setC(r); if (r.error) setMsg({ ok: false, t: r.error }) })
    return () => { vivo = false }
  }, [])
  if (!c) return null
  const num = (k: keyof Cfg, rot: string, sufixo: string) => (
    <label className="text-sm"><span className="text-xs font-medium text-slate-600">{rot}</span>
      <div className="mt-1 flex items-center gap-1"><input type="number" value={Number(c[k])} onChange={e => setC({ ...c, [k]: Number(e.target.value) })} className="w-24 rounded-lg border border-slate-200 p-2 text-sm" /><span className="text-xs text-slate-500">{sufixo}</span></div></label>
  )
  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">🏭 Motor de produção</h2>
      <p className="text-xs text-slate-500">A entrega é automática nas duas posições: assim que as fotos ficam prontas, a Ana manda para a cliente.</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {([['chatgpt_site', '💻 ChatGPT site (padrão)', 'Melhor qualidade. Você recebe o aviso e pede ao Claude Code do PC: "gera o pedido <id>".'],
           ['api_gemini', '🤖 API automática', 'Gemini gera sozinho (~US$ 0,14/foto), confere o rosto (nota ≥ 7) e entrega. Sem ninguém.']] as const).map(([k, t, dica]) => (
          <button key={k} onClick={() => setC({ ...c, motor: k })} className={`rounded-xl border p-3 text-left ${c.motor === k ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-slate-200'}`}>
            <p className="text-sm font-semibold text-slate-900">{t}</p><p className="text-xs text-slate-500">{dica}</p>
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {num('prazo_min', 'Prazo prometido', 'min')}
        {num('ajustes_gratis', 'Ajustes grátis', 'por pedido')}
        {num('upsell_qtd', 'Oferta pós-entrega', 'fotos')}
        {num('upsell_desconto_pct', 'Desconto da oferta', '%')}
      </div>
      <label className="mt-4 block text-sm"><span className="text-xs font-medium text-slate-600">Chave do Gemini (GEMINI_API_KEY)</span>
        {c.chave_no_servidor ? <p className="mt-1 text-xs text-emerald-700">✅ Já configurada nos segredos do servidor.</p> : (
          <input type="password" value={chave} onChange={e => setChave(e.target.value)} placeholder={c.tem_chave_gemini ? '•••••••• (já salva — cole outra para trocar)' : 'cole a chave do Google AI Studio'} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" autoComplete="off" />
        )}
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={c.aprovacao_manual} onChange={e => setC({ ...c, aprovacao_manual: e.target.checked })} />
        Aprovação manual (desligada = entrega automática, a decisão de 23/10)
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={async () => {
          const r = await salvarProducaoConfig({ ...c, gemini_api_key: chave || null })
          if (r.success) { setChave(''); setMsg({ ok: true, t: 'Salvo.' }); setC(await lerProducaoConfig()) } else setMsg({ ok: false, t: r.error ?? 'falhou' })
        }} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Salvar motor</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.t}</span>}
      </div>
    </section>
  )
}

/** Todas as fotos que a cliente mandou; trocar qual é rosto/corpo com um clique. */
function FotosRecebidas({ id, versao, onMudou }: { id: string; versao: number; onMudou: () => void }) {
  const [r, setR] = useState<Awaited<ReturnType<typeof fotosRecebidasDoPedido>> | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    fotosRecebidasDoPedido(id).then(x => { if (vivo) setR(x) }).catch(e => setErro(String(e)))
    return () => { vivo = false }
  }, [id, versao])
  if (!r || (r.fotos.length === 0 && !r.error)) return null
  const usar = async (path: string, papel: 'rosto' | 'corpo') => {
    setErro(null)
    const x = await usarFotoComoEstudio(id, path, papel)
    if (!x.success) setErro(x.error ?? 'falhou'); else onMudou()
  }
  const rotulo: Record<string, string> = { rosto: 'rosto', corpo_inteiro: 'corpo inteiro', rosto_e_corpo: 'rosto + corpo', invalida: 'inválida' }
  return (
    <div>
      <p className="text-xs font-semibold text-slate-700">Fotos recebidas da cliente ({r.fotos.length})</p>
      {r.rosto_recortado && <p className="mt-1 rounded bg-amber-50 p-1.5 text-[11px] text-amber-800">✂️ Rosto recortado da foto de corpo — pedir um close do rosto.</p>}
      {(erro || r.error) && <p className="mt-1 text-[11px] text-red-600">{erro ?? r.error}</p>}
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {r.fotos.map(f => (
          <div key={f.path} className={`overflow-hidden rounded-lg border ${f.papel ? 'border-violet-400 ring-1 ring-violet-400' : 'border-slate-200'}`}>
            <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="relative block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {f.url ? <img src={f.url} alt={f.tipo} className="aspect-[4/5] w-full object-cover" /> : <div className="aspect-[4/5] bg-slate-100" />}
              {f.papel && <span className="absolute left-1 top-1 rounded bg-violet-600 px-1 text-[10px] font-bold text-white">{f.papel === 'rosto' ? 'ROSTO' : 'CORPO'}</span>}
            </a>
            <p className="px-1.5 pt-1 text-[10px] text-slate-500" title={f.motivo ?? ''}>{rotulo[f.tipo] ?? f.tipo}{f.motivo ? ` · ${f.motivo}` : ''}</p>
            <div className="flex gap-1 p-1">
              <button onClick={() => void usar(f.path, 'rosto')} disabled={f.papel === 'rosto'} className="flex-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-700 disabled:opacity-40">usar como rosto</button>
              <button onClick={() => void usar(f.path, 'corpo')} disabled={f.papel === 'corpo'} className="flex-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-semibold text-slate-700 disabled:opacity-40">usar como corpo</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
