// ============================================================================
// Gestor de Tráfego — Fase 1: cliente da Marketing API
// ----------------------------------------------------------------------------
// Quatro defeitos do cliente antigo, todos silenciosos, travados aqui:
//
//   1. SEM PAGINAÇÃO — conta grande vinha truncada e o painel mostrava um
//      recorte arbitrário como se fosse o total (mesmo tipo de erro do corte
//      de 1000 linhas que sumiu com os leads do quiz);
//   2. SEM TRATAMENTO DE LIMITE de uso da Meta;
//   3. ERRO INDISTINGUÍVEL — token expirado parecia "conta sem dados";
//   4. VERSÃO v19.0, fora do ciclo de suporte.
//
// Nenhum teste toca a rede: o `fetch` é injetado.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  classificarErroMeta, descreverErroMeta, esperaDoRetry, lerUsoDaCota,
  META_API_VERSION, META_GRAPH_BASE, META_MAX_PAGINAS, MetaApiError,
  metaFetch, metaFetchPaginado, ocultarToken, urlGraph,
} from '../client'
import { normalizarIdConta } from '../accounts'
import { intervaloPadrao } from '../sync-v2'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

/** Resposta de mentira, com cabeçalhos. */
function resposta(corpo: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: new Headers(init.headers ?? {}),
    json: async () => corpo,
  } as unknown as Response
}

// ════════════════════════════════════════════════════════════════════════════

test('1) a versão da API saiu da v19 (fora de suporte)', () => {
  assert.notEqual(META_API_VERSION, 'v19.0', 'continua na versão sem suporte')
  const numero = Number.parseFloat(META_API_VERSION.replace('v', ''))
  assert.ok(numero >= 21, `versão ${META_API_VERSION} velha demais`)
  assert.ok(META_GRAPH_BASE.endsWith(META_API_VERSION), 'a base não usa a versão declarada')
})

test('2) REPRODUÇÃO: agora TODAS as páginas são lidas', async () => {
  const paginas = [
    { data: [{ id: '1' }, { id: '2' }], paging: { next: 'https://graph/p2' } },
    { data: [{ id: '3' }], paging: { next: 'https://graph/p3' } },
    { data: [{ id: '4' }] },  // sem `next`: fim
  ]
  let i = 0
  const fetchFn = (async () => resposta(paginas[i++])) as unknown as typeof fetch

  const r = await metaFetchPaginado<{ id: string }>('https://graph/p1', { fetchFn })
  assert.equal(r.itens.length, 4, 'a leitura parou antes da última página')
  assert.equal(r.paginas, 3)
  assert.equal(r.truncado, false)
})

test('3) o laço de páginas tem teto — nunca roda para sempre', async () => {
  // `next` que nunca acaba: sem teto, isto travaria a requisição inteira.
  const fetchFn = (async () => resposta({ data: [{ id: 'x' }], paging: { next: 'https://graph/loop' } })) as unknown as typeof fetch
  const r = await metaFetchPaginado<{ id: string }>('https://graph/1', { fetchFn, maxPaginas: 5 })
  assert.equal(r.paginas, 5)
  assert.equal(r.truncado, true, 'truncamento precisa ser reportado, não escondido')
  assert.ok(META_MAX_PAGINAS >= 10 && META_MAX_PAGINAS <= 1000, 'teto padrão irreal')
})

test('4) perto do limite de uso, a leitura para sozinha', async () => {
  const fetchFn = (async () => resposta(
    { data: [{ id: 'x' }], paging: { next: 'https://graph/p2' } },
    { headers: { 'x-business-use-case-usage': JSON.stringify({ '123': [{ call_count: 95 }] }) } },
  )) as unknown as typeof fetch

  const r = await metaFetchPaginado<{ id: string }>('https://graph/p1', { fetchFn })
  assert.equal(r.paginas, 1, 'continuou puxando páginas com a cota quase estourada')
  assert.equal(r.truncado, true)
  assert.equal(r.uso?.percentual, 95)
})

test('5) cada erro da Meta vira uma ação diferente para o usuário', () => {
  assert.equal(classificarErroMeta(400, 190), 'token_expirado')
  assert.equal(classificarErroMeta(400, 102), 'token_expirado')
  assert.equal(classificarErroMeta(403, 10), 'sem_permissao')
  assert.equal(classificarErroMeta(400, 200), 'sem_permissao')
  assert.equal(classificarErroMeta(400, 17), 'limite_de_uso')
  assert.equal(classificarErroMeta(400, 80004), 'limite_de_uso')
  assert.equal(classificarErroMeta(429), 'limite_de_uso')
  assert.equal(classificarErroMeta(500), 'instavel')
  assert.equal(classificarErroMeta(400, 100), 'requisicao_invalida')
  // Sessão caída sem o código 190: o subcódigo é quem denuncia.
  assert.equal(classificarErroMeta(400, 100, 463), 'token_expirado')

  // A frase da tela diz o que FAZER — e nunca mostra token.
  const expirado = new MetaApiError({ kind: 'token_expirado', httpStatus: 400, message: 'x' })
  assert.match(descreverErroMeta(expirado), /Reconecte a conta/)
  const limite = new MetaApiError({ kind: 'limite_de_uso', httpStatus: 429, message: 'x' })
  assert.match(descreverErroMeta(limite), /continua sozinha/)
})

