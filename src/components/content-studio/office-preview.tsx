'use client'

// ============================================================================
// Office Preview — escritório 2D dirigido por eventos reais
// ----------------------------------------------------------------------------
// A tela NÃO simula a produção. Ela consome os eventos gravados em cs_events e
// revela um por vez, em ritmo confortável de leitura. O timer controla apenas a
// VELOCIDADE da revelação — nunca o conteúdo: se o backend não gravou um
// evento, ele não aparece aqui.
//
// Por isso o estado visual é sempre `buildOfficeView(eventos já revelados)`:
// recarregar a página reconstrói exatamente a mesma cena a partir do banco.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { advanceDemo, getDemoState, getLatestDemo, startDemoProduction } from '@/app/actions/content-studio'
import {
  buildOfficeView,
  OFFICE_AGENT_ORDER,
  type AgentView,
  type OfficeView,
} from '@/lib/content-studio/view-model'
import type { StoredEvent } from '@/lib/content-studio/types'

const REVEAL_MS = 850      // ritmo de revelação dos eventos já gravados
const TICK_MS = 400        // intervalo entre pedidos de avanço ao servidor
const MAX_TICKS = 40       // trava de segurança do laço de avanço

const AVATAR: Record<string, { emoji: string; ring: string; desk: string }> = {
  researcher: { emoji: '🔎', ring: 'from-sky-400 to-blue-600', desk: 'bg-sky-50 border-sky-100' },
  strategist: { emoji: '🧭', ring: 'from-violet-400 to-indigo-600', desk: 'bg-violet-50 border-violet-100' },
  copywriter: { emoji: '✍️', ring: 'from-amber-400 to-orange-600', desk: 'bg-amber-50 border-amber-100' },
}

const STATE_LABEL: Record<AgentView['state'], string> = {
  idle: 'Parado',
  queued: 'Na fila',
  working: 'Trabalhando',
  walking: 'Entregando',
  done: 'Concluído',
  error: 'Erro',
}

const STATE_CHIP: Record<AgentView['state'], string> = {
  idle: 'bg-gray-100 text-gray-500',
  queued: 'bg-sky-100 text-sky-700',
  working: 'bg-emerald-100 text-emerald-700',
  walking: 'bg-amber-100 text-amber-700',
  done: 'bg-indigo-100 text-indigo-700',
  error: 'bg-rose-100 text-rose-700',
}

function hora(ts: string) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── Personagem ─────────────────────────────────────────────────────────────

