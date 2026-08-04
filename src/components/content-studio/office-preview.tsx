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
  const [timelineAberta, setTimelineAberta] = useState(false)

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
  const eventoAtual = revealed > 0 ? (view.timeline[view.timeline.length - 1]?.seq ?? 0) : 0

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto overflow-x-hidden">
      {/* Cabeçalho */}
      <header className="mb-5">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-xl shadow-lg shadow-indigo-200/60">
            🏢
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 leading-tight">Content Studio</h1>
            <p className="text-[13px] sm:text-sm text-gray-500 truncate">
              Escritório virtual dos agentes de conteúdo
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden />
            Modo demonstração — agentes stub
          </span>
          {status && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-2.5 py-1 text-[11px] text-gray-500">
              Produção:{' '}
              <strong className="font-semibold text-gray-800">{productionStatusLabel(status)}</strong>
            </span>
          )}
        </div>
      </header>

      {/* Ações */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={iniciar}
          disabled={running}
          className="px-4 sm:px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-md shadow-indigo-200 transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:translate-y-0"
        >
          {running ? 'Executando...' : 'Iniciar demonstração'}
        </button>
        <button
          onClick={reiniciar}
          disabled={running || !productionId}
          className="px-4 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          Reiniciar
        </button>

        {/* Pausa: só a reprodução visual. */}
        <button
          onClick={() => setPausado(p => !p)}
          disabled={!reproduzindo && !pausado}
          aria-pressed={pausado}
          className="px-3 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-40"
          title="Pausa apenas a animação — o processamento continua"
        >
          {pausado ? '▶ Continuar' : '⏸ Pausar'}
        </button>

        {/* Velocidade: puramente visual. */}
        <div className="inline-flex rounded-xl border border-gray-200 bg-white overflow-hidden" role="group" aria-label="Velocidade da animação">
          {(['normal', 'rapido'] as const).map(v => (
            <button
              key={v}
              onClick={() => setVelocidade(v)}
              aria-pressed={velocidade === v}
              className={`px-3 py-2.5 text-sm font-semibold transition-colors ${
                velocidade === v ? 'bg-indigo-500 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {v === 'normal' ? '1x' : '2x'}
            </button>
          ))}
        </div>
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

      {/* Linha do tempo */}
      <section className="rounded-3xl border border-gray-100 bg-white shadow-sm p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-bold text-gray-900">Linha do tempo</h2>
          {view.timeline.length > 0 && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
              {view.timeline.length}
            </span>
          )}
          {/* No celular a timeline começa recolhida para o escritório caber. */}
          <button
            onClick={() => setTimelineAberta(a => !a)}
            aria-expanded={timelineAberta}
            className="sm:hidden ml-auto rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-semibold text-gray-600"
          >
            {timelineAberta ? 'Ocultar' : 'Ver timeline'}
          </button>
        </div>

        <div className={timelineAberta ? '' : 'hidden sm:block'}>
          <TimelinePanel entries={view.timeline} currentSeq={eventoAtual} vazio={vazio} />
        </div>
      </section>

      <p className="mt-4 text-xs text-gray-400">
        Os agentes desta demonstração são determinísticos e não usam IA: nenhuma chamada externa é feita
        e nenhum custo é gerado. Os eventos exibidos são lidos de <code>cs_events</code>.
      </p>
    </div>
  )
}
