// ============================================================================
// Office Preview V4 — primitivas de rig
// ----------------------------------------------------------------------------
// POR QUE ESTE ARQUIVO EXISTE
//
// Até a V3.1 as juntas usavam `transform` como ATRIBUTO SVG e recebiam
// `transform` por animação CSS ao mesmo tempo. A animação sobrescreve o
// atributo — então todo keyframe precisava repetir o `translate(...)` da junta.
// Onde isso foi esquecido (ou onde a animação terminava), a parte saltava para
// a origem do pai: o quadril subia e o tronco parecia se separar das pernas.
//
// A correção é estrutural, e é o que qualquer rig de verdade faz:
//
//   Socket  -> POSIÇÃO da junta. Atributo transform. NUNCA animado.
//   Joint   -> ROTAÇÃO da junta. Só classe. SEMPRE animado, sempre em (0,0).
//
// Com os dois separados, um keyframe só precisa dizer `rotate(...)`. Não há
// translate para esquecer, e o fim de uma animação devolve a junta ao repouso
// em vez de arrancá-la do corpo.
//
// Sem estado, sem eventos, sem dependência de dados: geometria pura.
// ============================================================================

import React from 'react'

/** Nomes das juntas. Uma classe CSS por nome — o CSS anima estas e só estas. */
export type JointName =
  | 'root'
  | 'pelvis'
  | 'spine'
  | 'neck'
  | 'head'
  | 'shoulderL' | 'elbowL' | 'wristL'
  | 'shoulderR' | 'elbowR' | 'wristR'
  | 'hipL' | 'kneeL' | 'ankleL'
  | 'hipR' | 'kneeR' | 'ankleR'

/**
 * Posição de uma junta no espaço do pai.
 *
 * Usa atributo `transform` — e por isso NUNCA pode ser alvo de animação CSS.
 * Todo `Socket` existe para que o `Joint` dentro dele possa girar em (0,0).
 */
export function Socket({
  x = 0, y = 0, children,
}: { x?: number; y?: number; children: React.ReactNode }) {
  return <g transform={`translate(${x}, ${y})`}>{children}</g>
}

/**
 * Rotação de uma junta.
 *
 * Só recebe classe. O CSS anima `transform: rotate(...)` com origem em 0 0 —
 * que é exatamente onde o `Socket` a colocou.
 */
export function Joint({
  name, children,
}: { name: JointName; children: React.ReactNode }) {
  return <g className={`cs-j cs-j--${name}`}>{children}</g>
}

/**
 * Osso: segmento com espessura, desenhado de (0,0) para baixo.
 *
 * `strokeLinecap="round"` dá a articulação arredondada em cada ponta, então
 * cotovelo e joelho continuam parecendo juntas mesmo dobrados.
 */
export function Bone({
  length, width, color, curve = 0, opacity = 1,
}: { length: number; width: number; color: string; curve?: number; opacity?: number }) {
  return (
    <path
      d={`M 0 0 q ${curve} ${length * 0.55} ${curve * 0.6} ${length}`}
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      fill="none"
      opacity={opacity}
    />
  )
}

/** Massa arredondada — ombro, mão, articulação exposta. */
export function Blob({
  r, color, cx = 0, cy = 0, opacity = 1,
}: { r: number; color: string; cx?: number; cy?: number; opacity?: number }) {
  return <ellipse cx={cx} cy={cy} rx={r} ry={r * 0.96} fill={color} opacity={opacity} />
}

/** Sapato visto de leve perspectiva: apoia no chão em vez de flutuar. */
export function Shoe({ color, mirrored = false }: { color: string; mirrored?: boolean }) {
  return (
    <g transform={mirrored ? 'scale(-1, 1)' : undefined}>
      <path
        d="M -4.6 -1.6 q -.6 -2.8 3 -2.8 q 5.4 0 7.2 2.6 q 1.4 2 -1.2 2.8 l -7.4 0 q -1.6 0 -1.6 -1.4 Z"
        fill={color}
      />
      <path d="M -4.6 .4 l 9.8 0 q 1.2 0 1 1 l -10.4 0 q -.4 -.6 -.4 -1 Z" fill="#0f172a" opacity="0.35" />
    </g>
  )
}
