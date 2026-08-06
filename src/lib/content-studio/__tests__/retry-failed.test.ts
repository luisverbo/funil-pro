// ============================================================================
// Content Studio — retomada explícita de step `failed` (produção falhada)
// ----------------------------------------------------------------------------
// O cenário real: o Estrategista falhou (timeout/erro do provider) e a
// produção inteira virou `failed` — terminal, sem botão, sem motivo na tela.
// O que se prova aqui: o caminho normal NUNCA repete uma falha sozinho
// (already_failed); a retomada é EXPLÍCITA, com posse atômica failed→running
// (cinco cliques pagam UMA chamada), repete SÓ o agente que falhou, devolve a
// produção ao fluxo normal e o motivo persistido chega à interface.
// Nenhum teste chama API real.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { __setContentAIProviderForTests, type ContentAIProvider } from '../ai/provider'
import { retryFailedStudioStep, runStudioCarousel } from '../studio/run'
import {
  STUDIO_AGENT_ORDER, STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY,
  STUDIO_PIPELINE_KEY, STUDIO_STRATEGIST_KEY, validateStudioInput,
} from '../studio/schema'
import type {
  ContentStore, EmitEventInput, JobRow, ProductionRow, ProductionStatus,
  StepRow, StoredEvent,
} from '../types'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ─── Fixtures ───────────────────────────────────────────────────────────────

const N = 6
const T0 = Date.parse('2026-01-01T00:00:00.000Z')

function briefStudio() {
  const v = validateStudioInput({ tema: 'organizar leads', slides: N, idempotencyKey: 'retryfail0000001' })
  if (!v.ok) throw new Error('brief inválido')
  return v.brief
}

function planoBom() {
  return {
    bigIdea: 'Lead não se perde por falta de resposta, e sim por falta de lugar',
    angle: 'a bagunça dos canais', promise: 'nunca mais perder lead de vista',
    audience: 'donos de pequenas empresas', tone: 'direto',
    beats: Array.from({ length: N }, (_, i) => ({ number: i + 1, purpose: `função ${i + 1}` })),
  }
}
function copyBoa() {
  return {
    title: 'Como organizar o atendimento de leads',
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, headline: `Headline concreta do slide ${i + 1}`,
      body: `Texto de apoio do slide ${i + 1}, curto e direto.`,
    })),
    caption: 'Legenda que complementa o carrossel.',
    cta: 'Organize seus leads', hashtags: ['#leads'],
    review: { approved: true, notes: [] },
  }
}
function arteBoa() {
  return {
    direction: { style: 'editorial limpo', palette: 'grafite e laranja', typography: 'sem serifa', mood: 'organização' },
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, style: 'contraste', composition: `composição ${i + 1}`,
      elements: ['ícone'], colors: 'grafite', layout: 'headline no topo',
      imagePrompt: `cena ${i + 1}, luz suave`,
    })),
  }
}

/** Provider fake que responde pelo agente pedido — e conta cada chamada. */
function providerBom(contador: { calls: number; execIds: string[] }): ContentAIProvider {
  return {
    async call(req) {
      contador.calls++
      contador.execIds.push(req.executionId ?? '')
      const exec = req.executionId ?? ''
      const bruto = exec.includes(STUDIO_STRATEGIST_KEY) ? planoBom()
        : exec.includes(STUDIO_COPYWRITER_KEY) ? copyBoa() : arteBoa()
      return {
        output: req.parse(bruto), model: 'fake', inputTokens: 1,
        outputTokens: 1, durationMs: 1, calls: 1, finish: 'ok',
      }
    },
  }
}

/** Provider que SEMPRE falha — para provar a segunda falha persistida. */
function providerQueFalha(contador: { calls: number }): ContentAIProvider {
  return {
    async call() {
      contador.calls++
      const err = new Error('provider indisponível de novo') as Error & { code?: string }
      err.code = 'provider_unavailable'
      throw err
    },
  }
}

// ─── Store em memória: índice único + CAS de step e de produção ─────────────

class MemStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0

  /**
   * Produção FALHADA no agente pedido: todos os anteriores completed, o alvo
   * `failed` com o erro persistido — exatamente o que o runner grava.
   */
  falhadaNo(agentKey: (typeof STUDIO_AGENT_ORDER)[number], erro = 'anthropic: HTTP 529 overloaded'): ProductionRow {
    const p: ProductionRow = {
      id: 'prod-falhada', tenant_id: 'tenant-A', pipeline_key: STUDIO_PIPELINE_KEY,
      title: 'Falhada', brief: briefStudio(), status: 'failed', next_event_seq: 0,
      created_by: null, created_at: 'z', updated_at: 'z',
    }
    this.productions.set(p.id, p)
    const dados: Record<string, Record<string, unknown>> = {
      [STUDIO_STRATEGIST_KEY]: planoBom(),
      [STUDIO_COPYWRITER_KEY]: copyBoa(),
    }
    const alvoIndice = STUDIO_AGENT_ORDER.indexOf(agentKey)
    STUDIO_AGENT_ORDER.slice(0, alvoIndice).forEach((k, i) => {
      this.steps.push({
        id: `step-${k}`, production_id: p.id, tenant_id: p.tenant_id, agent_key: k,
        step_index: i, depends_on: [], status: 'completed', input: null,
        output: { data: dados[k], artifacts: [], usage: undefined },
        attempt: 0, error: null, started_at: 'x', completed_at: 'x',
      })
    })
    this.steps.push({
      id: `step-${agentKey}`, production_id: p.id, tenant_id: p.tenant_id,
      agent_key: agentKey, step_index: alvoIndice,
      depends_on: alvoIndice === 0 ? [] : [STUDIO_AGENT_ORDER[alvoIndice - 1]],
      status: 'failed', input: null, output: null, attempt: 0, error: erro,
      started_at: new Date(T0).toISOString(), completed_at: new Date(T0 + 30_000).toISOString(),
    })
    return p
  }

  async getProduction(id: string) { return this.productions.get(id) ?? null }
  async updateProductionStatus(id: string, st: ProductionStatus) {
    const p = this.productions.get(id); if (p) p.status = st
  }
  async transitionProductionStatus(id: string, expected: readonly ProductionStatus[], next: ProductionStatus) {
    const p = this.productions.get(id)
    if (!p || !expected.includes(p.status)) return false
    p.status = next
    return true
  }
  async listSteps(id: string) { return this.steps.filter(s => s.production_id === id).map(s => ({ ...s })) }
  async insertSteps(rows: Omit<StepRow, 'id'>[]) {
    const conflito = rows.some(r =>
      this.steps.some(s => s.production_id === r.production_id && s.step_index === r.step_index))
    if (conflito) {
      const existentes = this.steps.filter(s => rows.some(r => r.step_index === s.step_index))
      return { rows: existentes.map(s => ({ ...s })), inserted: false }
    }
    const criados = rows.map(r => ({ ...r, id: `step-novo-${++this.n}` }))
    this.steps.push(...criados)
    return { rows: criados.map(s => ({ ...s })), inserted: true }
  }
  async updateStep(id: string, patch: Partial<StepRow>) {
    const st = this.steps.find(x => x.id === id); if (st) Object.assign(st, patch)
  }
  async transitionStepStatus(
    id: string, expected: readonly StepRow['status'][],
    patch: Partial<StepRow> & { status: StepRow['status'] },
    expectedStartedAt?: string | null,
  ) {
    // Espelha a UPDATE com predicado do Postgres, INCLUINDO a posse.
    const st = this.steps.find(x => x.id === id)
    if (!st || !expected.includes(st.status)) return false
    if (expectedStartedAt === null && st.started_at !== null) return false
    if (typeof expectedStartedAt === 'string' && st.started_at !== expectedStartedAt) return false
    Object.assign(st, patch)
    return true
  }
  async insertJob() { return null }
  async claimNextJob() { return null }
  async completeJob() { return false }
  async failJob() { /* noop */ }
  async recoverStaleJobs() { return 0 }
  async emitEvent(i: EmitEventInput) {
    const p = this.productions.get(i.productionId)!
    p.next_event_seq += 1
    this.events.push({
      id: `ev-${p.next_event_seq}`, tenant_id: p.tenant_id, production_id: p.id,
      step_id: i.stepId ?? null, agent_key: i.agentKey ?? null, type: i.type,
      schema_version: 1, seq: p.next_event_seq, payload: i.payload ?? {},
      ui_hint: i.uiHint ?? null, occurred_at: 'z',
    })
    return p.next_event_seq
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. O caminho normal NUNCA repete uma falha sozinho
// ════════════════════════════════════════════════════════════════════════════

test('1) runStudioCarousel devolve already_failed e NÃO paga de novo', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerBom(contador))
  const store = new MemStore()
  const p = store.falhadaNo(STUDIO_STRATEGIST_KEY)

  for (let i = 0; i < 3; i++) {
    const r = await runStudioCarousel(store, p, briefStudio())
    assert.equal(r.ok, false)
    assert.equal(r.state, 'failed_existing')
    assert.equal(r.errorCode, 'already_failed')
  }
  assert.equal(contador.calls, 0, 'o caminho normal repetiu uma falha sozinho')
  assert.equal(store.productions.get(p.id)!.status, 'failed')
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Retomada explícita do agente que falhou
// ════════════════════════════════════════════════════════════════════════════

test('2) Estrategista falhou: retry repete SÓ ele, com attempt 1 e eventos', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerBom(contador))
  const store = new MemStore()
  const p = store.falhadaNo(STUDIO_STRATEGIST_KEY)

  const r = await retryFailedStudioStep(store, p, briefStudio(), { now: () => T0 + 600_000 })
  assert.equal(r.ok, true)
  assert.equal(r.state, 'partial', 'Estrategista não é o último — ainda falta agente')
  assert.equal(contador.calls, 1)
  assert.ok(contador.execIds[0].includes(STUDIO_STRATEGIST_KEY))
  assert.ok(contador.execIds[0].endsWith(':a1'), 'executionId deve refletir attempt 1')

  const step = store.steps.find(s => s.agent_key === STUDIO_STRATEGIST_KEY)!
  assert.equal(step.status, 'completed')
  assert.equal(step.attempt, 1)
  assert.equal(step.error, null, 'o erro antigo precisa ser limpo')

  // A produção SAI de failed — o fluxo normal pode continuar.
  assert.equal(store.productions.get(p.id)!.status, 'running')

  const tipos = store.events.map(e => e.type)
  assert.ok(tipos.includes('agent_retrying'))
  assert.ok(tipos.includes('agent_started'))
  assert.ok(tipos.includes('agent_completed'))
  const retrying = store.events.find(e => e.type === 'agent_retrying')!
  assert.equal((retrying.payload as { reason_code?: string }).reason_code, 'failed_step_recovery')
  assert.equal((retrying.payload as { attempt?: number }).attempt, 1)
  // NUNCA um production_created novo.
  assert.ok(!tipos.includes('production_created'))
})

