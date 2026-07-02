import type { QuizTheme } from '@/app/actions/quiz-v2'

export const THEME_PRESETS: Record<string, QuizTheme & { label: string }> = {
  clean:    { label: 'Clean',    preset: 'clean',    font: 'inter',      bg_type: 'color',    bg_value: '#f8fafc', card_style: 'shadow', button_radius: 'md',   dark_mode: false },
  dark:     { label: 'Dark',     preset: 'dark',     font: 'inter',      bg_type: 'color',    bg_value: '#0f172a', card_style: 'flat',   button_radius: 'md',   dark_mode: true },
  gradient: { label: 'Gradient', preset: 'gradient', font: 'poppins',    bg_type: 'gradient', bg_value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', card_style: 'glass', button_radius: 'full', dark_mode: true },
  minimal:  { label: 'Minimal',  preset: 'minimal',  font: 'inter',      bg_type: 'color',    bg_value: '#ffffff', card_style: 'flat',   button_radius: 'none', dark_mode: false },
  bold:     { label: 'Bold',     preset: 'bold',     font: 'montserrat', bg_type: 'gradient', bg_value: 'linear-gradient(160deg, #111827 0%, #1f2937 60%, #6366f1 140%)', card_style: 'shadow', button_radius: 'full', dark_mode: true },
}

export const FONT_STACKS: Record<string, string> = {
  inter: "'Inter', system-ui, sans-serif",
  poppins: "'Poppins', system-ui, sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
  montserrat: "'Montserrat', system-ui, sans-serif",
}

export const GOOGLE_FONT_URLS: Record<string, string> = {
  inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap',
  playfair: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&display=swap',
  montserrat: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap',
}

export interface ResolvedTheme {
  fontFamily: string
  fontUrl: string | null
  background: string
  backgroundImage: string | null
  isDark: boolean
  textColor: string
  mutedColor: string
  cardBg: string
  cardBorder: string
  cardShadow: string
  cardBackdrop: string | null
  buttonRadius: string
}

export function resolveTheme(theme?: QuizTheme | null): ResolvedTheme {
  const base = theme?.preset ? THEME_PRESETS[theme.preset] : undefined
  const merged: QuizTheme = { ...base, ...theme }

  const font = merged.font ?? 'inter'
  const isDark = !!merged.dark_mode
  const bgType = merged.bg_type ?? 'color'
  const bgValue = merged.bg_value ?? (isDark ? '#0f172a' : '#f8fafc')

  let background = bgValue
  let backgroundImage: string | null = null
  if (bgType === 'image' && bgValue) {
    background = isDark ? '#0f172a' : '#f8fafc'
    backgroundImage = bgValue
  }

  const cardStyle = merged.card_style ?? 'shadow'
  const cardBg = cardStyle === 'glass'
    ? (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.7)')
    : (isDark ? '#1e293b' : '#ffffff')
  const cardBorder = cardStyle === 'glass'
    ? (isDark ? '1px solid rgba(255,255,255,0.15)' : '1px solid rgba(255,255,255,0.6)')
    : (isDark ? '1px solid #334155' : '1px solid #e5e7eb')
  const cardShadow = cardStyle === 'shadow'
    ? '0 10px 30px -8px rgba(0,0,0,0.12)'
    : 'none'
  const cardBackdrop = cardStyle === 'glass' ? 'blur(12px)' : null

  const radiusMap = { none: '0.25rem', md: '0.75rem', full: '9999px' }
  const buttonRadius = radiusMap[merged.button_radius ?? 'md']

  return {
    fontFamily: FONT_STACKS[font],
    fontUrl: GOOGLE_FONT_URLS[font] ?? null,
    background,
    backgroundImage,
    isDark,
    textColor: isDark ? '#f1f5f9' : '#111827',
    mutedColor: isDark ? '#94a3b8' : '#6b7280',
    cardBg,
    cardBorder,
    cardShadow,
    cardBackdrop,
    buttonRadius,
  }
}
