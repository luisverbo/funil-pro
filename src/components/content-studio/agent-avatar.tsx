// ============================================================================
// Office Preview V4 — personagem montado sobre o rig
// ----------------------------------------------------------------------------
// Cadeia completa, do chão para cima:
//
//   root → pelvis → { hipL/R → kneeL/R → ankleL/R }
//                 → spine → torso
//                         → neck → head
//                         → shoulderL/R → elbowL/R → wristL/R → mão
//
// Cada junta é um par Socket (posição, atributo) + Joint (rotação, classe).
// Nenhuma junta animada carrega `transform` como atributo — é isso que impede
// as peças de saltarem quando uma animação começa ou termina.
//
// Consequência prática: um keyframe só precisa dizer `rotate(N deg)`. Não há
// translate para esquecer, e o repouso é sempre o desenho parado.
//
// Nenhuma animação inventa estado: as classes vêm de `state`, que veio dos
// eventos gravados em cs_events.
// ============================================================================

import React from 'react'
import { Blob, Bone, Joint, Shoe, Socket } from './agent-rig'
import type { AmbientAction } from './ambient-motion'
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

// Medidas do rig. Ficam juntas para a proporção ser lida de uma vez:
// ~5,5 cabeças de altura, ombro ≈ 1,7 cabeça, braço alcançando o meio da coxa.
const R = {
  pelvisY: 22,      // quadril, a partir do centro do torso
  hipX: 4.2,        // afastamento lateral das pernas
  thigh: 12,
  shin: 11,
  shoulderX: 12.2,  // meia-largura do ombro
  shoulderY: -2,
  upperArm: 10,
  forearm: 9.5,
  neckY: -3,
  headY: -9,
} as const

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

/** A pasta do handoff. */
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

/** Perna completa: coxa → joelho → canela → tornozelo → pé. */
function Leg({
  side, palette, mirrored,
}: { side: 'L' | 'R'; palette: AgentPalette; mirrored: boolean }) {
  const cor = side === 'L' ? palette.suitDark : palette.suitDark
  const sombra = side === 'L' ? 0.88 : 1

  return (
    <Socket x={mirrored ? -R.hipX : R.hipX}>
      <Joint name={side === 'L' ? 'hipL' : 'hipR'}>
        <Bone length={R.thigh} width={10.6} color={cor} opacity={sombra} curve={mirrored ? -1 : 1} />
        <Socket y={R.thigh}>
          <Joint name={side === 'L' ? 'kneeL' : 'kneeR'}>
            <Blob r={4.6} color={cor} opacity={sombra} />
            <Bone length={R.shin} width={9} color={cor} opacity={sombra} />
            <Socket y={R.shin}>
              <Joint name={side === 'L' ? 'ankleL' : 'ankleR'}>
                <Shoe color={side === 'L' ? '#2a3342' : '#1f2733'} mirrored={mirrored} />
              </Joint>
            </Socket>
          </Joint>
        </Socket>
      </Joint>
    </Socket>
  )
}

/** Braço completo: ombro → braço → cotovelo → antebraço → punho → mão. */
function Arm({
  side, palette, mirrored, children,
}: {
  side: 'L' | 'R'
  palette: AgentPalette
  mirrored: boolean
  /** O que a mão segura — ancorado no punho, então acompanha todo o gesto. */
  children?: React.ReactNode
}) {
  const cor = mirrored ? palette.suitDark : palette.suit
  const op = mirrored ? 0.94 : 1

  return (
    <Socket x={mirrored ? -R.shoulderX : R.shoulderX} y={R.shoulderY}>
      {/* Ombro: massa própria cobrindo a raiz do braço */}
      <Blob r={5.6} color={cor} opacity={op} />
      <Joint name={side === 'L' ? 'shoulderL' : 'shoulderR'}>
        <Bone length={R.upperArm} width={8.4} color={cor} opacity={op} curve={mirrored ? -0.8 : 0.8} />
        <Socket y={R.upperArm}>
          <Joint name={side === 'L' ? 'elbowL' : 'elbowR'}>
            <Blob r={4.1} color={cor} opacity={op} />
            <Bone length={R.forearm} width={7.6} color={cor} opacity={op} />
            <Socket y={R.forearm}>
              <Joint name={side === 'L' ? 'wristL' : 'wristR'}>
                <Blob r={4.2} color={mirrored ? SKIN_SHADE : SKIN} />
                {children}
              </Joint>
            </Socket>
          </Joint>
        </Socket>
      </Joint>
    </Socket>
  )
}

export interface AgentAvatarProps {
  agentKey: string
  state: AgentVisualState
  carryingFolder: boolean
  received?: boolean
  reducedMotion?: boolean
  /** Caminhando por rotina ambiental (cosmético). Nunca durante a tarefa. */
  ambientWalking?: boolean
  /** Ação no ponto de destino: alcançar, apontar, observar, ler. */
  ambientAction?: AmbientAction | null
}

