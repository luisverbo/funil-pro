// ============================================================================
// Office Preview — personagem de corpo inteiro (SVG)
// ----------------------------------------------------------------------------
// SVG puro, sem dependência de Tailwind nem de imagem externa: a cena precisa
// se sustentar sozinha, e isso também permite renderizá-la fora do navegador
// para gerar capturas.
//
// Cada agente tem paleta e adereço próprios — é o que faz o usuário reconhecer
// quem é quem sem ler o rótulo.
// ============================================================================

import React from 'react'
import type { AgentVisualState } from '@/lib/content-studio/view-model'

export interface AgentPalette {
  /** Roupa (tronco e pernas). */
  suit: string
  suitDark: string
  /** Detalhe do adereço. */
  accent: string
}

export const AGENT_PALETTE: Record<string, AgentPalette> = {
  researcher: { suit: '#3b82f6', suitDark: '#1d4ed8', accent: '#bfdbfe' },
  strategist: { suit: '#8b5cf6', suitDark: '#6d28d9', accent: '#ddd6fe' },
  copywriter: { suit: '#f97316', suitDark: '#c2410c', accent: '#fed7aa' },
}

const SKIN = '#f2c8a0'
const SKIN_DARK = '#dfa87a'
const HAIR: Record<string, string> = {
  researcher: '#1f2937',
  strategist: '#4b2e2e',
  copywriter: '#78350f',
}

/** Adereço que identifica o papel, na mão do personagem. */
function Prop({ agentKey, palette }: { agentKey: string; palette: AgentPalette }) {
  if (agentKey === 'researcher') {
    // Lupa
    return (
      <g transform="translate(15, 26)">
        <circle cx="0" cy="0" r="5" fill="none" stroke={palette.suitDark} strokeWidth="2" />
        <circle cx="0" cy="0" r="4" fill={palette.accent} opacity="0.5" />
        <line x1="3.5" y1="3.5" x2="7" y2="7" stroke={palette.suitDark} strokeWidth="2" strokeLinecap="round" />
      </g>
    )
  }
  if (agentKey === 'strategist') {
    // Bússola
    return (
      <g transform="translate(15, 26)">
        <circle cx="0" cy="0" r="5.5" fill={palette.accent} stroke={palette.suitDark} strokeWidth="1.6" />
        <path d="M -2.5 2.5 L 1 -1 L 2.5 -2.5 L -1 1 Z" fill={palette.suitDark} />
      </g>
    )
  }
  // Caneta
  return (
    <g transform="translate(15, 24) rotate(35)">
      <rect x="-1.4" y="-6" width="2.8" height="10" rx="1" fill={palette.accent} stroke={palette.suitDark} strokeWidth="1.2" />
      <path d="M -1.4 4 L 0 7 L 1.4 4 Z" fill={palette.suitDark} />
    </g>
  )
}

export interface AgentAvatarProps {
  agentKey: string
  state: AgentVisualState
  carryingFolder: boolean
  /** Desliga oscilações contínuas (respeita prefers-reduced-motion). */
  reducedMotion?: boolean
}

/**
 * Personagem visto de frente, com cabeça, tronco, braços e pernas.
 *
 * As pernas só se alternam quando ele está caminhando; sentado, ficam sob a
 * mesa. Nenhuma animação aqui inventa estado — todas são consequência do
 * `state`, que veio dos eventos.
 */
