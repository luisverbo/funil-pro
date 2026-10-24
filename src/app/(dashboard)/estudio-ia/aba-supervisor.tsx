'use client'
// ============================================================================
// Estúdio IA — subaba Supervisor: o 2º agente que revisa as conversas da Ana.
// Nota média, vendas/perdas, problemas por gravidade com "como deveria ter
// sido"; Aplicar (vira regra/FAQ na Base de conhecimento, editável antes),
// Ignorar, Revisar agora, e a lista pronta para levar ao Claude Code.
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import { painelSupervisor, aplicarAchado, ignorarAchado, revisarAgoraSupervisor } from '@/lib/estudio/client'
import { bandeira } from '@/lib/estudio/chat'

type Dados = Awaited<ReturnType<typeof painelSupervisor>>
type Achado = Dados['achados'][number]

const TIPO: Record<string, string> = { travou: '🧱 Travou', robotica: '🤖 Robótica', errada: '❌ Errada', faltou_info: '❓ Faltou informação', venda_perdida: '💸 Venda perdida', fluxo: '🔀 Fluxo' }
const DESTINO: Record<string, string> = { regra: 'Regra na base', faq: 'Pergunta e resposta na base', nao_dizer: '"Nunca diga" na base', codigo: 'Precisa de código' }
const COR: Record<string, string> = { alta: 'bg-red-100 text-red-800', media: 'bg-amber-100 text-amber-800', baixa: 'bg-slate-100 text-slate-700' }

export function AbaSupervisor() {
  const [dias, setDias] = useState(7)
  const [d, setD] = useState<Dados | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [versao, setVersao] = useState(0)
  const recarregar = useCallback(() => setVersao(v => v + 1), [])

  useEffect(() => {
    let vivo = true
    painelSupervisor(dias).then(r => { if (vivo) setD(r) }).catch(e => vivo && setMsg({ ok: false, t: String(e) }))
    return () => { vivo = false }
  }, [dias, versao])

  const revisar = async () => {
    setOcupado('revisar'); setMsg(null)
    try {
      const r = await revisarAgoraSupervisor()
      setMsg(r.error && !r.revisadas ? { ok: false, t: r.error } : { ok: true, t: `${r.revisadas} conversa(s) revisada(s), ${r.achados} problema(s) apontado(s).${r.error ? ` (${r.error})` : ''}` })
      recarregar()
    } catch (e) { setMsg({ ok: false, t: String(e) }) } finally { setOcupado(null) }
  }

  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">🕵️ Supervisor da Ana</h2>
            <p className="max-w-2xl text-xs text-slate-500">Um 2º agente lê cada conversa parada (de hora em hora), dá nota e aponta onde a cliente parou, as mensagens robóticas ou erradas e o que faltou a Ana saber. <strong>Aplicar</strong> põe a correção na Base de conhecimento — a Ana já usa na próxima mensagem. Nada muda sem você aprovar.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {[1, 7, 30].map(n => <button key={n} onClick={() => setDias(n)} className={`rounded-full px-2.5 py-1 font-medium ${dias === n ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{n === 1 ? 'Hoje' : `${n} dias`}</button>)}
            <button disabled={!!ocupado} onClick={revisar} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{ocupado === 'revisar' ? 'Revisando… (até 4 min)' : 'Revisar agora'}</button>
          </div>
        </div>
        {msg && <p className={`mt-3 rounded p-2 text-xs ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.t}</p>}
        {d?.error && <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{d.error}</p>}
        {d && !d.error && (
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Kpi r="Nota média" v={d.nota_media === null ? '—' : `${String(d.nota_media).replace('.', ',')}/10`} />
            <Kpi r="Conversas revisadas" v={String(d.revisoes)} />
            <Kpi r="Vendeu / perdeu" v={`${d.vendeu} / ${d.perdeu}`} />
            <Kpi r="Problemas abertos" v={String(d.achados.length)} />
            <Kpi r="Custo do Supervisor" v={`US$ ${d.custo_usd.toFixed(2)}`} />
          </dl>
        )}
        {d && Object.keys(d.por_tipo).length > 0 && (
          <p className="mt-3 flex flex-wrap gap-2 text-xs">{Object.entries(d.por_tipo).sort((a, b) => b[1] - a[1]).map(([k, n]) => <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{TIPO[k] ?? k}: {n}</span>)}</p>
        )}
      </section>

      {d?.para_claude && (
        <section className="rounded-xl border border-violet-200 bg-violet-50 p-5">
          <h3 className="text-sm font-semibold text-violet-900">🧑‍💻 Levar para o Claude Code ({d.achados.filter(a => a.correcao?.destino === 'codigo').length})</h3>
          <p className="text-xs text-violet-800">Problemas de fluxo que precisam de mudança no sistema. Copie e cole na conversa com o Claude Code.</p>
          <textarea readOnly value={d.para_claude} className="mt-2 h-32 w-full rounded-lg border border-violet-200 bg-white p-2 font-mono text-xs" />
          <button onClick={() => { void navigator.clipboard.writeText(d.para_claude).then(() => setMsg({ ok: true, t: 'Copiado! Cole na conversa com o Claude Code.' })) }} className="mt-2 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white">Copiar</button>
        </section>
      )}

      <section className="space-y-3">
        {!d ? <p className="text-sm text-slate-500">Carregando…</p>
          : d.achados.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Nenhum problema aberto. {d.revisoes === 0 ? 'Clique em "Revisar agora" para a 1ª análise.' : '🎉'}</p>
          : d.achados.map(a => <CartaoAchado key={a.id} a={a} ocupado={ocupado === a.id} onAcao={async (acao, texto) => {
            setOcupado(a.id); setMsg(null)
            try {
              const r = acao === 'aplicar' ? await aplicarAchado(a.id, texto) : await ignorarAchado(a.id)
              setMsg(r.success ? { ok: true, t: acao === 'aplicar' ? 'Aplicado — a Ana já usa na próxima mensagem.' : 'Ignorado.' } : { ok: false, t: r.error ?? 'falhou' })
              recarregar()
            } catch (e) { setMsg({ ok: false, t: String(e) }) } finally { setOcupado(null) }
          }} />)}
      </section>
    </div>
  )
}

