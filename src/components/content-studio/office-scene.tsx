'use client'

// ============================================================================
// Office Preview V3 — a cena do escritório (SVG isométrico)
// ----------------------------------------------------------------------------
// Escritório em perspectiva isométrica leve: piso em losangos, paredes com
// espessura, três salas separadas por divisórias, porta, janelas, estante,
// quadros, plantas e luminárias.
//
// A REGRA que não muda desde a V1: a posição do personagem é DERIVADA dos
// eventos (`agent.atDesk`), nunca de um timer. O CSS só interpola entre a
// posição anterior e a nova — se o backend não gravou o handoff, ninguém anda.
//
// Dois layouts, com PLANTAS DIFERENTES (não é o mesmo desenho espremido):
//   wide    — três salas lado a lado, corredor horizontal
//   compact — planta em L pensada para retrato, corredor em zigue-zague
// ============================================================================

import React from 'react'
import AgentAvatar, { AGENT_PALETTE } from './agent-avatar'
import {
  Chair, Desk, DeskSign, Door, Keyboard, Lamp, Monitor, Mug, Papers, Plant, Shelf, Window,
} from './office-props'
import { OFFICE_AGENT_ORDER, type AgentView, type OfficeView } from '@/lib/content-studio/view-model'

export type SceneLayout = 'wide' | 'compact'

/** Posição de cada estação, por layout. Coordenadas do viewBox. */
const DESKS: Record<SceneLayout, Record<string, { x: number; y: number }>> = {
  wide: {
    researcher: { x: 168, y: 300 },
    strategist: { x: 480, y: 300 },
    copywriter: { x: 792, y: 300 },
  },
  compact: {
    researcher: { x: 140, y: 178 },
    strategist: { x: 330, y: 336 },
    copywriter: { x: 140, y: 492 },
  },
}

/** Onde o personagem fica ao chegar na mesa de outro (para não sobrepor). */
const VISIT_OFFSET: Record<SceneLayout, number> = { wide: 62, compact: 54 }

const VIEWBOX: Record<SceneLayout, string> = {
  wide: '0 0 960 430',
  compact: '0 0 470 620',
}

export interface OfficeSceneProps {
  view: OfficeView
  layout?: SceneLayout
  reducedMotion?: boolean
  /** Multiplicador de velocidade da animação (1 = normal, 2 = rápido). */
  speed?: number
}

/**
 * Micro-rotina de ambiente — a camada de "vida" do escritório.
 *
 * Puramente COSMÉTICA e deliberadamente limitada:
 *   • só para quem está OCIOSO (idle) — nunca durante trabalho, caminhada,
 *     entrega, recebimento, erro ou conclusão;
 *   • nunca para quem está EM FOCO — o agente da tarefa real jamais é
 *     confundido com alguém "só se mexendo";
 *   • o índice vem da POSIÇÃO na cena, não de sorteio: a cena renderizada no
 *     servidor é idêntica à do cliente, e a captura é reproduzível.
 *
 * Não deriva de evento, não gera evento, não toca na timeline.
 */
function ambienteDe(agent: AgentView, emFoco: string | null, indice: number): number | undefined {
  if (agent.state !== 'idle') return undefined
  if (emFoco === agent.key) return undefined
  return indice % 3
}

