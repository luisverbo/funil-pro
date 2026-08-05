'use client'

// ============================================================================
// Office Preview V4.1 — relógio da locomoção ambiental
// ----------------------------------------------------------------------------
// O hook é SÓ o relógio. A decisão de "onde o agente está" vive em
// ambient-motion.ts, que é puro e testável sem navegador.
//
// QUATRO DECISÕES QUE IMPORTAM:
//
// 1. requestAnimationFrame, nunca setInterval. O rAF pausa sozinho com a aba em
//    segundo plano; um setInterval manteria o escritório "andando" com a tela
//    apagada, gastando bateria.
//
// 2. ABA OCULTA. No Safari/iOS o rAF congela, e o primeiro quadro ao voltar traz
//    um delta gigante. Sem tratamento o personagem SALTARIA vários waypoints de
//    uma vez. Duas defesas: um listener de visibilitychange que descarta o
//    intervalo em segundo plano, e um teto por quadro que segura qualquer salto
//    residual (troca de app, throttle agressivo, aba inativa por horas).
//
// 3. PAUSA. Congela o tempo VISUAL sem zerá-lo: ao continuar, a cena retoma da
//    fase exata em que parou. O backend nunca soube que houve pausa.
//
// 4. O estado do React só muda quando a FASE muda, não a cada quadro. As fases
//    duram segundos; re-renderizar três agentes a 60fps seria caro no celular.
//    Quem interpola o deslocamento é o CSS.
//
// O tempo vem de performance.now() a partir da montagem — nunca Date.now(). A
// cena não depende de que horas são.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AT_HOME,
  ambientStateAt,
  AMBIENT_ROUTINES,
  TASK_RETURN_MS,
  type AmbientState,
} from './ambient-motion'

/** Intervalo mínimo entre avaliações da agenda. */
const CHECK_MS = 160

/**
 * Teto do avanço por quadro. Um quadro normal traz ~16ms; qualquer valor muito
 * acima significa que o navegador parou de nos chamar (aba oculta, app em
 * segundo plano, throttle). Nesse caso não recuperamos o tempo perdido — é
 * exatamente o que evita o salto de waypoint ao voltar para a aba.
 */
const MAX_FRAME_MS = 120

export interface AmbientClock {
  /** Fase ambiental de cada agente, já calculada. */
  states: Record<string, AmbientState>
  /** Tempo visual decorrido — a cena usa para a coreografia de volta. */
  elapsedMs: number
  /**
   * Marca que um agente precisa voltar andando para a mesa.
   * Chamado pela cena quando a tarefa chega com o agente fora do lugar.
   */
  markReturning: (agentKey: string) => void
  /** Até quando cada agente está voltando (tempo visual). */
  returningUntil: Record<string, number>
}

function estadoInicial(chaves: readonly string[]): Record<string, AmbientState> {
  const mapa: Record<string, AmbientState> = {}
  for (const k of chaves) mapa[k] = AT_HOME
  return mapa
}

function iguais(a: AmbientState, b: AmbientState): boolean {
  return a.phase === b.phase && a.waypoint === b.waypoint && a.action === b.action
}

/**
 * Relógio e agenda ambiental.
 *
 * `enabled = false` (reduced-motion) e `paused = true` (botão Pausar) congelam
 * de formas diferentes de propósito: desligado devolve todos à mesa; pausado
 * mantém a cena exatamente onde estava.
 */
export function useAmbientOfficeMotion(
  agentKeys: readonly string[],
  enabled: boolean,
  paused: boolean,
  speed = 1,
): AmbientClock {
  const [states, setStates] = useState(() => estadoInicial(agentKeys))
  const [elapsed, setElapsed] = useState(0)
  const [returningUntil, setReturningUntil] = useState<Record<string, number>>({})

  const statesRef = useRef(states)
  const speedRef = useRef(speed)
  const pausedRef = useRef(paused)
  // Tempo visual acumulado. Vive em ref porque avança a 60fps; o estado só é
  // atualizado quando alguma fase muda.
  const visualRef = useRef(0)

  useEffect(() => { statesRef.current = states }, [states])
  useEffect(() => { speedRef.current = speed }, [speed])
  useEffect(() => { pausedRef.current = paused }, [paused])

  const chaves = agentKeys.join(',')

  /**
   * Agenda a coreografia de volta. A cena chama isto quando o evento chega e o
   * agente está fora da mesa — o backend não participa nem sabe disso.
   */
  const markReturning = useCallback((agentKey: string) => {
    setReturningUntil(atual => {
      // Já está voltando: não reinicia o cronômetro.
      if (atual[agentKey] !== undefined && atual[agentKey] > visualRef.current) return atual
      return { ...atual, [agentKey]: visualRef.current + TASK_RETURN_MS }
    })
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return

    let frame = 0
    let vivo = true
    let anterior = performance.now()
    let ultimaChecagem = 0

    // Ao voltar da aba oculta, o próximo quadro NÃO recupera o tempo parado:
    // apenas reancoramos a referência. A cena retoma da mesma fase.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') anterior = performance.now()
    }
    document.addEventListener('visibilitychange', onVisibility)

    const passo = (agora: number) => {
      if (!vivo) return

      const bruto = agora - anterior
      anterior = agora

      // Pausado ou em segundo plano: o tempo visual não anda.
      const congelado = pausedRef.current || document.visibilityState !== 'visible'
      if (!congelado) {
        visualRef.current += Math.min(bruto, MAX_FRAME_MS) * speedRef.current
      }

      if (agora - ultimaChecagem >= CHECK_MS) {
        ultimaChecagem = agora
        const visual = visualRef.current

        let mudou = false
        const proximo: Record<string, AmbientState> = {}
        for (const key of agentKeys) {
          const r = AMBIENT_ROUTINES[key]
          const estado = r ? ambientStateAt(r, visual) : AT_HOME
          proximo[key] = estado
          if (!iguais(estado, statesRef.current[key] ?? AT_HOME)) mudou = true
        }

        if (mudou) {
          setStates(proximo)
          setElapsed(visual)
        }
      }

      frame = requestAnimationFrame(passo)
    }

    frame = requestAnimationFrame(passo)

    // Unmount: cancela o quadro E remove o listener.
    return () => {
      vivo = false
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, chaves])

  // Desligado: valor derivado e estável, sem setState em efeito.
  const parado = useMemo(() => estadoInicial(agentKeys), [chaves])   // eslint-disable-line react-hooks/exhaustive-deps

  return {
    states: enabled ? states : parado,
    elapsedMs: enabled ? elapsed : 0,
    markReturning,
    returningUntil,
  }
}