function Kpi({ r, v }: { r: string; v: string }) {
  return <div className="rounded-lg bg-slate-50 p-3"><dt className="text-[11px] uppercase tracking-wider text-slate-500">{r}</dt><dd className="mt-1 text-lg font-bold text-slate-900">{v}</dd></div>
}

function CartaoAchado({ a, ocupado, onAcao }: { a: Achado; ocupado: boolean; onAcao: (acao: 'aplicar' | 'ignorar', texto?: string) => void }) {
  const [texto, setTexto] = useState(a.correcao?.texto ?? '')
  const codigo = a.correcao?.destino === 'codigo'
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${COR[a.gravidade] ?? ''}`}>{a.gravidade}</span>
        <span className="font-medium text-slate-800">{TIPO[a.tipo] ?? a.tipo}</span>
        <a href={`/estudio-ia?aba=conversas&c=${a.contato_id}`} className="text-slate-500 underline">{bandeira(a.pais)} {a.contato_nome ?? 'conversa'}</a>
        <span className="ml-auto text-slate-400">{new Date(a.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      </header>
      {a.trecho && <blockquote className="mt-2 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-600">“{a.trecho}”</blockquote>}
      <p className="mt-2 text-sm text-slate-900">{a.problema}</p>
      {a.deveria && <p className="mt-1 rounded bg-emerald-50 p-2 text-xs text-emerald-900"><strong>Deveria:</strong> {a.deveria}</p>}
      <div className="mt-3">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Correção sugerida · {DESTINO[a.correcao?.destino] ?? a.correcao?.destino}{a.correcao?.pergunta ? ` · "${a.correcao.pergunta}"` : ''}</p>
        {codigo ? <p className="mt-1 text-xs text-slate-700">{a.correcao.texto}</p>
          : <textarea value={texto} onChange={e => setTexto(e.target.value)} className="mt-1 h-16 w-full rounded-lg border border-slate-200 p-2 text-xs" />}
      </div>
      <div className="mt-2 flex gap-2">
        {!codigo && <button disabled={ocupado || !texto.trim()} onClick={() => onAcao('aplicar', texto)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Aplicar</button>}
        <button disabled={ocupado} onClick={() => onAcao('ignorar')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">{codigo ? 'Já levei / ignorar' : 'Ignorar'}</button>
      </div>
    </article>
  )
}