function Character({ agent, index }: { agent: AgentView; index: number }) {
  const art = AVATAR[agent.key] ?? { emoji: '🤖', ring: 'from-gray-400 to-gray-600', desk: 'bg-gray-50 border-gray-100' }
  const walking = agent.state === 'walking'
  const working = agent.state === 'working'

  return (
    <div className="relative flex-1 min-w-0 flex flex-col items-center">
      {/* Balão de status */}
      <div
        className={`mb-2 h-8 flex items-end transition-opacity duration-300 ${agent.bubble ? 'opacity-100' : 'opacity-0'}`}
        aria-live="polite"
      >
        <span className="px-3 py-1 rounded-full bg-white border border-gray-200 shadow-sm text-[11px] font-medium text-gray-700 whitespace-nowrap max-w-[11rem] truncate">
          {agent.bubble ?? '—'}
        </span>
      </div>

      {/* Personagem */}
      <div
        className={[
          'relative transition-transform duration-700 ease-in-out',
          walking ? 'translate-x-6 sm:translate-x-10' : 'translate-x-0',
          working ? 'animate-bounce' : '',
        ].join(' ')}
        style={working ? { animationDuration: '1.4s' } : undefined}
      >
        <div
          className={`w-16 h-16 rounded-full bg-gradient-to-br ${art.ring} flex items-center justify-center text-2xl shadow-lg ring-4 ring-white`}
        >
          {art.emoji}
        </div>

        {/* Pasta sendo levada */}
        {walking && (
          <span className="absolute -right-3 top-6 text-lg animate-pulse" aria-hidden>📁</span>
        )}
        {agent.state === 'done' && (
          <span className="absolute -right-1 -bottom-1 w-6 h-6 rounded-full bg-emerald-500 text-white text-xs flex items-center justify-center shadow" aria-hidden>✓</span>
        )}
        {agent.state === 'error' && (
          <span className="absolute -right-1 -bottom-1 w-6 h-6 rounded-full bg-rose-500 text-white text-xs flex items-center justify-center shadow" aria-hidden>!</span>
        )}
      </div>

      {/* Mesa */}
      <div className={`mt-3 w-full rounded-2xl border ${art.desk} px-3 py-3 text-center`}>
        <p className="text-sm font-semibold text-gray-800 truncate">{agent.label}</p>
        <span className={`mt-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATE_CHIP[agent.state]}`}>
          {STATE_LABEL[agent.state]}
        </span>

        {/* Barra só existe com progresso REAL reportado pelo agente */}
        {agent.progress && (
          <div className="mt-2">
            <div className="h-1.5 w-full rounded-full bg-white/70 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${Math.round((agent.progress.completed / agent.progress.total) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-[10px] text-gray-500">
              {agent.progress.completed} de {agent.progress.total}
            </p>
          </div>
        )}
      </div>

      {/* Seta de entrega para a próxima mesa */}
      {index < OFFICE_AGENT_ORDER.length - 1 && (
        <span
          className={`hidden sm:block absolute top-[4.5rem] -right-3 text-xl transition-opacity duration-300 ${walking ? 'opacity-100' : 'opacity-20'}`}
          aria-hidden
        >
          →
        </span>
      )}
    </div>
  )
}

// ─── Tela ───────────────────────────────────────────────────────────────────

