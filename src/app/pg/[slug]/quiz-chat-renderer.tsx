'use client'
// ============================================================================
// Quiz v2 — MODO CONVERSA: o mesmo quiz do editor, apresentado como um chat
// (uma pergunta por vez, balões, "digitando…", respostas por botão ou pelo
// campo de digitar). Lógica (pontuação, ramificação, lead, integrações,
// resultado) vem do motor puro — igual ao renderer de páginas.
// ============================================================================
import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { QuizData, QuizBlock, QuizPage } from '@/app/actions/quiz-v2'
import { resolveTheme } from '@/lib/quiz/theme'
import { capturarOrigem } from '@/lib/tracking/params'
import { linkWhatsAppDoBotao } from '@/lib/quiz/portal'
import { gradientePrimario, sombraColorida, comAlpha, textoContraste } from '@/lib/quiz/cores'
import {
  passosDaPagina, proximaPagina, calcularPontuacao, validarBloco, contatoDaPagina, personalizar, textoDaResposta,
  tempoDigitando, campoDaEntrada, BLOCOS_DE_ESCOLHA, type Passo, type Fala, type Respostas, type Lead,
} from '@/lib/quiz/motor'
import { useQuizTracker, dispararIntegracoes } from '@/components/quiz/use-quiz-tracker'

interface Props { data: QuizData; pageId: string; tenantId: string }

type Msg = { id: number; de: 'bot' | 'user'; fala: Fala; ts: number }
type Captura = { name: string; email: string; phone: string }

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms))
const fmtHora = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