export default function OfficeScene({
  view,
  layout = 'wide',
  reducedMotion = false,
  speed = 1,
}: OfficeSceneProps) {
  const desks = DESKS[layout]
  const wide = layout === 'wide'
  const byKey = new Map(view.agents.map(a => [a.key, a]))
  const v = Math.max(speed, 0.25)

  // Caminhada: encurta no modo rápido, some com reduced-motion.
  const walkMs = reducedMotion ? 0 : Math.round(1250 / v)

  // Foco visual: quem está trabalhando; na falta dele, quem está caminhando.
  // Derivado do estado — como tudo o mais, vem dos eventos.
  const emFoco =
    view.agents.find(a => a.state === 'working')?.key
    ?? view.agents.find(a => a.state === 'walking')?.key
    ?? null

  return (
    <svg
      viewBox={VIEWBOX[layout]}
      className="cs-scene"
      role="img"
      aria-label="Escritório virtual com Pesquisador, Estrategista e Copywriter"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      <defs>
        <linearGradient id="cs-wallgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4f7fb" />
          <stop offset="100%" stopColor="#dde5ef" />
        </linearGradient>
        <linearGradient id="cs-floorgrad" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#eaf0f7" />
          <stop offset="100%" stopColor="#d3dde9" />
        </linearGradient>
        <linearGradient id="cs-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a8d8f5" />
          <stop offset="100%" stopColor="#e3f2fd" />
        </linearGradient>
        <linearGradient id="cs-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="cs-light" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fde68a" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="cs-rug" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        {/* Textura sutil do piso: ladrilhos isométricos */}
        <pattern id="cs-tiles" width="56" height="28" patternUnits="userSpaceOnUse">
          <path d="M 28 0 L 56 14 L 28 28 L 0 14 Z" fill="none" stroke="#c3d0de" strokeWidth="1" opacity="0.5" />
        </pattern>
      </defs>

      <style>{`
        .cs-scene { --cs-walk: ${walkMs}ms; }
        /* Deslocamento com peso: sai devagar, ganha velocidade, freia na
           chegada. É o easing que separa "andar" de "deslizar". */
        .cs-actor  { transition: transform var(--cs-walk) cubic-bezier(.34,.02,.2,1); }
        .cs-screen { transition: fill 340ms ease; }
        .cs-station{ transition: opacity 480ms ease; }

        /* TODA junta gira em torno da própria origem — o Socket já a colocou
           no lugar. Nenhum keyframe precisa (nem pode) mexer em translate, e é
           por isso que nada salta quando uma animação começa ou termina.
           
           transform-box DECLARADO de propósito: o valor inicial para SVG
           varia entre implementações, e um reference box diferente moveria a
           origem de rotação de toda junta. Fixá-lo aqui tira o Safari (e
           qualquer outro) do palpite.
           
           A transition é a rede de segurança das trocas de estado: quando uma
           classe sai — o forwards da entrega, o --carry que trava o braço —
           a junta volta ao repouso INTERPOLANDO em vez de estalar. É o que
           impede o membro de piscar para a pose neutra. */
        .cs-j {
          transform-box: view-box;
          transform-origin: 0 0;
          transition: transform 320ms cubic-bezier(.3,.1,.2,1);
        }

        /* ── repouso em pé ────────────────────────────────────────────── */
        @keyframes cs-breathe { 0%,100% { transform: rotate(0deg) translateY(0); } 50% { transform: rotate(0deg) translateY(-1.2px); } }
        @keyframes cs-headidle{ 0%,100% { transform: rotate(-1.6deg); } 50% { transform: rotate(1.6deg); } }
        @keyframes cs-neckidle{ 0%,100% { transform: rotate(.7deg); } 50% { transform: rotate(-.7deg); } }
        @keyframes cs-armidleR{ 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
        @keyframes cs-armidleL{ 0%,100% { transform: rotate(3deg); } 50% { transform: rotate(-3deg); } }
        @keyframes cs-elbowidle{0%,100% { transform: rotate(4deg); } 50% { transform: rotate(-3deg); } }

        /* ── caminhada ───────────────────────────────────────────────
           Centro de massa: o corpo sobe duas vezes por ciclo (uma por passo),
           a pelve roda em oposição à coluna, e a cabeça chega com atraso.
           Joelho e tornozelo dobram — é a transferência de peso.           */
        @keyframes cs-bounce  { 0%,100% { transform: translateY(0); } 25% { transform: translateY(-3.6px); } 50% { transform: translateY(-.4px); } 75% { transform: translateY(-3.6px); } }
        @keyframes cs-pelvis  { 0%,100% { transform: rotate(-3.6deg); } 50% { transform: rotate(3.6deg); } }
        @keyframes cs-spine   { 0%,100% { transform: rotate(2deg); } 50% { transform: rotate(-2deg); } }
        @keyframes cs-headlag { 0%,100% { transform: rotate(-2.6deg); } 50% { transform: rotate(2.6deg); } }
        @keyframes cs-hipR    { 0%,100% { transform: rotate(26deg); } 50% { transform: rotate(-24deg); } }
        @keyframes cs-hipL    { 0%,100% { transform: rotate(-24deg); } 50% { transform: rotate(26deg); } }
        /* O joelho só dobra na fase de balanço — perna de apoio fica reta. */
        @keyframes cs-kneeR   { 0%,100% { transform: rotate(2deg); } 30% { transform: rotate(34deg); } 60% { transform: rotate(4deg); } }
        @keyframes cs-kneeL   { 0%,100% { transform: rotate(30deg); } 30% { transform: rotate(3deg); } 80% { transform: rotate(34deg); } }
        @keyframes cs-ankleR  { 0%,100% { transform: rotate(-14deg); } 50% { transform: rotate(12deg); } }
        @keyframes cs-ankleL  { 0%,100% { transform: rotate(12deg); } 50% { transform: rotate(-14deg); } }
        @keyframes cs-shoulderR{0%,100% { transform: rotate(-26deg); } 50% { transform: rotate(28deg); } }
        @keyframes cs-shoulderL{0%,100% { transform: rotate(28deg); } 50% { transform: rotate(-26deg); } }
        @keyframes cs-elbowSwing{0%,100%{ transform: rotate(10deg); } 50% { transform: rotate(26deg); } }
        @keyframes cs-shadow  { 0%,100% { opacity:.17; transform: scale(1); } 25% { opacity:.09; transform: scale(.84); } 50% { opacity:.16; transform: scale(.98); } 75% { opacity:.09; transform: scale(.84); } }

        /* ── trabalhando ─────────────────────────────────────────────── */
        @keyframes cs-lean    { 0%,100% { transform: rotate(-3.6deg); } 50% { transform: rotate(-4.8deg); } }
        @keyframes cs-typingR { 0%,100% { transform: rotate(-42deg); } 50% { transform: rotate(-34deg); } }
        @keyframes cs-typingL { 0%,100% { transform: rotate(36deg); } 50% { transform: rotate(44deg); } }
        @keyframes cs-typeElbR{ 0%,100% { transform: rotate(58deg); } 50% { transform: rotate(48deg); } }
        @keyframes cs-typeElbL{ 0%,100% { transform: rotate(-52deg); } 50% { transform: rotate(-62deg); } }
        @keyframes cs-headwork{ 0%,100% { transform: rotate(1deg); } 50% { transform: rotate(-1deg); } }

        /* ── entrega e recebimento ───────────────────────────────────
           Entregar: antecipa recolhendo, estende e SEGURA (forwards).
           Receber: alcança, pega e recolhe — termina diferente de onde vai. */
        @keyframes cs-giveArm { 0% { transform: rotate(4deg); } 28% { transform: rotate(-14deg); } 62%,100% { transform: rotate(-58deg); } }
        @keyframes cs-giveElb { 0% { transform: rotate(12deg); } 30% { transform: rotate(38deg); } 65%,100% { transform: rotate(-6deg); } }
        @keyframes cs-giveLean{ 0%,100% { transform: rotate(0deg); } 58% { transform: rotate(-4.2deg); } }
        @keyframes cs-recvArm { 0% { transform: rotate(2deg); } 46% { transform: rotate(-50deg); } 100% { transform: rotate(-8deg); } }
        @keyframes cs-recvElb { 0% { transform: rotate(6deg); } 46% { transform: rotate(-4deg); } 100% { transform: rotate(46deg); } }
        @keyframes cs-recvLean{ 0%,100% { transform: rotate(0deg); } 42% { transform: rotate(4.6deg); } }
        @keyframes cs-recvHead{ 0%,100% { transform: rotate(0deg); } 42% { transform: rotate(-7deg); } }

        /* ── micro-rotinas de ambiente (cosméticas) ─────────────────── */
        @keyframes cs-amb-look { 0%,64%,100% { transform: rotate(0deg); } 74%,88% { transform: rotate(-13deg); } }
        @keyframes cs-amb-read { 0%,54%,100% { transform: rotate(-4deg); } 68%,86% { transform: rotate(-40deg); } }
        @keyframes cs-amb-shift{ 0%,70%,100% { transform: rotate(0deg); } 80%,90% { transform: rotate(2.6deg); } }
        @keyframes cs-amb-tap  { 0%,46%,100% { transform: rotate(3deg); } 58%,72% { transform: rotate(-9deg); } }

        /* ── outros ──────────────────────────────────────────────────── */
        @keyframes cs-blink   { 0%,100% { opacity:.9; } 50% { opacity:.5; } }
        @keyframes cs-shake   { 0%,100% { transform: rotate(0); } 20% { transform: rotate(-3.6deg); } 60% { transform: rotate(3.6deg); } }
        @keyframes cs-cheer   { 0%,100% { transform: translateY(0); } 28% { transform: translateY(-5px); } 55% { transform: translateY(0); } 70% { transform: translateY(-2px); } }
        @keyframes cs-glow    { 0%,100% { opacity:.25; stroke-width:2; } 50% { opacity:.95; stroke-width:3.4; } }
        @keyframes cs-dash    { to { stroke-dashoffset: -28; } }
        @keyframes cs-leafsway{ 0%,100% { transform: rotate(-1.4deg); } 50% { transform: rotate(1.4deg); } }
        @keyframes cs-halo    { 0%,100% { opacity:.30; } 50% { opacity:.52; } }

        /* Repouso em pé: respira, a cabeça oscila, os braços acompanham. */
        /* cs-breathe só translada: origem irrelevante, e declará-la seria uma
           dependência inútil de reference box. */
        .cs-char--idle .cs-torso        { animation: cs-breathe ${Math.round(3600 / v)}ms ease-in-out infinite; }
        .cs-char--idle .cs-j--head      { animation: cs-headidle ${Math.round(5000 / v)}ms ease-in-out infinite; }
        .cs-char--idle .cs-j--neck      { animation: cs-neckidle ${Math.round(5000 / v)}ms ease-in-out infinite; }
        .cs-char--idle .cs-j--shoulderR { animation: cs-armidleR ${Math.round(4200 / v)}ms ease-in-out infinite; }
        .cs-char--idle .cs-j--shoulderL { animation: cs-armidleL ${Math.round(4200 / v)}ms ease-in-out infinite; }
        .cs-char--idle .cs-j--elbowR    { animation: cs-elbowidle ${Math.round(4200 / v)}ms ease-in-out infinite; }

        /* Caminhando. A pelve e a coluna girando em oposição são o que dá
           centro de massa; joelho e tornozelo dobrando dão a transferência. */
        .cs-char--walk                  { animation: cs-bounce ${Math.round(640 / v)}ms ease-in-out infinite; }
        /* fill-box: a sombra encolhe em torno do PRÓPRIO centro. Com o
           reference box do viewBox ela escalaria a partir do meio da cena e
           sairia de baixo do personagem. */
        .cs-char--walk .cs-shadow       { animation: cs-shadow ${Math.round(640 / v)}ms ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
        .cs-char--walk .cs-j--pelvis    { animation: cs-pelvis ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--spine     { animation: cs-spine ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--head      { animation: cs-headlag ${Math.round(640 / v)}ms ease-in-out infinite; animation-delay: ${Math.round(95 / v)}ms; }
        .cs-char--walk .cs-j--hipR      { animation: cs-hipR ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--hipL      { animation: cs-hipL ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--kneeR     { animation: cs-kneeR ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--kneeL     { animation: cs-kneeL ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--ankleR    { animation: cs-ankleR ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--ankleL    { animation: cs-ankleL ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--shoulderR { animation: cs-shoulderR ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--shoulderL { animation: cs-shoulderL ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--elbowR    { animation: cs-elbowSwing ${Math.round(640 / v)}ms ease-in-out infinite; }
        .cs-char--walk .cs-j--elbowL    { animation: cs-elbowSwing ${Math.round(640 / v)}ms ease-in-out infinite; animation-delay: ${Math.round(320 / v)}ms; }
        /* Carregando: o braço da pasta trava contra o corpo e para de balançar. */
        .cs-char--walk.cs-char--carry .cs-j--shoulderR { animation: none; transform: rotate(-20deg); }
        .cs-char--walk.cs-char--carry .cs-j--elbowR    { animation: none; transform: rotate(46deg); }

        /* Trabalhando: inclina sobre a mesa, antebraços na horizontal. */
        .cs-char--type .cs-j--spine     { animation: cs-lean ${Math.round(2800 / v)}ms ease-in-out infinite; }
        .cs-char--type .cs-j--head      { animation: cs-headwork ${Math.round(1900 / v)}ms ease-in-out infinite; }
        .cs-char--type .cs-j--shoulderR { animation: cs-typingR ${Math.round(400 / v)}ms ease-in-out infinite; }
        .cs-char--type .cs-j--shoulderL { animation: cs-typingL ${Math.round(400 / v)}ms ease-in-out infinite; animation-delay: ${Math.round(200 / v)}ms; }
        .cs-char--type .cs-j--elbowR    { animation: cs-typeElbR ${Math.round(400 / v)}ms ease-in-out infinite; }
        .cs-char--type .cs-j--elbowL    { animation: cs-typeElbL ${Math.round(400 / v)}ms ease-in-out infinite; animation-delay: ${Math.round(200 / v)}ms; }

        /* Entregando: antecipa, estende e segura. */
        .cs-char--give .cs-j--shoulderR { animation: cs-giveArm ${Math.round(820 / v)}ms cubic-bezier(.3,.1,.2,1) forwards; }
        .cs-char--give .cs-j--elbowR    { animation: cs-giveElb ${Math.round(820 / v)}ms cubic-bezier(.3,.1,.2,1) forwards; }
        .cs-char--give .cs-j--spine     { animation: cs-giveLean ${Math.round(940 / v)}ms ease-in-out; }

        /* Recebendo: alcança, pega e recolhe — absorvendo a tarefa. */
        .cs-char--receive .cs-j--shoulderL { animation: cs-recvArm ${Math.round(900 / v)}ms cubic-bezier(.3,.1,.2,1) 2; }
        .cs-char--receive .cs-j--elbowL    { animation: cs-recvElb ${Math.round(900 / v)}ms cubic-bezier(.3,.1,.2,1) 2; }
        .cs-char--receive .cs-j--spine     { animation: cs-recvLean ${Math.round(900 / v)}ms ease-in-out 2; }
        .cs-char--receive .cs-j--head      { animation: cs-recvHead ${Math.round(900 / v)}ms ease-in-out 2; }

        .cs-char--error .cs-j--head  { animation: cs-shake 640ms ease-in-out 3; }
        .cs-char--cheer              { animation: cs-cheer 1000ms cubic-bezier(.3,.6,.3,1) 2; }

        /* Micro-rotinas: só decoram, e cada agente tem a sua para não
           sincronizarem. Nunca tocam pelve, quadril ou joelho — nada que
           possa ser confundido com "esse aqui está trabalhando". */
        .cs-char--amb0 .cs-j--head      { animation: cs-amb-look ${Math.round(11000 / v)}ms ease-in-out infinite; }
        .cs-char--amb0 .cs-j--shoulderR { animation: cs-amb-tap ${Math.round(11000 / v)}ms ease-in-out infinite; }
        .cs-char--amb1 .cs-j--shoulderL { animation: cs-amb-read ${Math.round(13000 / v)}ms ease-in-out infinite; }
        .cs-char--amb1 .cs-j--head      { animation: cs-amb-look ${Math.round(13000 / v)}ms ease-in-out infinite; animation-delay: ${Math.round(2200 / v)}ms; }
        .cs-char--amb2 .cs-j--spine     { animation: cs-amb-shift ${Math.round(15000 / v)}ms ease-in-out infinite; }
        .cs-char--amb2 .cs-j--head      { animation: cs-amb-look ${Math.round(15000 / v)}ms ease-in-out infinite; animation-delay: ${Math.round(4200 / v)}ms; }

        .cs-folder-glow { animation: cs-glow ${Math.round(1300 / v)}ms ease-in-out infinite; }
        .cs-screen-lines{ animation: cs-blink ${Math.round(1500 / v)}ms ease-in-out infinite; }
        .cs-path--active{ animation: cs-dash ${Math.round(900 / v)}ms linear infinite; }
        .cs-leaves      { animation: cs-leafsway ${Math.round(5200 / v)}ms ease-in-out infinite; transform-box: fill-box; transform-origin: center bottom; }
        .cs-halo        { animation: cs-halo ${Math.round(2600 / v)}ms ease-in-out infinite; }

        /* O usuário mandou parar de mexer: paramos tudo. */
        @media (prefers-reduced-motion: reduce) {
          .cs-scene * { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* ─── Paredes ────────────────────────────────────────────────── */}
      <rect x="0" y="0" width="100%" height="100%" fill="url(#cs-wallgrad)" />

      {/* ─── Piso com textura ───────────────────────────────────────── */}
      <g>
        <rect x="0" y={wide ? 168 : 128} width="100%" height="100%" fill="url(#cs-floorgrad)" />
        <rect x="0" y={wide ? 168 : 128} width="100%" height="100%" fill="url(#cs-tiles)" />
        {/* Rodapé: a linha que separa parede de chão */}
        <rect x="0" y={wide ? 162 : 122} width="100%" height="7" fill="#c2cedd" />
        <rect x="0" y={wide ? 162 : 122} width="100%" height="2.5" fill="#dbe4ee" />
      </g>

      {/* ─── Divisórias entre as salas ──────────────────────────────── */}
      {wide ? (
        <g>
          {[324, 636].map(x => (
            <g key={x}>
              <rect x={x - 5} y="120" width="10" height="150" rx="3" fill="#cbd6e3" />
              <rect x={x - 5} y="120" width="4" height="150" rx="2" fill="#e3ebf4" />
              <rect x={x - 9} y="112" width="18" height="10" rx="4" fill="#b8c5d5" />
            </g>
          ))}
        </g>
      ) : (
        <g>
          {[276, 434].map(y => (
            <g key={y}>
              <rect x="18" y={y - 4} width="434" height="8" rx="3" fill="#cbd6e3" opacity="0.75" />
              <rect x="18" y={y - 4} width="434" height="3" rx="1.5" fill="#e3ebf4" opacity="0.9" />
            </g>
          ))}
        </g>
      )}

      {/* ─── Decoração de parede ────────────────────────────────────── */}
      {wide ? (
        <g>
          <g transform="translate(168, 92)"><Window /></g>
          <g transform="translate(792, 92)"><Window /></g>
          <g transform="translate(430, 74)"><Door tint="#94a3b8" /></g>
          <g transform="translate(534, 60)"><WallArtSafe tone="#8b5cf6" /></g>
          <g transform="translate(60, 52)"><WallArtSafe tone="#3b82f6" /></g>
          <g transform="translate(900, 52)"><WallArtSafe tone="#f97316" /></g>
          <g transform="translate(168, 34)"><Lamp /></g>
          <g transform="translate(480, 34)"><Lamp /></g>
          <g transform="translate(792, 34)"><Lamp /></g>
        </g>
      ) : (
        <g>
          <g transform="translate(120, 66)"><Window /></g>
          <g transform="translate(330, 78)"><Door tint="#94a3b8" /></g>
          <g transform="translate(410, 42)"><WallArtSafe tone="#8b5cf6" /></g>
          <g transform="translate(240, 30)"><Lamp /></g>
        </g>
      )}

      {/* ─── Mobiliário de canto ────────────────────────────────────── */}
      {wide ? (
        <g>
          <g transform="translate(58, 262)"><Shelf /></g>
          <g transform="translate(910, 268) scale(1.15)"><Plant /></g>
          <g transform="translate(322, 292) scale(0.95)"><Plant /></g>
          <g transform="translate(636, 292) scale(0.95)"><Plant /></g>
        </g>
      ) : (
        <g>
          <g transform="translate(400, 205) scale(0.85)"><Shelf /></g>
          <g transform="translate(50, 320) scale(0.9)"><Plant /></g>
          <g transform="translate(402, 552) scale(0.95)"><Plant /></g>
        </g>
      )}

      {/* ─── Corredor: o caminho da pasta ───────────────────────────── */}
      <g>
        <path
          d={wide ? 'M 96 372 L 864 372' : 'M 214 228 L 330 386 L 214 542'}
          stroke="#b9c7d8" strokeWidth={wide ? 26 : 22} strokeLinecap="round" fill="none" opacity="0.55"
        />
        <path
          className={view.agents.some(a => a.state === 'walking') ? 'cs-path cs-path--active' : 'cs-path'}
          d={wide ? 'M 96 372 L 864 372' : 'M 214 228 L 330 386 L 214 542'}
          stroke="#94a3b8" strokeWidth="2.6" strokeDasharray="10 18" fill="none" opacity="0.85"
        />
      </g>

      {/* ─── Estações ───────────────────────────────────────────────── */}
      {OFFICE_AGENT_ORDER.map(key => {
        const agent = byKey.get(key)
        const pos = desks[key]
        const p = AGENT_PALETTE[key]
        const ativo = agent?.state === 'working'

        // Sem foco definido, ninguém recua: a cena fica neutra.
        const foco = emFoco === null || emFoco === key

        return (
          // Recuo só por opacidade. `filter` obriga o Safari/iOS a rasterizar
          // o grupo inteiro numa camada própria e mantê-la enquanto durar —
          // caro demais para um efeito que a opacidade já resolve.
          <g
            key={key}
            className="cs-station"
            transform={`translate(${pos.x}, ${pos.y})`}
            opacity={foco ? 1 : 0.5}
          >
            {/* Halo do setor em foco — pulso lento, longe de pisca-pisca */}
            {emFoco === key && (
              <ellipse className="cs-halo" cx="0" cy="6" rx="126" ry="52" fill={p.suit} opacity="0.3" />
            )}

            {/* Tapete do setor */}
            <g opacity="0.95">
              <path d="M 0 -46 L 118 6 L 0 58 L -118 6 Z" fill={p.accent} opacity="0.55" />
              <path d="M 0 -46 L 118 6 L 0 58 L -118 6 Z" fill="url(#cs-rug)" />
              <path d="M 0 -38 L 100 6 L 0 50 L -100 6 Z" fill="none" stroke={p.suit} strokeWidth="1.6" opacity="0.3" />
            </g>

            {/* Cadeira atrás da mesa */}
            <g transform="translate(0, -12)"><Chair tint={p.suitLight} dark={p.suit} /></g>

            {/* Mesa e objetos */}
            <g transform="translate(0, 6)">
              <Desk tint={p.suit} />
              <g transform="translate(-34, -14)"><Monitor on={!!ativo} tint={p.suit} /></g>
              <g transform="translate(6, 14)"><Keyboard /></g>
              <g transform="translate(44, 2)"><Papers tint={p.suit} /></g>
              <g transform="translate(58, 16) scale(0.9)"><Mug color={p.suitDark} /></g>
            </g>

            {/* Placa do setor */}
            <g transform="translate(0, 94)">
              <DeskSign label={agent?.label ?? key} tint={p.suit} dark={p.suitDark} />
            </g>
          </g>
        )
      })}

      {/* ─── Personagens ────────────────────────────────────────────── */}
      {OFFICE_AGENT_ORDER.map((key, i) => {
        const agent = byKey.get(key)
        if (!agent) return null

        // A posição vem de `atDesk`, que veio dos eventos.
        const casa = desks[key]
        const alvo = desks[agent.atDesk] ?? casa
        const visitando = agent.atDesk !== key

        // Ao chegar na mesa do colega, para AO LADO — não em cima dele.
        const dx = visitando ? (alvo.x >= casa.x ? -VISIT_OFFSET[layout] : VISIT_OFFSET[layout]) : 0
        // Em pé fica um pouco à frente da mesa; sentado, atrás dela.
        const dy = visitando || agent.state === 'walking' ? 26 : -4

        return (
          <g
            key={key}
            className="cs-actor"
            style={{ transform: `translate(${alvo.x + dx}px, ${alvo.y + dy}px)` }}
          >
            <AgentAvatar
              agentKey={key}
              state={agent.state}
              carryingFolder={agent.carryingFolder}
              received={agent.receivedFolder}
              reducedMotion={reducedMotion}
              ambient={ambienteDe(agent, emFoco, i)}
            />
            <Bubble agent={agent} />
          </g>
        )
      })}
    </svg>
  )
}

/** Quadro de parede — reexportado localmente para manter a cena legível. */
function WallArtSafe({ tone }: { tone: string }) {
  return (
    <g>
      <rect x="-22" y="-17" width="44" height="34" rx="2.5" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="2.5" />
      <rect x="-18" y="-13" width="36" height="26" rx="1.5" fill={tone} opacity="0.16" />
      <path d="M -18 13 L -6 -3 L 2 6 L 10 -6 L 18 13 Z" fill={tone} opacity="0.55" />
      <circle cx="9" cy="-7" r="3.6" fill="#fbbf24" opacity="0.85" />
    </g>
  )
}

/** Balão curto acima da cabeça. Some quando não há nada a dizer. */
function Bubble({ agent }: { agent: AgentView }) {
  if (!agent.bubble) return null

  const texto = agent.bubble.length > 26 ? agent.bubble.slice(0, 25) + '…' : agent.bubble
  const w = Math.min(Math.max(texto.length * 6.6 + 26, 76), 186)
  const p = AGENT_PALETTE[agent.key] ?? AGENT_PALETTE.researcher

  return (
    <g transform="translate(0, -50)" className="cs-bubble">
      <g opacity="0.14">
        <rect x={-w / 2} y="-14" width={w} height="27" rx="13.5" fill="#0b1220" transform="translate(0,2)" />
      </g>
      <rect x={-w / 2} y="-15" width={w} height="27" rx="13.5" fill="#ffffff" stroke={p.suitLight} strokeWidth="1.6" />
      <path d="M -5 11 L 0 17.5 L 5 11 Z" fill="#ffffff" stroke={p.suitLight} strokeWidth="1.6" />
      <path d="M -5.5 10.4 L 5.5 10.4 Z" stroke="#ffffff" strokeWidth="2.4" />
      <text
        x="0" y="1.5" textAnchor="middle"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
        fontSize="11.5" fontWeight="600" fill="#3d4a5c"
      >
        {texto}
      </text>
      {agent.progress && (
        <g transform={`translate(${-w / 2 + 10}, 5.5)`}>
          <rect width={w - 20} height="3.2" rx="1.6" fill="#e6ecf3" />
          <rect
            width={(w - 20) * (agent.progress.completed / agent.progress.total)}
            height="3.2" rx="1.6" fill="#10b981"
          />
        </g>
      )}
    </g>
  )
}
