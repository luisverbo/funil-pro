// ============================================================================
// Office Preview V3 — personagem articulado (SVG)
// ----------------------------------------------------------------------------
// SVG puro, sem Tailwind e sem imagem externa: a cena precisa se sustentar
// sozinha, e isso permite renderizá-la fora do navegador para gerar capturas.
//
// O que mudou da V2: o corpo deixou de ser um empilhado de retângulos. Agora
// cada membro é um GRUPO com origem de rotação na articulação (ombro, quadril),
// e as animações giram esses grupos. É isso que tira a dureza — um braço que
// gira no ombro parece um braço; um retângulo que translada parece uma peça.
//
// Nenhuma animação aqui inventa estado: todas são consequência de `state`, que
// veio dos eventos gravados.
// ============================================================================

import React from 'react'
import type { AgentVisualState } from '@/lib/content-studio/view-model'

export interface AgentPalette {
  suit: string
  suitDark: string
  suitLight: string
  accent: string
  hair: string
}

export const AGENT_PALETTE: Record<string, AgentPalette> = {
  researcher: { suit: '#3b82f6', suitDark: '#1e40af', suitLight: '#93c5fd', accent: '#dbeafe', hair: '#27303f' },
  strategist: { suit: '#8b5cf6', suitDark: '#5b21b6', suitLight: '#c4b5fd', accent: '#ede9fe', hair: '#4a2c2a' },
  copywriter: { suit: '#f97316', suitDark: '#9a3412', suitLight: '#fdba74', accent: '#ffedd5', hair: '#7c2d12' },
}

const SKIN = '#f6d0ac'
const SKIN_SHADE = '#e0ac82'
const BLUSH = '#f3a3a3'

/** Adereço do papel, na mão livre. Reforça a personalidade de cada um. */
function Prop({ agentKey, palette }: { agentKey: string; palette: AgentPalette }) {
  if (agentKey === 'researcher') {
    return (
      <g transform="translate(0, 2)" className="cs-prop">
        <circle r="6.2" fill={palette.accent} opacity="0.75" stroke={palette.suitDark} strokeWidth="2.2" />
        <circle r="6.2" fill="none" stroke="#ffffff" strokeWidth="0.8" opacity="0.6" />
        <line x1="4.6" y1="4.6" x2="9.5" y2="9.5" stroke={palette.suitDark} strokeWidth="2.6" strokeLinecap="round" />
      </g>
    )
  }
  if (agentKey === 'strategist') {
    return (
      <g transform="translate(0, 2)" className="cs-prop">
        <circle r="6.6" fill="#ffffff" stroke={palette.suitDark} strokeWidth="2" />
        <circle r="6.6" fill={palette.accent} opacity="0.6" />
        <path d="M -3 3 L 1.4 -1.4 L 3 -3 L -1.4 1.4 Z" fill={palette.suitDark} />
        <circle r="1.1" fill={palette.suitDark} />
      </g>
    )
  }
  return (
    <g transform="translate(0, 1) rotate(28)" className="cs-prop">
      <rect x="-1.7" y="-8" width="3.4" height="12" rx="1.7" fill={palette.suitLight} stroke={palette.suitDark} strokeWidth="1.4" />
      <path d="M -1.7 4 L 0 8.5 L 1.7 4 Z" fill={palette.suitDark} />
      <rect x="-1.7" y="-8" width="3.4" height="3" rx="1.5" fill={palette.suitDark} />
    </g>
  )
}

export interface AgentAvatarProps {
  agentKey: string
  state: AgentVisualState
  carryingFolder: boolean
  /** Acabou de receber a pasta — dispara o aceno de reconhecimento. */
  received?: boolean
  reducedMotion?: boolean
}

/**
 * Personagem em três quartos, com proporção de avatar de jogo casual:
 * cabeça grande (~1/3 do corpo), tronco curto, membros arredondados.
 */