test('3) CINCO cliques simultâneos: posse atômica, UMA chamada', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerBom(contador))
  const store = new MemStore()
  const p = store.falhadaNo(STUDIO_STRATEGIST_KEY)

  const rs = await Promise.all(Array.from({ length: 5 }, () =>
    retryFailedStudioStep(store, p, briefStudio(), { now: () => T0 + 600_000 })))

  assert.equal(contador.calls, 1, `${contador.calls} chamadas para 5 cliques`)
  assert.equal(rs.filter(r => r.state === 'partial').length, 1, 'exatamente um vencedor')
  assert.equal(rs.filter(r => r.state === 'in_progress').length, 4, 'quatro perdedores')
  assert.equal(store.events.filter(e => e.type === 'agent_retrying').length, 1)
})

test('4) Copywriter falhou: Estrategista concluído NÃO é refeito', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerBom(contador))
  const store = new MemStore()
  const p = store.falhadaNo(STUDIO_COPYWRITER_KEY)
  const estrategistaAntes = JSON.stringify(store.steps.find(s => s.agent_key === STUDIO_STRATEGIST_KEY))

  const r = await retryFailedStudioStep(store, p, briefStudio(), { now: () => T0 + 600_000 })
  assert.equal(r.state, 'partial')
  assert.equal(contador.calls, 1)
  assert.ok(contador.execIds[0].includes(STUDIO_COPYWRITER_KEY), 'chamou o agente errado')
  assert.equal(
    JSON.stringify(store.steps.find(s => s.agent_key === STUDIO_STRATEGIST_KEY)),
    estrategistaAntes,
    'step concluído foi tocado',
  )
})

