// ============================================================================
// Content Studio — Fase 2B: provider Anthropic concreto (fetch MOCKADO)
// ----------------------------------------------------------------------------
// Nada aqui toca a rede: o fetch é injetado. O que se prova:
//
//   GRAFO REAL — o entrypoint de produção (registry → carousel-ai → bootstrap)
//   carrega a implementação Anthropic SEM depender de import lateral. Este
//   teste reproduzia o defeito da primeira versão ("provider real não
//   carregado") e agora trava a regressão.
//
//   ROBUSTEZ — stop_reason, classificação de retry por status HTTP,
//   contabilização de tokens com cache, e a garantia de que NENHUM caminho
//   excede duas chamadas HTTP.
//
// Sem sleeps reais: a espera é injetada e apenas registrada.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  classifyHttpStatus,
  classifyStopReason,
  createAnthropicProvider,
  retryDelayMs,
  RETRY_AFTER_CAP_MS,
} from '../ai/anthropic'
import { __setContentAIProviderForTests, type AICallRequest } from '../ai/provider'

const RAIZ = process.cwd()
const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ─── Utilitários de mock ────────────────────────────────────────────────────

interface RespostaFalsa {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** simula corpo HTTP que não é JSON */
  corpoInvalido?: boolean
  /** simula erro de rede */
  networkError?: boolean
  /** simula estouro do timeout (AbortError) */
  timeout?: boolean
}

function anthropicBody(texto: string, extras: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: texto }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
    ...extras,
  }
}

/** fetch falso: devolve as respostas na ordem e registra cada chamada. */
function fetchFalso(respostas: RespostaFalsa[]) {
  const chamadas: { headers: Record<string, string>; body: string }[] = []
  const esperas: number[] = []
  let i = 0

  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    const idx = Math.min(i, respostas.length - 1)
    const r = respostas[idx]
    i++
    chamadas.push({
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ''),
    })
    if (r.timeout) { const e = new Error('aborted'); e.name = 'AbortError'; throw e }
    if (r.networkError) throw new Error('ECONNRESET')
    return {
      status: r.status ?? 200,
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
      json: async () => {
        if (r.corpoInvalido) throw new Error('unexpected token')
        return r.body
      },
    } as unknown as Response
  }) as typeof fetch

  return {
    fetchFn,
    esperas,
    wait: async (ms: number) => { esperas.push(ms) },
    get chamadas() { return chamadas },
  }
}

function reqBase(): AICallRequest {
  return {
    system: 'system de teste',
    userContent: 'conteudo',
    parse: raw => {
      const o = raw as Record<string, unknown>
      if (typeof o.ok !== 'boolean') throw new Error('schema: ok ausente')
      return o
    },
    maxOutputTokens: 100,
    timeoutMs: 5_000,
    executionId: 'teste:exec:a0',
  }
}

function comChave<T>(fn: () => T): T {
  const originalKey = process.env.ANTHROPIC_API_KEY
  const originalModel = process.env.CONTENT_AI_MODEL
  process.env.ANTHROPIC_API_KEY = 'sk-teste-nao-real'
  // O modelo agora é OBRIGATÓRIO e explícito — como será em produção.
  process.env.CONTENT_AI_MODEL = 'claude-modelo-de-teste'
  try { return fn() } finally {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
    if (originalModel === undefined) delete process.env.CONTENT_AI_MODEL
    else process.env.CONTENT_AI_MODEL = originalModel
  }
}

// O teste do GRAFO foi movido para phase2b-graph.test.ts, em PROCESSO
// SEPARADO: este arquivo importa anthropic.ts diretamente (contexto unitário),
// o que invalidaria qualquer afirmação sobre o carregamento pelo grafo.

// ─── 1–6: caminho feliz e tokens ────────────────────────────────────────────

