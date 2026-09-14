// ============================================================================
// Planos e acesso — o que cada plano enxerga e pode criar
// ----------------------------------------------------------------------------
// O dono vende o QUIZ sozinho (anúncios + YouTube ensinando qualificação de
// lead). Quem compra só o quiz entra num FunilPro enxuto: Páginas (só quiz),
// Configurações e nada mais — sem funil, sem agente, sem WhatsApp na cara.
//
// Regra numa função pura, usada por sidebar, gate de rota e modal de criação:
// uma autoridade só, testável sem React.
// ============================================================================

export const PLANOS = ['starter', 'pro', 'scale', 'quiz'] as const
export type Plano = (typeof PLANOS)[number]

export function planoValido(v: unknown): v is Plano {
  return typeof v === 'string' && (PLANOS as readonly string[]).includes(v)
}

/** Nome que aparece para o dono e para o admin. */
export function rotuloPlano(plano: string): string {
  switch (plano) {
    case 'quiz': return 'Quiz'
    case 'starter': return 'Starter'
    case 'pro': return 'Pro'
    case 'scale': return 'Scale'
    default: return plano
  }
}

/**
 * Rotas do painel que o plano QUIZ enxerga. Prefixo: '/pages' cobre
 * '/pages/…' e os editores do quiz vivem em rotas próprias.
 */
const ROTAS_PLANO_QUIZ = ['/pages', '/quiz-editor', '/settings', '/content-studio', '/admin']

/** A rota é permitida neste plano? Planos completos veem tudo. */
export function rotaPermitida(plano: string | null | undefined, pathname: string): boolean {
  if (plano !== 'quiz') return true
  return ROTAS_PLANO_QUIZ.some(p => pathname === p || pathname.startsWith(p + '/'))
}

/** Para onde mandar quem cai numa rota fora do plano (ou faz login). */
export function homeDoPlano(plano: string | null | undefined): string {
  return plano === 'quiz' ? '/pages' : '/funnels'
}

/** Tipos de página que o plano pode criar — o quiz só cria quiz. */
export function tiposDePaginaDoPlano(plano: string | null | undefined): readonly string[] | null {
  return plano === 'quiz' ? ['interactive'] : null   // null = todos
}

/**
 * Plano pedido no link de venda (?plano=quiz) — só aceita o que existe e
 * nunca deixa alguém se auto-promover a Scale por URL.
 */
export function planoDoLinkDeVenda(v: unknown): Plano | null {
  return v === 'quiz' ? 'quiz' : null
}
