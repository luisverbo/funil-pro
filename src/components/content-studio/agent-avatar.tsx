// ============================================================================
// Office Preview V3.1 — personagem articulado (SVG)
// ----------------------------------------------------------------------------
// SVG puro, sem Tailwind e sem imagem externa: a cena se sustenta sozinha e
// pode ser renderizada fora do navegador para gerar capturas.
//
// O QUE MUDOU DA V3 — e por quê a cabeça parecia solta:
//
//   1. o pescoço era um retângulo DESENHADO ATRÁS da cabeça, sem encostar no
//      torso. Agora é um trapézio que NASCE da linha dos ombros e entra sob o
//      queixo, com sombra do maxilar por cima — a cabeça apoia em algo.
//   2. os ombros eram cantos arredondados do torso. Agora são duas cápsulas
//      próprias que cobrem a raiz de cada braço, então o braço sai de DENTRO
//      do ombro em vez de ficar colado ao lado.
//   3. `cs-head` girava com origem no próprio centro, ignorando o corpo. Agora
//      gira na BASE DO PESCOÇO, que é onde uma cabeça de verdade gira, e a
//      rotação é acompanhada por um `cs-upper` (tronco+cabeça+braços) que se
//      move junto — é isso que impede a cabeça de "descolar" ao caminhar.
//
// Proporções: ~5,5 cabeças de altura, ombro ≈ 1,7 cabeça, braço alcançando o
// meio da coxa. Estilizado, mas dentro de proporção real — era a mistura
// (cabeça de mascote em corpo realista) que parecia errada.
//
// Nenhuma animação inventa estado: todas são consequência de `state`, que veio
// dos eventos gravados.
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
  researcher: { suit: '#3b82f6', suitDark: '#1e40af', suitLight: '#93c5fd', accent: '#dbeafe', hair: '#2b3444' },
  strategist: { suit: '#8b5cf6', suitDark: '#5b21b6', suitLight: '#c4b5fd', accent: '#ede9fe', hair: '#4a2c2a' },
  copywriter: { suit: '#f97316', suitDark: '#9a3412', suitLight: '#fdba74', accent: '#ffedd5', hair: '#6d2f10' },
}

const SKIN = '#f7d3b0'
const SKIN_SHADE = '#e2ab80'
const SKIN_DEEP = '#c98f66'
const BLUSH = '#f0a0a0'
const MOUTH = '#a63a52'

/** Adereço do papel, na mão livre. */
function Prop({ agentKey, palette }: { agentKey: string; palette: AgentPalette }) {
  if (agentKey === 'researcher') {
    return (
      <g className="cs-prop">
        <circle r="6" fill={palette.accent} opacity="0.8" stroke={palette.suitDark} strokeWidth="2.1" />
        <path d="M -3.4 -2.6 A 5 5 0 0 1 1 -4.4" stroke="#ffffff" strokeWidth="1.1" fill="none" opacity="0.75" />
        <line x1="4.4" y1="4.4" x2="9" y2="9" stroke={palette.suitDark} strokeWidth="2.6" strokeLinecap="round" />
      </g>
    )
  }
  if (agentKey === 'strategist') {
    return (
      <g className="cs-prop">
        <circle r="6.4" fill="#ffffff" stroke={palette.suitDark} strokeWidth="1.9" />
        <circle r="6.4" fill={palette.accent} opacity="0.55" />
        <path d="M -2.9 2.9 L 1.3 -1.3 L 2.9 -2.9 L -1.3 1.3 Z" fill={palette.suitDark} />
        <circle r="1" fill={palette.suitDark} />
      </g>
    )
  }
  return (
    <g className="cs-prop" transform="rotate(30)">
      <rect x="-1.6" y="-7.6" width="3.2" height="11.4" rx="1.6" fill={palette.suitLight} stroke={palette.suitDark} strokeWidth="1.3" />
      <path d="M -1.6 3.8 L 0 8 L 1.6 3.8 Z" fill={palette.suitDark} />
      <rect x="-1.6" y="-7.6" width="3.2" height="2.8" rx="1.4" fill={palette.suitDark} />
    </g>
  )
}