test('1-3) 200 + end_turn + JSON válido: aceito, tokens contabilizados', async () => {
  const mock = fetchFalso([{ body: anthropicBody('{"ok":true}') }])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  const r = await provider.call(reqBase())
  assert.equal(r.output.ok, true)
  assert.equal(r.calls, 1)
  assert.equal(r.finish, 'ok')
  assert.equal(r.uncachedInputTokens, 100)
  assert.equal(r.inputTokens, 100)
  assert.equal(r.outputTokens, 50)
})

test('4-6) tokens de cache: criação e leitura entram no TOTAL, sem dupla contagem', async () => {
  const mock = fetchFalso([{
    body: anthropicBody('{"ok":true}', {
      usage: {
        input_tokens: 40,                    // não cacheados
        cache_creation_input_tokens: 900,    // gravados no cache
        cache_read_input_tokens: 2100,       // lidos do cache
        output_tokens: 77,
      },
    }),
  }])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  const r = await provider.call(reqBase())
  assert.equal(r.uncachedInputTokens, 40)
  assert.equal(r.cacheCreationInputTokens, 900)
  assert.equal(r.cacheReadInputTokens, 2100)
  assert.equal(r.inputTokens, 40 + 900 + 2100, 'o total subestima o consumo')
  assert.equal(r.outputTokens, 77)
})

// ─── 7–12: classificação de retry ───────────────────────────────────────────

test('7) 429 → espera (respeitando Retry-After com teto) → retry → sucesso', async () => {
  const mock = fetchFalso([
    { status: 429, body: {}, headers: { 'retry-after': '120' } },
    { body: anthropicBody('{"ok":true}') },
  ])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  const r = await provider.call(reqBase())
  assert.equal(r.calls, 2)
  assert.equal(r.finish, 'ok_after_retry')
  // Retry-After de 120s foi respeitado, mas com TETO curto.
  assert.deepEqual(mock.esperas, [RETRY_AFTER_CAP_MS])
  assert.equal(retryDelayMs('2'), 2000)
  assert.equal(retryDelayMs(null), 1000)
  assert.equal(retryDelayMs('lixo'), 1000)
})

test('8) 500/502/503/529 → no máximo UM retry, e SEM espera após a última', async () => {
  for (const status of [500, 502, 503, 529, 429]) {
    const mock = fetchFalso([{ status, body: {} }, { status, body: {} }, { status, body: {} }])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()), /content_ai:(provider_server_error|rate_limited)/)
    assert.equal(mock.chamadas.length, 2, `status ${status}: ${mock.chamadas.length} chamadas`)
    // A espera acontece SÓ entre a 1ª e a 2ª chamada — nunca depois da última
    // falhar: seria segurar a Server Action por nada.
    assert.equal(mock.esperas.length, 1, `status ${status}: ${mock.esperas.length} esperas`)
    assert.equal(classifyHttpStatus(status), 'retryable')
  }
})

test('9-10) 400/401/403/404 → NENHUMA repetição, com código estruturado', async () => {
  const casos: [number, string, string][] = [
    [400, 'invalid_request_error', 'invalid_request'],
    [401, 'authentication_error', 'authentication_error'],
    [403, 'permission_error', 'permission_error'],
    [404, 'not_found_error', 'invalid_model'],
  ]
  for (const [status, tipo, esperado] of casos) {
    const mock = fetchFalso([{ status, body: { type: 'error', error: { type: tipo, message: 'x' } } }])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()), new RegExp(`content_ai:${esperado}`))
    assert.equal(mock.chamadas.length, 1, `status ${status} foi repetido`)
    assert.equal(classifyHttpStatus(status), 'fatal')
  }
})

test('11) timeout → no máximo um retry', async () => {
  const mock = fetchFalso([{ timeout: true }, { timeout: true }, { timeout: true }])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  await assert.rejects(() => provider.call(reqBase()), /content_ai:timeout/)
  assert.equal(mock.chamadas.length, 2)
})

