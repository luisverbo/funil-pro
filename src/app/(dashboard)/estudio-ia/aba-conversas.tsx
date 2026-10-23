'use client'
// ============================================================================
// Estúdio IA — subaba Conversas (Fase 2b): o WhatsApp do estúdio dentro do
// FunilPro, estilo WhatsApp Web. Funciona no celular (lista ↔ conversa) e
// como app instalado (PWA) com notificação de mensagem nova.
//
// Atualiza sozinho: lista a cada 5 s, conversa aberta a cada 3 s. Mídia vem
// do NOSSO Storage por link assinado curto (a da Meta expira).
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  listarConversasChat, abrirConversaChat, enviarTextoChat, urlDeUploadChat, enviarMidiaChat,
  enviarFotosDoPedidoChat, listarModelosChat, enviarModeloChat, definirAtendimentoChat, salvarNotasChat,
  chavePushEstudio, inscreverPushEstudio,
} from '@/lib/estudio/client'
import { createClient } from '@/lib/supabase/client'
import { webmParaOgg } from '@/lib/whatsapp-cloud/webm-para-ogg'
import { bandeira, tempoDaJanela, tick, tipoCloudDoMime } from '@/lib/estudio/chat'
import { BUCKET_CLIENTES } from '@/lib/estudio/catalogo'

type Lista = Awaited<ReturnType<typeof listarConversasChat>>['contatos']
type Aberta = Awaited<ReturnType<typeof abrirConversaChat>>
type Msg = Aberta['mensagens'][number]

const EMOJIS = ['😊', '😍', '🥰', '😘', '💖', '❤️', '✨', '🔥', '👏', '🙏', '😂', '🤩', '📸', '🎂', '💼', '🌹', '👗', '✅', '👇', '🚀', '💅', '🥳', '😉', '🤗']

const STATUS_PEDIDO: Record<string, string> = {
  novo: 'Novo', aguardando_pagamento: 'Aguardando Pix', aguardando_conferencia: 'Conferir Pix', pago: 'Pago',
  aguardando_fotos: 'Aguardando fotos', aguardando_producao: 'Na fila', gerando: 'Gerando', pronto: 'Pronto',
  aguardando_aprovacao: 'Aprovação', entregue: 'Entregue', ajuste: 'Ajuste', finalizado: 'Finalizado', cancelado: 'Cancelado',
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const quando = (iso: string) => {
  const d = new Date(iso); const hoje = new Date()
  const mesmoDia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) === hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  return mesmoDia ? hora(iso) : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
}

