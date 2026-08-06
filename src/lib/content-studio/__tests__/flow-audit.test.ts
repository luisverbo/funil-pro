// ============================================================================
// Content Studio — auditoria do travamento do Designer (orçamento de tempo)
// ----------------------------------------------------------------------------
// A causa raiz encontrada: o provider Anthropic dava o timeout INTEIRO a cada
// tentativa (35s) e ainda esperava entre elas — pior caso ~70s+, acima do
// maxDuration da função (60s). A plataforma matava o processo no meio do
// retry, o step ficava `running` órfão e até o clique de retomada morria do
// mesmo jeito. O que se prova aqui: timeoutMs agora é orçamento TOTAL da
// call() (retries inclusos), a espera respeita o orçamento, e o Designer do
// modo viral ficou ~3x menor (só direção de capa — mais rápido e mais
// barato). Nenhum teste chama API real.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createAnthropicProvider } from '../ai/anthropic'
import { AI_MIN_ATTEMPT_MS } from '../ai/config'
import { STUDIO_REQUEST_BUDGET_MS } from '../studio/run'
import {
  studioDesignerSystem, STUDIO_DESIGNER_PROMPT_VERSION, STUDIO_DESIGNER_VIRAL_PROMPT_VERSION,
} from '../studio/prompt'
import { makeVisualParser, validateStudioInput } from '../studio/schema'
import { coerceDesignerCover } from '../images/viral-prompt'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

function briefViral(slides = 5) {
  const v = validateStudioInput({ tema: 'organizar leads', slides, idempotencyKey: 'flowaudit0000001' })
  if (!v.ok) throw new Error('brief inválido')
  return v.brief
}
function briefPerSlide(slides = 5) {
  const v = validateStudioInput({
    tema: 'organizar leads', slides, idempotencyKey: 'flowaudit0000002', visualMode: 'per_slide_v1',
  })
  if (!v.ok) throw new Error('brief inválido')
  return v.brief
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Orçamento TOTAL de tempo no provider (a causa raiz)
// ════════════════════════════════════════════════════════════════════════════

test('1) REPRODUÇÃO+FIX: timeout na 1ª tentativa NÃO ganha outro timeout inteiro', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste'
  process.env.CONTENT_AI_MODEL = 'claude-teste'
  process.env.CONTENT_AI_ENABLED = 'true'

  let chamadas = 0
  // fetch que NUNCA responde: só o abort o encerra — o pior caso real.
  const fetchTravado: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      chamadas++
      init?.signal?.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
      })
    })

  const provider = createAnthropicProvider({ fetchFn: fetchTravado, wait: async () => {} })
  const inicio = Date.now()
  await assert.rejects(
    provider.call({
      system: 's', userContent: 'u', parse: x => x as Record<string, unknown>,
      maxOutputTokens: 100, timeoutMs: 2_500, executionId: 'audit:a0',
    }),
    (e: Error & { code?: string }) => e.code === 'timeout',
  )
  const total = Date.now() - inicio

  // A 1ª tentativa consome o orçamento inteiro; a 2ª não tem tempo útil
  // (< AI_MIN_ATTEMPT_MS) e NÃO abre — antes eram 2 × timeout.
  assert.equal(chamadas, 1, `${chamadas} chamadas — o retry ganhou timeout inteiro de novo`)
  assert.ok(total < 2_500 + 1_000, `call() levou ${total}ms para um orçamento de 2500ms`)
})

test('2) erro retentável RÁPIDO ainda ganha o retry — dentro do orçamento', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-teste'
  process.env.CONTENT_AI_MODEL = 'claude-teste'
  process.env.CONTENT_AI_ENABLED = 'true'

  let chamadas = 0
  const esperas: number[] = []
  const fetch529: typeof fetch = async () => {
    chamadas++
    return new Response(JSON.stringify({ error: { type: 'overloaded_error' } }), { status: 529 })
  }
  const provider = createAnthropicProvider({
    fetchFn: fetch529,
    wait: async ms => { esperas.push(ms) },
  })
  await assert.rejects(provider.call({
    system: 's', userContent: 'u', parse: x => x as Record<string, unknown>,
    maxOutputTokens: 100, timeoutMs: 30_000, executionId: 'audit:a1',
  }))
  // Falha rápida: sobra orçamento, o retry acontece (2 chamadas), e NENHUMA
  // espera excede o que deixaria tempo útil para a tentativa seguinte.
  assert.equal(chamadas, 2)
  assert.ok(esperas.every(ms => ms >= 0 && ms <= 30_000 - AI_MIN_ATTEMPT_MS))
})