test('12) erro de rede → no máximo um retry', async () => {
  const mock = fetchFalso([{ networkError: true }, { networkError: true }])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  await assert.rejects(() => provider.call(reqBase()), /content_ai:network_error/)
  assert.equal(mock.chamadas.length, 2)
})

// ─── 13–15: stop_reason ─────────────────────────────────────────────────────

test('13) max_tokens: truncada NUNCA é persistida; refazer inteira 1x', async () => {
  const truncada = anthropicBody('{"ok":tru', { stop_reason: 'max_tokens' })
  const mock = fetchFalso([{ body: truncada }, { body: truncada }])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  await assert.rejects(() => provider.call(reqBase()), /content_ai:truncated_output/)
  assert.equal(mock.chamadas.length, 2, 'truncada deveria refazer a chamada UMA vez')
  // E na segunda vez cabendo no teto, aceita:
  const mock2 = fetchFalso([{ body: truncada }, { body: anthropicBody('{"ok":true}') }])
  const provider2 = comChave(() => createAnthropicProvider({ fetchFn: mock2.fetchFn, wait: mock2.wait }))
  const r = await provider2.call(reqBase())
  assert.equal(r.finish, 'ok_after_retry')
})

test('14) refusal: nunca persistir, NENHUMA repetição', async () => {
  const mock = fetchFalso([{ body: anthropicBody('não posso ajudar', { stop_reason: 'refusal' }) }])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  await assert.rejects(() => provider.call(reqBase()), /content_ai:refusal/)
  assert.equal(mock.chamadas.length, 1, 'refusal foi repetida')
})

test('15) tool_use / pause_turn / stop_sequence / desconhecido → falha segura', async () => {
  for (const stop of ['tool_use', 'pause_turn', 'stop_sequence', 'algo_novo_da_api', undefined]) {
    const mock = fetchFalso([{ body: anthropicBody('{"ok":true}', { stop_reason: stop }) }])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()), /content_ai:unexpected_stop/)
    assert.equal(mock.chamadas.length, 1, `stop_reason=${stop} foi repetido`)
    const c = classifyStopReason(stop)
    assert.equal(c.ok, false)
    assert.equal(c.retryable ?? false, false)
  }
  assert.equal(classifyStopReason('end_turn').ok, true)
})

// ─── 16–19: conteúdo inválido ───────────────────────────────────────────────

test('16) JSON inválido → no máximo um retry', async () => {
  const mock = fetchFalso([
    { body: anthropicBody('não é json de jeito nenhum') },
    { body: anthropicBody('ainda não é') },
  ])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  await assert.rejects(() => provider.call(reqBase()), /content_ai:invalid_output/)
  assert.equal(mock.chamadas.length, 2)
})

test('17) schema inválido → no máximo um retry', async () => {
  const mock = fetchFalso([
    { body: anthropicBody('{"outra_coisa":1}') },
    { body: anthropicBody('{"outra_coisa":2}') },
  ])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  await assert.rejects(() => provider.call(reqBase()), /content_ai:invalid_output/)
  assert.equal(mock.chamadas.length, 2)
})

test('18) resposta vazia → falha segura', async () => {
  const mock = fetchFalso([
    { body: { content: [], stop_reason: 'end_turn', usage: {} } },
    { body: { content: [], stop_reason: 'end_turn', usage: {} } },
  ])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  await assert.rejects(() => provider.call(reqBase()), /content_ai:invalid_output/)
})

test('19) corpo HTTP que não é JSON → falha segura', async () => {
  const mock = fetchFalso([{ corpoInvalido: true }, { corpoInvalido: true }])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  await assert.rejects(() => provider.call(reqBase()), /content_ai:invalid_output/)
  assert.equal(mock.chamadas.length, 2)
})

// ─── 20–22: vazamento e teto absoluto ───────────────────────────────────────