export function AbaConversas() {
  const [lista, setLista] = useState<Lista | null>(null)
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'naolidas' | 'humano'>('todas')
  // Abre direto pelo link da notificação (?c=…).
  const sp = useSearchParams()
  const [abertaId, setAbertaId] = useState<string | null>(() => sp.get('c'))
  const [aberta, setAberta] = useState<Aberta | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [painel, setPainel] = useState(false)
  const naoLidasAntes = useRef<Map<string, number>>(new Map())
  const humanoAntes = useRef<Set<string>>(new Set())
  const primeira = useRef(true)

  // ── PWA + notificações ────────────────────────────────────────────────────
  const permissaoAtual = useSyncExternalStore(() => () => {},
    () => ('Notification' in window ? Notification.permission : 'indisponivel') as NotificationPermission | 'indisponivel',
    () => 'indisponivel' as const)
  const [permissaoPedida, setPermissao] = useState<NotificationPermission | null>(null)
  const permissao = permissaoPedida ?? permissaoAtual
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw-estudio.js').catch(() => {})
  }, [])
  const notificar = useCallback(async (titulo: string, corpo: string, contatoId: string) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return
    if (document.visibilityState === 'visible' && abertaId === contatoId) return
    const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined)
    const dados = { url: `/estudio-ia?aba=conversas&c=${contatoId}` }
    if (reg) reg.showNotification(titulo, { body: corpo, tag: contatoId, data: dados, icon: '/icon-estudio.svg' })
    else new Notification(titulo, { body: corpo, tag: contatoId })
  }, [abertaId])

  // ── Lista (5 s) ───────────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true
    const carregar = async () => {
      const r = await listarConversasChat(busca).catch(e => ({ contatos: [] as Lista, error: String(e) }))
      if (!vivo) return
      if (r.error) setErro(r.error)
      setLista(r.contatos)
      if (!primeira.current) {
        for (const c of r.contatos) {
          const antes = naoLidasAntes.current.get(c.id) ?? 0
          if (c.nao_lidas > antes) void notificar(`${bandeira(c.pais)} ${c.nome || `+${c.wa_id}`}`, c.ultima_msg ?? 'Nova mensagem', c.id)
          if (c.precisa_humano && !humanoAntes.current.has(c.id)) void notificar('🙋 Passou para você', `${c.nome || `+${c.wa_id}`} precisa de atendimento humano`, c.id)
        }
      }
      primeira.current = false
      naoLidasAntes.current = new Map(r.contatos.map(c => [c.id, c.nao_lidas]))
      humanoAntes.current = new Set(r.contatos.filter(c => c.precisa_humano).map(c => c.id))
    }
    void carregar()
    const t = setInterval(carregar, 5000)
    return () => { vivo = false; clearInterval(t) }
  }, [busca, notificar])

  // ── Conversa aberta (3 s) ─────────────────────────────────────────────────
  const recarregarAberta = useCallback(async (id: string) => {
    const r = await abrirConversaChat(id).catch(e => ({ mensagens: [], pedidos: [], error: String(e) }) as Aberta)
    if (r.error) setErro(r.error)
    setAberta(a => (a?.contato?.id === id || !a || r.contato?.id === id) ? r : a)
  }, [])
  useEffect(() => {
    if (!abertaId) return
    let vivo = true
    const tick = () => { if (vivo) void recarregarAberta(abertaId) }
    tick()
    const t = setInterval(tick, 3000)
    return () => { vivo = false; clearInterval(t) }
  }, [abertaId, recarregarAberta])

  const visiveis = useMemo(() => (lista ?? []).filter(c =>
    filtro === 'todas' ? true : filtro === 'naolidas' ? c.nao_lidas > 0 : (c.modo === 'humano' || c.precisa_humano)), [lista, filtro])

  const contato = aberta?.contato?.id === abertaId ? aberta.contato : undefined

  return (
    <div className="mt-4 flex h-[calc(100dvh-210px)] min-h-[520px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* ─── Lista ─────────────────────────────────────────────────── */}
      <aside className={`${abertaId ? 'hidden md:flex' : 'flex'} w-full flex-col border-r border-slate-200 md:w-[340px] md:shrink-0`}>
        <div className="space-y-2 border-b border-slate-100 p-3">
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar nome ou número"
            className="w-full rounded-lg bg-slate-100 px-3 py-2 text-sm focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500" />
          <div className="flex gap-1">
            {([['todas', 'Todas'], ['naolidas', 'Não lidas'], ['humano', 'Comigo']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-full px-3 py-1 text-xs font-medium ${filtro === k ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{l}</button>
            ))}
            {permissao !== 'indisponivel' && permissao !== 'denied' && (
              <button onClick={async () => { const r = await ativarPush(); setPermissao(r.permissao); if (r.erro) setErro(r.erro); else setErro(null) }}
                className={`ml-auto rounded-full px-2.5 py-1 text-[11px] font-medium ${permissao === 'granted' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>
                {permissao === 'granted' ? '🔔 Avisos ligados' : '🔔 Ativar avisos'}
              </button>
            )}
          </div>
        </div>
        {erro && <p className="m-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{erro}</p>}
        <ul className="flex-1 overflow-y-auto">
          {lista === null ? <li className="p-4 text-sm text-slate-500">Carregando…</li> : visiveis.length === 0 ? (
            <li className="p-6 text-center text-sm text-slate-500">Nenhuma conversa {filtro !== 'todas' ? 'neste filtro' : 'ainda'}.</li>
          ) : visiveis.map(c => (
            <li key={c.id}>
              <button onClick={() => { setAbertaId(c.id); setPainel(false) }}
                className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-3 text-left hover:bg-slate-50 ${abertaId === c.id ? 'bg-emerald-50/60' : ''}`}>
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-200 text-lg">
                  {(c.nome || '?').trim().charAt(0).toUpperCase()}
                  <span className="absolute -bottom-0.5 -right-0.5 text-sm">{bandeira(c.pais)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{c.nome || `+${c.wa_id}`}</span>
                    <span className={`shrink-0 text-[11px] ${c.nao_lidas > 0 ? 'font-semibold text-emerald-600' : 'text-slate-400'}`}>{quando(c.ultima_msg_em)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500">{c.ultima_msg ?? '—'}</span>
                    {c.nao_lidas > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white">{c.nao_lidas}</span>}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {c.precisa_humano && <Selo cor="bg-red-100 text-red-700">🙋 precisa de você</Selo>}
                    <Selo cor={c.modo === 'humano' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}>{c.modo === 'humano' ? '👤 você' : '🤖 Ana'}{c.etapa ? ` · ${c.etapa}` : ''}</Selo>
                    {c.pedido_status && <Selo cor="bg-amber-100 text-amber-800">{STATUS_PEDIDO[c.pedido_status] ?? c.pedido_status}</Selo>}
                    {c.origem === 'anuncio' && <Selo cor="bg-slate-100 text-slate-600">anúncio</Selo>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* ─── Conversa ──────────────────────────────────────────────── */}
      <section className={`${abertaId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {!abertaId ? (
          <div className="flex flex-1 items-center justify-center bg-[#f0f2f5] p-8 text-center text-sm text-slate-500">
            <div><p className="text-4xl">💬</p><p className="mt-2">Escolha uma conversa.</p></div>
          </div>
        ) : !contato ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Carregando…</div>
        ) : (
          <Conversa key={contato.id} aberta={aberta!} painel={painel} setPainel={setPainel}
            voltar={() => { setAbertaId(null); setAberta(null) }}
            recarregar={() => recarregarAberta(contato.id)} setErro={setErro} />
        )}
      </section>
    </div>
  )
}

const b64 = (s: string) => { const p = s.replace(/-/g, '+').replace(/_/g, '/'); const r = atob(p + '='.repeat((4 - p.length % 4) % 4)); return Uint8Array.from(r, ch => ch.charCodeAt(0)) }

/**
 * Liga os avisos com o app FECHADO: permissão + inscrição no Web Push.
 * No iPhone só funciona com o FunilPro instalado na Tela de Início (iOS 16.4+).
 */
async function ativarPush(): Promise<{ permissao: NotificationPermission; erro?: string }> {
  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted') return { permissao }
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return { permissao, erro: 'Este navegador não recebe aviso com o app fechado. No iPhone: Safari → Compartilhar → Adicionar à Tela de Início, e abra pelo ícone.' }
    }
    const reg = await navigator.serviceWorker.register('/sw-estudio.js')
    await navigator.serviceWorker.ready
    const chave = await chavePushEstudio()
    if (!chave.publica) return { permissao, erro: chave.error ?? 'Sem chave de push.' }
    const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(chave.publica) })
    const r = await inscreverPushEstudio(sub.endpoint, navigator.userAgent.slice(0, 120))
    return r.success ? { permissao } : { permissao, erro: r.error }
  } catch (e) { return { permissao, erro: `Não deu para ligar o push: ${e instanceof Error ? e.message : String(e)}` } }
}

function Selo({ cor, children }: { cor: string; children: React.ReactNode }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${cor}`}>{children}</span>
}

// ── Conversa aberta ─────────────────────────────────────────────────────────

function Conversa({ aberta, painel, setPainel, voltar, recarregar, setErro }: {
  aberta: Aberta; painel: boolean; setPainel: (v: boolean) => void; voltar: () => void
  recarregar: () => Promise<void>; setErro: (e: string | null) => void
}) {
  const c = aberta.contato!
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [emojis, setEmojis] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const [modelos, setModelos] = useState<{ name: string; language: string; corpo: string }[] | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)
  const qtdMsgs = useRef(0)
  const janela = tempoDaJanela(c.janela_ate)

  useEffect(() => {
    if (aberta.mensagens.length !== qtdMsgs.current) {
      qtdMsgs.current = aberta.mensagens.length
      fimRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [aberta.mensagens.length])

  async function acao(fn: () => Promise<{ success?: boolean; error?: string; foraDaJanela?: boolean }>) {
    setEnviando(true); setAviso(null)
    try {
      const r = await fn()
      if (r.error) setAviso(r.error)
      if (r.foraDaJanela) setModelos((await listarModelosChat()).modelos)
      await recarregar()
      return !r.error
    } catch (e) { setAviso(e instanceof Error ? e.message : String(e)); return false }
    finally { setEnviando(false) }
  }

  async function enviarTexto() {
    const t = texto.trim(); if (!t) return
    if (await acao(() => enviarTextoChat(c.id, t))) setTexto('')
  }

  /** Sobe direto no Storage (link assinado) e manda pela Meta. */
  async function enviarArquivo(arquivo: File, legenda?: string) {
    const up = await urlDeUploadChat(c.id, arquivo.name, arquivo.type || 'application/octet-stream', arquivo.size)
    if (up.error || !up.path || !up.token) { setAviso(up.error ?? 'não deu para enviar'); return false }
    const { error } = await createClient().storage.from(BUCKET_CLIENTES).uploadToSignedUrl(up.path, up.token, arquivo, { contentType: arquivo.type })
    if (error) { setAviso(`Upload: ${error.message}`); return false }
    return acao(() => enviarMidiaChat(c.id, up.path!, arquivo.type || 'application/octet-stream', legenda, arquivo.name))
  }

  async function anexar(files: FileList | null) {
    if (!files?.length) return
    setEnviando(true)
    const lista = Array.from(files).slice(0, 10)
    for (let i = 0; i < lista.length; i++) {
      // A legenda digitada vai na 1ª imagem/vídeo/documento.
      const leg = i === 0 && tipoCloudDoMime(lista[i].type) !== 'audio' ? texto.trim() || undefined : undefined
      const ok = await enviarArquivo(lista[i], leg)
      if (!ok) break
      if (i === 0 && leg) setTexto('')
    }
    setEnviando(false)
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Cabeçalho */}
        <header className="flex items-center gap-2 border-b border-slate-200 bg-[#f0f2f5] px-3 py-2">
          <button onClick={voltar} className="rounded-full p-1.5 text-slate-600 hover:bg-slate-200 md:hidden" aria-label="Voltar">‹</button>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-300 text-base">{(c.nome || '?').charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{bandeira(c.pais)} {c.nome || `+${c.wa_id}`}</p>
            <p className="truncate text-[11px] text-slate-500">+{c.wa_id} · {c.idioma ?? '—'} · {janela ? `janela aberta · ${janela}` : '⛔ janela fechada (só modelo)'}</p>
          </div>
          {c.modo === 'humano' ? (
            <button onClick={() => acao(() => definirAtendimentoChat(c.id, 'ana'))} disabled={enviando}
              className="shrink-0 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50">🤖 Devolver p/ Ana</button>
          ) : (
            <button onClick={() => acao(() => definirAtendimentoChat(c.id, 'luis'))} disabled={enviando}
              className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50">👤 Assumir</button>
          )}
          <button onClick={() => setPainel(!painel)} className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200">ⓘ</button>
        </header>
        {c.modo === 'humano' && (
          <p className="bg-sky-50 px-3 py-1.5 text-center text-[11px] text-sky-800">
            Você está atendendo — a Ana não responde{c.humano_fixo ? ' até você devolver.' : ' (volta sozinha após 2 h sem mensagem sua).'}
          </p>
        )}

        {/* Mensagens */}
        <div className="flex-1 space-y-1.5 overflow-y-auto bg-[#efeae2] px-3 py-3">
          {aberta.mensagens.map(m => <Bolha key={m.id} m={m} />)}
          <div ref={fimRef} />
        </div>

        {/* Composer */}
        {aviso && <p className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{aviso}</p>}
        {!janela ? (
          <div className="border-t border-slate-200 bg-[#f0f2f5] p-3">
            <p className="text-xs text-slate-600">A janela de 24h fechou. Pela regra da Meta, só sai <strong>modelo aprovado</strong> até a cliente responder.</p>
            <button onClick={async () => setModelos((await listarModelosChat()).modelos)} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium">Escolher modelo</button>
            {modelos && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {modelos.length === 0 && <li className="text-xs text-slate-500">Nenhum modelo aprovado (sem variáveis) nesta WABA.</li>}
                {modelos.map(t => (
                  <li key={`${t.name}-${t.language}`}>
                    <button onClick={() => acao(() => enviarModeloChat(c.id, t.name, t.language))} disabled={enviando}
                      className="w-full rounded-lg bg-white p-2 text-left text-xs hover:bg-emerald-50">
                      <strong>{t.name}</strong> · {t.language}<br /><span className="text-slate-500">{t.corpo.slice(0, 120)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <Composer texto={texto} setTexto={setTexto} enviando={enviando} emojis={emojis} setEmojis={setEmojis}
            enviarTexto={enviarTexto} anexar={anexar}
            enviarVoz={async f => { setEnviando(true); await enviarArquivo(f); setEnviando(false) }}
            setErro={m => setAviso(m)} />
        )}
      </div>

      {/* Painel lateral: notas + pedido */}
      {painel && <Painel aberta={aberta} fechar={() => setPainel(false)} recarregar={recarregar} setErro={setErro} />}
    </div>
  )
}

function Bolha({ m }: { m: Msg }) {
  const minha = m.direcao === 'saida'
  const t = tick(m.status_entrega)
  const autor = minha ? (m.autor === 'ana' ? '🤖 Ana' : m.autor === 'luis' ? 'Você' : 'Sistema') : null
  const legenda = m.texto && !m.texto.startsWith('[') ? m.texto : null
  return (
    <div className={`flex ${minha ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm sm:max-w-[65%] ${minha ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
        {autor && <p className={`text-[10px] font-semibold ${m.autor === 'ana' ? 'text-violet-600' : 'text-sky-700'}`}>{autor}</p>}
        <Conteudo m={m} />
        {legenda && m.tipo !== 'texto' && m.tipo !== 'localizacao' && <p className="mt-1 whitespace-pre-wrap break-words">{legenda}</p>}
        {m.erro && <p className="mt-1 text-[11px] text-red-600">⚠ {m.erro}</p>}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-slate-500">
          {hora(m.criado_em)}
          {minha && <span className={t.azul ? 'text-sky-500' : t.falhou ? 'text-red-600' : ''}>{t.simbolo}</span>}
        </p>
      </div>
    </div>
  )
}

function Conteudo({ m }: { m: Msg }) {
  const url = m.media_url
  switch (m.tipo) {
    case 'imagem':
      // eslint-disable-next-line @next/next/no-img-element
      return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="max-h-72 rounded-md" /></a> : <p className="text-slate-500">📷 Foto</p>
    case 'figurinha':
      // eslint-disable-next-line @next/next/no-img-element
      return url ? <img src={url} alt="figurinha" className="h-32 w-32 object-contain" /> : <p className="text-slate-500">🩷 Figurinha</p>
    case 'audio':
      return url ? <audio controls src={url} className="w-60 max-w-full" preload="none" /> : <p className="text-slate-500">🎙 Áudio</p>
    case 'video':
      return url ? <video controls src={url} className="max-h-72 rounded-md" preload="none" /> : <p className="text-slate-500">🎬 Vídeo</p>
    case 'documento':
      return url
        ? <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-md bg-black/5 px-2 py-2 text-sm text-slate-800 hover:bg-black/10">📎 <span className="truncate">{m.media_nome || 'documento'}</span></a>
        : <p className="text-slate-500">📎 {m.media_nome || 'Documento'}</p>
    case 'localizacao': {
      const link = m.texto?.match(/https?:\/\/\S+/)?.[0]
      return <a href={link ?? '#'} target="_blank" rel="noreferrer" className="text-sky-700 underline">{m.texto?.replace(/https?:\/\/\S+/, '').replace(/·\s*$/, '').trim() || '📍 Localização'} ↗</a>
    }
    default:
      return <p className="whitespace-pre-wrap break-words">{m.texto}</p>
  }
}

function Composer({ texto, setTexto, enviando, emojis, setEmojis, enviarTexto, anexar, enviarVoz, setErro }: {
  texto: string; setTexto: (t: string) => void; enviando: boolean; emojis: boolean; setEmojis: (v: boolean) => void
  enviarTexto: () => void; anexar: (f: FileList | null) => void; enviarVoz: (f: File) => Promise<void>; setErro: (m: string) => void
}) {
  const [gravando, setGravando] = useState(false)
  const [seg, setSeg] = useState(0)
  const rec = useRef<MediaRecorder | null>(null)
  const pedacos = useRef<Blob[]>([])
  const cancelar = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  async function gravar() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m)) ?? ''
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      pedacos.current = []; cancelar.current = false
      r.ondataavailable = e => { if (e.data.size > 0) pedacos.current.push(e.data) }
      r.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (cancelar.current) return
        const tipo = r.mimeType || mime
        const blob = new Blob(pedacos.current, { type: tipo || 'audio/webm' })
        if (blob.size < 200) { setErro('Áudio curto demais.'); return }
        // Nota de voz do WhatsApp = OGG/Opus. Chrome grava WebM: converte aqui mesmo.
        let arq: File
        if (tipo.includes('ogg')) arq = new File([blob], 'voz.ogg', { type: 'audio/ogg' })
        else if (tipo.includes('webm')) {
          const ogg = webmParaOgg(new Uint8Array(await blob.arrayBuffer()))
          if (!ogg) { setErro('Não consegui converter a gravação — mande como arquivo pelo 📎.'); return }
          arq = new File([new Blob([new Uint8Array(ogg)])], 'voz.ogg', { type: 'audio/ogg' })
        } else arq = new File([blob], 'voz.m4a', { type: 'audio/mp4' })
        await enviarVoz(arq)
      }
      rec.current = r; r.start(250); setGravando(true); setSeg(0)
      timer.current = setInterval(() => setSeg(s => s + 1), 1000)
    } catch { setErro('Não consegui acessar o microfone — libere a permissão no navegador.') }
  }
  function parar(cancel: boolean) {
    cancelar.current = cancel
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    setGravando(false); rec.current?.stop(); rec.current = null
  }

  return (
    <div className="relative border-t border-slate-200 bg-[#f0f2f5] px-2 py-2">
      {emojis && (
        <div className="absolute bottom-full left-2 mb-1 grid grid-cols-8 gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          {EMOJIS.map(e => <button key={e} onClick={() => setTexto(texto + e)} className="rounded p-1 text-xl hover:bg-slate-100">{e}</button>)}
        </div>
      )}
      {gravando ? (
        <div className="flex items-center gap-3 px-2 py-1.5">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="text-sm tabular-nums text-slate-700">{Math.floor(seg / 60)}:{String(seg % 60).padStart(2, '0')}</span>
          <button onClick={() => parar(true)} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200">Cancelar</button>
          <button onClick={() => parar(false)} className="rounded-full bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-white">Enviar ➤</button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <button onClick={() => setEmojis(!emojis)} className="rounded-full p-2 text-xl text-slate-500 hover:bg-slate-200" aria-label="Emoji">😊</button>
          <label className="cursor-pointer rounded-full p-2 text-xl text-slate-500 hover:bg-slate-200" aria-label="Anexar">
            📎<input type="file" multiple className="hidden" disabled={enviando}
              accept="image/jpeg,image/png,video/mp4,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip"
              onChange={e => { anexar(e.target.files); e.target.value = '' }} />
          </label>
          <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={1} placeholder="Mensagem"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarTexto() } }}
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-lg bg-white px-3 py-2 text-sm focus:outline-none" />
          {texto.trim() ? (
            <button onClick={enviarTexto} disabled={enviando} className="rounded-full bg-emerald-500 px-3.5 py-2 text-white disabled:opacity-50" aria-label="Enviar">➤</button>
          ) : (
            <button onClick={gravar} disabled={enviando} className="rounded-full bg-emerald-500 px-3.5 py-2 text-white disabled:opacity-50" aria-label="Gravar áudio">🎤</button>
          )}
        </div>
      )}
      {enviando && <p className="px-2 pt-1 text-[11px] text-slate-500">Enviando…</p>}
    </div>
  )
}

function Painel({ aberta, fechar, recarregar, setErro }: { aberta: Aberta; fechar: () => void; recarregar: () => Promise<void>; setErro: (e: string | null) => void }) {
  const c = aberta.contato!
  const [notas, setNotas] = useState(c.notas ?? '')
  const [salvo, setSalvo] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [enviando, setEnviando] = useState(false)

  return (
    <aside className="absolute inset-0 z-20 flex flex-col overflow-y-auto bg-white md:static md:w-[300px] md:shrink-0 md:border-l md:border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Detalhes</h3>
        <button onClick={fechar} className="text-slate-400 hover:text-slate-700" aria-label="Fechar">✕</button>
      </div>
      <div className="space-y-4 p-4 text-sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-slate-500">País</dt><dd>{bandeira(c.pais)} {c.pais ?? '—'} · {c.idioma ?? '—'}</dd>
          <dt className="text-slate-500">Origem</dt><dd>{c.origem === 'anuncio' ? 'Anúncio' : 'Orgânico'}</dd>
          <dt className="text-slate-500">Etapa</dt><dd>{c.etapa ?? '—'}</dd>
        </dl>
        <div>
          <p className="text-xs font-semibold text-slate-700">Notas internas</p>
          <textarea value={notas} onChange={e => { setNotas(e.target.value); setSalvo(false) }} rows={4}
            className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm focus:border-emerald-500 focus:outline-none" placeholder="Só você vê." />
          {!salvo && <button onClick={async () => { const r = await salvarNotasChat(c.id, notas); if (r.error) setErro(r.error); else setSalvo(true) }}
            className="mt-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">Salvar notas</button>}
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-700">Pedidos</p>
          {aberta.pedidos.length === 0 ? <p className="mt-1 text-xs text-slate-500">Nenhum pedido ainda (a Ana cria na Fase 3).</p> : aberta.pedidos.map(p => (
            <div key={p.id} className="mt-2 rounded-lg border border-slate-200 p-2.5">
              <p className="text-xs"><strong>{STATUS_PEDIDO[p.status] ?? p.status}</strong> · {p.tema_slug ?? '—'} · {p.pacote_qtd ?? '?'} fotos{p.valor_cents ? ` · R$ ${(p.valor_cents / 100).toFixed(2).replace('.', ',')}` : ''}</p>
              {p.poses.length > 0 && <p className="text-[11px] text-slate-500">Poses: {p.poses.join(', ')}</p>}
              {p.entregas.length > 0 && (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    {p.entregas.map(e => (
                      <label key={e.id} className={`relative cursor-pointer overflow-hidden rounded ${sel.has(e.id) ? 'ring-2 ring-emerald-500' : ''}`}>
                        <input type="checkbox" className="absolute left-1 top-1" checked={sel.has(e.id)}
                          onChange={() => setSel(s => { const n = new Set(s); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n })} />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {e.url ? <img src={e.url} alt={e.pose_numero} className="aspect-[4/5] w-full object-cover" /> : <div className="aspect-[4/5] bg-slate-100" />}
                        <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[10px] text-white">{e.pose_numero}{e.status === 'enviada' ? ' ✓' : ''}</span>
                      </label>
                    ))}
                  </div>
                  <button disabled={sel.size === 0 || enviando}
                    onClick={async () => { setEnviando(true); const r = await enviarFotosDoPedidoChat(c.id, [...sel]); setEnviando(false); if (r.error) setErro(r.error); setSel(new Set()); await recarregar() }}
                    className="mt-2 w-full rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                    {enviando ? 'Enviando…' : `Enviar ${sel.size || ''} foto(s) do pedido`}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
