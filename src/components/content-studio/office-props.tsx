// ============================================================================
// Office Preview V3 — mobiliário e cenário (SVG)
// ----------------------------------------------------------------------------
// Peças isoladas do escritório. Ficam separadas da cena porque são desenho
// puro: nenhuma delas conhece evento, estado ou agente — recebem posição e
// paleta e devolvem geometria.
//
// A perspectiva é isométrica LEVE: as superfícies horizontais são losangos
// achatados (razão ~2:1) e o volume vem de faces laterais mais escuras. É o
// suficiente para dar profundidade sem exigir engine 3D.
// ============================================================================

import React from 'react'

/** Losango isométrico — a base de toda superfície horizontal da cena. */
export function IsoTop({
  w, h, fill, opacity = 1,
}: { w: number; h: number; fill: string; opacity?: number }) {
  return <path d={`M 0 ${-h / 2} L ${w / 2} 0 L 0 ${h / 2} L ${-w / 2} 0 Z`} fill={fill} opacity={opacity} />
}

// ─── Mesa ───────────────────────────────────────────────────────────────────

/**
 * Mesa em L com tampo isométrico, saia e quatro pés.
 *
 * As três tonalidades (tampo, borda, pé) são o que cria o volume — sem elas a
 * mesa vira um losango chapado.
 */
export function Desk({ tint }: { tint: string }) {
  return (
    <g className="cs-desk">
      {/* Sombra projetada no piso */}
      <ellipse cx="0" cy="26" rx="74" ry="26" fill="#0b1220" opacity="0.1" />

      {/* Pés */}
      {[[-52, 6], [52, 6], [-20, 22], [20, 22]].map(([x, y], i) => (
        <rect key={i} x={x - 2.5} y={y} width="5" height="20" rx="2" fill="#8b6a45" />
      ))}

      {/* Saia frontal (dá espessura ao tampo) */}
      <path d="M -76 2 L 0 34 L 76 2 L 76 10 L 0 42 L -76 10 Z" fill="#a8814f" />
      {/* Tampo */}
      <g>
        <path d="M 0 -30 L 76 2 L 0 34 L -76 2 Z" fill="#d8b183" />
        <path d="M 0 -30 L 76 2 L 0 34 L -76 2 Z" fill={tint} opacity="0.13" />
        {/* Reflexo suave no tampo */}
        <path d="M -46 0 L -8 -16 L 6 -10 L -32 6 Z" fill="#ffffff" opacity="0.18" />
      </g>
    </g>
  )
}

// ─── Cadeira ────────────────────────────────────────────────────────────────

/** Cadeira de escritório com encosto, base e rodízios. */
export function Chair({ tint, dark }: { tint: string; dark: string }) {
  return (
    <g className="cs-chair">
      <ellipse cx="0" cy="16" rx="17" ry="7" fill="#0b1220" opacity="0.12" />
      {/* Base e coluna */}
      <path d="M -13 14 L 0 8 L 13 14" stroke="#64748b" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="-2" y="-2" width="4" height="12" rx="2" fill="#94a3b8" />
      {/* Assento */}
      <path d="M 0 -12 L 20 -3 L 0 6 L -20 -3 Z" fill={dark} />
      <path d="M 0 -14 L 20 -5 L 0 4 L -20 -5 Z" fill={tint} />
      {/* Encosto */}
      <g transform="translate(0, -14)">
        <path d="M -15 -2 L 0 -8 L 15 -2 L 15 -22 Q 0 -30 -15 -22 Z" fill={dark} />
        <path d="M -13 -4 L 0 -9 L 13 -4 L 13 -20 Q 0 -27 -13 -20 Z" fill={tint} />
      </g>
    </g>
  )
}

// ─── Monitor e periféricos ──────────────────────────────────────────────────