test('5) Designer (último) falhou: retry finaliza em awaiting_approval, UM evento', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerBom(contador))
  const store = new MemStore()
  const p = store.falhadaNo(STUDIO_DESIGNER_KEY)

  const r = await retryFailedStudioStep(store, p, briefStudio(), { now: () => T0 + 600_000 })
  assert.equal(r.state, 'created')
  assert.equal(contador.calls, 1)
  assert.equal(store.productions.get(p.id)!.status, 'awaiting_approval')
  assert.equal(store.events.filter(e => e.type === 'content_waiting_approval').length, 1)
})

test('6) a nova tentativa TAMBÉM falhou: erro persistido, produção failed de novo', async () => {
  const contador = { calls: 0 }
  __setContentAIProviderForTests(providerQueFalha(contador))
  const store = new MemStore()
  const p = store.falhadaNo(STUDIO_STRATEGIST_KEY)

  const r = await retryFailedStudioStep(store, p, briefStudio(), { now: () => T0 + 600_000 })
  assert.equal(r.ok, false)
  assert.equal(r.state, 'failed')
  assert.equal(r.errorCode, 'provider_unavailable')
  assert.equal(contador.calls, 1)

  const step = store.steps.find(s => s.agent_key === STUDIO_STRATEGIST_KEY)!
  assert.equal(step.status, 'failed')
  assert.equal(step.attempt, 1)
  assert.ok(String(step.error).includes('provider indisponível'), 'motivo não persistido')
  assert.equal(store.productions.get(p.id)!.status, 'failed')

  // E um SEGUNDO clique consciente ainda funciona (attempt 2).
  const bons = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerBom(bons))
  const r2 = await retryFailedStudioStep(store, p, briefStudio(), { now: () => T0 + 900_000 })
  assert.equal(r2.state, 'partial')
  assert.ok(bons.execIds[0].endsWith(':a2'))
})

