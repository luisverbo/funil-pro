'use client'

// ============================================================================
// Office Preview — a cena do escritório (SVG)
// ----------------------------------------------------------------------------
// Escritório em perspectiva leve, desenhado inteiro em SVG: piso, divisórias,
// três estações com mesa/cadeira/computador, corredor central e os personagens.
//
// A REGRA que não muda desde a V1: a posição do personagem é DERIVADA dos
// eventos (`agent.atDesk`), nunca de um timer. O CSS só interpola entre a
// posição anterior e a nova — se o backend não gravou o handoff, ninguém anda.
//
// Dois layouts: `wide` (mesas lado a lado) e `compact` (zigue-zague, para
// caber no celular sem cortar ninguém nem gerar rolagem horizontal).
// ============================================================================

import React from 'react'
import AgentAvatar, { AGENT_PALETTE } from './agent-avatar'
import { OFFICE_AGENT_ORDER, type AgentView, type OfficeView } from '@/lib/content-studio/view-model'

export type SceneLayout = 'wide' | 'compact'

/** Posição de cada estação, por layout. Coordenadas do viewBox. */
const DESKS: Record<SceneLayout, Record<string, { x: number; y: number }>> = {
  wide: {
    researcher: { x: 130, y: 250 },
    strategist: { x: 400, y: 250 },
    copywriter: { x: 670, y: 250 },
  },
  compact: {
    researcher: { x: 110, y: 150 },
    strategist: { x: 300, y: 300 },
    copywriter: { x: 110, y: 450 },
  },
}

const VIEWBOX: Record<SceneLayout, string> = {
  wide: '0 0 800 380',
  compact: '0 0 420 580',
}

// ─── Mobiliário ─────────────────────────────────────────────────────────────

/** Estação de trabalho: mesa, cadeira, monitor e um objeto decorativo. */
function Workstation({
  x, y, agentKey, active, label,
}: { x: number; y: number; agentKey: string; active: boolean; label: string }) {
  const palette = AGENT_PALETTE[agentKey] ?? AGENT_PALETTE.researcher

  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Tapete do setor */}
      <ellipse cx="0" cy="34" rx="78" ry="30" fill={palette.accent} opacity="0.35" />

      {/* Cadeira (atrás do personagem) */}
      <g transform="translate(0, 4)">
        <rect x="-13" y="-20" width="26" height="26" rx="8" fill="#94a3b8" opacity="0.55" />
        <rect x="-3" y="6" width="6" height="12" rx="3" fill="#64748b" opacity="0.55" />
      </g>

      {/* Mesa */}
      <g>
        <rect x="-62" y="30" width="124" height="13" rx="5" fill="#c8a678" />
        <rect x="-62" y="30" width="124" height="5" rx="2.5" fill="#e0c39a" />
        <rect x="-54" y="43" width="7" height="26" rx="3" fill="#a4794f" />
        <rect x="47" y="43" width="7" height="26" rx="3" fill="#a4794f" />
      </g>

      {/* Monitor — acende quando o agente está trabalhando */}
      <g transform="translate(-30, 8)">
        <rect x="-19" y="-16" width="38" height="26" rx="3" fill="#1e293b" />
        <rect
          x="-16.5" y="-13.5" width="33" height="21" rx="2"
          fill={active ? palette.suit : '#475569'}
          className={active ? 'cs-screen cs-screen--on' : 'cs-screen'}
        />
        {active && (
          <g className="cs-screen-lines" opacity="0.85">
            <rect x="-13" y="-10" width="19" height="2.2" rx="1.1" fill="#fff" />
            <rect x="-13" y="-6" width="25" height="2.2" rx="1.1" fill="#fff" />
            <rect x="-13" y="-2" width="14" height="2.2" rx="1.1" fill="#fff" />
          </g>
        )}
        <rect x="-4" y="10" width="8" height="5" rx="1.5" fill="#334155" />
        <rect x="-11" y="15" width="22" height="3" rx="1.5" fill="#334155" />
      </g>

      {/* Teclado */}
      <rect x="4" y="26" width="30" height="8" rx="2" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="1" />

      {/* Decoração: caneca ou planta, alternando por mesa */}
      {agentKey === 'strategist' ? (
        <g transform="translate(46, 20)">
          <path d="M -6 10 L -4.5 -2 L 4.5 -2 L 6 10 Z" fill="#d97706" opacity="0.8" />
          <path d="M 0 -2 C -7 -6 -6 -15 0 -16 C 6 -15 7 -6 0 -2 Z" fill="#16a34a" />
        </g>
      ) : (
        <g transform="translate(46, 22)">
          <rect x="-5" y="-8" width="10" height="10" rx="2" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1.2" />
          <path d="M 5 -6 a 3 3 0 0 1 0 6" fill="none" stroke="#cbd5e1" strokeWidth="1.2" />
        </g>
      )}

      {/* Placa do setor */}
      <g transform="translate(0, 82)">
        <rect x="-52" y="-11" width="104" height="22" rx="11" fill="#ffffff" stroke={palette.suit} strokeWidth="1.5" />
        <text
          x="0" y="4" textAnchor="middle"
          fontFamily="system-ui, -apple-system, sans-serif" fontSize="12" fontWeight="600"
          fill={palette.suitDark}
        >
          {label}
        </text>
      </g>
    </g>
  )
}