export default function AgentAvatar({
  agentKey,
  state,
  carryingFolder,
  received = false,
  reducedMotion = false,
}: AgentAvatarProps) {
  const p = AGENT_PALETTE[agentKey] ?? AGENT_PALETTE.researcher

  const walking = state === 'walking'
  const working = state === 'working'
  const erro = state === 'error'
  const pronto = state === 'done'

  // `idle` é a respiração: existe em qualquer estado parado, e é o que separa
  // "personagem vivo" de "boneco colado na tela".
  const parado = !walking && !working
  const classes = [
    'cs-char',
    !reducedMotion && parado ? 'cs-char--idle' : '',
    !reducedMotion && walking ? 'cs-char--walk' : '',
    !reducedMotion && working ? 'cs-char--type' : '',
    !reducedMotion && erro ? 'cs-char--error' : '',
    !reducedMotion && pronto ? 'cs-char--cheer' : '',
    !reducedMotion && received ? 'cs-char--receive' : '',
  ].filter(Boolean).join(' ')

  return (
    <g className={classes}>
      {/* Sombra própria no chão, achatada como o resto da cena */}
      <ellipse className="cs-shadow" cx="0" cy="52" rx="17" ry="6" fill="#0b1220" opacity="0.16" />

      {/* ─── Pernas: giram no QUADRIL ─────────────────────────────────── */}
      <g className="cs-hip" transform="translate(0, 24)">
        <g className="cs-leg cs-leg--back">
          <path d="M -3.2 0 q -4 12 -3.4 22" stroke={p.suitDark} strokeWidth="9.5" strokeLinecap="round" fill="none" />
          <ellipse cx="-7.4" cy="25" rx="6.4" ry="3.6" fill="#273142" />
        </g>
        <g className="cs-leg cs-leg--front">
          <path d="M 3.2 0 q 4 12 3.4 22" stroke={p.suitDark} strokeWidth="9.5" strokeLinecap="round" fill="none" />
          <ellipse cx="7.4" cy="25" rx="6.4" ry="3.6" fill="#1f2937" />
        </g>
      </g>

      {/* ─── Tronco ───────────────────────────────────────────────────── */}
      <g className="cs-torso">
        {/* Corpo com ombros arredondados */}
        <path
          d="M -12.5 4 Q -13.5 -3 -6 -5 L 6 -5 Q 13.5 -3 12.5 4 L 11 24 Q 0 27.5 -11 24 Z"
          fill={p.suit}
        />
        {/* Sombreado lateral — dá volume ao torso */}
        <path d="M 4 -4.6 Q 13.4 -3 12.5 4 L 11 24 Q 6 25.6 3 25.8 Z" fill={p.suitDark} opacity="0.28" />
        {/* Camisa por baixo */}
        <path d="M -5.5 -4.6 L 0 6 L 5.5 -4.6 Q 0 -7 -5.5 -4.6 Z" fill="#ffffff" opacity="0.92" />
        {/* Gravata/detalhe do papel */}
        <path d="M 0 6 L 2.4 9 L 0 18 L -2.4 9 Z" fill={p.accent} opacity="0.95" />
        {/* Cinto */}
        <path d="M -11.4 22 Q 0 25 11.4 22 L 11 25 Q 0 28 -11 25 Z" fill={p.suitDark} opacity="0.55" />
      </g>

      {/* ─── Braços: giram no OMBRO ───────────────────────────────────── */}
      <g className="cs-arm cs-arm--back" transform="translate(-11, -1)">
        <path d="M 0 0 q -5.5 10 -3.5 19" stroke={p.suit} strokeWidth="8" strokeLinecap="round" fill="none" />
        <circle cx="-3.4" cy="20.5" r="4.1" fill={SKIN} />
      </g>

      <g className="cs-arm cs-arm--front" transform="translate(11, -1)">
        <path d="M 0 0 q 5.5 10 3.5 19" stroke={p.suit} strokeWidth="8" strokeLinecap="round" fill="none" />
        <circle cx="3.4" cy="20.5" r="4.1" fill={SKIN} />
        {/* O que a mão segura fica ancorado NELA, então acompanha o gesto */}
        <g transform="translate(3.4, 20.5)">
          {carryingFolder ? <Folder /> : <Prop agentKey={agentKey} palette={p} />}
        </g>
      </g>

      {/* ─── Cabeça: gira no PESCOÇO ──────────────────────────────────── */}
      <g className="cs-head" transform="translate(0, -8)">
        {/* Pescoço */}
        <rect x="-3.4" y="4" width="6.8" height="6" rx="3" fill={SKIN_SHADE} />
        {/* Rosto */}
        <ellipse cx="0" cy="-4" rx="12.4" ry="12.8" fill={SKIN} />
        <ellipse cx="4.5" cy="-3" rx="7.8" ry="11" fill={SKIN_SHADE} opacity="0.22" />

        {/* Orelhas */}
        <ellipse cx="-12" cy="-3" rx="2.4" ry="3.2" fill={SKIN_SHADE} />
        <ellipse cx="12" cy="-3" rx="2.4" ry="3.2" fill={SKIN_SHADE} />

        {/* Cabelo */}
        <path d="M -12.4 -6 Q -11 -18 0 -17.6 Q 11 -18 12.4 -6 Q 9 -12 0 -11.6 Q -9 -12 -12.4 -6 Z" fill={p.hair} />
        <path d="M -12.4 -5 Q -13.6 -14 -6 -17 Q 0 -19.4 6 -17 Q 13.6 -14 12.4 -5 L 12.4 -8 Q 8 -14.4 0 -14.4 Q -8 -14.4 -12.4 -8 Z" fill={p.hair} />

        {/* Sobrancelhas — a expressão mora aqui */}
        {erro ? (
          <>
            <path d="M -8.6 -7.6 L -3.2 -5.6" stroke={p.hair} strokeWidth="1.7" strokeLinecap="round" />
            <path d="M 8.6 -7.6 L 3.2 -5.6" stroke={p.hair} strokeWidth="1.7" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M -8.6 -6.4 Q -6 -8 -3.4 -6.6" stroke={p.hair} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M 8.6 -6.4 Q 6 -8 3.4 -6.6" stroke={p.hair} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </>
        )}

        {/* Olhos */}
        <g className="cs-eyes">
          <ellipse cx="-5" cy="-2.4" rx="2.1" ry="2.5" fill="#20293a" />
          <ellipse cx="5" cy="-2.4" rx="2.1" ry="2.5" fill="#20293a" />
          <circle cx="-4.3" cy="-3.3" r="0.75" fill="#ffffff" />
          <circle cx="5.7" cy="-3.3" r="0.75" fill="#ffffff" />
        </g>

        {/* Bochechas */}
        <ellipse cx="-8" cy="1.6" rx="2.6" ry="1.7" fill={BLUSH} opacity="0.5" />
        <ellipse cx="8" cy="1.6" rx="2.6" ry="1.7" fill={BLUSH} opacity="0.5" />

        {/* Boca */}
        {erro ? (
          <path d="M -3.4 6.4 Q 0 3.6 3.4 6.4" stroke="#a8324a" strokeWidth="1.7" fill="none" strokeLinecap="round" />
        ) : pronto || received ? (
          <path d="M -4 3.6 Q 0 8.6 4 3.6 Z" fill="#a8324a" opacity="0.85" />
        ) : working ? (
          <ellipse cx="0" cy="5" rx="2" ry="1.5" fill="#a8324a" opacity="0.7" />
        ) : (
          <path d="M -3.4 4.4 Q 0 6.8 3.4 4.4" stroke="#a8324a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        )}
      </g>

      {/* ─── Selo de estado ───────────────────────────────────────────── */}
      {(pronto || erro || state === 'queued') && (
        <g className="cs-badge" transform="translate(14, -22)">
          <circle r="8" fill="#ffffff" opacity="0.95" />
          <circle r="6.8" fill={pronto ? '#10b981' : erro ? '#ef4444' : '#0ea5e9'} />
          {pronto && (
            <path d="M -3 0.2 L -0.9 2.4 L 3.2 -2" stroke="#fff" strokeWidth="2" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
          )}
          {erro && (
            <>
              <line x1="0" y1="-3.2" x2="0" y2="1.2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              <circle cx="0" cy="3.6" r="1.1" fill="#fff" />
            </>
          )}
          {state === 'queued' && (
            <path d="M 0 -3.4 L 0 0.2 L 2.6 1.8" stroke="#fff" strokeWidth="1.9" fill="none" strokeLinecap="round" />
          )}
        </g>
      )}
    </g>
  )
}

/** A pasta entregue no handoff. Colorida e com brilho — precisa saltar. */
function Folder() {
  return (
    <g className="cs-folder" transform="translate(1, 1)">
      <ellipse cx="0" cy="8" rx="9" ry="2.6" fill="#0b1220" opacity="0.14" />
      <path d="M -9 -7 L -9 -10.5 L -2.6 -10.5 L -0.6 -7.6 L 9 -7.6 L 9 -6 Z" fill="#f59e0b" />
      <rect x="-9" y="-7" width="18" height="13.5" rx="2.2" fill="#fbbf24" stroke="#b45309" strokeWidth="1.5" />
      <rect x="-6" y="-3.6" width="12" height="1.7" rx="0.85" fill="#fff8e1" />
      <rect x="-6" y="-0.4" width="8.5" height="1.7" rx="0.85" fill="#fff8e1" />
      <rect x="-6" y="2.8" width="10" height="1.7" rx="0.85" fill="#fff8e1" opacity="0.8" />
      {/* Brilho pulsante: a pasta é o objeto mais importante da cena */}
      <rect className="cs-folder-glow" x="-10.4" y="-8.4" width="20.8" height="16.3" rx="3"
        fill="none" stroke="#fde047" strokeWidth="2" opacity="0.85" />
    </g>
  )
}