/** Monitor widescreen. Acende com a cor do agente quando ele trabalha. */
export function Monitor({ on, tint }: { on: boolean; tint: string }) {
  return (
    <g className="cs-monitor">
      {/* Pé */}
      <path d="M -9 14 L 9 14 L 6 18 L -6 18 Z" fill="#334155" />
      <rect x="-13" y="17" width="26" height="3.5" rx="1.75" fill="#1e293b" />
      {/* Corpo */}
      <rect x="-27" y="-20" width="54" height="35" rx="3.5" fill="#111827" />
      <rect x="-25" y="-18" width="50" height="30" rx="2.5" fill={on ? tint : '#334155'} className="cs-screen" />
      {on && (
        <>
          <rect x="-25" y="-18" width="50" height="30" rx="2.5" fill="url(#cs-glass)" opacity="0.55" />
          <g className="cs-screen-lines" opacity="0.9">
            <rect x="-20" y="-13" width="26" height="2.6" rx="1.3" fill="#fff" />
            <rect x="-20" y="-8.5" width="34" height="2.6" rx="1.3" fill="#fff" opacity="0.85" />
            <rect x="-20" y="-4" width="19" height="2.6" rx="1.3" fill="#fff" opacity="0.7" />
            <rect x="-20" y="0.5" width="30" height="2.6" rx="1.3" fill="#fff" opacity="0.55" />
          </g>
        </>
      )}
      {/* Brilho do vidro */}
      <path d="M -25 -18 L -6 -18 L -19 12 L -25 12 Z" fill="#ffffff" opacity={on ? 0.16 : 0.07} />
    </g>
  )
}

/** Teclado isométrico. */
export function Keyboard() {
  return (
    <g className="cs-keyboard">
      <path d="M 0 -7 L 22 3 L 0 13 L -22 3 Z" fill="#e8edf3" />
      <path d="M 0 -5 L 18 3 L 0 11 L -18 3 Z" fill="#f8fafc" />
      <path d="M 0 13 L 22 3 L 22 5 L 0 15 Z" fill="#c7d2de" />
    </g>
  )
}

/** Pilha de papéis sobre a mesa. */
export function Papers({ tint }: { tint: string }) {
  return (
    <g>
      {[0, -2.2, -4.4].map((dy, i) => (
        <path key={i} d={`M 0 ${-5 + dy} L 12 ${1 + dy} L 0 ${7 + dy} L -12 ${1 + dy} Z`}
          fill={i === 2 ? '#ffffff' : '#eef2f7'} stroke={tint} strokeWidth="0.7" opacity="0.95" />
      ))}
    </g>
  )
}

/** Caneca. */
export function Mug({ color = '#ef4444' }: { color?: string }) {
  return (
    <g>
      <ellipse cx="0" cy="6" rx="7" ry="3" fill="#0b1220" opacity="0.12" />
      <path d="M -5 -6 L 5 -6 L 4 5 L -4 5 Z" fill={color} />
      <ellipse cx="0" cy="-6" rx="5" ry="2.2" fill="#ffffff" opacity="0.85" />
      <path d="M 5 -4 a 3.2 3.2 0 0 1 0 6" fill="none" stroke={color} strokeWidth="1.6" />
    </g>
  )
}

// ─── Cenário ────────────────────────────────────────────────────────────────

/** Planta em vaso — dá vida aos cantos. */
export function Plant({ scale = 1 }: { scale?: number }) {
  return (
    <g transform={`scale(${scale})`} className="cs-plant">
      <ellipse cx="0" cy="20" rx="14" ry="6" fill="#0b1220" opacity="0.12" />
      <path d="M -9 4 L 9 4 L 7 20 L -7 20 Z" fill="#c2703f" />
      <path d="M -9 4 L 9 4 L 8.4 8 L -8.4 8 Z" fill="#dd8b58" />
      <g className="cs-leaves">
        <path d="M 0 4 C -16 -2 -14 -20 -2 -24 C 2 -14 4 -4 0 4 Z" fill="#16a34a" />
        <path d="M 0 4 C 16 -2 15 -22 3 -26 C -1 -15 -3 -4 0 4 Z" fill="#22c55e" />
        <path d="M 0 4 C -6 -6 -2 -18 4 -20 C 6 -12 4 -4 0 4 Z" fill="#4ade80" opacity="0.9" />
      </g>
    </g>
  )
}

/** Quadro na parede. */
export function WallArt({ tone = '#6366f1' }: { tone?: string }) {
  return (
    <g>
      <rect x="-22" y="-17" width="44" height="34" rx="2.5" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="2.5" />
      <rect x="-18" y="-13" width="36" height="26" rx="1.5" fill={tone} opacity="0.16" />
      <path d="M -18 13 L -6 -3 L 2 6 L 10 -6 L 18 13 Z" fill={tone} opacity="0.55" />
      <circle cx="9" cy="-7" r="3.6" fill="#fbbf24" opacity="0.85" />
    </g>
  )
}