test('3) o invariante de tempo agora é verdadeiro de ponta a ponta', () => {
  // timeout do agente é orçamento TOTAL da call() — então o pior caso de uma
  // requisição volta a ser timeout + margens, que cabe no maxDuration.
  const run = ler('src/lib/content-studio/studio/run.ts')
  assert.ok(run.includes('STUDIO_REQUEST_BUDGET_MS = 45_000'))
  const anthropic = ler('src/lib/content-studio/ai/anthropic.ts')
  assert.ok(anthropic.includes('req.timeoutMs - (Date.now() - inicio)'),
    'provider sem orçamento total')
  assert.ok(anthropic.includes('if (restanteMs < AI_MIN_ATTEMPT_MS) break'),
    'tentativa sem tempo útil ainda abre')
  const pagina = ler('src/app/(dashboard)/content-studio/page.tsx')
  const m = /export const maxDuration = (\d+)/.exec(pagina)
  assert.ok(m, 'página sem maxDuration')
  // O orçamento de TEXTO precisa caber no limite da rota, com folga real.
  assert.ok(STUDIO_REQUEST_BUDGET_MS + 10_000 <= Number(m![1]) * 1000,
    'orçamento de texto sem folga dentro do maxDuration')
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Designer VIRAL enxuto — mais rápido e mais barato
// ════════════════════════════════════════════════════════════════════════════

test('4) modo viral: Designer dirige a CAPA, não cenas por slide', () => {
  const viral = studioDesignerSystem(briefViral())
  assert.ok(viral.includes('"cover"'), 'prompt viral sem bloco cover')
  assert.ok(viral.includes('coverConcept') && viral.includes('curiosityMechanisms'))
  assert.ok(viral.includes('composition e imagePrompt são SEMPRE "-"'),
    'prompt viral ainda pede cena por slide')
  assert.ok(!viral.includes('prompt de imagem que outra pessoa'), 'texto do v2 vazou no viral')

  // O modo per_slide continua com o prompt COMPLETO de cena por slide.
  const perSlide = studioDesignerSystem(briefPerSlide())
  assert.ok(perSlide.includes('prompt de imagem que outra pessoa'))
  assert.ok(!perSlide.includes('"cover"'))

  // Identidades persistidas distintas.
  assert.equal(STUDIO_DESIGNER_PROMPT_VERSION, 'studio_designer_v2')
  assert.equal(STUDIO_DESIGNER_VIRAL_PROMPT_VERSION, 'studio_designer_v3_viral')
  const run = ler('src/lib/content-studio/studio/run.ts')
  assert.ok(run.includes('STUDIO_DESIGNER_VIRAL_PROMPT_VERSION') &&
    run.includes("visual_mode === 'viral_cover_text_v1'"), 'runner não usa a versão viral')

  // Teto de saída REDUZIDO no viral — decisão do servidor.
  assert.ok(run.includes('Math.min(perfil.maxOutputTokens, 1_600)'),
    'designer viral sem teto reduzido')
})

test('5) parser repassa o bloco cover por lista branca — e a capa o usa', () => {
  const parse = makeVisualParser(briefViral(5))
  const N = 5
  const saida = parse({
    direction: { style: 'editorial', palette: 'preto e roxo', typography: 'peso alto', mood: 'urgência' },
    cover: {
      coverConcept: 'Fila de clientes na porta de uma loja pequena ao amanhecer',
      visualQuestion: 'por que tanta gente nessa loja?',
      mainSubject: 'a fila improvável',
      curiosityMechanisms: ['escala', 'reacao', 'contraste', 'misterio'],
      lighting: 'luz baixa dourada',
      campo_inventado: 'não deve passar',
      apiKey: 'sk-nunca',
    },
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, style: 'texto', composition: '-', elements: [],
      colors: 'preto', layout: `ênfase ${i + 1}`, imagePrompt: '-',
    })),
  }) as { cover?: Record<string, unknown> }

  assert.ok(saida.cover, 'cover não repassado')
  assert.equal(saida.cover!.coverConcept, 'Fila de clientes na porta de uma loja pequena ao amanhecer')
  assert.equal((saida.cover!.curiosityMechanisms as string[]).length, 2, 'mecanismos não limitados a 2')
  assert.ok(!('campo_inventado' in saida.cover!), 'campo fora da lista branca vazou')
  assert.ok(!('apiKey' in saida.cover!), 'campo perigoso vazou')

  // O gerador da capa CONSEGUE usar o bloco repassado.
  const direcao = coerceDesignerCover(saida.cover)
  assert.ok(direcao, 'cover repassado não é aproveitável')
  assert.equal(direcao!.lighting, 'luz baixa dourada')

  // Sem cover: parser segue válido (derivação determinística cobre).
  const sem = parse({
    direction: { style: 'editorial', palette: 'preto', typography: 'alto', mood: 'urgência' },
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, style: 'texto', composition: '-', elements: [],
      colors: 'preto', layout: 'x', imagePrompt: '-',
    })),
  }) as { cover?: unknown }
  assert.equal(sem.cover, undefined)
})

test('6) R1 intacto; nenhuma migration; nenhuma variável nova', () => {
  assert.ok(ler('src/lib/security/cron-auth.ts').includes('timingSafeEqual'))
  assert.ok(ler('src/app/api/queue/process/route.ts').includes('evaluateCronAuth'))
  const fontes = [
    ler('src/lib/content-studio/ai/anthropic.ts'),
    ler('src/lib/content-studio/studio/prompt.ts'),
  ].join('\n')
  assert.ok(!/CREATE TABLE|ALTER TABLE|exec_sql|NEXT_PUBLIC_[A-Z_]*(KEY|SECRET)/.test(fontes))
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
