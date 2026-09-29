'use client'
// ============================================================================
// Aba Tráfego — contas conectadas + "Mesa de estrategistas"
// ----------------------------------------------------------------------------
// Conectar: cola SÓ o token, escolhe as contas da lista que a Meta devolveu.
// Mesa: o plano vem de /api/trafego (regras de mesa.ts); o parecer da IA só
// é pedido no botão.
// ============================================================================
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  buscarContasDoToken, conectarContas, listarContasConectadas, desconectarConta,
  sincronizarAgora, planoDaMesa, parecerDoChefe,
} from '@/lib/trafego/client'
import type { ContaDisponivel } from '@/lib/meta/conectar'
import type { ContaConectadaResumo } from '@/app/actions/trafego-conexao'
import {
  brl, ROTULO_RESULTADO, type Especialista, type PlanoMesa, type Recomendacao, type TipoResultado,
} from '@/lib/trafego/mesa'

const TIME: { chave: Especialista; nome: string; icone: string; papel: string }[] = [
  { chave: 'performance', nome: 'Performance', icone: '💸', papel: 'Onde você está perdendo dinheiro' },
  { chave: 'escala', nome: 'Escala', icone: '🚀', papel: 'Onde colocar mais dinheiro' },
  { chave: 'orcamento', nome: 'Orçamento', icone: '💰', papel: 'De onde tirar, para onde mover' },
  { chave: 'criativo', nome: 'Criativo', icone: '🎨', papel: 'Anúncio fraco e público cansado' },
  { chave: 'risco', nome: 'Risco', icone: '🛡️', papel: 'O que pode quebrar a operação' },
]

const ACAO: Record<Recomendacao['acao'], { rotulo: string; cor: string }> = {
  pausar: { rotulo: 'Pausar', cor: 'bg-red-600 text-white' },
  reduzir: { rotulo: 'Reduzir', cor: 'bg-orange-500 text-white' },
  escalar: { rotulo: 'Escalar', cor: 'bg-emerald-600 text-white' },
  mover_verba: { rotulo: 'Mover verba', cor: 'bg-indigo-600 text-white' },
  trocar_criativo: { rotulo: 'Trocar criativo', cor: 'bg-fuchsia-600 text-white' },
  ampliar_publico: { rotulo: 'Ampliar público', cor: 'bg-sky-600 text-white' },
  corrigir_rastreamento: { rotulo: 'Corrigir rastreamento', cor: 'bg-amber-600 text-white' },
  reconectar: { rotulo: 'Reconectar', cor: 'bg-red-600 text-white' },
  revisar: { rotulo: 'Revisar', cor: 'bg-slate-700 text-white' },
  observar: { rotulo: 'Observar', cor: 'bg-slate-400 text-white' },
}
const URG_COR = { alta: 'border-l-red-500', media: 'border-l-amber-400', baixa: 'border-l-slate-300' }