export default function OfficePreview() {
  const [allEvents, setAllEvents] = useState<StoredEvent[]>([])
  const [revealed, setRevealed] = useState(0)
  const [productionId, setProductionId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      .catch(err => { if (vivo) setError(String(err)) })
      .finally(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [])

  // Revela os eventos já gravados, um a um. Nunca cria evento.
  useEffect(() => {
    if (revealed >= allEvents.length) return
    const t = setTimeout(() => setRevealed(n => Math.min(n + 1, allEvents.length)), REVEAL_MS)
    return () => clearTimeout(t)
  }, [revealed, allEvents.length])

  const view: OfficeView = useMemo(
    () => buildOfficeView(allEvents.slice(0, revealed)),
    [allEvents, revealed],
  )

  const iniciar = useCallback(async () => {
    setError(null)
    setRunning(true)
    setAllEvents([])
    setRevealed(0)

    try {
      const criada = await startDemoProduction()
      if (!criada.ok) { setError(criada.error); setRunning(false); return }

      const id = criada.data.productionId
      setProductionId(id)

      // Avança um passo por vez, deixando a tela acompanhar.
      for (let i = 0; i < MAX_TICKS; i++) {
        if (cancelled.current) return
        const res = await advanceDemo(id, 1)
        if (!res.ok) { setError(res.error); break }

        setAllEvents(res.data.events)
        setStatus(res.data.production.status)
        if (!res.data.pending) break
        await new Promise(r => setTimeout(r, TICK_MS))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!cancelled.current) setRunning(false)
    }
  }, [])

  // Reiniciar = reler do banco e reproduzir. NÃO cria produção nova.
  const reiniciar = useCallback(async () => {
    if (!productionId) return
    setError(null)
    setRevealed(0)
    const res = await getDemoState(productionId)
    if (!res.ok) { setError(res.error); return }
    setAllEvents(res.data.events)
    setStatus(res.data.production.status)
  }, [productionId])

  const vazio = !loading && allEvents.length === 0 && !running

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Cabeçalho */}
      <header className="flex flex-wrap items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-xl shadow-lg shadow-indigo-200/60">
          🏢
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Content Studio</h1>
          <p className="text-sm text-gray-500">Escritório virtual dos agentes de conteúdo</p>
        </div>
        <span className="ml-auto px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">
          Modo demonstração — agentes stub
        </span>
      </header>

      {/* Ações */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={iniciar}
          disabled={running}
          className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-md shadow-indigo-200 transition-all hover:-translate-y-0.5 disabled:opacity-60 disabled:translate-y-0"
        >
          {running ? 'Executando...' : 'Iniciar demonstração'}
        </button>
        <button
          onClick={reiniciar}
          disabled={running || !productionId}
          className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 disabled:opacity-50"
        >
          Reiniciar visualização
        </button>
        {status && (
          <span className="self-center text-xs text-gray-500">
            Produção: <strong className="text-gray-700">{status}</strong>
          </span>
        )}
      </div>

      {/* Erro */}
      {error && (
        <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-semibold text-rose-800">Não foi possível concluir</p>
          <p className="text-sm text-rose-700 mt-0.5 break-words">{error}</p>
        </div>
      )}

      {/* Escritório */}
      <section className="rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden mb-6">
        <div className="bg-gradient-to-b from-slate-50 to-white px-4 sm:px-8 pt-8 pb-6">
          {loading ? (
            <div className="flex gap-4">
              {OFFICE_AGENT_ORDER.map(k => (
                <div key={k} className="flex-1 flex flex-col items-center animate-pulse">
                  <div className="w-16 h-16 rounded-full bg-gray-200" />
                  <div className="mt-3 w-full h-16 rounded-2xl bg-gray-100" />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-3 sm:gap-6 items-start">
              {view.agents.map((agent, i) => (
                <Character key={agent.key} agent={agent} index={i} />
              ))}
            </div>
          )}
        </div>
        {/* Chão */}
        <div className="h-3 bg-gradient-to-b from-slate-200 to-slate-100" />
      </section>

      {/* Linha do tempo */}
      <section className="rounded-3xl border border-gray-100 bg-white shadow-sm p-5">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Linha do tempo</h2>

        {vazio ? (
          <div className="py-10 text-center">
            <div className="text-3xl mb-2">🗂️</div>
            <p className="text-sm font-semibold text-gray-700">Nenhuma demonstração ainda</p>
            <p className="text-sm text-gray-500 mt-1">
              Clique em <strong>Iniciar demonstração</strong> para ver os três agentes trabalhando.
            </p>
          </div>
        ) : view.timeline.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">Aguardando os primeiros eventos...</p>
        ) : (
          <ol className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {view.timeline.map(item => (
              <li key={item.seq} className="flex items-center gap-3 text-sm">
                <span className="w-10 shrink-0 text-[11px] text-gray-400 tabular-nums">#{item.seq}</span>
                <span
                  className={[
                    'w-2 h-2 rounded-full shrink-0',
                    item.tone === 'bad' ? 'bg-rose-500' : item.tone === 'good' ? 'bg-emerald-500' : 'bg-gray-300',
                  ].join(' ')}
                  aria-hidden
                />
                <span className="text-gray-800 truncate">
                  {item.agentLabel && <strong className="font-semibold">{item.agentLabel}: </strong>}
                  {item.label}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-gray-400 tabular-nums">{hora(item.at)}</span>
              </li>
            ))}
          </ol>
        )}

        {view.finished && (
          <p className="mt-4 text-sm font-semibold text-emerald-700">
            ✓ Produção concluída — pronta para revisão.
          </p>
        )}
        {view.failed && (
          <p className="mt-4 text-sm font-semibold text-rose-700">
            A produção falhou. A timeline acima mostra em qual agente parou.
          </p>
        )}
      </section>

      <p className="mt-4 text-xs text-gray-400">
        Os agentes desta demonstração são determinísticos e não usam IA: nenhuma chamada externa é feita
        e nenhum custo é gerado. Os eventos exibidos são lidos de <code>cs_events</code>.
      </p>
    </div>
  )
}
