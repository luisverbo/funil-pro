'use client'

// ============================================================================
// Office Preview V4.1 — relógio da locomoção ambiental
// ----------------------------------------------------------------------------
// O hook é SÓ o relógio. Toda a decisão de "onde o agente está" vive em
// ambient-motion.ts, que é puro e testável sem navegador.
//
// DUAS DECISÕES QUE IMPORTAM:
//
// 1. `requestAnimationFrame`, nunca `setInterval`. O rAF pausa sozinho quando a
//    aba fica em segundo plano — num `setInterval` o escritório continuaria
//    "andando" com a tela apagada, gastando bateria à toa.
//
// 2. O estado do React só muda quando a FASE muda, não a cada frame. As fases
//    duram segundos; re-renderizar três agentes a 60fps para nada seria caro no
//    celular. O deslocamento em si quem interpola é o CSS.
//
// O tempo começa em zero e é medido com `performance.now()` a partir da
// montagem — nunca `Date.now()`. A cena não depende de que horas são.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { AT_HOME, ambientStateAt, AMBIENT_ROUTINES, type AmbientState } from './ambient-motion'

/** Quanto tempo, no mínimo, entre duas avaliações da agenda. */
const CHECK_MS = 180

export type AmbientMap = Record<string, AmbientState>

/** Todos parados na mesa. É o estado inicial — e o que o servidor renderiza. */
function estadoInicial(chaves: readonly string[]): AmbientMap {
  const mapa: AmbientMap = {}
  for (const k of chaves) mapa[k] = AT_HOME
  return mapa
}

function iguais(a: AmbientState, b: AmbientState): boolean {
  return a.phase === b.phase && a.waypoint === b.waypoint && a.action === b.action
}

/**
 * Agenda ambiental de todos os agentes.
 *
 * `enabled = false` congela tudo no estado inicial — é assim que
 * prefers-reduced-motion desliga a locomoção sem nenhum caso especial.
 *
 * O valor inicial é o MESMO no servidor e no primeiro quadro do cliente
 * (todos na mesa), então a hidratação nunca diverge.
 */
export function useAmbientOfficeMotion(
  agentKeys: readonly string[],
  enabled: boolean,
  speed = 1,
): AmbientMap {
  const [mapa, setMapa] = useState<AmbientMap>(() => estadoInicial(agentKeys))

  // Refs para o laço não precisar de dependências que o reiniciem.
  // Sincronizadas em efeito, nunca durante o render: escrever em ref no corpo
  // do componente é leitura/escrita fora de fase e o React reclama com razão.
  const mapaRef = useRef(mapa)
  const speedRef = useRef(speed)

  useEffect(() => { mapaRef.current = mapa }, [mapa])
  useEffect(() => { speedRef.current = speed }, [speed])

  const chaves = agentKeys.join(',')

  // Desligado: o valor é DERIVADO, não escrito em estado. Fazer setState num
  // efeito só para voltar ao inicial dispararia um render em cascata à toa.
  const parado = useMemo(() => estadoInicial(agentKeys), [chaves])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return

    let frame = 0
    let vivo = true
    const inicio = performance.now()
    let ultimaChecagem = 0
    // Tempo VISUAL acumulado: avança conforme a velocidade escolhida, e é ele
    // (não o relógio de parede) que decide a fase.
    let visual = 0
    let anterior = inicio

    const passo = (agora: number) => {
      if (!vivo) return

      visual += (agora - anterior) * speedRef.current
      anterior = agora

      if (agora - ultimaChecagem >= CHECK_MS) {
        ultimaChecagem = agora

        let mudou = false
        const proximo: AmbientMap = {}
        for (const key of agentKeys) {
          const routine = AMBIENT_ROUTINES[key]
          const estado = routine ? ambientStateAt(routine, visual) : AT_HOME
          proximo[key] = estado
          if (!iguais(estado, mapaRef.current[key] ?? AT_HOME)) mudou = true
        }
        // Só re-renderiza quando alguma fase virou. As fases duram segundos.
        if (mudou) setMapa(proximo)
      }

      frame = requestAnimationFrame(passo)
    }

    frame = requestAnimationFrame(passo)

    // Cancelamento no unmount: sem isso o laço sobreviveria à tela.
    return () => {
      vivo = false
      cancelAnimationFrame(frame)
    }
    // `chaves` estabiliza a dependência do array sem reiniciar a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, chaves])

  return enabled ? mapa : parado
}