/** Luminária de teto com cone de luz. */
export function Lamp() {
  return (
    <g>
      <line x1="0" y1="-26" x2="0" y2="-6" stroke="#94a3b8" strokeWidth="1.6" />
      <path d="M -13 -6 L 13 -6 L 8 -14 L -8 -14 Z" fill="#475569" />
      <ellipse cx="0" cy="-6" rx="13" ry="3.6" fill="#fde68a" />
      <path d="M -13 -5 L 13 -5 L 30 44 L -30 44 Z" fill="url(#cs-light)" opacity="0.4" />
    </g>
  )
}

/** Estante com livros e caixas. */
export function Shelf() {
  return (
    <g>
      <rect x="-30" y="-46" width="60" height="66" rx="3" fill="#b3854f" />
      <rect x="-26" y="-42" width="52" height="26" rx="2" fill="#8d6539" />
      <rect x="-26" y="-12" width="52" height="26" rx="2" fill="#8d6539" />
      {/* Livros */}
      {[['#ef4444', -23], ['#3b82f6', -18], ['#22c55e', -13], ['#f59e0b', -8]].map(([c, x]) => (
        <rect key={x} x={x as number} y="-39" width="4" height="20" rx="1" fill={c as string} />
      ))}
      {/* Caixas de arquivo */}
      <rect x="2" y="-36" width="20" height="17" rx="2" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="1.2" />
      <rect x="-22" y="-8" width="22" height="18" rx="2" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="1.2" />
      <rect x="4" y="-6" width="18" height="16" rx="2" fill="#cbd5e1" />
    </g>
  )
}

/** Porta de vidro no fundo — reforça a ideia de sala. */
export function Door({ tint = '#94a3b8' }: { tint?: string }) {
  return (
    <g>
      <rect x="-21" y="-56" width="42" height="56" rx="3" fill="#e6ecf3" stroke={tint} strokeWidth="3" />
      <rect x="-15" y="-49" width="30" height="42" rx="2" fill="#c7dcf0" opacity="0.75" />
      <path d="M -15 -49 L 0 -49 L -15 -20 Z" fill="#ffffff" opacity="0.4" />
      <circle cx="14" cy="-27" r="2.4" fill={tint} />
    </g>
  )
}

/** Janela ampla com paisagem simplificada. */
export function Window() {
  return (
    <g>
      <rect x="-52" y="-38" width="104" height="70" rx="5" fill="#bfe0f7" stroke="#cbd5e1" strokeWidth="4" />
      <rect x="-48" y="-34" width="96" height="62" rx="3" fill="url(#cs-sky)" />
      {/* Prédios ao fundo */}
      <g opacity="0.45" fill="#7aa7cc">
        <rect x="-40" y="-6" width="18" height="34" />
        <rect x="-18" y="-18" width="14" height="46" />
        <rect x="0" y="-2" width="16" height="30" />
        <rect x="20" y="-14" width="20" height="42" />
      </g>
      <circle cx="30" cy="-20" r="9" fill="#fef3c7" opacity="0.95" />
      {/* Caixilho */}
      <line x1="0" y1="-34" x2="0" y2="28" stroke="#cbd5e1" strokeWidth="4" />
      <line x1="-48" y1="-4" x2="48" y2="-4" stroke="#cbd5e1" strokeWidth="4" />
    </g>
  )
}

/** Placa de identificação do setor, pendurada. */
export function DeskSign({ label, tint, dark }: { label: string; tint: string; dark: string }) {
  const w = Math.max(label.length * 7.2 + 26, 84)
  return (
    <g className="cs-sign">
      <rect x={-w / 2} y="-13" width={w} height="26" rx="13" fill="#ffffff" stroke={tint} strokeWidth="2" />
      <circle cx={-w / 2 + 14} cy="0" r="5" fill={tint} opacity="0.28" />
      <circle cx={-w / 2 + 14} cy="0" r="2.4" fill={tint} />
      <text
        x={7} y="4.5" textAnchor="middle"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="12.5" fontWeight="700" fill={dark}
      >
        {label}
      </text>
    </g>
  )
}
