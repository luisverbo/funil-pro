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
import { resolveContentAIProvider } from '../ai/bootstrap'
import { __setContentAIProviderForTests, type AICallRequest } from '../ai/provider'
import { getAgent } from '../agents/registry'
import type { AgentInput } from '../types'

const RAIZ = process.cwd()
const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ─── Utilitários de mock ────────────────────────────────────────────────────

const RESEARCH_JSON = {
  contexto_do_produto: 'x', objetivo: 'y', perfil_do_publico: 'z',
  nivel_de_consciencia: 'w', dores_inferidas: ['a'], desejos: ['b'],
  objecoes: ['c'], hipoteses: ['d'],
}

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
    temperature: 0.2,
    timeoutMs: 5_000,
    executionId: 'teste:exec:a0',
  }
}

function comChave<T>(fn: () => T): T {
  const original = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'sk-teste-nao-real'
  try { return fn() } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = original
  }
}

// ─── O teste do GRAFO REAL ──────────────────────────────────────────────────
// Este arquivo NÃO importa anthropic.ts para provocar registro lateral — os
// imports acima são de funções puras, e o caminho executado abaixo é o MESMO
// da produção: getAgent (registry) → carousel-ai → bootstrap. Na primeira
// versão, este teste falhava com "provider real não carregado".

test('grafo) o entrypoint de produção carrega a implementação Anthropic', async () => {
  __setContentAIProviderForTests(null)                 // sem provedor de teste
  const originalEnabled = process.env.CONTENT_AI_ENABLED
  const originalKey = process.env.ANTHROPIC_API_KEY
  const originalFetch = globalThis.fetch
  process.env.CONTENT_AI_ENABLED = 'true'
  process.env.ANTHROPIC_API_KEY = 'sk-teste-nao-real'

  let alcancouAnthropic = false
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    alcancouAnthropic = String(url).startsWith('https://api.anthropic.com')
    assert.ok((init?.headers as Record<string, string>)['x-api-key'], 'sem chave no header')
    return {
      status: 200,
      headers: { get: () => null },
      json: async () => anthropicBody(JSON.stringify(RESEARCH_JSON)),
    } as unknown as Response
  }) as typeof fetch

  try {
    const agente = getAgent('cc_researcher')           // entrypoint de produção
    const input: AgentInput = {
      envelope: {
        productionId: 'p', stepId: 's', agentKey: 'cc_researcher',
        tenantId: 't', attempt: 0, idempotencyKey: 'k',
      },
      brief: { tema: 'organização de leads', publico: 'pequenas empresas' },
      upstream: {}, stepInput: null,
    }
    const out = await agente.run(input, {})

    assert.ok(alcancouAnthropic, 'a chamada NÃO alcançou a implementação Anthropic')
    assert.equal(out.data.pesquisa_externa_realizada, false)
    assert.equal(out.usage?.provider, 'anthropic')
  } catch (err) {
    // O defeito original aparecia exatamente assim:
    assert.ok(!(err instanceof Error && err.message.includes('provider real não carregado')),
      'REGRESSÃO: o grafo de produção não carrega o provider real')
    throw err
  } finally {
    globalThis.fetch = originalFetch
    if (originalEnabled === undefined) delete process.env.CONTENT_AI_ENABLED
    else process.env.CONTENT_AI_ENABLED = originalEnabled
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  }
})

test('grafo) desabilitado → disabled; sem chave → missing_key; nenhum template', () => {
  __setContentAIProviderForTests(null)
  const originalEnabled = process.env.CONTENT_AI_ENABLED
  const originalKey = process.env.ANTHROPIC_API_KEY
  try {
    delete process.env.CONTENT_AI_ENABLED
    assert.throws(() => resolveContentAIProvider(), /content_ai:disabled/)
    process.env.CONTENT_AI_ENABLED = 'true'
    delete process.env.ANTHROPIC_API_KEY
    assert.throws(() => resolveContentAIProvider(), /content_ai:missing_key/)
  } finally {
    if (originalEnabled === undefined) delete process.env.CONTENT_AI_ENABLED
    else process.env.CONTENT_AI_ENABLED = originalEnabled
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = originalKey
  }
})

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

test('8) 500/502/503/529 → no máximo UM retry cada', async () => {
  for (const status of [500, 502, 503, 529]) {
    const mock = fetchFalso([{ status, body: {} }, { status, body: {} }, { status, body: {} }])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()), /content_ai:(provider_error|rate_limited)/)
    assert.equal(mock.chamadas.length, 2, `status ${status}: ${mock.chamadas.length} chamadas`)
    assert.equal(classifyHttpStatus(status), 'retryable')
  }
})

test('9-10) 400/401/403/404 → NENHUMA repetição', async () => {
  for (const status of [400, 401, 403, 404]) {
    const mock = fetchFalso([{ status, body: { error: { type: 'invalid_request' } } }])
    const provider = comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    await assert.rejects(() => provider.call(reqBase()), /content_ai:provider_error/)
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

test('modelo) CONTENT_AI_MODEL vazio é configuração inválida, sem fallback', () => {
  const original = process.env.CONTENT_AI_MODEL
  try {
    process.env.CONTENT_AI_MODEL = '   '
    assert.throws(() => comChave(() => createAnthropicProvider()), /content_ai:invalid_config/)
    process.env.CONTENT_AI_MODEL = 'claude-modelo-explicito'
    const mock = fetchFalso([{ body: anthropicBody('{"ok":true}') }])
    comChave(() => createAnthropicProvider({ fetchFn: mock.fetchFn, wait: mock.wait }))
    delete process.env.CONTENT_AI_MODEL
    // Default provado: o MESMO literal que chat.ts usa em produção.
    const chat = readFileSync(join(RAIZ, 'src/lib/agents/chat.ts'), 'utf8')
    assert.ok(chat.includes("?? 'claude-sonnet-5'"), 'o default de chat.ts mudou — reavaliar o do Content Studio')
    const config = readFileSync(join(RAIZ, 'src/lib/content-studio/ai/config.ts'), 'utf8')
    assert.ok(config.includes("return 'claude-sonnet-5'"))
  } finally {
    if (original === undefined) delete process.env.CONTENT_AI_MODEL
    else process.env.CONTENT_AI_MODEL = original
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