export default function QuizChatRenderer({ data, pageId, tenantId }: Props) {
  const pages = data.pages
  const theme = resolveTheme(data.settings.theme)
  const primary = data.settings.primary_color || theme.accent
  const chat = data.settings.chat ?? {}
  const nome = chat.nome?.trim() || 'Atendimento'
  const velocidade = chat.velocidade ?? 'normal'
  const textoContinuar = chat.texto_continuar?.trim() || 'Continuar'
  const mostrarHora = chat.mostrar_horario !== false

  const [msgs, setMsgs] = useState<Msg[]>([])
  const [digitando, setDigitando] = useState(false)
  const [pageIdx, setPageIdx] = useState(0)
  const [passoIdx, setPassoIdx] = useState(0)
  const [pronto, setPronto] = useState(false)          // falas do passo já saíram → mostra a entrada
  const [answers, setAnswers] = useState<Respostas>({})
  const [lead, setLead] = useState<Lead>({})
  const [score, setScore] = useState(0)
  const [fase, setFase] = useState<'conversando' | 'enviando' | 'fim'>('conversando')
  const [resultado, setResultado] = useState<QuizBlock | null>(null)
  const [texto, setTexto] = useState('')
  const [multi, setMulti] = useState<string[]>([])
  const [cap, setCap] = useState<Captura>({ name: '', email: '', phone: '' })
  const [erro, setErro] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const vivo = useRef(true)
  const tracker = useQuizTracker(pageId)

  const page: QuizPage | undefined = pages[pageIdx]
  const passos = useMemo(() => (page ? passosDaPagina(page, textoContinuar) : []), [page, textoContinuar])
  const passo: Passo | undefined = passos[passoIdx]
  const totalPaginas = pages.length
  const progresso = Math.round(((pageIdx + 1) / Math.max(1, totalPaginas)) * 100)

  const pers = (t: string) => personalizar(t, pages, answers, lead, score)
  const push = (de: Msg['de'], fala: Fala) => setMsgs(m => [...m, { id: ++seq.current, de, fala, ts: Date.now() }])

  useEffect(() => { vivo.current = true; tracker.start(); return () => { vivo.current = false } }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [msgs, digitando, pronto, fase])
  useEffect(() => { if (pronto && passo?.entrada && inputRef.current) inputRef.current.focus() }, [pronto, passo])

  // Falas do passo atual saem uma a uma, com "digitando…" entre elas.
  useEffect(() => {
    if (!page || fase !== 'conversando') return
    let cancelado = false
    const falar = async () => {
      // Página sem passos (só o resultado): fecha direto.
      if (!passo) { await dormir(50); if (!cancelado && vivo.current) fecharPagina(answers); return }
      if (passoIdx === 0) tracker.track('page_viewed', page.id, null, {})
      const falas: Fala[] = [...passo.falas]
      if (pageIdx === 0 && passoIdx === 0 && chat.saudacao?.trim()) falas.unshift({ t: 'texto', texto: chat.saudacao.trim() })
      for (const f of falas) {
        setDigitando(true)
        await dormir(tempoDigitando(f, velocidade))
        setDigitando(false)
        if (cancelado || !vivo.current) return
        push('bot', f.t === 'texto' ? { t: 'texto', texto: pers(f.texto) } : f)
        await dormir(180)
      }
      if (cancelado) return
      setPronto(true)
      if (passo.esperaSeg) { await dormir(passo.esperaSeg * 1000); if (!cancelado && vivo.current) avancarPasso() }
      // Passo "automático" (conteúdo antes do resultado): segue sozinho.
      else if (!passo.entrada && !passo.botao) { await dormir(400); if (!cancelado && vivo.current) avancarPasso() }
    }
    void falar()
    return () => { cancelado = true }
  }, [pageIdx, passoIdx, fase])   // eslint-disable-line react-hooks/exhaustive-deps

  /** Próximo passo da página ou fecha a página (lead, pontuação, ramificação). */
  function avancarPasso(novasRespostas: Respostas = answers, capturaFinal?: Captura) {
    if (passoIdx + 1 < passos.length) { setPassoIdx(i => i + 1); return }
    fecharPagina(novasRespostas, capturaFinal)
  }

  function fecharPagina(ans: Respostas, captura?: Captura) {
    if (!page) return
    const pontos = calcularPontuacao(pages, ans)
    const novoLead = contatoDaPagina(page, ans, lead, captura)
    for (const b of page.blocks) {
      if (b.type === 'field_text' && ans[b.id] && !lead.name) tracker.trackContact(String(ans[b.id]), undefined, undefined)
      if (b.type === 'field_email' && ans[b.id]) tracker.trackContact(undefined, String(ans[b.id]), undefined)
      if (b.type === 'field_phone' && ans[b.id]) tracker.trackContact(undefined, undefined, String(ans[b.id]))
      if (b.type === 'final_capture' && captura) {
        tracker.trackContact(captura.name || undefined, captura.email || undefined, captura.phone || undefined)
        tracker.track('form_submitted', page.id, b.id, captura)
        dispararIntegracoes(pageId, tracker.getLeadId(), b.id, b.config, { answers: ans, score: pontos, name: novoLead.name, email: novoLead.email, phone: novoLead.phone })
      }
    }
    setLead(novoLead); setScore(pontos)
    const prox = proximaPagina(pages, pageIdx, ans, pontos)
    if (prox.tipo === 'resultado') { void mostrarResultado(prox.bloco, pontos, novoLead, ans); return }
    if (prox.tipo === 'fim') {
      tracker.track('quiz_completed', page.id, null, { score: pontos }); tracker.trackComplete(pontos, null)
      setFase('fim'); return
    }
    setPassoIdx(0); setPageIdx(prox.idx)
  }

  async function mostrarResultado(rb: QuizBlock, pontos: number, ld: Lead, ans: Respostas) {
    setResultado(rb); setFase('enviando')
    tracker.track('quiz_completed', page?.id ?? '', null, { score: pontos, result: rb.config.title })
    tracker.trackComplete(pontos, rb.config.title ?? null)
    const falas: string[] = []
    if (rb.config.title) falas.push(rb.config.title)
    if (rb.config.show_score) falas.push((rb.config.score_display_text || 'Você fez {{score}} pontos!').replace(/\{\{score\}\}/g, String(pontos)))
    if (rb.config.description) falas.push(rb.config.description.replace(/\{\{score\}\}/g, String(pontos)))
    for (const t of falas) {
      setDigitando(true); await dormir(tempoDigitando({ t: 'texto', texto: t }, velocidade)); if (!vivo.current) return
      setDigitando(false); push('bot', { t: 'texto', texto: personalizar(t, pages, ans, ld, pontos) }); await dormir(180)
    }
    try {
      await fetch(`/api/quiz/${pageId}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: ans, leadData: ld, result_profile: rb.config.title ?? null, funnel_id: rb.config.funnel_id ?? null, tenantId, tracking: capturarOrigem() }),
      })
    } catch { /* segue */ }
    setFase('fim')
    const cta = rb.config.cta_url
    if (cta && !rb.config.cta_text) setTimeout(() => { window.location.href = cta }, 1500)
  }

  /** A pessoa respondeu o bloco de entrada do passo. */
  function responder(valor: unknown, captura?: Captura) {
    const b = passo?.entrada
    if (!b || !page) return
    const e = validarBloco(b, valor, captura)
    if (e) { setErro(e); return }
    setErro(null)
    const txt = textoDaResposta(b, valor, captura)
    if (txt) push('user', { t: 'texto', texto: txt })
    const novas = { ...answers, [b.id]: b.type === 'final_capture' ? captura : valor }
    setAnswers(novas)
    tracker.track(BLOCOS_DE_ESCOLHA.has(b.type) || b.type === 'multi_choice' ? 'choice_selected' : 'field_filled', page.id, b.id, { selected: valor })
    setTexto(''); setMulti([])
    setPronto(false)
    setTimeout(() => avancarPasso(novas, captura), 250)
  }

  function clicarBotao() {
    const bt = passo?.botao
    if (!bt || !page) return
    if (bt.bloco) tracker.track('button_clicked', page.id, bt.bloco.id, { text: bt.texto, url: bt.url })
    if (bt.bloco?.type === 'button') dispararIntegracoes(pageId, tracker.getLeadId(), bt.bloco.id, bt.bloco.config, { answers, score, ...lead })
    push('user', { t: 'texto', texto: bt.texto })
    setPronto(false)
    setTimeout(() => avancarPasso(), 250)
  }

  const botaoWhats = passo?.botao?.bloco?.type === 'button' && passo.botao.bloco.config.button_action === 'whatsapp'
    ? linkWhatsAppDoBotao(passo.botao.bloco.config.button_whatsapp, pers(passo.botao.bloco.config.button_whatsapp_msg ?? '')) : null

  const btnStyle = { background: gradientePrimario(primary), color: textoContraste(primary), boxShadow: sombraColorida(primary), borderRadius: theme.buttonRadius === '9999px' ? '9999px' : '14px' }
  const chipStyle = (ativo: boolean) => ({
    background: ativo ? gradientePrimario(primary) : theme.surfaceBg, color: ativo ? textoContraste(primary) : theme.textColor,
    border: ativo ? '1px solid transparent' : theme.surfaceBorder, boxShadow: ativo ? sombraColorida(primary) : theme.cardShadow,
  })
  const inputBg = theme.isDark ? 'rgba(255,255,255,0.08)' : '#ffffff'
  const entrada = pronto && fase === 'conversando' ? passo?.entrada ?? null : null
  const campo = entrada && !BLOCOS_DE_ESCOLHA.has(entrada.type) && !['multi_choice', 'scale', 'final_capture', 'video_answer'].includes(entrada.type) ? campoDaEntrada(entrada) : null
  const escolhas = entrada && (BLOCOS_DE_ESCOLHA.has(entrada.type) || entrada.type === 'video_answer') ? (entrada.config.options ?? []) : []
  const escalas = entrada?.type === 'scale' ? Array.from({ length: (entrada.config.scale_max ?? 10) - (entrada.config.scale_min ?? 1) + 1 }, (_, i) => (entrada.config.scale_min ?? 1) + i) : []

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center overflow-x-hidden"
      style={{ background: theme.background, backgroundImage: theme.backgroundImage ? `url(${theme.backgroundImage})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', fontFamily: theme.fontFamily }}>
      {theme.fontUrl && <link rel="stylesheet" href={theme.fontUrl} />}
      <style>{`@keyframes bolha { from { opacity:0; transform:translateY(10px) scale(.98); } to { opacity:1; transform:none; } }`}</style>
      <div className="w-full max-w-lg flex flex-col h-[100dvh]" style={{ background: theme.chatBg ?? (theme.isDark ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.6)') }}>
        {/* Cabeçalho: avatar · nome · status · progresso */}
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: theme.cardBorder, background: theme.headerBg }}>
          {chat.avatar_url
            ? <img src={chat.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />   // eslint-disable-line @next/next/no-img-element
            : data.settings.logo_url
              ? <img src={data.settings.logo_url} alt="" className="w-10 h-10 rounded-full object-cover bg-white" />   // eslint-disable-line @next/next/no-img-element
              : <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold" style={{ background: comAlpha(primary, 0.25), color: theme.headerText }}>{nome.charAt(0).toUpperCase()}</div>}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm truncate" style={{ color: theme.headerText }}>{nome}</p>
            <p className="text-xs flex items-center gap-1" style={{ color: theme.headerText, opacity: 0.8 }}>
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> {digitando ? 'digitando…' : (chat.status?.trim() || 'online')}
            </p>
          </div>
          {data.settings.show_progress !== false && totalPaginas > 1 && fase === 'conversando' && (
            <span className="rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums" style={{ background: comAlpha(primary, theme.isDark ? 0.3 : 0.14), color: theme.headerText }}>{pageIdx + 1}/{totalPaginas}</span>
          )}
        </div>
        {data.settings.show_progress !== false && totalPaginas > 1 && (
          <div className="h-1 w-full" style={{ background: comAlpha(primary, 0.15) }}><div className="h-full transition-all duration-700" style={{ width: `${fase === 'conversando' ? progresso : 100}%`, background: gradientePrimario(data.settings.progress_color || primary) }} /></div>
        )}

        {/* Mensagens */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-4 flex flex-col gap-2">
          {msgs.map(m => <Balao key={m.id} m={m} theme={theme} primary={primary} hora={mostrarHora} />)}
          {digitando && <Digitando theme={theme} />}
          {entrada?.type === 'final_capture' && (
            <div className="self-stretch mt-2 p-4 rounded-2xl border" style={{ background: theme.cardBg, borderColor: theme.cardBorder, animation: 'bolha 250ms ease-out' }}>
              <div className="flex flex-col gap-2">
                {entrada.config.show_name !== false && <input value={cap.name} onChange={e => setCap({ ...cap, name: e.target.value })} placeholder="Seu nome" className="px-3 py-2.5 rounded-lg border outline-none w-full" style={{ background: inputBg, color: theme.textColor, borderColor: theme.cardBorder, fontSize: 16 }} />}
                {entrada.config.show_email && <input type="email" inputMode="email" value={cap.email} onChange={e => setCap({ ...cap, email: e.target.value })} placeholder="Seu e-mail" className="px-3 py-2.5 rounded-lg border outline-none w-full" style={{ background: inputBg, color: theme.textColor, borderColor: theme.cardBorder, fontSize: 16 }} />}
                {entrada.config.show_phone && <input type="tel" inputMode="tel" value={cap.phone} onChange={e => setCap({ ...cap, phone: e.target.value })} placeholder="Seu WhatsApp (com DDD)" className="px-3 py-2.5 rounded-lg border outline-none w-full" style={{ background: inputBg, color: theme.textColor, borderColor: theme.cardBorder, fontSize: 16 }} />}
                {erro && <p className="text-xs text-red-500">{erro}</p>}
                <button onClick={() => responder(cap, cap)} className="mt-1 px-4 py-3 font-semibold text-sm" style={btnStyle}>{entrada.config.submit_text || 'Enviar'}</button>
              </div>
            </div>
          )}
          {fase === 'fim' && resultado?.config.cta_text && (
            <a href={resultado.config.cta_url || '#'} target={resultado.config.cta_url ? '_blank' : undefined} rel="noopener noreferrer"
              className="self-start mt-1 px-5 py-3 font-semibold text-sm inline-flex items-center gap-2" style={{ ...btnStyle, animation: 'bolha 250ms ease-out' }}>
              {resultado.config.cta_text} <span aria-hidden>→</span>
            </a>
          )}
          {fase === 'fim' && !resultado && (
            <div className="self-start mt-1 px-4 py-2 rounded-full text-sm font-medium" style={{ background: comAlpha(primary, 0.12), color: theme.isDark ? '#fff' : primary }}>✓ Tudo certo! Aguarde o contato.</div>
          )}
        </div>

        {/* Área de resposta: botões de escolha / escala / múltipla / seguir */}
        {escolhas.length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-2" style={{ animation: 'bolha 250ms ease-out' }}>
            {escolhas.map(o => (
              <button key={o.id} onClick={() => responder(o.label)} className="px-4 py-2.5 rounded-full text-sm font-medium flex items-center gap-2" style={chipStyle(false)}>
                {o.image_url && <img src={o.image_url} alt="" className="w-7 h-7 rounded-full object-cover" /> /* eslint-disable-line @next/next/no-img-element */}
                {o.emoji && <span>{o.emoji}</span>}{o.label}
              </button>
            ))}
          </div>
        )}
        {entrada?.type === 'multi_choice' && (
          <div className="px-4 pb-2" style={{ animation: 'bolha 250ms ease-out' }}>
            <div className="flex flex-wrap gap-2">
              {(entrada.config.options ?? []).map(o => { const on = multi.includes(o.label); return (
                <button key={o.id} onClick={() => setMulti(m => on ? m.filter(x => x !== o.label) : [...m, o.label])} className="px-4 py-2.5 rounded-full text-sm font-medium" style={chipStyle(on)}>{on ? '✓ ' : ''}{o.emoji ? `${o.emoji} ` : ''}{o.label}</button>
              ) })}
            </div>
            {erro && <p className="mt-1 text-xs text-red-500">{erro}</p>}
            <button onClick={() => responder(multi)} disabled={!multi.length} className="mt-2 w-full px-4 py-3 font-semibold text-sm disabled:opacity-50" style={btnStyle}>{entrada.config.next_button_text || 'Confirmar'}</button>
          </div>
        )}
        {escalas.length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-2" style={{ animation: 'bolha 250ms ease-out' }}>
            {escalas.map(n => <button key={n} onClick={() => responder(n)} className="w-11 h-11 rounded-full text-sm font-bold" style={chipStyle(false)}>{n}</button>)}
          </div>
        )}
        {pronto && fase === 'conversando' && passo?.botao && !entrada && !passo.esperaSeg && (
          <div className="px-4 pb-2" style={{ animation: 'bolha 250ms ease-out' }}>
            {passo.botao.url || botaoWhats
              ? <a href={botaoWhats ?? passo.botao.url} target="_blank" rel="noopener noreferrer" onClick={clicarBotao} className="inline-flex items-center gap-2 px-5 py-3 font-semibold text-sm" style={btnStyle}>{passo.botao.texto} →</a>
              : <button onClick={clicarBotao} className="inline-flex items-center gap-2 px-5 py-3 font-semibold text-sm" style={btnStyle}>{passo.botao.texto} →</button>}
          </div>
        )}

        {/* Campo de digitar (texto, e-mail, telefone, número, data…) */}
        {campo && entrada && (
          <div className="px-3 py-3 border-t flex flex-col gap-1" style={{ borderColor: theme.cardBorder, background: theme.cardBg, paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
            {erro && <p className="px-2 text-xs text-red-500">{erro}</p>}
            <div className="flex gap-2">
              {entrada.type === 'field_textarea'
                ? <textarea value={texto} onChange={e => setTexto(e.target.value)} placeholder={campo.placeholder} rows={2} className="flex-1 min-w-0 px-4 py-2.5 rounded-2xl outline-none border resize-none" style={{ background: inputBg, color: theme.textColor, borderColor: theme.cardBorder, fontSize: 16 }} />
                : <input ref={inputRef} type={campo.tipo} inputMode={campo.inputMode as React.HTMLAttributes<HTMLInputElement>['inputMode']} value={texto} onChange={e => setTexto(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') responder(entrada.type === 'field_number' || entrada.type === 'field_height' || entrada.type === 'field_weight' ? Number(texto) || texto : texto) }}
                    placeholder={campo.placeholder} className="flex-1 min-w-0 px-4 py-3 rounded-full outline-none border" style={{ background: inputBg, color: theme.textColor, borderColor: theme.cardBorder, fontSize: 16 }} />}
              <button onClick={() => responder(entrada.type === 'field_number' || entrada.type === 'field_height' || entrada.type === 'field_weight' ? Number(texto) || texto : texto)} aria-label="Enviar"
                className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: gradientePrimario(primary), color: textoContraste(primary) }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-5 w-5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Balao({ m, theme, primary, hora }: { m: Msg; theme: ReturnType<typeof resolveTheme>; primary: string; hora: boolean }) {
  const user = m.de === 'user'
  const base: React.CSSProperties = {
    background: user ? theme.userBubbleBg : theme.cardBg, color: user ? theme.userBubbleText : theme.textColor,
    borderRadius: user ? '18px 18px 4px 18px' : '18px 18px 18px 4px', border: user ? 'none' : `1px solid ${theme.cardBorder}`,
    overflowWrap: 'anywhere', wordBreak: 'break-word', animation: 'bolha 250ms ease-out',
  }
  const cls = `max-w-[82%] ${user ? 'self-end' : 'self-start'}`
  const f = m.fala
  if (f.t === 'imagem') return <div className={cls} style={{ ...base, padding: 4, overflow: 'hidden' }}><img src={f.url} alt="" className="block max-w-full rounded-[14px]" /></div>   // eslint-disable-line @next/next/no-img-element
  if (f.t === 'video') return <div className={`${cls} w-full`} style={{ ...base, padding: 4, overflow: 'hidden' }}><Video url={f.url} /></div>
  if (f.t === 'audio') return <div className={cls} style={{ ...base, padding: '8px 12px' }}>{f.titulo && <p className="text-xs mb-1 opacity-70">{f.titulo}</p>}<audio controls src={f.url} className="max-w-full" /></div>
  if (f.t === 'cartao') return <div className={`${cls} w-full`} style={{ ...base, padding: '12px 14px' }}><Cartao bloco={f.bloco} theme={theme} primary={primary} /></div>
  const partes = f.texto.split(/(https?:\/\/[^\s]+)/g)
  return (
    <div className={`${cls} px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap`} style={base}>
      {partes.map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline font-medium break-all" style={{ color: user ? theme.userBubbleText : primary }}>{p}</a> : <React.Fragment key={i}>{p}</React.Fragment>)}
      {hora && <span className="block text-right text-[10px] mt-0.5 select-none" style={{ opacity: 0.55 }}>{fmtHora(m.ts)}</span>}
    </div>
  )
}

function Video({ url }: { url: string }) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/)
  if (yt) return <iframe src={`https://www.youtube.com/embed/${yt[1]}`} className="w-full aspect-video rounded-[14px]" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="vídeo" />
  const vm = url.match(/vimeo\.com\/(\d+)/)
  if (vm) return <iframe src={`https://player.vimeo.com/video/${vm[1]}`} className="w-full aspect-video rounded-[14px]" allow="autoplay; fullscreen" allowFullScreen title="vídeo" />
  return <video src={url} controls playsInline className="w-full rounded-[14px]" />
}

/** Blocos ricos (benefícios, depoimentos, FAQ, preço, checklist…) em versão compacta dentro do balão. */
function Cartao({ bloco, theme, primary }: { bloco: QuizBlock; theme: ReturnType<typeof resolveTheme>; primary: string }) {
  const c = bloco.config
  const titulo = (t?: string) => t ? <p className="font-semibold mb-2" style={{ color: theme.textColor }}>{t}</p> : null
  switch (bloco.type) {
    case 'features': return <div>{titulo(c.features_title)}<ul className="space-y-1.5">{(c.features ?? []).map(f => <li key={f.id} className="text-sm"><span className="mr-1">{f.icon ?? '✅'}</span><strong>{f.title}</strong>{f.description ? <span style={{ color: theme.mutedColor }}> — {f.description}</span> : null}</li>)}</ul></div>
    case 'checklist': return <div>{titulo(c.checklist_title)}<ul className="space-y-1">{(c.checklist_items ?? []).map(i => <li key={i.id} className="text-sm">✅ {i.text}</li>)}</ul></div>
    case 'testimonials': return <div>{titulo(c.testimonials_title)}<div className="space-y-2">{(c.testimonials ?? []).map(t => <div key={t.id} className="text-sm rounded-xl p-2.5" style={{ background: comAlpha(primary, 0.08) }}><p className="italic">“{t.text}”</p><p className="mt-1 text-xs font-semibold" style={{ color: theme.mutedColor }}>— {t.name}{t.stars ? ` · ${'★'.repeat(Math.max(1, Math.min(5, t.stars)))}` : ''}</p></div>)}</div></div>
    case 'faq': return <div>{titulo(c.faq_title)}<div className="space-y-2">{(c.faq_items ?? []).map(q => <div key={q.id} className="text-sm"><p className="font-semibold">{q.question}</p><p style={{ color: theme.mutedColor }}>{q.answer}</p></div>)}</div></div>
    case 'pricing': return <div>{titulo(c.pricing_title)}<p className="text-2xl font-extrabold" style={{ color: primary }}>{c.pricing_price}{c.pricing_period ? <span className="text-sm font-medium" style={{ color: theme.mutedColor }}>/{c.pricing_period}</span> : null}</p><ul className="mt-2 space-y-1">{(c.pricing_items ?? []).map(i => <li key={i.id} className="text-sm">{i.included === false ? '✗' : '✓'} {i.text}</li>)}</ul>{c.pricing_cta_text && c.pricing_cta_url && <a href={c.pricing_cta_url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block px-4 py-2 rounded-full text-sm font-semibold" style={{ background: gradientePrimario(primary), color: textoContraste(primary) }}>{c.pricing_cta_text}</a>}</div>
    case 'metrics': return <div className="grid grid-cols-2 gap-2">{(c.metrics_items ?? []).map(m => <div key={m.id} className="text-center rounded-xl p-2" style={{ background: comAlpha(primary, 0.08) }}><p className="text-xl font-extrabold" style={{ color: primary }}>{m.value}{m.suffix}</p><p className="text-xs" style={{ color: theme.mutedColor }}>{m.label}</p></div>)}</div>
    case 'level': return <div><p className="text-sm font-semibold mb-1">{c.level_label}</p><div className="h-2.5 rounded-full" style={{ background: comAlpha(primary, 0.15) }}><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, c.level_percent ?? 50))}%`, background: c.level_color || primary }} /></div></div>
    case 'before_after': return <div className="grid grid-cols-2 gap-2">{[[c.before_image_url, c.before_label ?? 'Antes'], [c.after_image_url, c.after_label ?? 'Depois']].map(([u, l], i) => <div key={i} className="text-center">{u && <img src={u} alt="" className="w-full rounded-xl object-cover aspect-[4/5]" /> /* eslint-disable-line @next/next/no-img-element */}<p className="text-xs mt-1 font-semibold" style={{ color: theme.mutedColor }}>{l}</p></div>)}</div>
    case 'carousel': return <div className="flex gap-2 overflow-x-auto">{(c.carousel_items ?? []).map(i => <figure key={i.id} className="shrink-0 w-40"><img src={i.image_url} alt="" className="w-40 h-40 rounded-xl object-cover" /> {/* eslint-disable-line @next/next/no-img-element */}{i.caption && <figcaption className="text-xs mt-1" style={{ color: theme.mutedColor }}>{i.caption}</figcaption>}</figure>)}</div>
    case 'chart': return <div>{titulo(c.chart_title)}<div className="space-y-1.5">{(c.chart_data ?? []).map(d => { const max = Math.max(1, ...(c.chart_data ?? []).map(x => x.value)); return <div key={d.id} className="text-xs"><div className="flex justify-between"><span>{d.label}</span><span style={{ color: theme.mutedColor }}>{d.value}</span></div><div className="h-2 rounded-full mt-0.5" style={{ background: comAlpha(primary, 0.12) }}><div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: d.color || primary }} /></div></div> })}</div></div>
    case 'countdown': return <p className="text-sm font-semibold" style={{ color: primary }}>⏳ {c.countdown_text || 'Oferta por tempo limitado'}</p>
    case 'html_embed': return <div className="text-sm" dangerouslySetInnerHTML={{ __html: (c.html_content ?? '').replace(/<script[\s\S]*?<\/script>/gi, '') }} />
    default: return null
  }
}

function Digitando({ theme }: { theme: ReturnType<typeof resolveTheme> }) {
  return (
    <div className="self-start px-4 py-3 flex items-center gap-1" style={{ background: theme.cardBg, borderRadius: '18px 18px 18px 4px', border: `1px solid ${theme.cardBorder}` }}>
      {[0, 150, 300].map(d => <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: theme.mutedColor, animationDelay: `${d}ms` }} />)}
    </div>
  )
}