export function MesaClient({ dias }: { dias: number }) {
  const router = useRouter()
  const [contas, setContas] = useState<ContaConectadaResumo[] | null>(null)
  const [plano, setPlano] = useState<PlanoMesa | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [aba, setAba] = useState<Especialista | 'todas'>('todas')
  const [modal, setModal] = useState(false)
  const [sync, setSync] = useState<string | null>(null)
  const [parecer, setParecer] = useState<{ texto?: string; error?: string; carregando?: boolean }>({})

  const recarregar = useCallback(async () => {
    const [c, p] = await Promise.all([listarContasConectadas(), planoDaMesa(dias)])
    setContas(c.contas); setPlano(p.plano); setCarregando(false)
  }, [dias])

  useEffect(() => {
    let vivo = true
    Promise.all([listarContasConectadas(), planoDaMesa(dias)]).then(([c, p]) => {
      if (!vivo) return
      setContas(c.contas); setPlano(p.plano); setCarregando(false)
    }).catch(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [dias])

  async function lerAgora() {
    setSync('Lendo a Meta… pode levar um minuto.')
    const r = await sincronizarAgora()
    setSync(r.error ?? (r.falhas > 0 ? `Falhou: ${r.erros.join(' · ')}` : `Pronto: ${r.ok} conta(s) lida(s).`))
    await recarregar(); router.refresh()
  }

  async function pedirParecer() {
    setParecer({ carregando: true })
    setParecer(await parecerDoChefe(dias))
  }

  const semConta = contas !== null && contas.length === 0
  const lista = plano ? (aba === 'todas' ? plano.recomendacoes : plano.porEspecialista[aba]) : []
  const r = plano?.resumo

  return (
    <div className="mb-8 space-y-4">
      {/* ─── Contas ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Contas de anúncio</h2>
            <p className="text-xs text-slate-500">Gerenciador de Anúncios da Meta ligado ao FunilPro.</p>
          </div>
          <div className="flex gap-2">
            {contas && contas.length > 0 && (
              <button onClick={lerAgora} disabled={sync?.startsWith('Lendo')}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                ↻ Ler agora
              </button>
            )}
            <button onClick={() => setModal(true)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
              {semConta ? 'Conectar conta' : '+ Conectar / reconectar'}
            </button>
          </div>
        </div>
        {sync && <p className="mt-2 text-xs text-slate-600">{sync}</p>}
        {semConta && (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <strong className="text-slate-900">Nenhuma conta de anúncio conectada.</strong> Sem conta não há gasto para
            comparar — isso não é &quot;zero vendas&quot;. Conecte em 1 minuto: cole o token e escolha a conta da lista.
          </p>
        )}
        {contas && contas.length > 0 && (
          <ul className="mt-3 divide-y divide-slate-100">
            {contas.map(c => {
              const ruim = c.status !== 'active' || !!c.erro
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{c.nome}</p>
                    <p className="text-xs text-slate-500">
                      ID {c.externalId}{c.moeda ? ` · ${c.moeda}` : ''} · {c.ultimaSync ? `lida em ${new Date(c.ultimaSync).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'ainda não lida'}
                    </p>
                    {ruim && <p className="text-xs text-red-600">{c.status === 'token_expired' ? 'Conexão caiu — reconecte.' : c.erro}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${ruim ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{ruim ? 'Com problema' : 'Conectada'}</span>
                    <button onClick={async () => { if (confirm(`Desconectar "${c.nome}"?`)) { await desconectarConta(c.id); await recarregar(); router.refresh() } }}
                      className="text-xs text-slate-400 hover:text-red-600">Desconectar</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ─── Mesa de estrategistas ──────────────────────────────────────── */}
      {!semConta && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="bg-gradient-to-r from-slate-900 via-indigo-900 to-blue-900 p-5 text-white">
            <p className="text-xs uppercase tracking-widest text-indigo-200">Mesa de estrategistas · últimos {dias} dias</p>
            <h2 className="mt-1 text-xl font-semibold">O que o seu time de tráfego recomenda</h2>
            {carregando ? <p className="mt-3 text-sm text-indigo-200">Analisando a conta…</p> : r && (
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Numero rotulo="Investido" valor={brl(r.gastoCents)} />
                <Numero rotulo="Resultados" valor={resultadosEmTexto(r.resultados)} />
                <Numero rotulo="Dinheiro em risco" valor={brl(r.dinheiroEmRiscoCents)} destaque={r.dinheiroEmRiscoCents > 0 ? 'text-red-300' : undefined} />
                <Numero rotulo="Saúde da conta" valor={r.saude === null ? '—' : `${r.saude}/100`} destaque={r.saude !== null && r.saude < 60 ? 'text-amber-300' : 'text-emerald-300'} />
              </div>
            )}
          </div>

          {!carregando && plano && r && r.gastoCents === 0 && plano.recomendacoes.length === 0 && (
            <p className="p-5 text-sm text-slate-600">
              Ainda não há gasto lido no período. Clique em <strong>↻ Ler agora</strong> — o time só opina com número real.
            </p>
          )}

          {!carregando && plano && (plano.recomendacoes.length > 0 || (r && r.gastoCents > 0)) && (
            <div className="p-4">
              <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
                <Chip ativo={aba === 'todas'} onClick={() => setAba('todas')}>Todas ({plano.recomendacoes.length})</Chip>
                {TIME.map(t => (
                  <Chip key={t.chave} ativo={aba === t.chave} onClick={() => setAba(t.chave)}>
                    {t.icone} {t.nome} ({plano.porEspecialista[t.chave].length})
                  </Chip>
                ))}
              </div>
              {aba !== 'todas' && <p className="mb-3 text-xs text-slate-500">{TIME.find(t => t.chave === aba)!.papel}</p>}

              {lista.length === 0 ? (
                <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
                  {aba === 'todas' ? 'Nada fora da régua neste período. Siga rodando e reavalie em 3 dias.' : 'Este especialista não viu nada para mexer agora.'}
                </p>
              ) : (
                <ul className="space-y-3">
                  {lista.map(x => {
                    const t = TIME.find(tt => tt.chave === x.especialista)!
                    return (
                      <li key={x.chave} className={`rounded-xl border border-slate-200 border-l-4 ${URG_COR[x.urgencia]} p-4`}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-slate-500">{t.icone} {t.nome} · {x.alvo.nome}</p>
                            <p className="mt-0.5 font-semibold text-slate-900">{x.titulo}</p>
                          </div>
                          <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${ACAO[x.acao].cor}`}>{ACAO[x.acao].rotulo}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-700">{x.porque}</p>
                        {x.impacto && <p className="mt-1 text-sm font-medium text-slate-900">→ {x.impacto}</p>}
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-indigo-950">🧠 Parecer do estrategista-chefe</p>
                    <p className="text-xs text-indigo-800/80">Junta tudo num plano de ação: o que fazer hoje e nesta semana.</p>
                  </div>
                  <button onClick={pedirParecer} disabled={parecer.carregando}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                    {parecer.carregando ? 'Escrevendo…' : parecer.texto ? 'Gerar de novo' : 'Gerar parecer'}
                  </button>
                </div>
                {parecer.error && <p className="mt-3 text-sm text-red-700">{parecer.error}</p>}
                {parecer.texto && <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{parecer.texto}</div>}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                As recomendações saem de regras com os números da própria conta. Onde diz &quot;estimativa&quot;, é conta de padaria mantendo o custo atual.
              </p>
            </div>
          )}
        </section>
      )}

      {modal && <ModalConectar onFechar={() => setModal(false)} onConectou={async () => { setModal(false); await lerAgora() }} />}
    </div>
  )
}

function resultadosEmTexto(res: Record<TipoResultado, number>): string {
  const partes = (Object.keys(res) as TipoResultado[]).filter(t => res[t] > 0).map(t => `${res[t]} ${ROTULO_RESULTADO[t].varios}`)
  return partes.length ? partes.slice(0, 2).join(' · ') : '0'
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: string }) {
  return (
    <div className="rounded-xl bg-white/10 p-3">
      <p className="text-[11px] uppercase tracking-wide text-indigo-200">{rotulo}</p>
      <p className={`mt-0.5 text-lg font-semibold ${destaque ?? 'text-white'}`}>{valor}</p>
    </div>
  )
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${ativo ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
      {children}
    </button>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onFechar}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Conectar Gerenciador de Anúncios</h3>
          <button onClick={onFechar} className="text-slate-400 hover:text-slate-700" aria-label="Fechar">✕</button>
        </div>

        {!contas ? (
          <>
            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
              <li>Abra o <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer" className="text-blue-600 underline">Explorador da Graph API</a> logado no Facebook dono dos anúncios.</li>
              <li>Em <strong>Permissões</strong>, adicione <code className="rounded bg-slate-100 px-1">ads_read</code> (e <code className="rounded bg-slate-100 px-1">business_management</code> se a conta for de um Gerenciador de Negócios).</li>
              <li>Clique em <strong>Generate Access Token</strong>, autorize e copie o token.</li>
              <li>Cole abaixo. Você <strong>não</strong> precisa digitar o ID da conta — a lista aparece sozinha.</li>
            </ol>
            <textarea value={token} onChange={e => setToken(e.target.value)} rows={4} placeholder="EAAB…"
              className="mt-4 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs focus:border-blue-500 focus:outline-none" />
            <button onClick={buscar} disabled={ocupado || token.trim().length < 20}
              className="mt-3 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
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
                      <span className="block text-xs text-slate-500">
                        ID {c.id}{c.moeda ? ` · ${c.moeda}` : ''}{c.empresa ? ` · ${c.empresa}` : ''}
                      </span>
                      <span className={`text-xs ${c.podeAnunciar ? 'text-emerald-700' : 'text-amber-700'}`}>{c.situacao}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setContas(null)} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">Voltar</button>
              <button onClick={conectar} disabled={ocupado || marcadas.size === 0}
                className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
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