test('6) só erro retentável é repetido — token expirado falha na hora', async () => {
  let chamadas = 0
  const fetchToken = (async () => {
    chamadas++
    return resposta({ error: { code: 190, message: 'expirado' } }, { status: 400 })
  }) as unknown as typeof fetch

  await assert.rejects(
    metaFetch('https://graph/x', { fetchFn: fetchToken, esperar: async () => {} }),
    (e: MetaApiError) => e.kind === 'token_expirado' && e.retentavel === false,
  )
  assert.equal(chamadas, 1, 'token expirado não pode ser repetido — repetir não conserta')

  // Já o limite de uso é repetido até o teto.
  let chamadas2 = 0
  const fetchLimite = (async () => {
    chamadas2++
    return resposta({ error: { code: 17 } }, { status: 400 })
  }) as unknown as typeof fetch
  await assert.rejects(metaFetch('https://graph/x', { fetchFn: fetchLimite, esperar: async () => {} }))
  assert.equal(chamadas2, 3, 'limite de uso deveria ser repetido 2x antes de desistir')
})

test('7) a espera respeita o que a Meta pede, com teto', () => {
  // Sem informação: exponencial.
  assert.ok(esperaDoRetry(0) < esperaDoRetry(1))
  assert.ok(esperaDoRetry(5) <= 8_000, 'a espera exponencial precisa ter teto')
  // Com informação da Meta: respeita, mas não prende a requisição.
  assert.equal(esperaDoRetry(0, { percentual: 100, esperaMinutos: 60 }), 30_000)
})

test('8) o cabeçalho de cota é lido nos formatos que a Meta usa', () => {
  const h1 = new Headers({ 'x-business-use-case-usage': JSON.stringify({ '999': [{ call_count: 10, total_cputime: 42 }] }) })
  assert.equal(lerUsoDaCota(h1)?.percentual, 42)

  const h2 = new Headers({ 'x-app-usage': JSON.stringify({ call_count: 77 }) })
  assert.equal(lerUsoDaCota(h2)?.percentual, 77)

  assert.equal(lerUsoDaCota(new Headers()), null)
  assert.equal(lerUsoDaCota(new Headers({ 'x-app-usage': 'não é json' })), null, 'cabeçalho quebrado não pode explodir')
})

test('9) o token nunca aparece em log', () => {
  const url = urlGraph('/act_123/insights', { level: 'ad' }, 'SEGREDO123')
  assert.ok(url.includes('access_token=SEGREDO123'), 'a URL precisa levar o token')
  assert.ok(!ocultarToken(url).includes('SEGREDO123'), 'o log vazaria o token')
  assert.ok(ocultarToken(url).includes('<oculto>'))
  // Parâmetro vazio não polui a URL.
  assert.ok(!urlGraph('/x', { a: '', b: undefined, c: 1 }, 't').includes('a='))
})

test('10) VÁRIAS contas por tenant, com queda para o modo antigo', () => {
  const acc = ler('src/lib/meta/accounts.ts')
  assert.ok(acc.includes("from('ad_accounts')"), 'não lê a tabela de contas')
  assert.ok(acc.includes('ehTabelaAusente'), 'sem queda para o modo antigo')
  assert.ok(acc.includes("from('tenants')"), 'perderia a conta de quem ainda não migrou')
  // Conta sem token não entra: só produziria erro a cada execução do cron.
  assert.ok(acc.includes("typeof c.access_token === 'string' && c.access_token.length > 0"),
    'conta sem token entraria na sincronização')

  assert.equal(normalizarIdConta('act_123'), '123')
  assert.equal(normalizarIdConta('  456 '), '456')
})

test('11) a sincronização traz o que a análise precisa — e nos 3 níveis', () => {
  const s = ler('src/lib/meta/sync-v2.ts')
  for (const campo of ['ctr', 'cpm', 'frequency', 'reach', 'actions', 'action_values']) {
    assert.ok(s.includes(`'${campo}'`), `insights sem ${campo}`)
  }
  // Um dia por linha numa consulta só, no lugar das 30 chamadas em série.
  assert.ok(s.includes('time_increment: 1'), 'voltaria a fazer uma chamada por dia')
  assert.ok(s.includes("['campaign', 'adset', 'ad'] as NivelAnuncio[]"), 'não cobre os três níveis')
  // Erro não é mais engolido: vira status na conta.
  assert.ok(s.includes("status = meta?.kind === 'token_expirado' ? 'token_expired'"),
    'token expirado não marca a conta')
  // Sem os comentários: o cabeçalho do arquivo DESCREVE o defeito antigo, e
  // essa menção não pode ser confundida com o defeito de volta.
  const semComentarios = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.ok(!/catch\s*\{\s*\}/.test(semComentarios), 'voltou a engolir erro em silêncio')

  const { desde, ate } = intervaloPadrao(7, new Date('2026-08-18T12:00:00Z'))
  assert.equal(ate, '2026-08-18')
  assert.equal(desde, '2026-08-12', 'o intervalo padrão deveria cobrir 7 dias')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (e) {
      results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  let passed = 0
  for (const r of results) {
    if (r.ok) { passed++; console.log(`  ok   ${r.name}`) }
    else console.log(` FALHA ${r.name}\n        → ${r.error}`)
  }
  console.log(`\n${passed}/${results.length} testes passaram`)
  if (passed !== results.length) process.exit(1)
}

void main()