// ─── Cena ───────────────────────────────────────────────────────────────────

export interface OfficeSceneProps {
  view: OfficeView
  layout?: SceneLayout
  reducedMotion?: boolean
  /** Multiplicador de velocidade da animação (1 = normal, 2 = rápido). */
  speed?: number
}

export default function OfficeScene({
  view,
  layout = 'wide',
  reducedMotion = false,
  speed = 1,
}: OfficeSceneProps) {
  const desks = DESKS[layout]
  const byKey = new Map(view.agents.map(a => [a.key, a]))

  // Duração da caminhada: encurta no modo rápido, some com reduced-motion.
  const walkMs = reducedMotion ? 0 : Math.round(1100 / Math.max(speed, 0.25))

  return (
    <svg
      viewBox={VIEWBOX[layout]}
      className="cs-scene"
      role="img"
      aria-label="Escritório virtual com três agentes de conteúdo"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <defs>
        <linearGradient id="cs-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eef2f7" />
          <stop offset="100%" stopColor="#dfe6ef" />
        </linearGradient>
        <linearGradient id="cs-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#e9eef5" />
        </linearGradient>
      </defs>

      <style>{`
        .cs-scene { --cs-walk: ${walkMs}ms; }
        .cs-actor { transition: transform var(--cs-walk) cubic-bezier(.42,.02,.32,1); }
        .cs-screen { transition: fill 320ms ease; }

        @keyframes cs-step {
          0%, 100% { transform: rotate(0deg); }
          50%      { transform: rotate(16deg); }
        }
        @keyframes cs-step-alt {
          0%, 100% { transform: rotate(0deg); }
          50%      { transform: rotate(-16deg); }
        }
        @keyframes cs-bob   { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
        @keyframes cs-type  { 0%,100% { transform: translateY(0); } 50% { transform: translateY(1.6px); } }
        @keyframes cs-blink { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
        @keyframes cs-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-1.5px); } 75% { transform: translateX(1.5px); } }

        .cs-char--walk .cs-leg--l { animation: cs-step ${Math.round(520 / speed)}ms ease-in-out infinite; transform-origin: center top; }
        .cs-char--walk .cs-leg--r { animation: cs-step-alt ${Math.round(520 / speed)}ms ease-in-out infinite; transform-origin: center top; }
        .cs-char--walk .cs-head   { animation: cs-bob ${Math.round(520 / speed)}ms ease-in-out infinite; }
        .cs-char--type .cs-arm--l,
        .cs-char--type .cs-arm--r { animation: cs-type ${Math.round(420 / speed)}ms ease-in-out infinite; transform-origin: center top; }
        .cs-char--type .cs-arm--r { animation-delay: ${Math.round(210 / speed)}ms; }
        .cs-char--error .cs-head  { animation: cs-shake 700ms ease-in-out 3; }
        .cs-screen-lines          { animation: cs-blink ${Math.round(1400 / speed)}ms ease-in-out infinite; }

        /* O usuário mandou parar de mexer: paramos. */
        @media (prefers-reduced-motion: reduce) {
          .cs-actor { transition: none !important; }
          .cs-char--walk .cs-leg--l,
          .cs-char--walk .cs-leg--r,
          .cs-char--walk .cs-head,
          .cs-char--type .cs-arm--l,
          .cs-char--type .cs-arm--r,
          .cs-char--error .cs-head,
          .cs-screen-lines { animation: none !important; }
        }
      `}</style>

      {/* Parede e piso */}
      <rect x="0" y="0" width="100%" height="100%" fill="url(#cs-wall)" />
      <rect
        x="0" y={layout === 'wide' ? 120 : 90}
        width="100%" height="100%" fill="url(#cs-floor)"
      />

      {/* Janelas na parede */}
      {layout === 'wide' && (
        <g opacity="0.9">
          {[90, 350, 610].map(x => (
            <g key={x} transform={`translate(${x}, 26)`}>
              <rect width="100" height="66" rx="8" fill="#bfdbfe" stroke="#cbd5e1" strokeWidth="3" />
              <line x1="50" y1="0" x2="50" y2="66" stroke="#cbd5e1" strokeWidth="3" />
              <circle cx="76" cy="18" r="9" fill="#fef9c3" opacity="0.9" />
            </g>
          ))}
        </g>
      )}

      {/* Linhas do piso — dão a noção de corredor entre as mesas */}
      <g stroke="#cbd5e1" strokeWidth="1" opacity="0.55">
        {layout === 'wide'
          ? [175, 230, 290, 355].map(y => <line key={y} x1="0" y1={y} x2="800" y2={y} />)
          : [140, 200, 260, 320, 380, 440, 500].map(y => <line key={y} x1="0" y1={y} x2="420" y2={y} />)}
      </g>

      {/* Corredor central: o caminho por onde a pasta viaja */}
      <path
        d={layout === 'wide'
          ? 'M 60 318 L 740 318'
          : 'M 180 190 L 300 340 L 180 490'}
        stroke="#94a3b8" strokeWidth="2.5" strokeDasharray="9 9" fill="none" opacity="0.5"
      />

      {/* Estações */}
      {OFFICE_AGENT_ORDER.map(key => {
        const agent = byKey.get(key)
        const pos = desks[key]
        return (
          <Workstation
            key={key}
            x={pos.x} y={pos.y}
            agentKey={key}
            active={agent?.state === 'working'}
            label={agent?.label ?? key}
          />
        )
      })}

      {/* Personagens — camada acima do mobiliário, para caminharem "na frente" */}
      {OFFICE_AGENT_ORDER.map(key => {
        const agent = byKey.get(key)
        if (!agent) return null
        // A posição vem de `atDesk`, que veio dos eventos.
        const alvo = desks[agent.atDesk] ?? desks[key]
        const andando = agent.state === 'walking'
        // Ao chegar na mesa do colega, para ao LADO — não em cima dele.
        const offsetX = andando ? (alvo.x > desks[key].x ? -34 : 34) : 0

        return (
          <g
            key={key}
            className="cs-actor"
            style={{ transform: `translate(${alvo.x + offsetX}px, ${alvo.y}px)` }}
          >
            <AgentAvatar
              agentKey={key}
              state={agent.state}
              carryingFolder={agent.carryingFolder}
              reducedMotion={reducedMotion}
            />
            <Bubble agent={agent} />
          </g>
        )
      })}
    </svg>
  )
}

/** Balão curto acima da cabeça. Some quando não há nada a dizer. */
function Bubble({ agent }: { agent: AgentView }) {
  if (!agent.bubble) return null
  const largura = Math.min(Math.max(agent.bubble.length * 6.1 + 20, 66), 168)

  return (
    <g transform={`translate(0, -34)`} className="cs-bubble">
      <rect
        x={-largura / 2} y="-15" width={largura} height="23" rx="11.5"
        fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.4"
      />
      <path d="M -4 8 L 0 13 L 4 8 Z" fill="#ffffff" stroke="#e2e8f0" strokeWidth="1.4" />
      <text
        x="0" y="0.5" textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif" fontSize="10.5" fill="#334155"
      >
        {agent.bubble.length > 26 ? agent.bubble.slice(0, 25) + '…' : agent.bubble}
      </text>
      {agent.progress && (
        <g transform={`translate(${-largura / 2 + 8}, 4)`}>
          <rect width={largura - 16} height="2.5" rx="1.25" fill="#e2e8f0" />
          <rect
            width={(largura - 16) * (agent.progress.completed / agent.progress.total)}
            height="2.5" rx="1.25" fill="#10b981"
          />
        </g>
      )}
    </g>
  )
}