test('7) sem step failed (running ou tudo completo): invalid, nenhuma chamada', async () => {
  const contador = { calls: 0, execIds: [] as string[] }
  __setContentAIProviderForTests(providerBom(contador))
  const store = new MemStore()
  const p = store.falhadaNo(STUDIO_STRATEGIST_KEY)
  // Vira running (outro caminho — o de stale — é quem cuida dele).
  store.steps.find(s => s.agent_key === STUDIO_STRATEGIST_KEY)!.status = 'running'

  const r = await retryFailedStudioStep(store, p, briefStudio())
  assert.equal(r.ok, false)
  assert.equal(r.state, 'invalid')
  assert.equal(r.errorCode, 'no_failed_step')
  assert.equal(contador.calls, 0)
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Action, estado para a interface e telas
// ════════════════════════════════════════════════════════════════════════════

test('8) action retryFailedStudioProduction: só produção failed, preflight antes', () => {
  const acoes = semComentarios(ler('src/app/actions/content-production.ts'))
  const fn = acoes.slice(acoes.indexOf('export async function retryFailedStudioProduction'))
  const corpo = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(corpo.includes("if (production.status !== 'failed') return fail('not_failed')"),
    'aceita produção que não falhou')
  assert.ok(corpo.includes('preflightContentAI()'), 'sem preflight — chamada paga sem freio')
  assert.ok(corpo.includes('retryFailedStudioStep(store, production, brief)'))
  assert.ok(corpo.indexOf('preflightContentAI()') < corpo.indexOf('retryFailedStudioStep('),
    'preflight precisa vir antes da retomada')
  // tenant SEMPRE da sessão.
  assert.ok(corpo.includes('currentTenantId()'))
  // A mensagem existe no registro central.
  const guard = ler('src/lib/content-studio/production-guard.ts')
  assert.ok(guard.includes('not_failed:'), 'mensagem not_failed ausente do registro')
})

test('9) readState expõe a falha: agente + motivo persistido (truncado)', () => {
  const acoes = semComentarios(ler('src/app/actions/content-production.ts'))
  assert.ok(acoes.includes('function studioFailureRecovery'), 'sem leitor de falha')
  const fn = acoes.slice(acoes.indexOf('function studioFailureRecovery'))
  const corpo = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(corpo.includes('failedStep: true'))
  assert.ok(corpo.includes('st.error.slice(0, 200)'), 'motivo sem truncamento')
  // O ramo failed do readState usa o leitor de falha.
  assert.ok(acoes.includes("row.status === 'failed'") && acoes.includes('studioFailureRecovery((steps.data'),
    'readState não expõe a falha')
  // O tipo público carrega os campos novos.
  assert.ok(acoes.includes('failedStep?: boolean') && acoes.includes('reason?: string'))
})

test('10) UI: banner acionável com motivo + botão que repete só o agente', () => {
  const ui = ler('src/components/content-studio/office-preview.tsx')
  assert.ok(ui.includes('retryFailedStudioProduction'), 'action não importada')
  assert.ok(ui.includes('A produção falhou no {recuperacao.agentLabel'), 'banner sem o agente')
  assert.ok(ui.includes('Motivo: {recuperacao.reason}'), 'motivo não aparece')
  assert.ok(ui.includes('tentarNovamenteFalha'), 'sem handler de retomada')
  assert.ok(ui.includes('uma nova\n              chamada de IA será feita') ||
    ui.includes('uma nova chamada de IA será feita'), 'aviso de custo ausente')
  // O banner passivo continua existindo para falhas SEM retomada disponível.
  assert.ok(ui.includes('A produção falhou. A linha do tempo mostra em qual agente parou.'))
  // Depois da retomada, o laço de continuação segue os MESMOS freios.
  const handler = ui.slice(ui.indexOf('const tentarNovamenteFalha'))
  const corpo = handler.slice(0, handler.indexOf('], ['))
  assert.ok(corpo.includes('MAX_CONTINUACOES'), 'sem laço de continuação')
  assert.ok(corpo.includes('recovery.running || r.data.recovery.available'), 'laço sem freio de recovery')
})

test('12) CAUSA RAIZ: texto longo é APARADO, não derruba a resposta paga', async () => {
  // O defeito real de produção: "slides[0].headline: excede 90 caracteres"
  // matava a chamada inteira do Copywriter — e o retry repetia o estilo.
  const { makeCopyParser, makeStrategyParser } = await import('../studio/schema')
  const brief = briefStudio()
  const parse = makeCopyParser(brief)

  const copy = copyBoa()
  copy.slides[0].headline =
    'Uma headline gigantesca que o modelo escreveu empolgado e que passa com folga dos noventa caracteres permitidos pelo layout'
  const ok = parse(copy) as { slides: { headline: string }[] }
  assert.ok(ok.slides[0].headline.length <= 90, 'headline não foi aparada')
  assert.ok(ok.slides[0].headline.endsWith('…'), 'aparo sem reticências')
  assert.ok(!/\s$/.test(ok.slides[0].headline), 'aparo com espaço solto')
  // Corte em fronteira de palavra: nunca termina no meio de uma palavra longa.
  assert.ok(ok.slides[0].headline.length >= 60, 'aparo curto demais')

  // body/caption/cta também aparam; o Estrategista idem.
  copy.slides[1].body = 'palavra '.repeat(80)
  const ok2 = parse(copy) as { slides: { body: string }[] }
  assert.ok(ok2.slides[1].body.length <= 320)

  const parseStrat = makeStrategyParser(brief)
  const plano = planoBom() as ReturnType<typeof planoBom> & { bigIdea: string }
  plano.bigIdea = 'ideia '.repeat(120)
  const okStrat = parseStrat(plano) as { bigIdea: string }
  assert.ok(okStrat.bigIdea.length <= 300)

  // Falha DURA continua onde deve: estrutura, não estilo.
  assert.throws(() => parse({ ...copyBoa(), slides: copyBoa().slides.slice(0, 2) }), /slides/)
  assert.throws(() => parse({ ...copyBoa(), title: 42 }), /esperado texto/)

  // E o prompt agora DECLARA os limites (v3) — o modelo tinha como saber.
  const prompt = ler('src/lib/content-studio/studio/prompt.ts')
  assert.ok(prompt.includes("STUDIO_COPYWRITER_PROMPT_VERSION = 'studio_copywriter_v3'"))
  assert.ok(prompt.includes('headline até 90 caracteres'), 'prompt não declara limites')
})

test('11) R1 intacto; nenhuma migration; nenhuma variável nova', () => {
  assert.ok(ler('src/lib/security/cron-auth.ts').includes('timingSafeEqual'))
  assert.ok(ler('src/app/api/queue/process/route.ts').includes('evaluateCronAuth'))
  const fontes = semComentarios(ler('src/lib/content-studio/studio/run.ts'))
  assert.ok(!/CREATE TABLE|ALTER TABLE|exec_sql|NEXT_PUBLIC/i.test(fontes))
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