test('20-21) resposta bruta e API key nunca aparecem em erro ou log', async () => {
  const segredoResposta = 'CONTEUDO-SECRETO-DA-RESPOSTA'
  const logs: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(' ')) }
  try {
    const mock = fetchFalso([
      { body: anthropicBody(segredoResposta) },
      { body: anthropicBody(segredoResposta) },
    ])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()), (err: Error) => {
      assert.ok(!err.message.includes(segredoResposta), 'a resposta bruta vazou no erro')
      assert.ok(!err.message.includes('sk-teste'), 'a chave vazou no erro')
      return true
    })
    const tudo = logs.join('\n')
    assert.ok(!tudo.includes(segredoResposta), 'a resposta bruta vazou no log')
    assert.ok(!tudo.includes('sk-teste'), 'a chave vazou no log')
    assert.ok(!tudo.includes('system de teste'), 'o prompt vazou no log')
  } finally {
    console.error = originalError
  }
})

test('22) NENHUM caminho excede duas chamadas HTTP', async () => {
  const cenarios: RespostaFalsa[][] = [
    [{ status: 429, body: {} }, { status: 500, body: {} }, { body: anthropicBody('{"ok":true}') }],
    [{ timeout: true }, { networkError: true }, { body: anthropicBody('{"ok":true}') }],
    [{ body: anthropicBody('inválido') }, { body: anthropicBody('{"errado":1}') }, { body: anthropicBody('{"ok":true}') }],
    [{ body: anthropicBody('x', { stop_reason: 'max_tokens' }) }, { status: 503, body: {} }, { body: anthropicBody('{"ok":true}') }],
  ]
  for (const respostas of cenarios) {
    const mock = fetchFalso(respostas)
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await provider.call(reqBase()).catch(() => {})
    assert.ok(mock.chamadas.length <= 2, `cenário fez ${mock.chamadas.length} chamadas HTTP`)
  }
})

// ─── configuração de modelo ─────────────────────────────────────────────────

test('modelo) CONTENT_AI_MODEL é OBRIGATÓRIO: ausente ou vazio = invalid_config', () => {
  const originalModel = process.env.CONTENT_AI_MODEL
  const originalKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'sk-teste-nao-real'
  try {
    // Ausente: o canário provou que o default herdado de chat.ts era uma
    // alegação frágil (AGENT_MODEL pode mascará-lo em produção). Sem fallback.
    delete process.env.CONTENT_AI_MODEL
    assert.throws(() => createAnthropicProvider(), /content_ai:invalid_config/)
    // Vazio/em branco: idem.
    process.env.CONTENT_AI_MODEL = '   '
    assert.throws(() => createAnthropicProvider(), /content_ai:invalid_config/)
    // Explícito: constrói sem rede.
    process.env.CONTENT_AI_MODEL = 'claude-modelo-explicito'
    const mock = fetchFalso([{ body: anthropicBody('{"ok":true}') }])
    createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait })
    assert.equal(mock.chamadas.length, 0, 'construir o provider tocou a rede')
    // E não sobrou fallback silencioso no config.
    const config = readFileSync(join(RAIZ, 'src/lib/content-studio/ai/config.ts'), 'utf8')
    assert.ok(!/return 'claude-/.test(config), 'fallback de modelo voltou ao config')
  } finally {
    if (originalModel === undefined) delete process.env.CONTENT_AI_MODEL
    else process.env.CONTENT_AI_MODEL = originalModel
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  }
})

test('cache) cache_control usa a MESMA combinação já em produção em chat.ts', () => {
  const chat = readFileSync(join(RAIZ, 'src/lib/agents/chat.ts'), 'utf8')
  const impl = readFileSync(join(RAIZ, 'src/lib/content-studio/ai/anthropic.ts'), 'utf8')
  // chat.ts roda em produção com esta dupla — não é experimento novo.
  assert.ok(chat.includes("cache_control: { type: 'ephemeral' }"))
  assert.ok(chat.includes("'anthropic-version': '2023-06-01'"))
  assert.ok(impl.includes("cache_control: { type: 'ephemeral' }"))
  assert.ok(impl.includes("'anthropic-version': '2023-06-01'"))
})

