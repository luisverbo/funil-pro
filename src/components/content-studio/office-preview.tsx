'use client'

// ============================================================================
// Office Preview V2 — escritório 2D dirigido por eventos reais
// ----------------------------------------------------------------------------
// A tela NÃO simula a produção. Ela consome os eventos gravados em cs_events e
// revela um por vez. O timer controla apenas a VELOCIDADE da revelação — nunca
// o conteúdo: se o backend não gravou um evento, ele não aparece aqui.
//
// Por isso o estado visual é sempre `buildOfficeView(eventos revelados)`:
// recarregar a página reconstrói exatamente a mesma cena a partir do banco.
//
// PAUSAR interrompe só a revelação visual. O backend segue processando: os
// jobs já enfileirados continuam sendo executados e gravados.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import { advanceDemo, getDemoState, getLatestDemo, startDemoProduction } from '@/app/actions/content-studio'
import {
  buildOfficeView,
  productionStatusLabel,
  type OfficeView,
} from '@/lib/content-studio/view-model'
import type { PublicEvent } from '@/lib/content-studio/demo-guard'
import OfficeScene from './office-scene'
import TimelinePanel from './timeline-panel'

const REVEAL_MS = 950         // ritmo base de revelação dos eventos gravados
const TICK_MS = 400           // intervalo entre pedidos de avanço ao servidor
const MAX_TICKS = 30          // teto de chamadas: o pipeline tem 3 passos
const MAX_TOTAL_MS = 60_000   // teto de tempo total do laço
const MAX_SEM_PROGRESSO = 3   // rodadas sem evento novo antes de desistir

type Velocidade = 'normal' | 'rapido'
const FATOR: Record<Velocidade, number> = { normal: 1, rapido: 2.2 }

