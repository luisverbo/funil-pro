'use client'

// ============================================================================
// Office Preview — linha do tempo
// ----------------------------------------------------------------------------
// Mostra os eventos REAIS lidos de cs_events, sem esconder nenhum. O que muda
// em relação à V1 é só a leitura: ícone por tipo, cor por agente, handoff em
// destaque e marcação de qual evento está sendo reproduzido agora.
// ============================================================================

import React, { useEffect, useRef } from 'react'
import { AGENT_PALETTE } from './agent-avatar'
import type { EventType } from '@/lib/content-studio/types'
import type { TimelineEntry } from '@/lib/content-studio/view-model'

const ICON: Record<EventType, string> = {
  production_created: '🗂️',
  agent_queued: '📥',
  agent_started: '⌨️',
  agent_progress: '⏳',
  agent_completed: '✅',
  agent_failed: '⛔',
  agent_waiting: '⏸️',
  agent_retrying: '🔁',
  agent_reprocessed: '♻️',
  task_handoff_started: '🚶',
  task_handoff_completed: '🤝',
  content_waiting_approval: '🏁',
  content_approved: '👍',
  content_rejected: '👎',
  publication_scheduled: '📅',
  publication_started: '📤',
  publication_completed: '🌐',
  publication_failed: '⚠️',
}

const HANDOFF: EventType[] = ['task_handoff_started', 'task_handoff_completed']

function hora(ts: string) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export interface TimelinePanelProps {
  entries: TimelineEntry[]
  /** `seq` do evento sendo reproduzido agora — recebe destaque. */
  currentSeq: number
  vazio: boolean
}

export default function TimelinePanel({ entries, currentSeq, vazio }: TimelinePanelProps) {
  const atualRef = useRef<HTMLLIElement | null>(null)

  // Acompanha a reprodução, sem arrastar a página junto.
  useEffect(() => {
    atualRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentSeq])

  if (vazio) {
    return (
      <div className="py-10 text-center">
        <div className="text-3xl mb-2">🗂️</div>
        <p className="text-sm font-semibold text-gray-700">Nenhuma demonstração ainda</p>
        <p className="text-sm text-gray-500 mt-1">
          Clique em <strong>Iniciar demonstração</strong> para ver os três agentes trabalhando.
        </p>
      </div>
    )
  }

  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-gray-500">Aguardando os primeiros eventos...</p>
  }

  return (
    <ol className="space-y-1 max-h-80 overflow-y-auto pr-1">
      {entries.map(item => {
        const palette = item.agentKey ? AGENT_PALETTE[item.agentKey] : undefined
        const atual = item.seq === currentSeq
        const handoff = HANDOFF.includes(item.type)

        return (
          <li
            key={item.seq}
            ref={atual ? atualRef : undefined}
            className={[
              'flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm transition-colors',
              atual ? 'bg-indigo-50 ring-1 ring-indigo-200' : '',
              handoff && !atual ? 'bg-amber-50/70' : '',
            ].join(' ')}
          >
            <span className="w-6 shrink-0 text-center text-[13px]" aria-hidden>
              {ICON[item.type] ?? '•'}
            </span>

            {/* Faixa da cor do agente — agrupa visualmente sem repetir o nome */}
            <span
              className="w-1 h-6 rounded-full shrink-0"
              style={{ background: palette?.suit ?? '#cbd5e1' }}
              aria-hidden
            />

            <span className="min-w-0 truncate text-gray-800">
              {item.agentLabel && (
                <strong className="font-semibold" style={{ color: palette?.suitDark }}>
                  {item.agentLabel}:{' '}
                </strong>
              )}
              {item.label}
            </span>

            {item.tone === 'bad' && (
              <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                erro
              </span>
            )}

            <span className="ml-auto shrink-0 text-[11px] text-gray-400 tabular-nums">{hora(item.at)}</span>
          </li>
        )
      })}
    </ol>
  )
}