export default function AgentAvatar({
  agentKey,
  state,
  carryingFolder,
  reducedMotion = false,
}: AgentAvatarProps) {
  const palette = AGENT_PALETTE[agentKey] ?? AGENT_PALETTE.researcher
  const hair = HAIR[agentKey] ?? '#1f2937'

  const walking = state === 'walking'
  const working = state === 'working'
  const erro = state === 'error'

  const classes = [
    'cs-char',
    walking && !reducedMotion ? 'cs-char--walk' : '',
    working && !reducedMotion ? 'cs-char--type' : '',
    erro ? 'cs-char--error' : '',
  ].filter(Boolean).join(' ')

  return (
    <g className={classes}>
      {/* Sombra no chão */}
      <ellipse cx="0" cy="46" rx="13" ry="4" fill="#0f172a" opacity="0.12" />

      {/* Pernas — juntas quando sentado, alternando ao caminhar */}
      <g className="cs-legs">
        <rect className="cs-leg cs-leg--l" x="-8" y="28" width="6.5" height="17" rx="3" fill={palette.suitDark} />
        <rect className="cs-leg cs-leg--r" x="1.5" y="28" width="6.5" height="17" rx="3" fill={palette.suitDark} />
        {/* Sapatos */}
        <rect x="-9.5" y="43" width="8.5" height="4" rx="2" fill="#1f2937" />
        <rect x="1" y="43" width="8.5" height="4" rx="2" fill="#1f2937" />
      </g>

      {/* Tronco */}
      <rect x="-10" y="8" width="20" height="22" rx="7" fill={palette.suit} />
      {/* Gola */}
      <path d="M -4 8 L 0 13 L 4 8 Z" fill="#ffffff" opacity="0.85" />

      {/* Braços */}
      <g className="cs-arm cs-arm--l">
        <rect x="-15" y="11" width="5.5" height="15" rx="2.75" fill={palette.suit} />
        <circle cx="-12.2" cy="27" r="3" fill={SKIN} />
      </g>
      <g className="cs-arm cs-arm--r">
        <rect x="9.5" y="11" width="5.5" height="15" rx="2.75" fill={palette.suit} />
        <circle cx="12.2" cy="27" r="3" fill={SKIN} />
      </g>

      {/* Cabeça */}
      <g className="cs-head">
        <circle cx="0" cy="-2" r="9.5" fill={SKIN} />
        <path d="M -9.5 -4 A 9.5 9.5 0 0 1 9.5 -4 L 9.5 -6 A 9.5 9.5 0 0 0 -9.5 -6 Z" fill={hair} />
        <path d="M -9.6 -5 A 9.6 9.6 0 0 1 9.6 -5 L 9.6 -8 A 9.6 9.6 0 0 0 -9.6 -8 Z" fill={hair} />
        {/* Olhos */}
        <circle cx="-3.4" cy="-1.5" r="1.25" fill="#1f2937" />
        <circle cx="3.4" cy="-1.5" r="1.25" fill="#1f2937" />
        {/* Boca — muda com o estado */}
        {erro ? (
          <path d="M -3 4 Q 0 1.5 3 4" stroke="#b91c1c" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        ) : state === 'done' ? (
          <path d="M -3.5 2.5 Q 0 6 3.5 2.5" stroke={SKIN_DARK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M -2.5 3.2 L 2.5 3.2" stroke={SKIN_DARK} strokeWidth="1.4" fill="none" strokeLinecap="round" />
        )}
      </g>

      {/* Adereço do papel — escondido enquanto carrega a pasta */}
      {!carryingFolder && <Prop agentKey={agentKey} palette={palette} />}

      {/* Pasta sendo carregada, na mão */}
      {carryingFolder && (
        <g className="cs-folder" transform="translate(14, 24)">
          <rect x="-6" y="-5" width="12" height="9.5" rx="1.6" fill="#f59e0b" stroke="#b45309" strokeWidth="1.2" />
          <path d="M -6 -5 L -6 -7 L -1.5 -7 L -0.2 -5 Z" fill="#fbbf24" stroke="#b45309" strokeWidth="1.2" />
          <line x1="-3.5" y1="-1.5" x2="3.5" y2="-1.5" stroke="#fef3c7" strokeWidth="1.1" />
          <line x1="-3.5" y1="1" x2="1.5" y2="1" stroke="#fef3c7" strokeWidth="1.1" />
        </g>
      )}

      {/* Selo de conclusão / erro */}
      {state === 'done' && (
        <g transform="translate(11, -9)">
          <circle r="6" fill="#10b981" />
          <path d="M -2.6 0.2 L -0.8 2 L 2.8 -1.8" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {erro && (
        <g transform="translate(11, -9)">
          <circle r="6" fill="#ef4444" />
          <line x1="0" y1="-2.8" x2="0" y2="1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="0" cy="3.1" r="1" fill="#fff" />
        </g>
      )}
      {state === 'queued' && (
        <g transform="translate(11, -9)">
          <circle r="6" fill="#0ea5e9" />
          <path d="M 0 -3 L 0 0 L 2.2 1.4" stroke="#fff" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        </g>
      )}
    </g>
  )
}
