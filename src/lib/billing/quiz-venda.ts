// ============================================================================
// Venda do Quiz avulso — a régua (pura) que landing, checkout, cadastro e
// webhook compartilham
// ----------------------------------------------------------------------------
// Dois modos, decididos pelo que o dono colou em /admin/settings:
//
//   • SEM Stripe configurado → a landing manda direto para
//     /register?plano=quiz (como hoje: conta nasce no plano quiz, sem cobrar)
//   • COM Stripe configurado → o botão abre o Checkout da Stripe; ao pagar, a
//     Stripe devolve para /register?plano=quiz&cs=<sessão>. Se o dono marcou
//     "exigir pagamento", o cadastro no plano quiz só passa com sessão PAGA.
//
// Uma autoridade só, sem React e sem rede — testável.
// ============================================================================

import { idDeSessaoValido, sessaoPaga, type SessaoCheckout } from './stripe'

/** Chaves em platform_settings — a migration cria as linhas. */
export const CHAVES_VENDA_QUIZ = [
  'stripe_secret_key',
  'stripe_webhook_secret',
  'stripe_quiz_price_id',
  'quiz_preco_exibido',
  'quiz_exigir_pagamento',
] as const

export interface ConfigVendaQuiz {
  stripe_secret_key?: string | null
  stripe_webhook_secret?: string | null
  stripe_quiz_price_id?: string | null
  /** Texto do preço na landing, ex.: "97" ou "97,00". Vazio = "Consulte". */
  quiz_preco_exibido?: string | null
  /** 'true' = cadastro no plano quiz só com sessão paga. */
  quiz_exigir_pagamento?: string | null
}

export const LANDING_QUIZ = '/quiz'
export const CHECKOUT_QUIZ = '/api/checkout/quiz'
export const CADASTRO_QUIZ = '/register?plano=quiz'

/** Stripe pronto para cobrar? Exige chave secreta + preço. */
export function stripeConfigurado(c: ConfigVendaQuiz): boolean {
  return !!(c.stripe_secret_key?.trim() && c.stripe_quiz_price_id?.trim())
}

export function exigePagamento(c: ConfigVendaQuiz): boolean {
  return stripeConfigurado(c) && c.quiz_exigir_pagamento === 'true'
}

/**
 * Para onde o botão da landing leva. Com Stripe, o botão é um POST para o
 * checkout (formulário); sem, é um link para o cadastro.
 */
export function destinoDoCta(c: ConfigVendaQuiz): { tipo: 'checkout'; action: string } | { tipo: 'cadastro'; href: string } {
  return stripeConfigurado(c)
    ? { tipo: 'checkout', action: CHECKOUT_QUIZ }
    : { tipo: 'cadastro', href: CADASTRO_QUIZ }
}

/**
 * Preço para exibir: "R$ 97" a partir de "97", "97,00", "R$97". Lixo vira
 * null e a landing mostra "Consulte" — nunca "R$ NaN".
 */
export function precoExibido(v: string | null | undefined): { inteiro: string; centavos: string | null } | null {
  if (!v) return null
  const limpo = v.replace(/[^\d,.]/g, '').replace('.', ',')
  const m = limpo.match(/^(\d{1,6})(?:,(\d{1,2}))?$/)
  if (!m) return null
  const centavos = m[2] && m[2] !== '00' && m[2] !== '0' ? m[2].padEnd(2, '0') : null
  return { inteiro: m[1], centavos }
}

/**
 * O cadastro pode criar a conta no plano quiz?
 *   - sem exigência de pagamento: sempre
 *   - com exigência: só com sessão de checkout válida e PAGA
 */
export function cadastroQuizLiberado(c: ConfigVendaQuiz, sessao: SessaoCheckout | null | undefined): boolean {
  if (!exigePagamento(c)) return true
  return !!sessao && idDeSessaoValido(sessao.id) && sessaoPaga(sessao)
}

/** URLs de retorno do Checkout — a Stripe troca {CHECKOUT_SESSION_ID} por ela mesma. */
export function urlsDeRetorno(origem: string): { successUrl: string; cancelUrl: string } {
  const base = origem.replace(/\/$/, '')
  return {
    successUrl: `${base}${CADASTRO_QUIZ}&cs={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}${LANDING_QUIZ}?cancelado=1`,
  }
}

/** Resultado do webhook → o que fazer com o tenant. */
export type AcaoWebhook =
  | { acao: 'registrar_compra' }
  | { acao: 'renovar' }
  | { acao: 'cancelar' }
  | { acao: 'ignorar' }

export function acaoParaEvento(type: string): AcaoWebhook {
  switch (type) {
    case 'checkout.session.completed': return { acao: 'registrar_compra' }
    case 'invoice.paid':
    case 'invoice.payment_succeeded': return { acao: 'renovar' }
    case 'customer.subscription.deleted': return { acao: 'cancelar' }
    default: return { acao: 'ignorar' }
  }
}
