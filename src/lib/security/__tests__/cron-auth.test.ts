// ============================================================================
// Testes da autenticação de cron (R1)
// ----------------------------------------------------------------------------
// Sem rede, sem banco, sem process.env real: o ambiente é injetado em cada
// caso. Os testes de rota chamam o handler de verdade — com enforcement ligado
// e sem credencial, ele devolve 401 antes de qualquer acesso a dados.
//
// Como rodar (sem instalar nada):
//   node_modules/.bin/tsc -p <tsconfig de teste>   &&   node <saida>/...test.js
// ============================================================================

import assert from 'node:assert/strict'

import {
  CRON_UNAUTHORIZED_BODY,
  evaluateCronAuth,
  extractBearerToken,
  isEnforcing,
  logCronAuth,
  verifyCronSecret,
  type EnvLike,
} from '../cron-auth'

import { GET, POST, handle } from '@/app/api/queue/process/route'

// ─── Runner mínimo ──────────────────────────────────────────────────────────

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []

function test(name: string, fn: () => void | Promise<void>) {
  suite.push({ name, fn })
}

// ─── Utilidades ─────────────────────────────────────────────────────────────

const SECRET = 'sk_cron_valor_super_secreto_para_testes_123456'
const WRONG = 'sk_cron_valor_errado_mas_do_mesmo_tamanho_1234'

const OFF: EnvLike = { CRON_SECRET: SECRET }
const ON: EnvLike = { CRON_SECRET: SECRET, CRON_AUTH_ENFORCE: 'true' }

function req(opts: { method?: string; auth?: string | null; ua?: string } = {}) {
  const headers = new Headers()
  if (opts.auth) headers.set('authorization', opts.auth)
  headers.set('user-agent', opts.ua ?? 'curl/8.5.0')
  return { method: opts.method ?? 'POST', headers }
}

/** Captura tudo que for para o console durante `fn`. */
async function captureLogs(fn: () => void | Promise<void>): Promise<string> {
  const orig = { log: console.log, warn: console.warn, error: console.error }
  const buf: string[] = []
  const grab = (...a: unknown[]) => { buf.push(a.map(String).join(' ')) }
  console.log = grab; console.warn = grab; console.error = grab
  try {
    await fn()
  } finally {
    console.log = orig.log; console.warn = orig.warn; console.error = orig.error
  }
  return buf.join('\n')
}

// ─── 1-3. Enforcement DESLIGADO: nada é bloqueado ───────────────────────────

test('1) enforcement off + segredo válido -> passa como authenticated', () => {
  const r = evaluateCronAuth(req({ auth: `Bearer ${SECRET}` }), OFF)
  assert.equal(r.allowed, true)
  assert.equal(r.mode, 'authenticated')
  assert.equal(r.enforced, false)
})

test('2) enforcement off + segredo ausente -> passa, marcado legacy_missing', () => {
  const r = evaluateCronAuth(req(), OFF)
  assert.equal(r.allowed, true, 'chamador legado NAO pode ser quebrado nesta etapa')
  assert.equal(r.mode, 'legacy_missing')
})

test('3) enforcement off + segredo inválido -> passa, marcado legacy_invalid', () => {
  const r = evaluateCronAuth(req({ auth: `Bearer ${WRONG}` }), OFF)
  assert.equal(r.allowed, true)
  assert.equal(r.mode, 'legacy_invalid')
})

test('enforcement off é o padrão quando a variável está ausente', () => {
  assert.equal(isEnforcing({}), false)
  assert.equal(isEnforcing({ CRON_AUTH_ENFORCE: '' }), false)
  assert.equal(isEnforcing({ CRON_AUTH_ENFORCE: '1' }), false, 'só o literal "true" liga')
  assert.equal(isEnforcing({ CRON_AUTH_ENFORCE: 'yes' }), false)
  assert.equal(isEnforcing({ CRON_AUTH_ENFORCE: ' TRUE ' }), true)
})

// ─── 4-7. Enforcement LIGADO ────────────────────────────────────────────────

test('4) enforcement on + segredo válido -> permitido', () => {
  const r = evaluateCronAuth(req({ auth: `Bearer ${SECRET}` }), ON)
  assert.equal(r.allowed, true)
  assert.equal(r.mode, 'authenticated')
  assert.equal(r.enforced, true)
  assert.equal(r.configError, false)
})

