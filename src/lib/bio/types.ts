// ─── Bio Link (página de links estilo Linktree) ──────────────────────────────

export interface BioButton {
  id: string
  emoji?: string
  label: string
  url: string
  highlight?: boolean   // botão em destaque (pulsa)
}

export interface BioData {
  version: 1
  avatar_url?: string
  display_name?: string
  bio?: string
  theme?: 'gradient' | 'dark' | 'clean' | 'sunset' | 'ocean'
  socials?: { instagram?: string; youtube?: string; tiktok?: string; whatsapp?: string }
  buttons: BioButton[]
}

export const BIO_THEMES: Record<string, { bg: string; text: string; sub: string; btnBg: string; btnText: string; btnBorder: string }> = {
  gradient: { bg: 'linear-gradient(160deg, #7c3aed 0%, #ec4899 100%)', text: '#ffffff', sub: 'rgba(255,255,255,0.85)', btnBg: 'rgba(255,255,255,0.95)', btnText: '#111827', btnBorder: 'transparent' },
  dark:     { bg: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)', text: '#f1f5f9', sub: '#94a3b8', btnBg: '#1e293b', btnText: '#f1f5f9', btnBorder: '#334155' },
  clean:    { bg: '#f8fafc', text: '#111827', sub: '#6b7280', btnBg: '#ffffff', btnText: '#111827', btnBorder: '#e5e7eb' },
  sunset:   { bg: 'linear-gradient(160deg, #f97316 0%, #db2777 100%)', text: '#ffffff', sub: 'rgba(255,255,255,0.85)', btnBg: 'rgba(255,255,255,0.95)', btnText: '#111827', btnBorder: 'transparent' },
  ocean:    { bg: 'linear-gradient(160deg, #0ea5e9 0%, #10b981 100%)', text: '#ffffff', sub: 'rgba(255,255,255,0.85)', btnBg: 'rgba(255,255,255,0.95)', btnText: '#111827', btnBorder: 'transparent' },
}

export const emptyBio = (): BioData => ({
  version: 1,
  display_name: '',
  bio: '',
  theme: 'gradient',
  socials: {},
  buttons: [],
})
