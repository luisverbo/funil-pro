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

// ─── Pontos de destino da locomoção ambiental ───────────────────────────────
// Peças com FUNÇÃO visual: cada uma é o destino de uma rotina, então o
// deslocamento tem um motivo legível em vez de ser passeio sem propósito.

/** Quadro de planejamento — destino do Estrategista. */
export function PlanningBoard({ tint = '#8b5cf6' }: { tint?: string }) {
  return (
    <g>
      <rect x="-34" y="-26" width="68" height="50" rx="3" fill="#ffffff" stroke="#cbd5e1" strokeWidth="3" />
      <rect x="-30" y="-22" width="60" height="42" rx="2" fill="#f8fafc" />
      {/* Post-its e conexões */}
      <rect x="-25" y="-17" width="13" height="10" rx="1.5" fill="#fde047" />
      <rect x="-6" y="-17" width="13" height="10" rx="1.5" fill={tint} opacity="0.5" />
      <rect x="13" y="-17" width="13" height="10" rx="1.5" fill="#86efac" />
      <rect x="-16" y="0" width="13" height="10" rx="1.5" fill="#fdba74" />
      <rect x="4" y="0" width="13" height="10" rx="1.5" fill="#93c5fd" />
      <path d="M -12 -12 L -9 5 M 0 -7 L 10 0 M 19 -7 L 10 0" stroke={tint} strokeWidth="1.4" opacity="0.6" fill="none" />
      {/* Suporte */}
      <path d="M -14 24 L -10 38 M 14 24 L 10 38" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
    </g>
  )
}

/** Painel de ideias — destino do Copywriter. */
export function IdeaWall({ tint = '#f97316' }: { tint?: string }) {
  return (
    <g>
      <rect x="-30" y="-24" width="60" height="46" rx="3" fill="#e8d5b7" stroke="#b08a5f" strokeWidth="3" />
      {[[-21, -17], [-3, -17], [15, -17], [-21, 2], [-3, 2], [15, 2]].map(([x, y], i) => (
        <rect key={i} x={x} y={y} width="14" height="13" rx="1.5"
          fill={['#fde047', '#fca5a5', '#a7f3d0', '#bfdbfe', '#fdba74', '#ddd6fe'][i]}
          transform={`rotate(${(i % 3) - 1} ${x + 7} ${y + 6})`} />
      ))}
      <circle cx="0" cy="-24" r="3" fill={tint} />
    </g>
  )
}

/** Estação de café — destino do Copywriter. */
export function CoffeeCorner() {
  return (
    <g>
      <ellipse cx="0" cy="26" rx="30" ry="11" fill="#0b1220" opacity="0.1" />
      {/* Bancada */}
      <path d="M -30 8 L 0 22 L 30 8 L 30 14 L 0 28 L -30 14 Z" fill="#a8814f" />
      <path d="M 0 -2 L 30 8 L 0 22 L -30 8 Z" fill="#d8b183" />
      {/* Máquina */}
      <g transform="translate(-8, -6)">
        <rect x="-11" y="-22" width="22" height="24" rx="3" fill="#334155" />
        <rect x="-8" y="-19" width="16" height="9" rx="2" fill="#0ea5e9" opacity="0.75" />
        <rect x="-5" y="-6" width="10" height="4" rx="1" fill="#1e293b" />
        <circle cx="7" cy="-15" r="1.8" fill="#ef4444" />
      </g>
      {/* Canecas na bancada */}
      <g transform="translate(12, 4) scale(0.75)"><Mug color="#0ea5e9" /></g>
      <g transform="translate(20, 8) scale(0.7)"><Mug color="#f59e0b" /></g>
    </g>
  )
}

/** Mesa de reunião — destino do Estrategista. */
export function MeetingTable() {
  return (
    <g>
      <ellipse cx="0" cy="18" rx="44" ry="17" fill="#0b1220" opacity="0.1" />
      {/* Tampo oval */}
      <ellipse cx="0" cy="0" rx="44" ry="19" fill="#a8814f" />
      <ellipse cx="0" cy="-3" rx="44" ry="19" fill="#d8b183" />
      <ellipse cx="-14" cy="-6" rx="16" ry="6" fill="#ffffff" opacity="0.16" />
      {/* Pé central */}
      <rect x="-4" y="10" width="8" height="14" rx="3" fill="#8b6a45" />
      <ellipse cx="0" cy="24" rx="13" ry="5" fill="#8b6a45" />
      {/* Documentos e cadeiras laterais */}
      <g transform="translate(-16, -6) scale(0.8)"><Papers tint="#8b5cf6" /></g>
      <g transform="translate(14, -4) scale(0.7)"><Mug color="#8b5cf6" /></g>
      <ellipse cx="-46" cy="2" rx="9" ry="7" fill="#94a3b8" opacity="0.5" />
      <ellipse cx="46" cy="2" rx="9" ry="7" fill="#94a3b8" opacity="0.5" />
    </g>
  )
}

/** Arquivo e impressora — destino do Pesquisador. */
export function FileCabinet() {
  return (
    <g>
      <ellipse cx="0" cy="30" rx="24" ry="9" fill="#0b1220" opacity="0.1" />
      {/* Gavetas */}
      <rect x="-20" y="-14" width="40" height="44" rx="3" fill="#94a3b8" />
      <rect x="-20" y="-14" width="40" height="4" rx="2" fill="#cbd5e1" />
      {[0, 14, 28].map(y => (
        <g key={y}>
          <rect x="-16" y={-8 + y} width="32" height="11" rx="1.5" fill="#cbd5e1" />
          <rect x="-5" y={-4 + y} width="10" height="2.6" rx="1.3" fill="#64748b" />
        </g>
      ))}
      {/* Impressora em cima */}
      <g transform="translate(0, -20)">
        <rect x="-17" y="-12" width="34" height="14" rx="2.5" fill="#475569" />
        <rect x="-13" y="-16" width="26" height="5" rx="1.5" fill="#f8fafc" />
        <rect x="-11" y="1" width="22" height="3.5" rx="1" fill="#e2e8f0" />
        <circle cx="12" cy="-5" r="1.6" fill="#22c55e" />
      </g>
    </g>
  )
}