export interface AgentAvatarProps {
  agentKey: string
  state: AgentVisualState
  carryingFolder: boolean
  /** Acabou de receber a pasta — dispara a postura de recebimento. */
  received?: boolean
  reducedMotion?: boolean
}

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

  // Entregando: parado na mesa de outro, com a pasta na mão.
  const entregando = carryingFolder && !walking
  const parado = !walking && !working

  const classes = [
    'cs-char',
    !reducedMotion && parado && !entregando && !received ? 'cs-char--idle' : '',
    !reducedMotion && walking ? 'cs-char--walk' : '',
    !reducedMotion && working ? 'cs-char--type' : '',
    !reducedMotion && erro ? 'cs-char--error' : '',
    !reducedMotion && pronto ? 'cs-char--cheer' : '',
    !reducedMotion && entregando ? 'cs-char--give' : '',
    !reducedMotion && received ? 'cs-char--receive' : '',
    carryingFolder ? 'cs-char--carry' : '',
  ].filter(Boolean).join(' ')

  return (
    <g className={classes}>
      {/* Sombra de contato, elíptica como o resto da isometria */}
      <ellipse className="cs-shadow" cx="0" cy="54" rx="18" ry="6.2" fill="#0b1220" opacity="0.17" />

      {/* ─── PERNAS — giram no quadril ────────────────────────────────── */}
      <g className="cs-hip" transform="translate(0, 22)">
        {/* Traseira */}
        <g className="cs-leg cs-leg--back">
          <path d="M -4 0 q -3.4 11 -2.6 20" stroke={p.suitDark} strokeWidth="10.5" strokeLinecap="round" fill="none" opacity="0.9" />
          <g className="cs-foot cs-foot--back" transform="translate(-6.6, 22)">
            <path d="M -5.4 0 q 0 -3.4 4 -3.4 q 5.6 0 6.4 2.4 q .6 1.9 -1.6 2.4 l -7.2 0 q -1.6 0 -1.6 -1.4 Z" fill="#2a3342" />
          </g>
        </g>
        {/* Dianteira */}
        <g className="cs-leg cs-leg--front">
          <path d="M 4 0 q 3.4 11 2.6 20" stroke={p.suitDark} strokeWidth="10.5" strokeLinecap="round" fill="none" />
          <g className="cs-foot cs-foot--front" transform="translate(6.6, 22)">
            <path d="M -5.4 0 q 0 -3.4 4 -3.4 q 5.6 0 6.4 2.4 q .6 1.9 -1.6 2.4 l -7.2 0 q -1.6 0 -1.6 -1.4 Z" fill="#1f2733" />
          </g>
        </g>
      </g>

      {/* ─── PARTE SUPERIOR — tronco, ombros, cabeça e braços juntos ────
           Agrupados de propósito: quando o corpo oscila ao caminhar, TUDO
           acompanha. Era a falta disso que fazia a cabeça parecer solta.  */}
      <g className="cs-upper">
        {/* Braço traseiro (atrás do torso) */}
        <g className="cs-arm cs-arm--back" transform="translate(-12.5, -2)">
          <path d="M 0 0 q -4.6 9.5 -2.6 17.5" stroke={p.suitDark} strokeWidth="8.4" strokeLinecap="round" fill="none" opacity="0.92" />
          <circle className="cs-hand cs-hand--back" cx="-2.6" cy="19" r="4.2" fill={SKIN_SHADE} />
        </g>

        {/* Torso: trapézio invertido — ombro largo, cintura estreita */}
        <g className="cs-torso">
          <path
            d="M -13.6 2 Q -14.6 -2.4 -11.4 -4.4 L 11.4 -4.4 Q 14.6 -2.4 13.6 2 L 11.4 22.5 Q 0 25.8 -11.4 22.5 Z"
            fill={p.suit}
          />
          {/* Sombreado do lado oposto à luz */}
          <path d="M 5 -4.4 L 11.4 -4.4 Q 14.6 -2.4 13.6 2 L 11.4 22.5 Q 8 23.5 4.6 24 Z" fill={p.suitDark} opacity="0.26" />

          {/* Camisa em V, ancorada na linha dos ombros */}
          <path d="M -6 -4 L 0 7.4 L 6 -4 Q 0 -6 -6 -4 Z" fill="#ffffff" opacity="0.95" />
          <path d="M 0 7.4 L 2.6 10.6 L 0 19 L -2.6 10.6 Z" fill={p.accent} />

          {/* Cinto */}
          <path d="M -11.8 20.6 Q 0 23.8 11.8 20.6 L 11.5 23.6 Q 0 26.8 -11.5 23.6 Z" fill={p.suitDark} opacity="0.5" />
        </g>

        {/* PESCOÇO — trapézio que nasce dos ombros e entra sob o queixo.
            É a peça que faltava: a cabeça agora apoia em algo. */}
        <g className="cs-neck">
          <path d="M -4.6 -2 L 4.6 -2 L 3.4 -10.5 L -3.4 -10.5 Z" fill={SKIN_SHADE} />
          {/* Sombra projetada pelo maxilar sobre o pescoço */}
          <path d="M -3.9 -10.5 L 3.9 -10.5 L 4.2 -7 Q 0 -4.6 -4.2 -7 Z" fill={SKIN_DEEP} opacity="0.55" />
          {/* Trapézio/clavícula: liga o pescoço aos ombros */}
          <path d="M -13 -3.4 Q -6 -6.4 0 -6.4 Q 6 -6.4 13 -3.4 L 13 -1 Q 0 -3.4 -13 -1 Z" fill={p.suitLight} opacity="0.32" />
        </g>

        {/* OMBROS — cápsulas próprias cobrindo a raiz de cada braço */}
        <ellipse className="cs-shoulder" cx="-12" cy="-1.4" rx="5.6" ry="5.2" fill={p.suit} />
        <ellipse className="cs-shoulder" cx="12" cy="-1.4" rx="5.6" ry="5.2" fill={p.suit} />
        <ellipse cx="12" cy="-1.4" rx="5.6" ry="5.2" fill={p.suitDark} opacity="0.18" />

        {/* ─── CABEÇA — gira na BASE DO PESCOÇO ─────────────────────── */}
        <g className="cs-head">
          {/* Crânio levemente ovalado */}
          <path d="M 0 -32.6 C 8.6 -32.6 12.8 -26.4 12.8 -20.4 C 12.8 -14 8.4 -9 0 -9 C -8.4 -9 -12.8 -14 -12.8 -20.4 C -12.8 -26.4 -8.6 -32.6 0 -32.6 Z" fill={SKIN} />
          {/* Volume: lado oposto à luz */}
          <path d="M 4.6 -32 C 10.4 -30.6 12.8 -25.6 12.8 -20.4 C 12.8 -14 8.4 -9 0 -9 C 3.4 -12 5.4 -15.6 5.4 -20.6 C 5.4 -25 5.2 -29.4 4.6 -32 Z" fill={SKIN_SHADE} opacity="0.32" />
          {/* Queixo */}
          <path d="M -5 -10.8 Q 0 -7.6 5 -10.8 Q 0 -8.6 -5 -10.8 Z" fill={SKIN_DEEP} opacity="0.3" />

          {/* Orelhas, na altura dos olhos */}
          <ellipse cx="-12.6" cy="-19.4" rx="2.5" ry="3.4" fill={SKIN_SHADE} />
          <ellipse cx="12.6" cy="-19.4" rx="2.5" ry="3.4" fill={SKIN_SHADE} />

          {/* Cabelo, acompanhando a curva do crânio */}
          <path d="M -12.8 -21.4 C -12.8 -29.4 -7.4 -33 0 -33 C 7.4 -33 12.8 -29.4 12.8 -21.4 C 12.8 -24.6 8.4 -26.6 0 -26.6 C -8.4 -26.6 -12.8 -24.6 -12.8 -21.4 Z" fill={p.hair} />
          <path d="M -12.6 -22.6 Q -11 -30.6 -3.4 -32.4 Q -8.4 -28 -8 -24.4 Z" fill={p.hair} />
          <path d="M 12.6 -22.6 Q 11 -30.6 3.4 -32.4 Q 8.4 -28 8 -24.4 Z" fill={p.hair} />

          {/* Sobrancelhas — o essencial da expressão */}
          {erro ? (
            <>
              <path d="M -8.6 -23.4 L -3.4 -21.4" stroke={p.hair} strokeWidth="1.8" strokeLinecap="round" />
              <path d="M 8.6 -23.4 L 3.4 -21.4" stroke={p.hair} strokeWidth="1.8" strokeLinecap="round" />
            </>
          ) : pronto || received ? (
            <>
              <path d="M -8.4 -23.8 Q -5.8 -25.8 -3.2 -24.2" stroke={p.hair} strokeWidth="1.7" fill="none" strokeLinecap="round" />
              <path d="M 8.4 -23.8 Q 5.8 -25.8 3.2 -24.2" stroke={p.hair} strokeWidth="1.7" fill="none" strokeLinecap="round" />
            </>
          ) : (
            <>
              <path d="M -8.4 -22.8 Q -5.8 -24.4 -3.2 -23" stroke={p.hair} strokeWidth="1.7" fill="none" strokeLinecap="round" />
              <path d="M 8.4 -22.8 Q 5.8 -24.4 3.2 -23" stroke={p.hair} strokeWidth="1.7" fill="none" strokeLinecap="round" />
            </>
          )}

          {/* Olhos */}
          <g className="cs-eyes">
            <ellipse cx="-5.2" cy="-19" rx="2.2" ry="2.6" fill="#243044" />
            <ellipse cx="5.2" cy="-19" rx="2.2" ry="2.6" fill="#243044" />
            <circle cx="-4.4" cy="-19.9" r="0.8" fill="#ffffff" />
            <circle cx="6" cy="-19.9" r="0.8" fill="#ffffff" />
          </g>

          {/* Nariz — só uma sombra, suficiente nesse tamanho */}
          <path d="M 0 -17.4 Q 1.4 -15.4 0 -14.6" stroke={SKIN_DEEP} strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.65" />

          {/* Bochechas */}
          <ellipse cx="-8" cy="-14.6" rx="2.8" ry="1.8" fill={BLUSH} opacity="0.45" />
          <ellipse cx="8" cy="-14.6" rx="2.8" ry="1.8" fill={BLUSH} opacity="0.45" />

          {/* Boca */}
          {erro ? (
            <path d="M -3.4 -11.4 Q 0 -14 3.4 -11.4" stroke={MOUTH} strokeWidth="1.7" fill="none" strokeLinecap="round" />
          ) : pronto || received ? (
            <path d="M -4 -13.8 Q 0 -9 4 -13.8 Z" fill={MOUTH} opacity="0.9" />
          ) : working ? (
            <ellipse cx="0" cy="-12.4" rx="1.9" ry="1.4" fill={MOUTH} opacity="0.72" />
          ) : (
            <path d="M -3.4 -13.2 Q 0 -10.8 3.4 -13.2" stroke={MOUTH} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          )}
        </g>

        {/* Braço dianteiro (na frente do torso) — carrega a pasta ou o adereço */}
        <g className="cs-arm cs-arm--front" transform="translate(12.5, -2)">
          <path d="M 0 0 q 4.6 9.5 2.6 17.5" stroke={p.suit} strokeWidth="8.4" strokeLinecap="round" fill="none" />
          <g className="cs-hand cs-hand--front" transform="translate(2.6, 19)">
            <circle r="4.2" fill={SKIN} />
            {/* O que a mão segura fica DENTRO dela: acompanha todo gesto */}
            <g transform="translate(1.6, 1.6)">
              {carryingFolder ? <Folder /> : <Prop agentKey={agentKey} palette={p} />}
            </g>
            {/* Dedos por cima da pasta: a mão SEGURA, não encosta */}
            {carryingFolder && (
              <path d="M -2.6 1.4 q 2.6 -2.4 5.4 -0.6" stroke={SKIN_SHADE} strokeWidth="2.2" fill="none" strokeLinecap="round" />
            )}
          </g>
        </g>
      </g>

      {/* ─── Selo de estado ───────────────────────────────────────────── */}
      {(pronto || erro || state === 'queued') && (
        <g className="cs-badge" transform="translate(15, -30)">
          <circle r="8.2" fill="#ffffff" opacity="0.96" />
          <circle r="6.9" fill={pronto ? '#10b981' : erro ? '#ef4444' : '#0ea5e9'} />
          {pronto && (
            <path d="M -3 0.2 L -0.9 2.4 L 3.2 -2" stroke="#fff" strokeWidth="2" fill="none"
              strokeLinecap="round" strokeLinejoin="round" />
          )}
          {erro && (
            <>
              <line x1="0" y1="-3.3" x2="0" y2="1.2" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              <circle cx="0" cy="3.7" r="1.1" fill="#fff" />
            </>
          )}
          {state === 'queued' && (
            <path d="M 0 -3.5 L 0 0.2 L 2.7 1.9" stroke="#fff" strokeWidth="1.9" fill="none" strokeLinecap="round" />
          )}
        </g>
      )}
    </g>
  )
}

/** A pasta entregue no handoff. */
function Folder() {
  return (
    <g className="cs-folder">
      <path d="M -9 -6.6 L -9 -10 L -2.6 -10 L -0.6 -7.2 L 9 -7.2 L 9 -5.6 Z" fill="#e08c0b" />
      <rect x="-9" y="-6.6" width="18" height="13.2" rx="2.2" fill="#fbbf24" stroke="#a3560a" strokeWidth="1.5" />
      <rect x="-6" y="-3.2" width="12" height="1.8" rx="0.9" fill="#fff8e1" />
      <rect x="-6" y="0" width="8.5" height="1.8" rx="0.9" fill="#fff8e1" />
      <rect x="-6" y="3.2" width="10" height="1.8" rx="0.9" fill="#fff8e1" opacity="0.8" />
      <rect className="cs-folder-glow" x="-10.6" y="-8.2" width="21.2" height="16.4" rx="3"
        fill="none" stroke="#fde047" strokeWidth="2" opacity="0.85" />
    </g>
  )
}