/**
 * Media query como fonte externa de verdade.
 *
 * `useSyncExternalStore` em vez de useEffect + setState: o navegador é quem
 * manda aqui, e o React só se inscreve. No servidor devolve `false`, então a
 * primeira pintura nunca diverge da hidratação.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((notify: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => {}
    const mq = window.matchMedia(query)
    mq.addEventListener('change', notify)
    return () => mq.removeEventListener('change', notify)
  }, [query])

  return useSyncExternalStore(
    subscribe,
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  )
}

export default function OfficePreview() {
  const [allEvents, setAllEvents] = useState<PublicEvent[]>([])
  const [revealed, setRevealed] = useState(0)
  const [productionId, setProductionId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [velocidade, setVelocidade] = useState<Velocidade>('normal')
  const [pausado, setPausado] = useState(false)

  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const compact = useMediaQuery('(max-width: 639px)')

  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  // Carrega a última demonstração do tenant, se houver.
  useEffect(() => {
    let vivo = true
    getLatestDemo()
      .then(res => {
        if (!vivo) return
        if (!res.ok) { setError(res.error); return }
        if (res.data) {
          setProductionId(res.data.production.id)
          setStatus(res.data.production.status)
          setAllEvents(res.data.events)
          setRevealed(res.data.events.length) // já aconteceu: mostra completa
        }
      })
      .catch(() => { if (vivo) setError('Não foi possível carregar a demonstração. Tente novamente.') })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [])

  // Revela os eventos já gravados, um a um. Nunca cria evento.
  // Pausar apenas suspende ESTE efeito — o backend não sabe que existe pausa.
  useEffect(() => {
    if (pausado) return
    if (revealed >= allEvents.length) return
    const espera = reducedMotion ? 120 : REVEAL_MS / FATOR[velocidade]
    const t = setTimeout(() => setRevealed(n => Math.min(n + 1, allEvents.length)), espera)
    return () => clearTimeout(t)
  }, [revealed, allEvents.length, pausado, velocidade, reducedMotion])

  const view: OfficeView = useMemo(
    () => buildOfficeView(allEvents.slice(0, revealed)),
    [allEvents, revealed],
  )

  const reproduzindo = revealed < allEvents.length

  const iniciar = useCallback(async () => {
    // Guarda de clique duplo no cliente. O servidor também é idempotente — as
    // duas camadas existem porque nenhuma sozinha basta.
    if (running) return

    setError(null)
    setRunning(true)
    setPausado(false)
    setAllEvents([])
    setRevealed(0)

    const limite = Date.now() + MAX_TOTAL_MS
    let semProgresso = 0
    let ultimoTotal = -1

    try {
      const criada = await startDemoProduction()
      if (!criada.ok) { setError(criada.error); return }
      if (cancelled.current) return

      const id = criada.data.productionId
      setProductionId(id)

      for (let i = 0; i < MAX_TICKS; i++) {
        if (cancelled.current) return
        if (Date.now() > limite) {
          setError('A demonstração demorou mais que o esperado e foi interrompida.')
          break
        }

        const res = await advanceDemo(id)
        if (cancelled.current) return
        if (!res.ok) { setError(res.error); break }

        setAllEvents(res.data.events)
        setStatus(res.data.production.status)

        if (!res.data.pending) break   // terminou: para imediatamente

        semProgresso = res.data.events.length === ultimoTotal ? semProgresso + 1 : 0
        ultimoTotal = res.data.events.length
        if (semProgresso >= MAX_SEM_PROGRESSO) {
          setError('A demonstração parou de avançar. Tente novamente.')
          break
        }

        await new Promise(r => setTimeout(r, TICK_MS))
      }
    } catch {
      setError('Não foi possível concluir a demonstração. Tente novamente.')
    } finally {
      if (!cancelled.current) setRunning(false)
    }
  }, [running])

  // Reiniciar = reler do banco e reproduzir. NÃO cria produção nova.
  const reiniciar = useCallback(async () => {
    if (!productionId) return
    setError(null)
    setPausado(false)
    setRevealed(0)
    const res = await getDemoState(productionId)
    if (!res.ok) { setError(res.error); return }
    setAllEvents(res.data.events)
    setStatus(res.data.production.status)
  }, [productionId])

  const vazio = !loading && allEvents.length === 0 && !running
  const estadoCor =
    status === 'failed' ? 'text-rose-600'
    : status === 'review' || status === 'published' ? 'text-emerald-600'
    : status ? 'text-indigo-600' : 'text-gray-400'
  const eventoAtual = revealed > 0 ? (view.timeline[view.timeline.length - 1]?.seq ?? 0) : 0

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto overflow-x-hidden">
      {/* Cabeçalho — faixa única: identidade, selo e estado na mesma linha */}
      <header className="mb-3 rounded-2xl bg-white border border-gray-100 shadow-sm px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-lg sm:text-xl shadow-md shadow-indigo-200/60">
            🏢
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-gray-900 leading-tight truncate">
                Content Studio
              </h1>
              <span
                className="shrink-0 rounded-md bg-amber-50 border border-amber-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600"
                title="Agentes determinísticos, sem IA e sem custo"
              >
                demo
              </span>
            </div>
            <p className="text-[12px] sm:text-[13px] text-gray-500 truncate">
              Escritório virtual dos agentes de conteúdo
            </p>
          </div>

          {/* Estado da produção, sempre em português */}
          <div className="shrink-0 text-right">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 leading-none">Produção</p>
            <p className={`text-[12px] sm:text-[13px] font-bold leading-tight ${estadoCor}`}>
              {productionStatusLabel(status)}
            </p>
          </div>
        </div>
      </header>

      {/* Controles — HUD compacto, tudo numa faixa */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={iniciar}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-b from-indigo-500 to-violet-600 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-200 ring-1 ring-inset ring-white/25 transition-all hover:brightness-110 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-60 disabled:translate-y-0"
        >
          <span aria-hidden>{running ? '⏳' : '▶'}</span>
          {running ? 'Executando...' : 'Iniciar demonstração'}
        </button>

        <div className="inline-flex rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <button
            onClick={reiniciar}
            disabled={running || !productionId}
            className="px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Reproduz de novo os eventos já gravados"
          >
            ↻ <span className="hidden sm:inline">Reiniciar</span>
          </button>
          <span className="w-px bg-gray-200" aria-hidden />
          <button
            onClick={() => setPausado(p => !p)}
            disabled={!reproduzindo && !pausado}
            aria-pressed={pausado}
            className="px-3 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            title="Pausa apenas a animação — o processamento continua"
          >
            {pausado ? '▶' : '❚❚'} <span className="hidden sm:inline">{pausado ? 'Continuar' : 'Pausar'}</span>
          </button>
        </div>

        {/* Velocidade: puramente visual. */}
        <div
          className="inline-flex rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
          role="group"
          aria-label="Velocidade da animação"
        >
          {(['normal', 'rapido'] as const).map(vel => (
            <button
              key={vel}
              onClick={() => setVelocidade(vel)}
              aria-pressed={velocidade === vel}
              className={`px-3.5 py-2.5 text-sm font-bold transition-colors ${
                velocidade === vel ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {vel === 'normal' ? '1x' : '2x'}
            </button>
          ))}
        </div>

        {/* Andamento da reprodução — some quando não há nada a reproduzir */}
        {allEvents.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11px] font-semibold text-gray-500 tabular-nums">
            <span
              className={`w-1.5 h-1.5 rounded-full ${reproduzindo && !pausado ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}
              aria-hidden
            />
            {revealed}/{allEvents.length}
          </span>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-semibold text-rose-800">Não foi possível concluir</p>
          <p className="text-sm text-rose-700 mt-0.5 break-words">{error}</p>
        </div>
      )}

      {/* Escritório */}
      <section className="rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden mb-4">
        {loading ? (
          <div className="h-64 sm:h-80 animate-pulse bg-gradient-to-b from-slate-100 to-slate-50" />
        ) : (
          <OfficeScene
            view={view}
            layout={compact ? 'compact' : 'wide'}
            reducedMotion={reducedMotion}
            speed={FATOR[velocidade]}
            paused={pausado}
          />
        )}
      </section>

      {/* Conclusão / falha */}
      {view.finished && (
        <p className="mb-4 rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-sm font-semibold text-emerald-800">
          ✓ Produção concluída — aguardando aprovação.
        </p>
      )}
      {view.failed && (
        <p className="mb-4 rounded-2xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-800">
          A produção falhou. A linha do tempo mostra em qual agente parou.
        </p>
      )}

      {/* Linha do tempo — cabeçalho, botão de ocultar e rolagem vivem no painel */}
      <section className="rounded-3xl border border-gray-100 bg-white shadow-sm p-4 sm:p-5">
        <TimelinePanel
          entries={view.timeline}
          currentSeq={eventoAtual}
          vazio={vazio}
          reducedMotion={reducedMotion}
        />
      </section>

      <p className="mt-4 text-xs text-gray-400">
        Os agentes desta demonstração são determinísticos e não usam IA: nenhuma chamada externa é feita
        e nenhum custo é gerado. Os eventos exibidos são lidos de <code>cs_events</code>.
      </p>
    </div>
  )
}
