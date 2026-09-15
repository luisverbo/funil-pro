'use client'

// ============================================================================
// Landing do Quiz — cliente
// ----------------------------------------------------------------------------
// Uma página de venda de verdade: promessa clara no topo, demonstração VIVA do
// produto (o celular à direita roda um quiz sozinho), prova de capacidade,
// comparação honesta, preço único e FAQ. Só o que é público chega aqui.
// ============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Cta = { tipo: 'checkout'; action: string } | { tipo: 'cadastro'; href: string }
type Preco = { inteiro: string; centavos: string | null } | null

interface Props {
  cta: Cta
  preco: Preco
  aviso: string | null
}

// ── Demo que roda sozinha no celular do hero ────────────────────────────────

const DEMO = [
  {
    pergunta: 'Qual é o seu maior desafio hoje?',
    opcoes: ['Gerar leads todo dia', 'Qualificar quem chega', 'Fechar mais vendas'],
    escolha: 1,
  },
  {
    pergunta: 'Quanto você investe em anúncios por mês?',
    opcoes: ['Até R$ 1 mil', 'R$ 1 mil a R$ 5 mil', 'Acima de R$ 5 mil'],
    escolha: 2,
  },
  {
    pergunta: 'Quando quer começar?',
    opcoes: ['Esta semana', 'Este mês', 'Só pesquisando'],
    escolha: 0,
  },
]

