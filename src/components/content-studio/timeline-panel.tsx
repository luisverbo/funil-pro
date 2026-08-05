'use client'

// ============================================================================
// Office Preview — linha do tempo
// ----------------------------------------------------------------------------
// Mostra os eventos REAIS lidos de cs_events, sem esconder nenhum. O que muda
// em relação à V1 é só a leitura: ícone por tipo, cor por agente, handoff em
// destaque e marcação de qual evento está sendo reproduzido agora.
//
// ROLAGEM — a correção desta versão.
//
// A versão anterior chamava `scrollIntoView({ block: 'nearest' })` no item
// atual. O `nearest` engana: ele limita o QUANTO se rola, não QUEM rola. A
// especificação manda percorrer TODOS os ancestrais roláveis até o viewport —
// então, com o painel fora da tela, quem se mexia era o documento. A cada
// evento revelado a página era puxada de volta para a timeline, e o usuário
// não conseguia subir para olhar o escritório.
//
// Aqui a rolagem automática é feita com `container.scrollTo`, que por
// construção não pode tocar em `window.scrollY`, no `documentElement` nem no
// Office Preview. O único elemento que rola é a própria lista.
//
// `overflow-anchor: none` é deliberado e local: a lista cresce por baixo, e o
// scroll anchoring do Chrome reposicionaria o conteúdo ao inserir itens,
// brigando com o auto-follow. Fica só neste container — não na página.
// `overscroll-behavior: contain` impede que a rolagem, ao chegar no fim da
// lista, se propague para o documento.
// ============================================================================