export default function AgentAvatar({
  agentKey,
  state,
  carryingFolder,
  received = false,
  reducedMotion = false,
  ambientWalking = false,
  ambientAction = null,
}: AgentAvatarProps) {
  const p = AGENT_PALETTE[agentKey] ?? AGENT_PALETTE.researcher

  const walking = state === 'walking'
  const working = state === 'working'
  const erro = state === 'error'
  const pronto = state === 'done'
  const entregando = carryingFolder && !walking
  // A tarefa sempre vence: rotina ambiental só existe se nada real acontece.
  const semTarefa = state === 'idle'
  const andandoAmbiente = ambientWalking && semTarefa && !reducedMotion
  const acao = semTarefa && !reducedMotion ? ambientAction : null
  const parado = !walking && !working && !andandoAmbiente

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
    // Locomoção ambiental: o MESMO ciclo de passos do handoff. O que muda é
    // apenas quem escolheu o destino.
    andandoAmbiente ? 'cs-char--walk cs-char--amb-walk' : '',
    // Pose no ponto de destino.
    acao ? `cs-char--act-${acao}` : '',
  ].filter(Boolean).join(' ')

  return (
    <g className={classes}>
      {/* Sombra de contato */}
      <ellipse className="cs-shadow" cx="0" cy="54" rx="18" ry="6.2" fill="#0b1220" opacity="0.17" />

      <Joint name="root">
        {/* ─── PELVE — raiz de tudo que fica abaixo da cintura ────────── */}
        <Socket y={R.pelvisY}>
          <Joint name="pelvis">
            {/* Bacia: liga visualmente o tronco às duas pernas. Sem ela, a
                cintura fica "aberta" e o tronco parece flutuar sobre elas. */}
            <path d="M -11.6 -2.6 Q 0 1.4 11.6 -2.6 L 9.4 4.2 Q 0 7.2 -9.4 4.2 Z" fill={p.suitDark} />
            <Leg side="L" palette={p} mirrored />
            <Leg side="R" palette={p} mirrored={false} />
          </Joint>
        </Socket>

        {/* ─── COLUNA — raiz de tudo acima da cintura ─────────────────── */}
        <Joint name="spine">
          {/* Braço de trás, atrás do torso */}
          <Arm side="L" palette={p} mirrored />

          {/* Torso */}
          <g className="cs-torso">
            <path
              d="M -13.6 2 Q -14.6 -2.4 -11.4 -4.4 L 11.4 -4.4 Q 14.6 -2.4 13.6 2 L 11.4 22.5 Q 0 25.8 -11.4 22.5 Z"
              fill={p.suit}
            />
            <path d="M 5 -4.4 L 11.4 -4.4 Q 14.6 -2.4 13.6 2 L 11.4 22.5 Q 8 23.5 4.6 24 Z" fill={p.suitDark} opacity="0.26" />
            <path d="M -6 -4 L 0 7.4 L 6 -4 Q 0 -6 -6 -4 Z" fill="#ffffff" opacity="0.95" />
            <path d="M 0 7.4 L 2.6 10.6 L 0 19 L -2.6 10.6 Z" fill={p.accent} />
            <path d="M -11.8 20.6 Q 0 23.8 11.8 20.6 L 11.5 23.6 Q 0 26.8 -11.5 23.6 Z" fill={p.suitDark} opacity="0.5" />
          </g>

          {/* ─── PESCOÇO → CABEÇA ────────────────────────────────────── */}
          <Socket y={R.neckY}>
            <Joint name="neck">
              {/* Trapézio ligando pescoço aos ombros */}
              <path d="M -13 -0.4 Q -6 -3.4 0 -3.4 Q 6 -3.4 13 -0.4 L 13 2 Q 0 -0.4 -13 2 Z" fill={p.suitLight} opacity="0.32" />
              {/* Coluna cervical: nasce nos ombros, entra sob o queixo */}
              <path d="M -4.6 1 L 4.6 1 L 3.4 -7.5 L -3.4 -7.5 Z" fill={SKIN_SHADE} />
              <path d="M -3.9 -7.5 L 3.9 -7.5 L 4.2 -4 Q 0 -1.6 -4.2 -4 Z" fill={SKIN_DEEP} opacity="0.55" />

              <Socket y={R.headY}>
                <Joint name="head">
                  <Head palette={p} state={state} received={received} />
                </Joint>
              </Socket>
            </Joint>
          </Socket>

          {/* Braço da frente — carrega a pasta ou o adereço */}
          <Arm side="R" palette={p} mirrored={false}>
            <g transform="translate(1.6, 1.6)">
              {carryingFolder ? <Folder /> : <Prop agentKey={agentKey} palette={p} />}
            </g>
            {carryingFolder && (
              <path d="M -2.6 1.4 q 2.6 -2.4 5.4 -0.6" stroke={SKIN_SHADE} strokeWidth="2.2" fill="none" strokeLinecap="round" />
            )}
          </Arm>
        </Joint>
      </Joint>

      {/* Selo de estado */}
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

/** Cabeça: crânio, cabelo, rosto. Desenhada a partir da base do pescoço. */
function Head({
  palette, state, received,
}: { palette: AgentPalette; state: AgentVisualState; received: boolean }) {
  const erro = state === 'error'
  const pronto = state === 'done'
  const working = state === 'working'

  return (
    <>
      <path d="M 0 -23.6 C 8.6 -23.6 12.8 -17.4 12.8 -11.4 C 12.8 -5 8.4 0 0 0 C -8.4 0 -12.8 -5 -12.8 -11.4 C -12.8 -17.4 -8.6 -23.6 0 -23.6 Z" fill={SKIN} />
      <path d="M 4.6 -23 C 10.4 -21.6 12.8 -16.6 12.8 -11.4 C 12.8 -5 8.4 0 0 0 C 3.4 -3 5.4 -6.6 5.4 -11.6 C 5.4 -16 5.2 -20.4 4.6 -23 Z" fill={SKIN_SHADE} opacity="0.32" />
      <path d="M -5 -1.8 Q 0 1.4 5 -1.8 Q 0 0.4 -5 -1.8 Z" fill={SKIN_DEEP} opacity="0.3" />

      <ellipse cx="-12.6" cy="-10.4" rx="2.5" ry="3.4" fill={SKIN_SHADE} />
      <ellipse cx="12.6" cy="-10.4" rx="2.5" ry="3.4" fill={SKIN_SHADE} />

      <path d="M -12.8 -12.4 C -12.8 -20.4 -7.4 -24 0 -24 C 7.4 -24 12.8 -20.4 12.8 -12.4 C 12.8 -15.6 8.4 -17.6 0 -17.6 C -8.4 -17.6 -12.8 -15.6 -12.8 -12.4 Z" fill={palette.hair} />
      <path d="M -12.6 -13.6 Q -11 -21.6 -3.4 -23.4 Q -8.4 -19 -8 -15.4 Z" fill={palette.hair} />
      <path d="M 12.6 -13.6 Q 11 -21.6 3.4 -23.4 Q 8.4 -19 8 -15.4 Z" fill={palette.hair} />

      {erro ? (
        <>
          <path d="M -8.6 -14.4 L -3.4 -12.4" stroke={palette.hair} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M 8.6 -14.4 L 3.4 -12.4" stroke={palette.hair} strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : pronto || received ? (
        <>
          <path d="M -8.4 -14.8 Q -5.8 -16.8 -3.2 -15.2" stroke={palette.hair} strokeWidth="1.7" fill="none" strokeLinecap="round" />
          <path d="M 8.4 -14.8 Q 5.8 -16.8 3.2 -15.2" stroke={palette.hair} strokeWidth="1.7" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M -8.4 -13.8 Q -5.8 -15.4 -3.2 -14" stroke={palette.hair} strokeWidth="1.7" fill="none" strokeLinecap="round" />
          <path d="M 8.4 -13.8 Q 5.8 -15.4 3.2 -14" stroke={palette.hair} strokeWidth="1.7" fill="none" strokeLinecap="round" />
        </>
      )}

      <g className="cs-eyes">
        <ellipse cx="-5.2" cy="-10" rx="2.2" ry="2.6" fill="#243044" />
        <ellipse cx="5.2" cy="-10" rx="2.2" ry="2.6" fill="#243044" />
        <circle cx="-4.4" cy="-10.9" r="0.8" fill="#ffffff" />
        <circle cx="6" cy="-10.9" r="0.8" fill="#ffffff" />
      </g>

      <path d="M 0 -8.4 Q 1.4 -6.4 0 -5.6" stroke={SKIN_DEEP} strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.65" />
      <ellipse cx="-8" cy="-5.6" rx="2.8" ry="1.8" fill={BLUSH} opacity="0.45" />
      <ellipse cx="8" cy="-5.6" rx="2.8" ry="1.8" fill={BLUSH} opacity="0.45" />

      {erro ? (
        <path d="M -3.4 -2.4 Q 0 -5 3.4 -2.4" stroke={MOUTH} strokeWidth="1.7" fill="none" strokeLinecap="round" />
      ) : pronto || received ? (
        <path d="M -4 -4.8 Q 0 0 4 -4.8 Z" fill={MOUTH} opacity="0.9" />
      ) : working ? (
        <ellipse cx="0" cy="-3.4" rx="1.9" ry="1.4" fill={MOUTH} opacity="0.72" />
      ) : (
        <path d="M -3.4 -4.2 Q 0 -1.8 3.4 -4.2" stroke={MOUTH} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      )}
    </>
  )
}
