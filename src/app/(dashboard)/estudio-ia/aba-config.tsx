'use client'
// ============================================================================
// Estúdio IA — subaba Configurações (Fase 2: conexão do WhatsApp do estúdio)
// ----------------------------------------------------------------------------
// Preços, motor de produção, Asaas e ajustes entram nas fases 4 e 5.
// O token é só de escrita: a tela sabe "tem/não tem", nunca o valor.
// ============================================================================
import { useEffect, useState } from 'react'
import {
  lerConfigEstudio, salvarConfigEstudio, testarConexaoEstudio, registrarNumeroEstudio,
  appsDaWaba, inscreverAppNaWaba, enviarTesteAvisos, ultimasConversasEstudio,
  webhookDoNumeroEstudio, apontarWebhookEstudio,
} from '@/lib/estudio/client'
import { RESPOSTA_TESTE_PADRAO, dentroDaJanela } from '@/lib/estudio/whatsapp'

type Config = NonNullable<Awaited<ReturnType<typeof lerConfigEstudio>>['config']>
type Status = NonNullable<Awaited<ReturnType<typeof testarConexaoEstudio>>['status']>
type Conversa = Awaited<ReturnType<typeof ultimasConversasEstudio>>['conversas'][number]
type Aviso = { tipo: 'ok' | 'erro'; texto: string } | null

const VAZIO: Config = { waba_id: null, phone_number_id: null, display_number: null, whatsapp_avisos: null, resposta_teste: null, ativo: false, temToken: false, temAppSecret: false, verificado_em: null }

