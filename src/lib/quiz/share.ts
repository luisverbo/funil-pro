// ============================================================================
// Painel compartilhado de leads — token e senha (regras puras)
// ----------------------------------------------------------------------------
// O caso de uso: quem capta lead para clientes manda um link com senha, e o
// cliente abre o painel DAQUELE quiz e baixa os leads — sem conta no sistema,
// sem enxergar nada além daquele quiz.
//
// Três decisões de segurança, nenhuma negociável:
//
//   1. A senha NUNCA é guardada em claro. Vai para o banco como
//      scrypt(salt, senha) — se a tabela vazar, a senha não vaza. scrypt (e
//      não sha256 puro) porque senha de pessoa é curta e adivinhável; scrypt
//      torna o chute em massa caro.
//   2. A comparação é em TEMPO CONSTANTE (timingSafeEqual). Comparação comum
//      devolve mais rápido quando o começo bate — dá para adivinhar a senha
//      caractere a caractere medindo o tempo.
//   3. O token do link tem 128 bits aleatórios. O link sozinho já é
//      inadivinhável; a senha é a segunda tranca, para o caso de o link parar
//      num grupo errado.
// ============================================================================

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** Tamanho do token na URL: 128 bits em base64url (22 caracteres). */
export const SHARE_TOKEN_BYTES = 16

export const SHARE_SENHA_MIN = 4

/** Custo do scrypt — o padrão do Node (N=16384), suficiente para senha de painel. */
const SCRYPT_KEYLEN = 32

export function gerarTokenShare(): string {
  return randomBytes(SHARE_TOKEN_BYTES).toString('base64url')
}

/** `salt:hash`, ambos hex — autocontido, sem coluna extra. */
export function hashSenhaShare(senha: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(senha.normalize('NFKC'), salt, SCRYPT_KEYLEN).toString('hex')
  return `${salt}:${hash}`
}

export function verificarSenhaShare(senha: string, guardado: string): boolean {
  const [salt, hashHex] = guardado.split(':')
  if (!salt || !hashHex) return false
  try {
    const esperado = Buffer.from(hashHex, 'hex')
    const obtido = scryptSync(senha.normalize('NFKC'), salt, SCRYPT_KEYLEN)
    return esperado.length === obtido.length && timingSafeEqual(esperado, obtido)
  } catch {
    return false
  }
}

/** Valida a senha ANTES de criar o link — erro em pt, para a tela. */
export function validarSenhaShare(senha: string): string | null {
  const s = senha.trim()
  if (s.length < SHARE_SENHA_MIN) return `A senha precisa de pelo menos ${SHARE_SENHA_MIN} caracteres`
  if (s.length > 72) return 'A senha é longa demais'
  return null
}

/** Token vindo da URL: só o formato que nós geramos passa adiante. */
export function tokenShareValido(token: string): boolean {
  return /^[A-Za-z0-9_-]{20,32}$/.test(token)
}