test('5) enforcement on + segredo ausente -> recusado', () => {
  const r = evaluateCronAuth(req(), ON)
  assert.equal(r.allowed, false)
  assert.equal(r.mode, 'legacy_missing')
})

test('6) enforcement on + segredo inválido -> recusado', () => {
  const r = evaluateCronAuth(req({ auth: `Bearer ${WRONG}` }), ON)
  assert.equal(r.allowed, false)
  assert.equal(r.mode, 'legacy_invalid')
})

test('7) enforcement on + CRON_SECRET ausente -> falha fechada e sinaliza config', () => {
  const env: EnvLike = { CRON_AUTH_ENFORCE: 'true' }
  const comSegredo = evaluateCronAuth(req({ auth: `Bearer ${SECRET}` }), env)
  assert.equal(comSegredo.allowed, false, 'sem CRON_SECRET nada passa')
  assert.equal(comSegredo.configError, true)

  const semSegredo = evaluateCronAuth(req(), env)
  assert.equal(semSegredo.allowed, false)
  assert.equal(semSegredo.configError, true)

  // CRON_SECRET vazio é tratado como ausente
  const vazio = evaluateCronAuth(req({ auth: 'Bearer x' }), { CRON_AUTH_ENFORCE: 'true', CRON_SECRET: '' })
  assert.equal(vazio.allowed, false)
  assert.equal(vazio.configError, true)
})

// ─── Extração do header ─────────────────────────────────────────────────────

test('só aceita Bearer no header Authorization', () => {
  assert.equal(extractBearerToken(req({ auth: `Bearer ${SECRET}` })), SECRET)
  assert.equal(extractBearerToken(req({ auth: `bearer ${SECRET}` })), SECRET, 'esquema é case-insensitive')
  assert.equal(extractBearerToken(req({ auth: `Basic ${SECRET}` })), null)
  assert.equal(extractBearerToken(req({ auth: 'Bearer' })), null)
  assert.equal(extractBearerToken(req({ auth: 'Bearer    ' })), null)
  assert.equal(extractBearerToken(req()), null)
})

test('segredo em query string é ignorado (URLs vazam em log)', () => {
  // Nada na avaliação lê a URL: um ?key=/?token= correto não autentica.
  const r = evaluateCronAuth(req(), ON)
  assert.equal(r.allowed, false)
  assert.equal(r.mode, 'legacy_missing')
})

test('comparação não usa === e tolera tamanhos diferentes', () => {
  assert.equal(verifyCronSecret(SECRET, SECRET), true)
  assert.equal(verifyCronSecret(WRONG, SECRET), false)
  assert.equal(verifyCronSecret('x', SECRET), false, 'tamanho diferente não pode lançar')
  assert.equal(verifyCronSecret(SECRET + 'a', SECRET), false)
  assert.equal(verifyCronSecret(null, SECRET), false)
  assert.equal(verifyCronSecret(SECRET, undefined), false)
  assert.equal(verifyCronSecret(SECRET, ''), false)
})

// ─── 9. Nenhum segredo nos logs ─────────────────────────────────────────────

test('9) nenhum segredo, hash, prefixo ou tamanho aparece nos logs', async () => {
  const { createHash } = await import('node:crypto')
  const hash = createHash('sha256').update(SECRET).digest('hex')

  const saida = await captureLogs(() => {
    for (const env of [OFF, ON, { CRON_AUTH_ENFORCE: 'true' } as EnvLike]) {
      for (const auth of [null, `Bearer ${SECRET}`, `Bearer ${WRONG}`]) {
        for (const method of ['GET', 'POST']) {
          const r = req({ method, auth })
          logCronAuth(evaluateCronAuth(r, env), r, 200)
        }
      }
    }
  })

  assert.ok(!saida.includes(SECRET), 'o segredo vazou no log')
  assert.ok(!saida.includes(WRONG), 'o valor recebido vazou no log')
  assert.ok(!saida.includes(hash), 'o hash do segredo vazou no log')
  assert.ok(!saida.includes(hash.slice(0, 8)), 'prefixo do hash vazou')
  assert.ok(!saida.includes(SECRET.slice(0, 6)), 'prefixo do segredo vazou')
  assert.ok(!/Bearer/i.test(saida), 'o header cru vazou no log')

  // O comprimento é procurado FORA do timestamp: `at` é um campo permitido e
  // cheio de números, então um "45" vindo do relógio marcaria falso positivo.
  const semTimestamp = saida.replace(/"at":"[^"]*"/g, '"at":"<ts>"')
  assert.ok(!semTimestamp.includes(String(SECRET.length)), 'tamanho do segredo vazou')
  assert.ok(!semTimestamp.includes(String(WRONG.length)), 'tamanho do valor recebido vazou')

  // ...e o que DEVE estar registrado, está.
  assert.ok(saida.includes('authenticated'))
  assert.ok(saida.includes('legacy_missing'))
  assert.ok(saida.includes('legacy_invalid'))
  assert.ok(saida.includes('"method":"GET"') && saida.includes('"method":"POST"'))
  assert.ok(saida.includes('curl/8.5.0'), 'user-agent é permitido')
  assert.ok(saida.includes('"enforced":true') && saida.includes('"enforced":false'))
})

