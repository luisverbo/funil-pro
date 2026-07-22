import type { QuizTheme } from '@/app/actions/quiz-v2'

export const THEME_PRESETS: Record<string, QuizTheme & { label: string }> = {
  clean:    { label: 'Clean',    preset: 'clean',    font: 'inter',      bg_type: 'color',    bg_value: '#f8fafc', card_style: 'shadow', button_radius: 'md',   dark_mode: false },
  dark:     { label: 'Dark',     preset: 'dark',     font: 'inter',      bg_type: 'color',    bg_value: '#0f172a', card_style: 'flat',   button_radius: 'md',   dark_mode: true },
  gradient: { label: 'Gradient', preset: 'gradient', font: 'poppins',    bg_type: 'gradient', bg_value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', card_style: 'glass', button_radius: 'full', dark_mode: true },
  minimal:  { label: 'Minimal',  preset: 'minimal',  font: 'inter',      bg_type: 'color',    bg_value: '#ffffff', card_style: 'flat',   button_radius: 'none', dark_mode: false },
  bold:     { label: 'Bold',     preset: 'bold',     font: 'montserrat', bg_type: 'gradient', bg_value: 'linear-gradient(160deg, #111827 0%, #1f2937 60%, #6366f1 140%)', card_style: 'shadow', button_radius: 'full', dark_mode: true },
  whatsapp: { label: 'WhatsApp', preset: 'whatsapp', font: 'inter',      bg_type: 'color',    bg_value: '#efeae2', card_style: 'shadow', button_radius: 'full', dark_mode: false },
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
  // Superfície dos blocos de conteúdo (Benefícios, Depoimentos, Preço, FAQ…):
  // segue SEMPRE o modo claro/escuro, ignorando a "cor dos cards" personalizada
  // (que é só pros cards de opção) — evita fundo preto em página clara.
  surfaceBg: string
  surfaceBorder: string
  buttonRadius: string
  // Campos usados pelo chat do agente (ChatLanding) — cor de destaque e balões
  accent: string          // botões, cabeçalho, envio
  userBubbleBg: string    // balão do lead
  userBubbleText: string
  headerBg: string        // fundo do cabeçalho do chat
  headerText: string      // texto do cabeçalho
  chatBg: string | null   // fundo da área de mensagens (null = usa o padrão translúcido)
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
  // card_color (personalização antiga) NÃO entra mais aqui — vazava fundo escuro
  // pra todos os blocos. Cards seguem o modo claro/escuro.
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

  // Tema WhatsApp: cores próprias de balões, cabeçalho e destaque
  const isWhatsapp = merged.preset === 'whatsapp'
  const accent = isWhatsapp ? '#00a884' : '#6366f1'
  const userBubbleBg = isWhatsapp ? (isDark ? '#005c4b' : '#d9fdd3') : accent
  const userBubbleText = isWhatsapp ? (isDark ? '#e9edef' : '#111b21') : '#ffffff'
  const headerBg = isWhatsapp ? (isDark ? '#202c33' : '#008069') : cardBg
  const headerText = isWhatsapp ? '#ffffff' : (isDark ? '#f1f5f9' : '#111827')
  const chatBg = isWhatsapp ? (isDark ? '#0b141a' : '#efeae2') : null

  return {
    fontFamily: FONT_STACKS[font],
    fontUrl: GOOGLE_FONT_URLS[font] ?? null,
    background,
    backgroundImage,
    isDark,
    textColor: merged.text_color || (isDark ? '#f1f5f9' : '#111827'),
    mutedColor: merged.muted_color || (isDark ? '#94a3b8' : '#6b7280'),
    cardBg,
    cardBorder,
    cardShadow,
    cardBackdrop,
    surfaceBg: isDark ? '#1e293b' : '#ffffff',
    surfaceBorder: isDark ? '1px solid #334155' : '1px solid #e5e7eb',
    buttonRadius,
    accent,
    userBubbleBg,
    userBubbleText,
    headerBg,
    headerText,
    chatBg,
  }
}