// ─── REGRESSÃO DO CANÁRIO: o request que o Sonnet 5 aceita ──────────────────

test('request) Sonnet 5 não recebe sampling parameters não padrão', async () => {
  // A causa CONFIRMADA do canário: o Sonnet 5 rejeita com 400 qualquer request
  // com temperature/top_p/top_k fora do padrão — e mandávamos temperature
  // sempre (0.2–0.8). Este teste inspeciona o BODY real enviado.
  const originalKey = process.env.ANTHROPIC_API_KEY
  const original = process.env.CONTENT_AI_MODEL
  process.env.ANTHROPIC_API_KEY = 'sk-teste-nao-real'
  process.env.CONTENT_AI_MODEL = 'claude-sonnet-5'
  try {
    const mock = fetchFalso([{ body: anthropicBody('{"ok":true}') }])
    const provider = createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait })
    await provider.call(reqBase())

    const body = JSON.parse(mock.chamadas[0].body) as Record<string, unknown>
    assert.equal(body.model, 'claude-sonnet-5')
    assert.ok(!('temperature' in body), 'temperature voltou ao payload')
    assert.ok(!('top_p' in body), 'top_p entrou no payload')
    assert.ok(!('top_k' in body), 'top_k entrou no payload')
    assert.equal(body.max_tokens, 100)
    assert.ok(Array.isArray(body.system) && body.system.length === 1)
    assert.ok(Array.isArray(body.messages) && body.messages.length === 1)
    // thinking DESLIGADO explicitamente — sem budget_tokens.
    assert.deepEqual(body.thinking, { type: 'disabled' })
    assert.ok(!JSON.stringify(body.thinking).includes('budget'), 'budget_tokens vazou')
  } finally {
    if (original === undefined) delete process.env.CONTENT_AI_MODEL
    else process.env.CONTENT_AI_MODEL = original
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  }
})

test('request) 413 fatal; 409/504 retentáveis; request_id do corpo como fallback', async () => {
  // 413 request_too_large: repetir o MESMO request não conserta.
  const m413 = fetchFalso([{ status: 413, body: { type: 'error', error: { type: 'request_too_large' } } }])
  const p413 = comChave(() => createAnthropicProvider({ fetchFn: m413.fetchFn, wait: m413.wait }))
  await assert.rejects(() => p413.call(reqBase()), (err: Error) => {
    assert.equal((err as Error & { agentErrorDisposition?: string }).agentErrorDisposition, 'fatal')
    return true
  })
  assert.equal(m413.chamadas.length, 1, '413 foi repetido')

  // 409 conflict e 504 timeout_error: transitórios, um retry.
  for (const [status, tipo] of [[409, 'conflict_error'], [504, 'timeout_error']] as const) {
    const mock = fetchFalso([
      { status, body: { type: 'error', error: { type: tipo } } },
      { status, body: { type: 'error', error: { type: tipo } } },
    ])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()), (err: Error) => {
      assert.equal((err as Error & { agentErrorDisposition?: string }).agentErrorDisposition, 'retryable')
      return true
    })
    assert.equal(mock.chamadas.length, 2, `status ${status}: ${mock.chamadas.length} chamadas`)
  }

  // request_id: sem header, o corpo serve de fallback — só no log interno.
  const logs: string[] = []
  const originalError = console.error
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try {
    const mock = fetchFalso([{
      status: 400,
      body: { type: 'error', request_id: 'req_do_corpo_789', error: { type: 'invalid_request_error' } },
    }])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()))
    assert.ok(logs.some(l => l.includes('request_id=req_do_corpo_789')),
      'o request_id do corpo não foi usado como fallback no log')
  } finally {
    console.error = originalError
  }
})

// ─── CANÁRIO: HTTP 400 real reproduzido ─────────────────────────────────────

