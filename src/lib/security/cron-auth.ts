// ============================================================================
// Autenticação dos chamadores de cron (R1)
// ----------------------------------------------------------------------------
// /api/queue/process é chamado por dois clientes que não têm sessão: o crontab
// da VPS e o GitHub Actions. Este módulo decide se a chamada pode passar.
//
// A troca é feita em DUAS ETAPAS, de propósito:
//
//   CRON_AUTH_ENFORCE ausente/false  -> compatibilidade: tudo passa, mas cada
//                                       chamada sem segredo (ou com segredo
//                                       errado) é registrada como legada.
//   CRON_AUTH_ENFORCE=true           -> só passa quem apresentar o segredo.
//
// Exigir o segredo antes de os dois chamadores estarem enviando o header
// derrubaria filas de funil, sequências de DM do Instagram, lembretes de
// reunião e follow-ups — todos passam por este mesmo endpoint.
//
// REGRA DE LOG: nunca registrar o segredo, seu hash, um prefixo dele, seu
// comprimento ou o valor recebido no header. Só o MODO da chamada.
// ============================================================================

import { createHash, timingSafeEqual } from 'node:crypto'

/** Como a chamada se apresentou. */
export type CronAuthMode =
  /** Trouxe o segredo correto. */
  | 'authenticated'
  /** Não trouxe header Authorization (ou não era Bearer). Chamador legado. */
  | 'legacy_missing'
  /** Trouxe um Bearer que não confere. */
  | 'legacy_invalid'

export interface CronAuthResult {
  /** Se a requisição pode seguir para o processamento. */
  allowed: boolean
  mode: CronAuthMode
  /** Se o enforcement estava ligado nesta avaliação. */
  enforced: boolean
  /** true quando enforcement está ligado mas CRON_SECRET não foi configurado. */
  configError: boolean
}

/** Fonte mínima de ambiente — parametrizada para os testes não mexerem em process.env. */
export type EnvLike = Record<string, string | undefined>

/**
 * Enforcement só liga com o literal "true" (sem espaços, sem caixa).
 *
 * Deliberadamente estrito: um `CRON_AUTH_ENFORCE=1` ou `=yes` digitado por
 * engano deve deixar o sistema no modo permissivo, não derrubar as filas.
 */
export function isEnforcing(env: EnvLike = process.env): boolean {
  return (env.CRON_AUTH_ENFORCE ?? '').trim().toLowerCase() === 'true'
}

/**
 * Extrai o segredo de `Authorization: Bearer <valor>`.
 *
 * SOMENTE header. Nunca query string: `?key=` e `?token=` vazam em logs de
 * servidor, histórico de proxy, Referer e painéis de analytics.
 */
export function extractBearerToken(request: { headers: Headers }): string | null {
  const raw = request.headers.get('authorization')
  if (!raw) return null

  const match = /^Bearer[ \t]+(.+)$/i.exec(raw.trim())
  if (!match) return null

  const token = match[1].trim()
  return token.length > 0 ? token : null
}

/**
 * Compara dois segredos em tempo constante.
 *
 * Passa pelo SHA-256 antes de comparar porque `timingSafeEqual` exige buffers
 * do MESMO tamanho — comparar direto vazaria o comprimento do segredo (lança
 * exceção quando difere) e permitiria distinguir tentativas pelo tamanho.
 * O hash normaliza tudo para 32 bytes.
 */
export function verifyCronSecret(provided: string | null, expected: string | undefined): boolean {
  if (!provided) return false
  if (!expected || expected.length === 0) return false

  const a = createHash('sha256').update(provided, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/**
 * Decide se a requisição passa.
 *
 * No modo de compatibilidade `allowed` é sempre true — inclusive para segredo
 * inválido. É intencional: durante a transição o objetivo é NÃO quebrar nada
 * enquanto observamos, nos logs, se os dois chamadores já estão autenticando.
 */
export function evaluateCronAuth(
  request: { headers: Headers },
  env: EnvLike = process.env,
): CronAuthResult {
  const enforced = isEnforcing(env)
  const expected = env.CRON_SECRET
  const token = extractBearerToken(request)

  const mode: CronAuthMode = token === null
    ? 'legacy_missing'
    : verifyCronSecret(token, expected) ? 'authenticated' : 'legacy_invalid'

  // Enforcement ligado sem segredo configurado: falha fechada. Deixar passar
  // aqui transformaria um erro de configuração num bypass silencioso.
  const configError = enforced && (!expected || expected.length === 0)

  return {
    allowed: enforced ? mode === 'authenticated' : true,
    mode,
    enforced,
    configError,
  }
}

/** Corpo da resposta de recusa. Idêntico para ausente e inválido — não dá pista nenhuma. */
export const CRON_UNAUTHORIZED_BODY = { error: 'unauthorized' } as const

/**
 * Registra a decisão. Só metadados: nada aqui deriva do segredo.
 *
 * `logCronAuth` é a ÚNICA função que escreve log de autenticação — concentrar
 * isso num lugar é o que torna auditável a promessa de não vazar credencial.
 */
export function logCronAuth(
  result: CronAuthResult,
  request: { method: string; headers: Headers },
  status: number,
): void {
  if (result.configError) {
    console.error(
      '[cron-auth] CRON_AUTH_ENFORCE=true mas CRON_SECRET não está configurado — ' +
      'todas as chamadas serão recusadas até a variável ser definida.',
    )
  }

  const entry = {
    at: new Date().toISOString(),
    method: request.method,
    ua: request.headers.get('user-agent') ?? null,
    origin: request.headers.get('x-forwarded-for') ?? request.headers.get('origin') ?? null,
    mode: result.mode,
    enforced: result.enforced,
    status,
  }

  const line = `[cron-auth] ${JSON.stringify(entry)}`
  if (result.mode === 'authenticated') console.log(line)
  else console.warn(line)
}