import React, { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
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

/** Preferência puramente visual. Nada disso vai para o backend. */
export const TIMELINE_COLLAPSED_KEY = 'content-studio:timeline-collapsed'

/**
 * Folga para considerar que o usuário está "no fim" da lista. Precisa ser
 * maior que zero: alturas fracionárias e zoom fazem a conta fechar em 0,5px.
 */
export const FIM_TOLERANCIA_PX = 32

function hora(ts: string) {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Quanto falta para o fim da lista, em pixels. */
function distanciaDoFim(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

// ─── Preferência de ocultar ─────────────────────────────────────────────────
//
// O navegador é a fonte da verdade, então ele entra como store externo, igual
// à media query do Office Preview. Duas consequências que importam:
//
//   O snapshot do SERVIDOR é `false` por definição — a primeira pintura é
//   sempre "timeline visível", idêntica no servidor e na hidratação. Não há
//   divergência possível porque o servidor não consulta nada.
//
//   `localStorage` fica confinado a estas três funções de módulo. O corpo do
//   componente não o menciona.

const ouvintes = new Set<() => void>()

function lerPreferencia(): boolean {
  try {
    return window.localStorage.getItem(TIMELINE_COLLAPSED_KEY) === '1'
  } catch {
    return false          // modo privativo / storage bloqueado
  }
}

function gravarPreferencia(valor: boolean) {
  try {
    window.localStorage.setItem(TIMELINE_COLLAPSED_KEY, valor ? '1' : '0')
  } catch {
    // Não poder lembrar a escolha não pode quebrar a tela.
  }
  for (const notificar of ouvintes) notificar()
}

function assinarPreferencia(notificar: () => void) {
  ouvintes.add(notificar)
  // Outra aba mudou a preferência.
  window.addEventListener('storage', notificar)
  return () => {
    ouvintes.delete(notificar)
    window.removeEventListener('storage', notificar)
  }
}

function usePreferenciaOculta(): [boolean, (valor: boolean) => void] {
  const oculta = useSyncExternalStore(assinarPreferencia, lerPreferencia, () => false)
  return [oculta, gravarPreferencia]
}

export interface TimelinePanelProps {
  entries: TimelineEntry[]
  /** `seq` do evento sendo reproduzido agora — recebe destaque. */
  currentSeq: number
  vazio: boolean
  /** Reduced motion: a rolagem acompanha sem animar. */
  reducedMotion?: boolean
}

export default function TimelinePanel({ entries, currentSeq, vazio, reducedMotion }: TimelinePanelProps) {
  const listaRef = useRef<HTMLOListElement | null>(null)
  const [oculta, definirOculta] = usePreferenciaOculta()

  // `noFim` decide se o painel acompanha. Vive em ref porque é lido dentro do
  // efeito de novos eventos, que não deve re-disparar quando ele muda.
  const [noFim, setNoFim] = useState(true)
  const noFimRef = useRef(true)
  const [temNovos, setTemNovos] = useState(false)
  const totalAnteriorRef = useRef(0)

  const corpoId = useId()

  const irParaOFim = useCallback((suave: boolean) => {
    const el = listaRef.current
    if (!el) return
    // Só o container. Nunca `scrollIntoView`, nunca a página.
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' })
    noFimRef.current = true
    setNoFim(true)
    setTemNovos(false)
  }, [])

  const aoRolar = useCallback(() => {
    const el = listaRef.current
    if (!el) return
    const fim = distanciaDoFim(el) <= FIM_TOLERANCIA_PX
    noFimRef.current = fim
    setNoFim(fim)
    if (fim) setTemNovos(false)
  }, [])

  // Novos eventos revelados: acompanha só se o usuário estiver no fim.
  useEffect(() => {
    const total = entries.length
    const anterior = totalAnteriorRef.current
    totalAnteriorRef.current = total

    const el = listaRef.current
    if (!el || oculta) return

    // Reinício da demonstração: a lista encolheu (ou zerou). Volta ao começo
    // do PAINEL — a página fica onde está.
    if (total < anterior) {
      el.scrollTop = 0
      noFimRef.current = total === 0
      setNoFim(total === 0)
      setTemNovos(false)
      return
    }

    if (total === anterior) return

    if (noFimRef.current) irParaOFim(!reducedMotion)
    else setTemNovos(true)
  }, [entries.length, currentSeq, oculta, reducedMotion, irParaOFim])

  const alternar = () => {
    const proxima = !oculta
    definirOculta(proxima)
    // Ao reabrir, se o usuário estava acompanhando, reencontra o mais recente.
    if (!proxima && noFimRef.current) {
      requestAnimationFrame(() => irParaOFim(false))
    }
  }

  const contagem = entries.length

  return (
    <div>
      {/* Cabeçalho compacto — permanece visível mesmo com a lista oculta. */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-gray-900">Linha do tempo</h2>
        {contagem > 0 && (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500 tabular-nums">
            {contagem}
          </span>
        )}

        <button
          type="button"
          onClick={alternar}
          aria-expanded={!oculta}
          aria-controls={corpoId}
          className="ml-auto shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
        >
          {oculta ? 'Mostrar linha do tempo' : 'Ocultar linha do tempo'}
        </button>
      </div>

      {/* `hidden` em vez de desmontar: os eventos continuam ali, intactos. */}
      <div id={corpoId} className={oculta ? 'hidden' : 'relative'}>
        {vazio ? (
          <div className="py-10 text-center">
            <div className="text-3xl mb-2">🗂️</div>
            <p className="text-sm font-semibold text-gray-700">Nenhuma demonstração ainda</p>
            <p className="text-sm text-gray-500 mt-1">
              Clique em <strong>Iniciar demonstração</strong> para ver os três agentes trabalhando.
            </p>
          </div>
        ) : contagem === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">Aguardando os primeiros eventos...</p>
        ) : (
          <>
            <ol
              ref={listaRef}
              onScroll={aoRolar}
              className="space-y-1 max-h-80 overflow-y-auto overflow-x-hidden pr-1"
              style={{ overflowAnchor: 'none', overscrollBehavior: 'contain' }}
            >
              {entries.map(item => {
                const palette = item.agentKey ? AGENT_PALETTE[item.agentKey] : undefined
                const atual = item.seq === currentSeq
                const handoff = HANDOFF.includes(item.type)

                return (
                  <li
                    key={item.seq}
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

            {/* Só aparece quando há evento novo E o usuário saiu do fim. */}
            {temNovos && !noFim && (
              <button
                type="button"
                onClick={() => irParaOFim(!reducedMotion)}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3.5 py-2 text-[12px] font-semibold text-white shadow-lg shadow-indigo-300/50 hover:bg-indigo-500"
              >
                ↓ Ir para o mais recente
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