function PhoneDemo() {
  const [passo, setPasso] = useState(0)          // 0..2 perguntas, 3 = resultado
  const [marcada, setMarcada] = useState(false)

  useEffect(() => {
    let vivo = true
    let t1: ReturnType<typeof setTimeout> | undefined
    let t2: ReturnType<typeof setTimeout> | undefined
    function ciclo() {
      if (!vivo) return
      t1 = setTimeout(() => {
        if (!vivo) return
        setMarcada(true)
        t2 = setTimeout(() => {
          if (!vivo) return
          setMarcada(false)
          setPasso(p => (p + 1) % (DEMO.length + 1))
          ciclo()
        }, 900)
      }, passo === DEMO.length ? 2600 : 1500)
    }
    ciclo()
    return () => { vivo = false; if (t1) clearTimeout(t1); if (t2) clearTimeout(t2) }
  }, [passo])

  const total = DEMO.length
  const resultado = passo === total
  const q = DEMO[Math.min(passo, total - 1)]
  const progresso = resultado ? 100 : ((passo + (marcada ? 1 : 0)) / total) * 100

  return (
    <div className="relative mx-auto w-[300px] sm:w-[320px]" style={{ perspective: 1200 }}>
      <div
        className="relative rounded-[42px] p-[10px]"
        style={{
          background: 'linear-gradient(160deg,#2a2a35,#0b0b12)',
          boxShadow: '0 40px 80px -20px rgba(99,102,241,0.45), 0 0 0 1px rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.04)',
          animation: 'floatPhone 7s ease-in-out infinite',
        }}
      >
        <div className="absolute left-1/2 top-[14px] z-10 h-[22px] w-[110px] -translate-x-1/2 rounded-full bg-black" />
        <div className="relative overflow-hidden rounded-[34px] bg-[#0f0f1a]" style={{ height: 620 }}>
          {/* orbes */}
          <div className="pointer-events-none absolute -left-16 -top-10 h-56 w-56 rounded-full opacity-60 blur-3xl" style={{ background: '#6366f1' }} />
          <div className="pointer-events-none absolute -bottom-20 -right-16 h-64 w-64 rounded-full opacity-40 blur-3xl" style={{ background: '#ec4899' }} />

          <div className="relative flex h-full flex-col px-5 pb-6 pt-12 text-white">
            {/* header */}
            <div className="mb-4 flex items-center justify-between text-[11px] text-white/60">
              <span>← Voltar</span>
              <span className="font-semibold text-white/80">{resultado ? 'Resultado' : `${passo + 1} / ${total}`}</span>
              <span className="w-10" />
            </div>
            <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progresso}%`, background: 'linear-gradient(90deg,#818cf8,#c084fc,#f472b6)' }} />
            </div>

            {!resultado ? (
              <div key={passo} className="flex-1" style={{ animation: 'fadeUp 420ms ease-out both' }}>
                <h3 className="mb-5 text-[19px] font-bold leading-snug tracking-tight">{q.pergunta}</h3>
                <div className="space-y-3">
                  {q.opcoes.map((o, i) => {
                    const sel = marcada && i === q.escolha
                    return (
                      <div
                        key={o}
                        className="flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-[14px] transition-all duration-300"
                        style={{
                          animation: `fadeUp 400ms ease-out ${i * 70}ms both`,
                          borderColor: sel ? 'rgba(167,139,250,0.9)' : 'rgba(255,255,255,0.10)',
                          background: sel ? 'rgba(129,140,248,0.22)' : 'rgba(255,255,255,0.04)',
                          transform: sel ? 'scale(1.02)' : 'scale(1)',
                          boxShadow: sel ? '0 0 0 4px rgba(129,140,248,0.18)' : 'none',
                        }}
                      >
                        <span
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-bold"
                          style={{ background: sel ? 'linear-gradient(135deg,#818cf8,#c084fc)' : 'rgba(255,255,255,0.08)' }}
                        >
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span className="flex-1">{o}</span>
                        {sel && <span className="text-violet-300" style={{ animation: 'popIn 260ms ease-out both' }}>✓</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div key="res" className="flex flex-1 flex-col items-center justify-center text-center" style={{ animation: 'fadeUp 420ms ease-out both' }}>
                <div className="relative mb-5 grid h-28 w-28 place-items-center">
                  <svg viewBox="0 0 120 120" className="absolute inset-0 h-full w-full -rotate-90">
                    <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
                    <circle cx="60" cy="60" r="52" fill="none" stroke="url(#gradRing)" strokeWidth="8" strokeLinecap="round" strokeDasharray="327" strokeDashoffset="327" style={{ animation: 'ringDraw 1.2s ease-out forwards' }} />
                    <defs>
                      <linearGradient id="gradRing" x1="0" x2="1">
                        <stop offset="0" stopColor="#818cf8" />
                        <stop offset="1" stopColor="#f472b6" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <span className="text-3xl">🔥</span>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-300">Lead quente</p>
                <h3 className="mt-2 text-[20px] font-bold leading-snug">Perfil: pronto para comprar</h3>
                <p className="mt-2 text-[13px] text-white/60">Investe acima de R$ 5 mil e quer começar esta semana.</p>
                <div className="mt-6 w-full rounded-2xl px-4 py-3.5 text-center text-[14px] font-semibold" style={{ background: 'linear-gradient(135deg,#25D366,#128C7E)', boxShadow: '0 14px 30px -10px rgba(37,211,102,0.6)' }}>
                  Falar no WhatsApp agora
                </div>
              </div>
            )}

            {!resultado && (
              <div className="mt-6 w-full rounded-2xl py-3.5 text-center text-[14px] font-semibold text-white" style={{ background: 'linear-gradient(135deg,#818cf8,#a855f7 55%,#ec4899)', boxShadow: '0 14px 30px -10px rgba(168,85,247,0.7)' }}>
                Continuar →
              </div>
            )}
          </div>
        </div>
      </div>

      {/* etiquetas flutuantes */}
      <div className="absolute -left-10 top-24 hidden rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-white/80 backdrop-blur-md sm:block" style={{ animation: 'floatTag 6s ease-in-out infinite' }}>
        <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-400" /> Pixel: <b>Lead</b> disparado
      </div>
      <div className="absolute -right-8 bottom-32 hidden rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-[12px] text-white/80 backdrop-blur-md sm:block" style={{ animation: 'floatTag 6s ease-in-out 1.5s infinite' }}>
        📲 Lead entregue no <b>WhatsApp</b>
      </div>
    </div>
  )
}

// ── Botão/formulário de compra ──────────────────────────────────────────────

function BotaoComprar({ cta, grande = false, comEmail = false }: { cta: Cta; grande?: boolean; comEmail?: boolean }) {
  const cls = `inline-flex items-center justify-center gap-2 rounded-2xl font-semibold text-white transition-transform hover:-translate-y-0.5 active:translate-y-0 ${grande ? 'px-7 py-4 text-[16px]' : 'px-5 py-3 text-[14px]'}`
  const estilo = { background: 'linear-gradient(135deg,#818cf8,#a855f7 55%,#ec4899)', boxShadow: '0 18px 40px -14px rgba(168,85,247,0.75)' }

  if (cta.tipo === 'cadastro') {
    return (
      <Link href={cta.href} className={cls} style={estilo}>
        Criar meu quiz agora <span aria-hidden>→</span>
      </Link>
    )
  }
  return (
    <form method="POST" action={cta.action} className={comEmail ? 'flex w-full max-w-md flex-col gap-3 sm:flex-row' : 'inline'}>
      {comEmail && (
        <input
          type="email"
          name="email"
          required
          placeholder="Seu melhor e-mail"
          className="w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3.5 text-[15px] text-white placeholder:text-white/40 outline-none backdrop-blur-md focus:border-violet-400 focus:ring-4 focus:ring-violet-500/20"
        />
      )}
      <button type="submit" className={cls} style={estilo}>
        {comEmail ? 'Quero o Quiz' : 'Assinar o Quiz'} <span aria-hidden>→</span>
      </button>
    </form>
  )
}

// ── Página ──────────────────────────────────────────────────────────────────

const RECURSOS = [
  { icone: '🎨', titulo: 'Design premium de fábrica', texto: 'Gradientes, fundo com profundidade, opções A/B/C em cascata, botões com sombra colorida. Seu quiz nasce bonito — sem designer.' },
  { icone: '🧠', titulo: 'Lógica por resposta', texto: 'Cada opção leva a um caminho. Pontuação, perfis de resultado e páginas diferentes para cada tipo de lead.' },
  { icone: '📈', titulo: 'Pixel por etapa', texto: 'Dispare Lead, CompleteRegistration ou evento custom em qualquer passo. Otimize o anúncio para quem chega ao final.' },
  { icone: '📲', titulo: 'Lead quente no WhatsApp', texto: 'Quem conclui cai direto no seu WhatsApp com nome, telefone e as respostas. Sem planilha, sem espera.' },
  { icone: '🗂️', titulo: 'Portal para o seu cliente', texto: 'Link + senha para o cliente ver os leads, marcar desfecho, medir CPL e conversão. Ideal para gestor de tráfego.' },
  { icone: '🧩', titulo: '30+ blocos prontos', texto: 'Perguntas, imagens 4:3, vídeo, depoimentos, contagem regressiva, preço, gráficos, prova social rotativa, HTML.' },
  { icone: '⏱️', titulo: 'Aparição temporizada', texto: 'Revele blocos após X segundos — o botão só aparece quando o lead já leu o que importa.' },
  { icone: '🔗', titulo: 'Seu domínio, seu link', texto: 'Publique com slug próprio, UTMs capturados na entrada, imagem de compartilhamento e SEO configurados.' },
]

const COMPARA: Array<{ item: string; nos: boolean | string; outros: boolean | string }> = [
  { item: 'Editor visual em canvas', nos: true, outros: true },
  { item: 'Temas premium com fundo decorado', nos: true, outros: 'Básico' },
  { item: 'Pixel por etapa (não só no final)', nos: true, outros: false },
  { item: 'Lead entregue no WhatsApp', nos: true, outros: 'Só integração' },
  { item: 'Portal do cliente com kanban e CPL', nos: true, outros: false },
  { item: 'Investimento por dia → CPL do lead quente', nos: true, outros: false },
  { item: 'Agente de IA para atender o lead (opcional)', nos: 'Upgrade', outros: false },
  { item: 'Suporte em português', nos: true, outros: true },
]

const PASSOS = [
  { n: '01', titulo: 'Monte em minutos', texto: 'Arraste perguntas, escolha um tema premium e defina o que cada resposta faz. Sem código.' },
  { n: '02', titulo: 'Publique e anuncie', texto: 'Cole o link no anúncio. UTMs e pixel já vão configurados por etapa.' },
  { n: '03', titulo: 'Receba o lead quente', texto: 'Quem chega ao fim aparece no WhatsApp e no portal — pronto para fechar.' },
]

const FAQ = [
  { p: 'Preciso saber programar?', r: 'Não. O editor é visual: você arrasta blocos, escreve as perguntas e escolhe o tema. Publicar é um clique.' },
  { p: 'O lead chega mesmo no WhatsApp?', r: 'Sim. Ao concluir, o lead pode ser levado ao seu WhatsApp com a mensagem pronta, e você também vê tudo no painel e no portal do cliente.' },
  { p: 'Funciona com Meta Ads?', r: 'Foi feito para isso. UTMs são capturados na entrada e o pixel dispara em qualquer etapa que você marcar — inclusive eventos custom.' },
  { p: 'Posso usar para clientes de tráfego?', r: 'Sim. Cada quiz pode ter um portal com link e senha para o cliente ver os leads, marcar desfecho e acompanhar CPL.' },
  { p: 'Tem fidelidade?', r: 'Não. É mensal, cancela quando quiser, direto no painel.' },
  { p: 'E se eu quiser funis, agente de IA e WhatsApp oficial depois?', r: 'É só fazer upgrade dentro da plataforma — seus quizzes e leads continuam intactos.' },
]

export default function QuizLanding({ cta, preco, aviso }: Props) {
  return (
    <div className="min-h-screen bg-[#07070d] text-white" style={{ fontFamily: 'var(--font-primary)' }}>
      <style>{`
        @keyframes floatPhone { 0%,100% { transform: translateY(0) rotateY(-6deg) rotateX(2deg) } 50% { transform: translateY(-14px) rotateY(-4deg) rotateX(1deg) } }
        @keyframes floatTag { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: translateY(0) } }
        @keyframes popIn { from { transform: scale(0.4); opacity: 0 } to { transform: scale(1); opacity: 1 } }
        @keyframes ringDraw { to { stroke-dashoffset: 0 } }
        @keyframes orb { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(30px,-20px) scale(1.08) } }
        @keyframes shimmer { 0% { background-position: 0% 50% } 100% { background-position: 200% 50% } }
        .gtext { background: linear-gradient(90deg,#c7d2fe,#e9d5ff,#fbcfe8,#c7d2fe); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shimmer 6s linear infinite; }
        .card { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
        .card:hover { background: rgba(255,255,255,0.06); border-color: rgba(167,139,250,0.35); }
        details > summary { list-style: none; cursor: pointer }
        details > summary::-webkit-details-marker { display: none }
        details[open] .chev { transform: rotate(45deg) }
        html { scroll-behavior: smooth }
      `}</style>

      {/* fundo */}
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-[520px] w-[520px] rounded-full opacity-30 blur-[120px]" style={{ background: '#6366f1', animation: 'orb 14s ease-in-out infinite' }} />
        <div className="absolute top-1/3 -right-40 h-[480px] w-[480px] rounded-full opacity-20 blur-[120px]" style={{ background: '#ec4899', animation: 'orb 18s ease-in-out 2s infinite' }} />
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '28px 28px', maskImage: 'radial-gradient(ellipse at top, black 20%, transparent 70%)' }} />
      </div>

      <div className="relative z-10">
        {/* NAV */}
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#07070d]/70 backdrop-blur-xl">
          <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
            <a href="#topo" className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl" style={{ background: 'linear-gradient(135deg,#818cf8,#ec4899)' }}>
                <svg viewBox="0 0 28 28" fill="none" width="18" height="18"><path d="M6 7h16l-6.2 7.44V19.5l-3.6-1.8V14.44L6 7z" fill="white" /></svg>
              </span>
              <span className="text-[15px] font-bold tracking-tight">FunilPro <span className="text-violet-300">Quiz</span></span>
            </a>
            <div className="hidden items-center gap-7 text-[13px] text-white/60 md:flex">
              <a href="#recursos" className="hover:text-white">Recursos</a>
              <a href="#como" className="hover:text-white">Como funciona</a>
              <a href="#compare" className="hover:text-white">Compare</a>
              <a href="#preco" className="hover:text-white">Preço</a>
              <a href="#faq" className="hover:text-white">Dúvidas</a>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/login" className="hidden text-[13px] text-white/60 hover:text-white sm:block">Entrar</Link>
              <BotaoComprar cta={cta} />
            </div>
          </nav>
        </header>

        {aviso && (
          <div className="mx-auto mt-4 max-w-6xl px-5">
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[14px] text-amber-200">{aviso}</div>
          </div>
        )}

        {/* HERO */}
        <section id="topo" className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-24 pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:pt-24">
          <div style={{ animation: 'fadeUp 600ms ease-out both' }}>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3.5 py-1.5 text-[12px] font-medium text-white/80">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Novo: temas Aurora, Midnight e Sunset
            </div>
            <h1 className="text-[40px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[56px] lg:text-[64px]">
              O quiz que transforma <span className="gtext">cliques em leads quentes</span> no seu WhatsApp
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-white/65 sm:text-[19px]">
              Faça perguntas, qualifique quem responde e receba só quem está pronto para comprar. Design premium, pixel por etapa e portal para o seu cliente — tudo em uma ferramenta.
            </p>
            <div className="mt-9">
              <BotaoComprar cta={cta} grande comEmail={cta.tipo === 'checkout'} />
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-white/50">
              <span>✓ Sem fidelidade</span>
              <span>✓ Publique em 10 minutos</span>
              <span>✓ Suporte em português</span>
            </div>
          </div>
          <div className="flex justify-center lg:justify-end" style={{ animation: 'fadeUp 700ms ease-out 150ms both' }}>
            <PhoneDemo />
          </div>
        </section>

        {/* FAIXA DE CAPACIDADES */}
        <section className="border-y border-white/[0.06] bg-white/[0.02]">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-10 text-center md:grid-cols-4">
            {[
              ['30+', 'blocos prontos'],
              ['8', 'temas premium'],
              ['1 clique', 'para publicar'],
              ['100%', 'em português'],
            ].map(([n, l]) => (
              <div key={l}>
                <div className="text-[30px] font-extrabold tracking-tight gtext">{n}</div>
                <div className="mt-1 text-[13px] text-white/55">{l}</div>
              </div>
            ))}
          </div>
        </section>

        {/* COMO FUNCIONA */}
        <section id="como" className="mx-auto max-w-6xl px-5 py-24">
          <div className="mb-14 max-w-2xl">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-violet-300">Como funciona</p>
            <h2 className="text-[34px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[42px]">Do anúncio ao lead quente em três passos</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {PASSOS.map(p => (
              <div key={p.n} className="card rounded-3xl p-7 transition-colors">
                <div className="mb-5 text-[13px] font-bold tracking-[0.2em] text-violet-300/80">{p.n}</div>
                <h3 className="text-[20px] font-bold tracking-tight">{p.titulo}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-white/60">{p.texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* RECURSOS */}
        <section id="recursos" className="mx-auto max-w-6xl px-5 pb-24">
          <div className="mb-14 max-w-2xl">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-violet-300">Recursos</p>
            <h2 className="text-[34px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[42px]">Tudo o que um quiz precisa para vender. Nada que atrapalhe.</h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {RECURSOS.map(r => (
              <div key={r.titulo} className="card rounded-3xl p-6 transition-colors">
                <div className="mb-4 grid h-11 w-11 place-items-center rounded-2xl text-xl" style={{ background: 'linear-gradient(135deg,rgba(129,140,248,0.25),rgba(236,72,153,0.25))' }}>{r.icone}</div>
                <h3 className="text-[16px] font-bold tracking-tight">{r.titulo}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-white/60">{r.texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* FLUXO */}
        <section className="mx-auto max-w-6xl px-5 pb-24">
          <div className="relative overflow-hidden rounded-[32px] border border-white/10 p-8 sm:p-12" style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.18),rgba(236,72,153,0.10))' }}>
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-violet-300">Para gestores de tráfego</p>
                <h2 className="text-[30px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[38px]">Mostre ao seu cliente o lead, o custo e a conversão — sem planilha</h2>
                <p className="mt-4 text-[16px] leading-relaxed text-white/65">
                  Cada quiz ganha um portal com link e senha. Seu cliente vê quem entrou, quem chegou ao fim, marca quem fechou e acompanha o custo por lead quente. Você aparece como quem entrega resultado.
                </p>
                <ul className="mt-6 space-y-2.5 text-[15px] text-white/75">
                  {['Kanban de leads com desfecho (novo → fechado)', 'Investimento por dia → CPL e CPL do lead quente', 'Botão de WhatsApp com mensagem pronta', 'Exporta CSV e PDF com um clique'].map(t => (
                    <li key={t} className="flex gap-3"><span className="text-emerald-400">✓</span>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="grid grid-cols-3 gap-3 text-[12px]">
                {[
                  ['Entraram', '1.248', 'text-white'],
                  ['Chegaram ao fim', '811', 'text-violet-300'],
                  ['Leads quentes', '327', 'text-pink-300'],
                  ['Investido', 'R$ 2.410', 'text-white'],
                  ['CPL', 'R$ 1,93', 'text-white'],
                  ['CPL quente', 'R$ 7,37', 'text-emerald-300'],
                ].map(([l, v, c]) => (
                  <div key={l} className="rounded-2xl border border-white/10 bg-[#0b0b14]/70 p-4 backdrop-blur-md">
                    <div className="text-white/45">{l}</div>
                    <div className={`mt-1 text-[20px] font-extrabold tracking-tight ${c}`}>{v}</div>
                  </div>
                ))}
                <div className="col-span-3 mt-1 text-center text-[11px] text-white/35">Exemplo ilustrativo do portal do cliente</div>
              </div>
            </div>
          </div>
        </section>

        {/* COMPARAÇÃO */}
        <section id="compare" className="mx-auto max-w-6xl px-5 pb-24">
          <div className="mb-12 max-w-2xl">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-violet-300">Compare</p>
            <h2 className="text-[34px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[42px]">Mais do que um construtor de quiz</h2>
            <p className="mt-4 text-[16px] text-white/60">Ferramentas de quiz param no formulário. O FunilPro Quiz vai até o fechamento.</p>
          </div>
          <div className="overflow-x-auto rounded-3xl border border-white/10">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead className="bg-white/[0.04] text-[12px] uppercase tracking-wider text-white/50">
                <tr>
                  <th className="px-6 py-4 font-semibold">Recurso</th>
                  <th className="px-6 py-4 font-semibold text-violet-300">FunilPro Quiz</th>
                  <th className="px-6 py-4 font-semibold">Construtores comuns</th>
                </tr>
              </thead>
              <tbody>
                {COMPARA.map(l => (
                  <tr key={l.item} className="border-t border-white/[0.06]">
                    <td className="px-6 py-4 text-white/80">{l.item}</td>
                    <td className="px-6 py-4 font-semibold">{l.nos === true ? <span className="text-emerald-400">✓</span> : l.nos === false ? <span className="text-white/25">—</span> : <span className="text-violet-300">{l.nos}</span>}</td>
                    <td className="px-6 py-4">{l.outros === true ? <span className="text-emerald-400">✓</span> : l.outros === false ? <span className="text-white/25">—</span> : <span className="text-white/50">{l.outros}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* PREÇO */}
        <section id="preco" className="mx-auto max-w-6xl px-5 pb-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-violet-300">Preço</p>
            <h2 className="text-[34px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[42px]">Um plano. Tudo do Quiz incluído.</h2>
          </div>
          <div className="mx-auto mt-12 max-w-lg">
            <div className="relative rounded-[32px] p-[1.5px]" style={{ background: 'linear-gradient(135deg,#818cf8,#a855f7,#ec4899)' }}>
              <div className="rounded-[30px] bg-[#0b0b14] p-8 sm:p-10">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold uppercase tracking-[0.2em] text-violet-300">Quiz</span>
                  <span className="rounded-full bg-white/[0.06] px-3 py-1 text-[11px] text-white/60">mensal · sem fidelidade</span>
                </div>
                <div className="mt-6 flex items-end gap-1">
                  {preco ? (
                    <>
                      <span className="pb-2 text-[20px] text-white/60">R$</span>
                      <span className="text-[64px] font-extrabold leading-none tracking-[-0.04em]">{preco.inteiro}</span>
                      {preco.centavos && <span className="pb-2 text-[22px] font-bold text-white/80">,{preco.centavos}</span>}
                      <span className="pb-2 text-[16px] text-white/50">/mês</span>
                    </>
                  ) : (
                    <span className="text-[40px] font-extrabold tracking-tight">Consulte</span>
                  )}
                </div>
                <ul className="mt-8 space-y-3 text-[15px] text-white/80">
                  {[
                    'Quizzes ilimitados, leads ilimitados',
                    'Todos os blocos e temas premium',
                    'Lógica por resposta e perfis de resultado',
                    'Pixel Meta por etapa + UTMs',
                    'Lead no WhatsApp com mensagem pronta',
                    'Portal do cliente com kanban e CPL',
                    'Exportação CSV/PDF',
                  ].map(t => (
                    <li key={t} className="flex gap-3"><span className="text-emerald-400">✓</span>{t}</li>
                  ))}
                </ul>
                <div className="mt-9">
                  <div className="[&>a]:w-full [&>form]:w-full [&>form>button]:w-full [&>a]:py-4 [&>form>button]:py-4">
                    <BotaoComprar cta={cta} grande />
                  </div>
                  <p className="mt-3 text-center text-[12px] text-white/40">
                    {cta.tipo === 'checkout' ? 'Pagamento seguro pela Stripe. Acesso imediato.' : 'Acesso imediato. Cancele quando quiser.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-3xl px-5 pb-24">
          <div className="mb-10 text-center">
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-violet-300">Dúvidas</p>
            <h2 className="text-[34px] font-extrabold leading-tight tracking-[-0.02em]">Perguntas frequentes</h2>
          </div>
          <div className="space-y-3">
            {FAQ.map(f => (
              <details key={f.p} className="card rounded-2xl px-6 py-5 transition-colors">
                <summary className="flex items-center justify-between gap-4 text-[16px] font-semibold">
                  {f.p}
                  <span className="chev grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/70 transition-transform">+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-white/60">{f.r}</p>
              </details>
            ))}
          </div>
        </section>

        {/* CTA FINAL */}
        <section className="mx-auto max-w-6xl px-5 pb-24">
          <div className="relative overflow-hidden rounded-[32px] px-8 py-16 text-center sm:px-16" style={{ background: 'linear-gradient(135deg,#4c1d95,#7c3aed 45%,#db2777)' }}>
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
            <h2 className="text-[34px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[44px]">Seu próximo lead quente começa com uma pergunta.</h2>
            <p className="mx-auto mt-4 max-w-xl text-[17px] text-white/80">Monte seu primeiro quiz hoje e veja a diferença entre um formulário e uma conversa que vende.</p>
            <div className="mt-9 flex justify-center">
              <div className="[&_button]:!bg-white [&_button]:!text-violet-800 [&_a]:!bg-white [&_a]:!text-violet-800 [&_button]:!shadow-none [&_a]:!shadow-none">
                <BotaoComprar cta={cta} grande />
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-white/[0.06]">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-[13px] text-white/40 sm:flex-row">
            <span>© 2026 FunilPro · LC Marketing Digital</span>
            <div className="flex gap-6">
              <Link href="/privacidade" className="hover:text-white">Privacidade</Link>
              <Link href="/login" className="hover:text-white">Entrar</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