export function AbaConfig() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [form, setForm] = useState({ waba_id: '', phone_number_id: '', display_number: '', whatsapp_avisos: '', resposta_teste: '', access_token: '', app_secret: '' })
  const [aviso, setAviso] = useState<Aviso>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [apps, setApps] = useState<{ id?: string; name?: string }[] | null>(null)
  const [hook, setHook] = useState<{ webhook?: { application?: string; phone_number?: string; whatsapp_business_account?: string }; nosso?: string } | null>(null)
  const [pin, setPin] = useState('')
  const [conversas, setConversas] = useState<Conversa[] | null>(null)

  const preencher = (c: Config) => {
    setCfg(c)
    setForm({
      waba_id: c.waba_id ?? '', phone_number_id: c.phone_number_id ?? '', display_number: c.display_number ?? '',
      whatsapp_avisos: c.whatsapp_avisos ?? '', resposta_teste: c.resposta_teste ?? '', access_token: '', app_secret: '',
    })
  }

  useEffect(() => {
    let vivo = true
    lerConfigEstudio().then(r => {
      if (!vivo) return
      if (r.error) setAviso({ tipo: 'erro', texto: r.error })
      preencher(r.config ?? VAZIO)
    }).catch(e => { if (vivo) setAviso({ tipo: 'erro', texto: String(e) }) })
    ultimasConversasEstudio().then(r => { if (vivo) setConversas(r.conversas) }).catch(() => {})
    return () => { vivo = false }
  }, [])

  async function rodar<T>(chave: string, fn: () => Promise<T>, ok?: (r: T) => string | null) {
    setOcupado(chave); setAviso(null)
    try {
      const r = await fn() as T & { error?: string; success?: boolean }
      if (r?.error) setAviso({ tipo: 'erro', texto: r.error })
      else if (ok) { const t = ok(r); if (t) setAviso({ tipo: 'ok', texto: t }) }
      return r
    } catch (e) { setAviso({ tipo: 'erro', texto: e instanceof Error ? e.message : String(e) }) }
    finally { setOcupado(null) }
  }

  async function salvar(extra: Partial<{ ativo: boolean }> = {}) {
    const r = await rodar('salvar', () => salvarConfigEstudio({ ...form, ...extra }), () => 'Salvo.')
    if (r?.success) { const n = await lerConfigEstudio(); if (n.config) preencher(n.config) }
  }

  if (!cfg) return <p className="mt-6 text-sm text-slate-500">Carregando…</p>
  const campo = (k: keyof typeof form) => ({ value: form[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value })) })
  const registrado = status?.platform_type === 'CLOUD_API' || status?.status === 'CONNECTED'

  return (
    <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        {aviso && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${aviso.tipo === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{aviso.texto}</div>
        )}

        {/* ─── Conexão ─────────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">WhatsApp do estúdio (API oficial)</h2>
              <p className="text-xs text-slate-500">Número exclusivo. As mensagens dele vêm só para o Estúdio IA — nunca para a aba WhatsApp.</p>
            </div>
            <label className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${cfg.ativo ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
              <input type="checkbox" checked={cfg.ativo} disabled={!!ocupado} onChange={e => salvar({ ativo: e.target.checked })} />
              {cfg.ativo ? 'Respondendo' : 'Desligado (só registra)'}
            </label>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Campo rotulo="Número de exibição" dica="Vai no botão do catálogo (wa.me)"><input {...campo('display_number')} placeholder="+55 21 99077-3595" className={inp} /></Campo>
            <Campo rotulo="phone_number_id"><input {...campo('phone_number_id')} inputMode="numeric" placeholder="1418653454665224" className={inp} /></Campo>
            <Campo rotulo="WABA id"><input {...campo('waba_id')} inputMode="numeric" placeholder="2250778325757289" className={inp} /></Campo>
            <Campo rotulo="Seu WhatsApp para avisos" dica="Recebe 'novo pedido pago'"><input {...campo('whatsapp_avisos')} inputMode="tel" placeholder="21 98012-0036" className={inp} /></Campo>
            <div className="sm:col-span-2">
              <Campo rotulo={`Token permanente ${cfg.temToken ? '· ✅ salvo (cole outro para trocar)' : '· ainda não salvo'}`} dica="Do usuário do sistema da BM. Fica só no servidor.">
                <input {...campo('access_token')} type="password" autoComplete="off" placeholder={cfg.temToken ? '••••••••  (deixe vazio para manter)' : 'EAAG…'} className={inp} />
              </Campo>
            </div>
            <div className="sm:col-span-2">
              <Campo rotulo={`App Secret do app Cobrazap ${cfg.temAppSecret ? '· ✅ salvo' : '· ainda não salvo'}`} dica="developers.facebook.com → app Cobrazap → Configurações → Básico → Chave secreta do app. A Meta assina as mensagens deste número com ela.">
                <input {...campo('app_secret')} type="password" autoComplete="off" placeholder={cfg.temAppSecret ? '••••••••  (deixe vazio para manter)' : '32 caracteres'} className={inp} />
              </Campo>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button onClick={() => salvar()} disabled={!!ocupado} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{ocupado === 'salvar' ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </section>

        {/* ─── Passos com a Meta ───────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Conferir e ativar na Meta</h2>
          <p className="text-xs text-slate-500">Salve o token antes. Cada botão pergunta direto à Meta.</p>

          <Passo n={1} titulo="Testar conexão" texto="Mostra nome, verificação, registro e qualidade do número.">
            <button onClick={() => rodar('teste', testarConexaoEstudio, r => { if (r.status) setStatus(r.status); return null })} disabled={!!ocupado} className={btn}>{ocupado === 'teste' ? '…' : 'Testar'}</button>
          </Passo>
          {status && (
            <dl className="ml-9 mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-xs">
              <Linha k="Número" v={status.display_phone_number} />
              <Linha k="Nome" v={status.verified_name} />
              <Linha k="Nome aprovado" v={status.name_status} />
              <Linha k="Verificação SMS" v={status.code_verification_status} />
              <Linha k="Registro" v={status.platform_type ?? status.status} destaque={registrado ? 'ok' : 'alerta'} />
              <Linha k="Qualidade" v={status.quality_rating} />
            </dl>
          )}

          <Passo n={2} titulo="Registrar na Cloud API" texto="Tira o número do 'Pendente'. Escolha um PIN de 6 dígitos e GUARDE: a Meta pede ele de novo se o número for migrado. O FunilPro não guarda o PIN.">
            <div className="flex gap-2">
              <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="PIN" className={`${inp} w-24 text-center tracking-widest`} />
              <button onClick={() => rodar('reg', () => registrarNumeroEstudio(pin), r => r.success ? 'Número registrado na Cloud API. Clique em Testar para conferir.' : null)}
                disabled={!!ocupado || pin.length !== 6} className={btn}>{ocupado === 'reg' ? '…' : 'Registrar'}</button>
            </div>
          </Passo>

          <Passo n={3} titulo="Webhook SÓ deste número → FunilPro" texto="Usa o override por número da Meta: o 99077-3595 passa a vir para o FunilPro e o webhook do app Cobrazap continua no CobrarZap (os outros números não mudam). Precisa do App Secret salvo.">
            <div className="flex gap-2">
              <button onClick={() => rodar('hookver', webhookDoNumeroEstudio, r => { setHook(r); return null })} disabled={!!ocupado} className={btn}>{ocupado === 'hookver' ? '…' : 'Ver'}</button>
              <button onClick={() => rodar('hook', apontarWebhookEstudio, r => r.success ? 'Webhook deste número apontado para o FunilPro. Clique em Ver para conferir.' : null)}
                disabled={!!ocupado || !cfg.temAppSecret} className={btn}>{ocupado === 'hook' ? '…' : 'Apontar'}</button>
            </div>
          </Passo>
          {hook?.webhook && (
            <dl className="ml-9 mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 text-xs">
              <dt className="text-slate-500">Deste número</dt>
              <dd className={`break-all font-medium ${hook.webhook.phone_number === hook.nosso ? 'text-emerald-700' : 'text-amber-700'}`}>{hook.webhook.phone_number ?? '— (sem override: vai para o webhook do app)'}</dd>
              <dt className="text-slate-500">Da WABA</dt><dd className="break-all text-slate-900">{hook.webhook.whatsapp_business_account ?? '—'}</dd>
              <dt className="text-slate-500">Do app</dt><dd className="break-all text-slate-900">{hook.webhook.application ?? '—'}</dd>
            </dl>
          )}

          <Passo n={4} titulo="App inscrito na WABA" texto="Confere se o Cobrazap está inscrito (já deve estar — é ele que atende o CobrarZap). Não precisa inscrever outro app.">
            <div className="flex gap-2">
              <button onClick={() => rodar('apps', appsDaWaba, r => { setApps(r.apps ?? []); return null })} disabled={!!ocupado} className={btn}>{ocupado === 'apps' ? '…' : 'Ver apps'}</button>
              <button onClick={() => rodar('insc', inscreverAppNaWaba, r => r.success ? 'App inscrito na WABA.' : null)} disabled={!!ocupado} className={btn}>{ocupado === 'insc' ? '…' : 'Inscrever'}</button>
            </div>
          </Passo>
          {apps && (
            <p className="ml-9 mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              {apps.length === 0 ? 'Nenhum app inscrito nesta WABA — clique em Inscrever.' : <>Inscritos: {apps.map(a => `${a.name ?? 'app'} (${a.id})`).join(', ')}</>}
            </p>
          )}

          <Passo n={5} titulo="Teste dos avisos" texto="Manda uma mensagem para o seu WhatsApp pessoal. Antes, mande um 'oi' do seu WhatsApp para o número do estúdio (regra das 24h da Meta).">
            <button onClick={() => rodar('aviso', enviarTesteAvisos, r => r.success ? 'Enviado! Confira o seu WhatsApp.' : null)} disabled={!!ocupado} className={btn}>{ocupado === 'aviso' ? '…' : 'Enviar teste'}</button>
          </Passo>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Resposta automática de teste</h2>
          <p className="text-xs text-slate-500">Só nesta fase: responde quem escreve (no máximo 1 vez a cada 30 min). Na Fase 3 a Ana assume com o roteiro completo.</p>
          <textarea {...campo('resposta_teste')} rows={3} placeholder={RESPOSTA_TESTE_PADRAO} className={`${inp} mt-3`} />
          <div className="mt-3 flex justify-end"><button onClick={() => salvar()} disabled={!!ocupado} className={btn}>Salvar texto</button></div>
        </section>
      </div>

      {/* ─── Últimas conversas ─────────────────────────────────────── */}
      <aside className="h-fit rounded-xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-4">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Últimas conversas</h3>
          <button onClick={async () => setConversas((await ultimasConversasEstudio()).conversas)} className="text-xs font-medium text-slate-500 hover:text-slate-900">↻</button>
        </div>
        {!conversas ? <p className="p-4 text-xs text-slate-500">Carregando…</p> : conversas.length === 0 ? (
          <p className="p-4 text-xs text-slate-500">Ninguém escreveu ainda. Mande &quot;Olá&quot; para o número do estúdio e atualize.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {conversas.map(c => (
              <li key={c.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-slate-900">{c.nome || `+${c.wa_id}`}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.origem === 'anuncio' ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>{c.origem === 'anuncio' ? 'anúncio' : 'orgânico'}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{c.direcao === 'saida' ? 'Você: ' : ''}{c.ultima ?? '—'}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {new Date(c.ultima_msg_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {' · '}{dentroDaJanela(c.janela_ate) ? 'janela aberta' : 'janela fechada'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  )
}

const inp = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-rose-500 focus:outline-none'
const btn = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'

function Campo({ rotulo, dica, children }: { rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-slate-600">{rotulo}
      <div className="mt-1">{children}</div>
      {dica && <span className="mt-0.5 block text-[11px] font-normal text-slate-400">{dica}</span>}
    </label>
  )
}

function Passo({ n, titulo, texto, children }: { n: number; titulo: string; texto: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-slate-100 pt-4 first-of-type:border-0">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">{titulo}</p>
        <p className="text-xs text-slate-500">{texto}</p>
      </div>
      {children}
    </div>
  )
}

function Linha({ k, v, destaque }: { k: string; v?: string; destaque?: 'ok' | 'alerta' }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className={`font-medium ${destaque === 'ok' ? 'text-emerald-700' : destaque === 'alerta' ? 'text-amber-700' : 'text-slate-900'}`}>{v ?? '—'}</dd>
    </>
  )
}
