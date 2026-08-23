// ============================================================================
// Sessão do portal — para o cliente não digitar a senha a cada F5
// ----------------------------------------------------------------------------
// O portal só aceitava senha em memória: atualizar a página deslogava. Para
// quem vai abrir isso todo dia no celular, é inviável.
//
// A sessão é um cookie httpOnly ASSINADO, e a chave da assinatura é o próprio
// `password_hash` do portal. Três consequências de graça:
//
//   • nenhuma variável de ambiente nova, nenhuma tabela nova;
//   • trocar a senha do portal INVALIDA todas as sessões na hora — a chave
//     muda junto, então cookie antigo deixa de conferir;
//   • cookie de um portal não vale noutro: o token vai assinado dentro.
//
// O cookie não guarda a senha, só a prova de que ela foi apresentada.
// ============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'

export const PORTAL_COOKIE = 'fp_portal'

/** 12 horas: cobre o dia de trabalho sem virar acesso permanente. */
export const PORTAL_SESSAO_MS = 12 * 60 * 60 * 1000

function assinar(token: string, expira: number, chave: string): string {
  return createHmac('sha256', chave).update(`${token}.${expira}`).digest('base64url')
}

/** Valor do cookie: `<token>.<expira>.<assinatura>`. */
export function criarSessaoPortal(token: string, chave: string, agora = Date.now()): string {
  const expira = agora + PORTAL_SESSAO_MS
  return `${token}.${expira}.${assinar(token, expira, chave)}`
}

/**
 * Confere o cookie. Falha em silêncio (false) para qualquer defeito: formato
 * errado, expirado, assinatura inválida ou de OUTRO portal.
 */
export function sessaoPortalValida(
  valor: string | undefined | null,
  token: string,
  chave: string,
  agora = Date.now(),
): boolean {
  if (!valor) return false
  const partes = valor.split('.')
  if (partes.length !== 3) return false
  const [tokenCookie, expiraTexto, assinatura] = partes
  if (tokenCookie !== token) return false          // cookie de outro portal

  const expira = Number(expiraTexto)
  if (!Number.isFinite(expira) || expira <= agora) return false

  try {
    const esperado = Buffer.from(assinar(token, expira, chave), 'base64url')
    const recebido = Buffer.from(assinatura, 'base64url')
    return esperado.length === recebido.length && timingSafeEqual(esperado, recebido)
  } catch {
    return false
  }
}