test('canário) 400 invalid_request: UMA chamada, fatal, diagnóstico seguro', async () => {
  const logs: string[] = []
  const originalError = console.error
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(' ')) }
  try {
    const mock = fetchFalso([{
      status: 400,
      headers: { 'request-id': 'req_canario_123' },
      body: { type: 'error', error: {
        type: 'invalid_request_error',
        message: 'SEGREDO-DA-MENSAGEM-ANTHROPIC campo x é inválido',
      } },
    }])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))

    await assert.rejects(() => provider.call(reqBase()), (err: Error) => {
      const e = err as Error & {
        agentErrorDisposition?: string; httpStatus?: number; providerErrorType?: string
      }
      assert.equal(e.agentErrorDisposition, 'fatal', '400 não veio tipado como fatal')
      assert.equal(e.httpStatus, 400)
      assert.equal(e.providerErrorType, 'invalid_request_error')
      assert.ok(e.message.startsWith('content_ai:invalid_request'))
      assert.ok(!e.message.includes('SEGREDO-DA-MENSAGEM'), 'mensagem bruta vazou no erro')
      return true
    })

    assert.equal(mock.chamadas.length, 1, '400 gerou retry interno')
    assert.equal(mock.esperas.length, 0, '400 gerou espera')

    // O log interno responde modelo/status/type/request-id — sem prompt/chave.
    const linha = logs.find(l => l.includes('request_id=req_canario_123'))
    assert.ok(linha, 'o log estruturado não registrou o request-id')
    assert.ok(linha!.includes('model=claude-modelo-de-teste'))
    assert.ok(linha!.includes('status=400'))
    assert.ok(linha!.includes('type=invalid_request_error'))
    assert.ok(linha!.includes('code=invalid_request'))
    assert.ok(!linha!.includes('sk-teste'), 'a chave vazou no log')
    assert.ok(!linha!.includes('system de teste'), 'o prompt vazou no log')
    // A mensagem higienizada PODE ir ao log interno — truncada.
    assert.ok(!logs.join('').includes('conteudo'), 'o userContent vazou no log')
  } finally {
    console.error = originalError
  }
})

test('canário) variações: 401/403/404 fatais; 429/500 retentáveis; JSON de erro malformado', async () => {
  // Fatais: uma chamada cada.
  for (const [status, tipo] of [[401, 'authentication_error'], [403, 'permission_error'], [404, 'not_found_error']] as const) {
    const mock = fetchFalso([{ status, body: { type: 'error', error: { type: tipo } } }])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()), (err: Error) => {
      assert.equal((err as Error & { agentErrorDisposition?: string }).agentErrorDisposition, 'fatal')
      return true
    })
    assert.equal(mock.chamadas.length, 1, `status ${status} repetiu`)
  }
  // Retentáveis: duas chamadas, erro final tipado como retryable.
  for (const [status, tipo] of [[429, 'rate_limit_error'], [500, 'api_error'], [529, 'overloaded_error']] as const) {
    const mock = fetchFalso([
      { status, body: { type: 'error', error: { type: tipo } } },
      { status, body: { type: 'error', error: { type: tipo } } },
    ])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()), (err: Error) => {
      assert.equal((err as Error & { agentErrorDisposition?: string }).agentErrorDisposition, 'retryable')
      return true
    })
    assert.equal(mock.chamadas.length, 2, `status ${status}: ${mock.chamadas.length} chamadas`)
  }
  // Corpo de erro que NEM é JSON: o status decide, sem derrubar o diagnóstico.
  const mock = fetchFalso([{ status: 400, corpoInvalido: true }])
  const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
  await assert.rejects(() => provider.call(reqBase()), /content_ai:unknown_provider_error/)
  assert.equal(mock.chamadas.length, 1)
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (err) { results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) }) }
    finally { __setContentAIProviderForTests(null) }
  }
  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FALHA'} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
  if (failed.length > 0) process.exitCode = 1
}

void main()
