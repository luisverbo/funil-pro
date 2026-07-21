// ─── Bio Link (página de links estilo Linktree) ──────────────────────────────
import type React from 'react'

export interface BioButton {
  id: string
  emoji?: string
  label: string
  url: string
  highlight?: boolean   // botão em destaque (pulsa)
  // personalização (vazio = estilo do tema)
  bg_color?: string
  text_color?: string
  border_color?: string
  radius?: 'md' | 'xl' | 'full'
}

export interface BioData {
  version: 1
  avatar_url?: string
  display_name?: string
  bio?: string
  theme?: string
  socials?: { instagram?: string; youtube?: string; tiktok?: string; whatsapp?: string }
  buttons: BioButton[]
}

export const BIO_THEMES: Record<string, { bg: string; text: string; sub: string; btnBg: string; btnText: string; btnBorder: string }> = {
  gradient: { bg: 'linear-gradient(160deg, #7c3aed 0%, #ec4899 100%)', text: '#ffffff', sub: 'rgba(255,255,255,0.85)', btnBg: 'rgba(255,255,255,0.95)', btnText: '#111827', btnBorder: 'transparent' },
  dark:     { bg: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)', text: '#f1f5f9', sub: '#94a3b8', btnBg: '#1e293b', btnText: '#f1f5f9', btnBorder: '#334155' },
  clean:    { bg: '#f8fafc', text: '#111827', sub: '#6b7280', btnBg: '#ffffff', btnText: '#111827', btnBorder: '#e5e7eb' },
  sunset:   { bg: 'linear-gradient(160deg, #f97316 0%, #db2777 100%)', text: '#ffffff', sub: 'rgba(255,255,255,0.85)', btnBg: 'rgba(255,255,255,0.95)', btnText: '#111827', btnBorder: 'transparent' },
  ocean:    { bg: 'linear-gradient(160deg, #0ea5e9 0%, #10b981 100%)', text: '#ffffff', sub: 'rgba(255,255,255,0.85)', btnBg: 'rgba(255,255,255,0.95)', btnText: '#111827', btnBorder: 'transparent' },
  neon:     { bg: 'linear-gradient(160deg, #030712 0%, #111827 100%)', text: '#a7f3d0', sub: '#6ee7b7', btnBg: 'transparent', btnText: '#a7f3d0', btnBorder: '#10b981' },
  royal:    { bg: 'linear-gradient(160deg, #1e1b4b 0%, #4c1d95 100%)', text: '#ffffff', sub: '#c4b5fd', btnBg: '#facc15', btnText: '#1e1b4b', btnBorder: 'transparent' },
  candy:    { bg: 'linear-gradient(160deg, #fdf2f8 0%, #fce7f3 100%)', text: '#831843', sub: '#be185d', btnBg: '#ec4899', btnText: '#ffffff', btnBorder: 'transparent' },
  forest:   { bg: 'linear-gradient(160deg, #064e3b 0%, #022c22 100%)', text: '#ecfdf5', sub: '#a7f3d0', btnBg: '#10b981', btnText: '#022c22', btnBorder: 'transparent' },
  gold:     { bg: 'linear-gradient(160deg, #111827 0%, #1c1917 100%)', text: '#fde68a', sub: '#d6d3d1', btnBg: 'linear-gradient(90deg, #f59e0b, #fbbf24)', btnText: '#1c1917', btnBorder: 'transparent' },
  sky:      { bg: 'linear-gradient(160deg, #e0f2fe 0%, #bae6fd 100%)', text: '#0c4a6e', sub: '#0369a1', btnBg: '#0284c7', btnText: '#ffffff', btnBorder: 'transparent' },
  fire:     { bg: 'linear-gradient(160deg, #7f1d1d 0%, #ea580c 100%)', text: '#ffffff', sub: '#fed7aa', btnBg: '#ffffff', btnText: '#9a3412', btnBorder: 'transparent' },
}

const RADII = { md: '0.75rem', xl: '1rem', full: '9999px' }
/** Estilo final de um botão: personalização do botão > estilo do tema */
export function buttonStyle(b: BioButton, t: { btnBg: string; btnText: string; btnBorder: string }): React.CSSProperties {
  return {
    background: b.bg_color || t.btnBg,
    color: b.text_color || t.btnText,
    border: `2px solid ${b.border_color || t.btnBorder}`,
    borderRadius: RADII[b.radius ?? 'xl'],
  }
}

export const emptyBio = (): BioData => ({
  version: 1,
  display_name: '',
  bio: '',
  theme: 'gradient',
  socials: {},
  buttons: [],
})
