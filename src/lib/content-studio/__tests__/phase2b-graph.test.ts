// ============================================================================
// Content Studio — Fase 2B: teste ISOLADO do grafo de produção
// ----------------------------------------------------------------------------
// Este arquivo NÃO importa nada de src/lib/content-studio/ai nem dos agentes —
// só node:child_process, node:path e node:assert. Cada cenário roda num
// PROCESSO NODE SEPARADO, com cache de módulos zerado, e o script filho:
//
//   1. configura CONTENT_AI_ENABLED e uma chave falsa
//   2. substitui globalThis.fetch ANTES de qualquer import do produto
//   3. só então faz require do REGISTRY — o mesmo entrypoint da produção
//   4. executa o agente e reporta o que aconteceu por stdout (JSON)
//
// Por que assim: a versão anterior deste teste importava anthropic.ts
// estaticamente no topo do arquivo. Na implementação antiga (autorregistro por
// efeito colateral), esse import teria carregado a fábrica ANTES do getAgent —
// mascarando exatamente o defeito que o teste dizia detectar. Num processo
// filho que só importa o registry, não há como o teste "ajudar" o produto:
// se bootstrap.ts deixar de importar a implementação concreta, o filho falha.
// ============================================================================

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

/**
 * Roda o script filho num Node novo. `env` controla o cenário; o caminho do
 * registry COMPILADO é injetado — o filho não conhece este arquivo.
 */
function rodarFilho(env: Record<string, string | undefined>, agentKey = 'cc_ai_researcher'): {
  alcancouAnthropic: boolean
  provider: string | null
  pesquisaExterna: unknown
  erro: string | null
} {
  const registryPath = join(__dirname, '..', 'agents', 'registry.js')

  const script = `
    // Cenário controlado ANTES de qualquer import do produto.
    let alcancouAnthropic = false
    globalThis.fetch = async (url, init) => {
      alcancouAnthropic = String(url).startsWith('https://api.anthropic.com')
      const temChave = !!(init && init.headers && init.headers['x-api-key'])
      if (!temChave) throw new Error('sem chave no header')
      return {
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          content: [{ type: 'text', text: JSON.stringify({
            contexto_do_produto: 'x', objetivo: 'y', perfil_do_publico: 'z',
            nivel_de_consciencia: 'w', dores_inferidas: ['a'], desejos: ['b'],
            objecoes: ['c'], hipoteses: ['d'],
          }) }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      }
    }

    // SÓ AGORA o entrypoint real de produção entra no processo.
    const { getAgent } = require(${JSON.stringify(registryPath)})
    const agente = getAgent(${JSON.stringify('__AGENT__')})
    agente.run({
      envelope: { productionId: 'p', stepId: 's', agentKey: ${JSON.stringify('__AGENT__')},
                  tenantId: 't', attempt: 0, idempotencyKey: 'k' },
      brief: { tema: 'organização de leads', publico: 'pequenas empresas' },
      upstream: {}, stepInput: null,
    }, {})
      .then(out => {
        console.log('RESULTADO:' + JSON.stringify({
          alcancouAnthropic,
          provider: (out.usage && out.usage.provider) || null,
          pesquisaExterna: out.data.pesquisa_externa_realizada,
          erro: null,
        }))
      })
      .catch(err => {
        console.log('RESULTADO:' + JSON.stringify({
          alcancouAnthropic, provider: null, pesquisaExterna: null,
          erro: String(err && err.message || err),
        }))
      })
  `

  const scriptFinal = script.replaceAll(JSON.stringify('__AGENT__'), JSON.stringify(agentKey))
  const filho = spawnSync(process.execPath, ['-e', scriptFinal], {
    // Ambiente MÍNIMO e explícito: nada vaza do processo pai.
    env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
    timeout: 30_000,
  })

  const linha = (filho.stdout ?? '').split('\n').find(l => l.startsWith('RESULTADO:'))
  assert.ok(linha, `o filho não reportou resultado. stderr: ${(filho.stderr ?? '').slice(0, 400)}`)
  return JSON.parse(linha.slice('RESULTADO:'.length))
}

// ─── Cenários ───────────────────────────────────────────────────────────────

test('grafo isolado) produção habilitada carrega a implementação Anthropic', () => {
  const r = rodarFilho({
    CONTENT_AI_ENABLED: 'true',
    ANTHROPIC_API_KEY: 'sk-teste-nao-real',
  })
  assert.equal(r.erro, null, `o agente falhou no grafo real: ${r.erro}`)
  assert.equal(r.alcancouAnthropic, true,
    'a chamada NÃO alcançou a implementação Anthropic pelo grafo de produção')
  assert.equal(r.provider, 'anthropic')
  assert.equal(r.pesquisaExterna, false)
})

test('grafo isolado) desligado → disabled, sem tocar a rede', () => {
  const r = rodarFilho({
    // CONTENT_AI_ENABLED ausente: default é desligado.
    ANTHROPIC_API_KEY: 'sk-teste-nao-real',
  })
  assert.ok(r.erro?.includes('content_ai:disabled'), `erro inesperado: ${r.erro}`)
  assert.equal(r.alcancouAnthropic, false, 'desligado tocou a rede')
})

test('grafo isolado) habilitado sem chave → missing_key, sem template', () => {
  const r = rodarFilho({ CONTENT_AI_ENABLED: 'true' })
  assert.ok(r.erro?.includes('content_ai:missing_key'), `erro inesperado: ${r.erro}`)
  assert.equal(r.alcancouAnthropic, false)
  // E nada de conteúdo: o agente não devolveu output nenhum.
  assert.equal(r.provider, null)
})

test('grafo isolado) cc_researcher determinístico roda com IA DESLIGADA e zero fetch', () => {
  // Nenhuma env de IA: produção antiga precisa concluir num deploy sem chave.
  const r = rodarFilho({}, 'cc_researcher')
  assert.equal(r.erro, null, `o determinístico falhou sem IA: ${r.erro}`)
  assert.equal(r.alcancouAnthropic, false, 'o determinístico tocou a rede')
  assert.equal(r.provider, 'none', 'o determinístico deveria declarar provider none')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (err) { results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) }) }
  }
  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FALHA'} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
  if (failed.length > 0) process.exitCode = 1
}

void main()