test('erro de configuração é registrado sem revelar nada', async () => {
  const r = req({ auth: `Bearer ${SECRET}` })
  const saida = await captureLogs(() => {
    logCronAuth(evaluateCronAuth(r, { CRON_AUTH_ENFORCE: 'true' }), r, 401)
  })
  assert.ok(saida.includes('CRON_SECRET não está configurado'))
  assert.ok(!saida.includes(SECRET))
})

// ─── 8, 10, 11. Rota: GET e POST pela mesma porta ───────────────────────────

async function chamaRota(
  fn: (r: Request) => Promise<Response>,
  method: string,
  auth: string | null,
  enforce: boolean,
) {
  const anterior = { s: process.env.CRON_SECRET, e: process.env.CRON_AUTH_ENFORCE }
  process.env.CRON_SECRET = SECRET
  if (enforce) process.env.CRON_AUTH_ENFORCE = 'true'
  else delete process.env.CRON_AUTH_ENFORCE

  const headers = new Headers()
  if (auth) headers.set('authorization', auth)
  const request = new Request('https://exemplo.test/api/queue/process', { method, headers })

  try {
    return await fn(request)
  } finally {
    if (anterior.s === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = anterior.s
    if (anterior.e === undefined) delete process.env.CRON_AUTH_ENFORCE; else process.env.CRON_AUTH_ENFORCE = anterior.e
  }
}

test('8) GET e POST usam a mesma proteção', async () => {
  await captureLogs(async () => {
    for (const [nome, fn] of [['GET', GET], ['POST', POST]] as const) {
      const res = await chamaRota(fn as (r: Request) => Promise<Response>, nome, null, true)
      assert.equal(res.status, 401, `${nome} deveria recusar sem credencial`)
    }
  })
})

test('11) resposta 401 é idêntica para segredo ausente e inválido', async () => {
  let semSegredo!: Response, invalido!: Response
  await captureLogs(async () => {
    semSegredo = await chamaRota(handle, 'POST', null, true)
    invalido = await chamaRota(handle, 'POST', `Bearer ${WRONG}`, true)
  })

  assert.equal(semSegredo.status, 401)
  assert.equal(invalido.status, 401)

  const a = await semSegredo.json()
  const b = await invalido.json()
  assert.deepEqual(a, b, 'corpos diferentes revelariam qual foi o erro')
  assert.deepEqual(a, CRON_UNAUTHORIZED_BODY)
  assert.ok(!JSON.stringify(a).toLowerCase().includes('missing'))
  assert.ok(!JSON.stringify(a).toLowerCase().includes('invalid'))
})

test('10) com credencial válida a requisição CHEGA ao processador', async () => {
  // Neste ambiente não há credencial de banco, então o processador falha ao
  // criar o client e o handler devolve 500. É exatamente a prova buscada:
  // 500 significa que passou da autenticação e entrou em run(); 401 significaria
  // que foi barrado antes. Nenhuma rede é usada — createClient falha na hora.
  let res!: Response
  const saida = await captureLogs(async () => {
    res = await chamaRota(handle, 'POST', `Bearer ${SECRET}`, true)
  })
  assert.notEqual(res.status, 401, 'credencial válida não pode ser recusada')
  assert.ok(saida.includes('authenticated'), 'a chamada foi registrada como autenticada')
})

test('modo de compatibilidade deixa o chamador legado processar', async () => {
  let res!: Response
  await captureLogs(async () => {
    res = await chamaRota(handle, 'POST', null, false)
  })
  assert.notEqual(res.status, 401, 'sem enforcement, chamada legada não pode receber 401')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (err) {
      results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FALHA'} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
  if (failed.length > 0) process.exitCode = 1
}

void main()
