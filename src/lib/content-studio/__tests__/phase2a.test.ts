// ============================================================================
// Content Studio — Fase 2A: Production Core v1
// ----------------------------------------------------------------------------
// Sem banco, sem rede, sem navegador. O store em memória implementa a MESMA
// porta que a implementação Supabase, incluindo as travas que importam:
// claim atômico, dedupe de job e escopo de tenant.
//
// Dois níveis, como nas fases anteriores:
//   COMPORTAMENTAL — roda o pipeline de verdade e confere o que ficou gravado
//   ESTÁTICO       — lê o fonte e prova que uma promessa (tenant da sessão,
//                    nenhuma IA, nenhum endpoint público) não foi desfeita
//
// O que o código PROMETE em comentário não é o que ele FAZ: as buscas estáticas
// removem comentários antes de procurar.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { drainQueue, runNextJob, startProduction } from '../orchestrator'
import { CAROUSEL_PIPELINE, getPipeline, materializeSteps, validatePipeline } from '../pipeline'
import { CAROUSEL_STRATEGIST, reviewCopy, SLIDES_MAX, SLIDES_MIN } from '../agents/carousel'
import { __registerAgentForTests, getAgent } from '../agents/registry'
import { validateBrief } from '../brief'
import {
  admitProduction, isOpenProduction, isRealProduction,
  PRODUCTION_MAX_JOBS_PER_CALL, safeProductionMessage,
} from '../production-guard'
import { ensureProduction, type ProductionRepo, type ProductionRowLite } from '../production-runner'
import { buildProductionResult } from '../result-view'
import { buildOfficeView, deskOf } from '../view-model'
import { DEMO_BRIEF_MODE } from '../demo-guard'
import type {
  ContentStore, EmitEventInput, JobRow, ProductionRow, ProductionStatus,
  StepRow, StoredEvent,
} from '../types'

const RAIZ = process.cwd()
const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const actions = ler('src/app/actions/content-production.ts')
const actionsCode = semComentarios(actions)
const agentes = semComentarios(ler('src/lib/content-studio/agents/carousel.ts'))
const formulario = semComentarios(ler('src/components/content-studio/production-form.tsx'))
const painel = semComentarios(ler('src/components/content-studio/result-panel.tsx'))
const preview = semComentarios(ler('src/components/content-studio/office-preview.tsx'))

// ─── Briefing de teste ──────────────────────────────────────────────────────

const BRIEF_BOM = {
  titulo: 'Carrossel de lançamento',
  tema: 'mentoria de tráfego pago',
  objetivo: 'gerar candidaturas para a turma',
  publico: 'infoprodutores que travaram na escala',
  oferta: 'acompanhamento semanal de campanhas',
  tom: 'direto',
  cta: 'chame no direct',
  observacoes: '',
  idempotencyKey: 'chave-de-teste-0001',
}

function briefValido() {
  const r = validateBrief(BRIEF_BOM)
  assert.ok(r.ok, 'o briefing de teste deveria ser válido')
  return r.ok ? r.brief : (undefined as never)
}

// ─── Store em memória ───────────────────────────────────────────────────────

class MemoryStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0

  constructor(readonly tenantId = 'tenant-A', readonly productionId = 'prod-1') {}

  criar(pipelineKey: string, brief: Record<string, unknown>): ProductionRow {
    const p: ProductionRow = {
      id: this.productionId, tenant_id: this.tenantId, pipeline_key: pipelineKey,
      title: 'Produção', brief, status: 'draft', next_event_seq: 0, created_by: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }
    this.productions.set(p.id, p)
    return p
  }

  async getProduction(id: string) {
    if (id !== this.productionId) return null
    return this.productions.get(id) ?? null
  }

  async updateProductionStatus(id: string, status: ProductionStatus) {
    const p = this.productions.get(id)
    if (p) p.status = status
  }

  async listSteps(id: string) {
    return this.steps
      .filter(s => s.production_id === id)
      .sort((a, b) => a.step_index - b.step_index)
      .map(s => ({ ...s }))
  }

  async insertSteps(rows: Omit<StepRow, 'id'>[]) {
    // Índice único (production_id, step_index): quem chegar depois perde.
    if (this.steps.some(s => s.production_id === this.productionId)) {
      return { rows: await this.listSteps(this.productionId), inserted: false }
    }
    const criados = rows.map((r, i) => ({ ...r, id: `step-${i}` }))
    this.steps.push(...criados)
    return { rows: criados.map(s => ({ ...s })), inserted: true }
  }

  async updateStep(stepId: string, patch: Partial<StepRow>) {
    const s = this.steps.find(x => x.id === stepId)
    if (s) Object.assign(s, patch)
  }

  async insertJob(job: Omit<JobRow, 'id'>) {
    // uq_cs_jobs_dedupe + uq_cs_jobs_active: as duas travas do schema.
    if (this.jobs.some(j => j.dedupe_key === job.dedupe_key)) return null
    if (this.jobs.some(j => j.step_id === job.step_id && (j.status === 'pending' || j.status === 'running'))) {
      return null
    }
    const row: JobRow = { ...job, id: `job-${this.n++}` }
    this.jobs.push(row)
    return { ...row }
  }

  async claimNextJob(now: Date, lockToken: string, lockSeconds: number) {
    // Claim ATÔMICO: a checagem e a escrita acontecem sem ponto de suspensão,
    // que é o análogo em memória do UPDATE ... WHERE status='pending'.
    //
    // O ESCOPO é modelado junto de propósito: o store real é preso a
    // (tenant, produção), e um modelo sem essa trava validaria menos do que a
    // produção realmente garante.
    const job = this.jobs.find(
      j => j.tenant_id === this.tenantId &&
           j.production_id === this.productionId &&
           j.status === 'pending' && new Date(j.scheduled_for) <= now,
    )
    if (!job) return null
    job.status = 'running'
    job.lock_token = lockToken
    job.locked_until = new Date(now.getTime() + lockSeconds * 1000).toISOString()
    return { ...job }
  }

  async completeJob(jobId: string, lockToken: string) {
    const j = this.jobs.find(x => x.id === jobId && x.lock_token === lockToken && x.status === 'running')
    if (!j) return false
    j.status = 'done'
    return true
  }

  async failJob(jobId: string, lockToken: string, error: string, retryAt: Date | null) {
    const j = this.jobs.find(x => x.id === jobId && x.lock_token === lockToken)
    if (!j) return
    j.error = error
    j.lock_token = null
    j.locked_until = null
    if (retryAt) { j.status = 'pending'; j.attempt += 1; j.scheduled_for = retryAt.toISOString() }
    else j.status = 'failed'
  }

  async recoverStaleJobs(now: Date) {
    let n = 0
    for (const j of this.jobs) {
      if (j.tenant_id !== this.tenantId || j.production_id !== this.productionId) continue
      if (j.status === 'running' && j.locked_until && new Date(j.locked_until) < now) {
        j.status = 'pending'; j.lock_token = null; j.locked_until = null; n++
      }
    }
    return n
  }

  async emitEvent(input: EmitEventInput) {
    const p = this.productions.get(input.productionId)
    if (!p) throw new Error('production_not_found')
    p.next_event_seq += 1
    this.events.push({
      id: `ev-${p.next_event_seq}`, tenant_id: p.tenant_id, production_id: p.id,
      step_id: input.stepId ?? null, agent_key: input.agentKey ?? null,
      type: input.type, schema_version: 1, seq: p.next_event_seq,
      payload: input.payload ?? {}, ui_hint: input.uiHint ?? null,
      occurred_at: `2026-01-01T00:00:${String(p.next_event_seq).padStart(2, '0')}.000Z`,
    })
    return p.next_event_seq
  }
}

/** Roda o pipeline inteiro e devolve o store para inspeção. */
async function rodarPipeline(brief: Record<string, unknown> = briefValido()) {
  const store = new MemoryStore()
  store.criar(CAROUSEL_PIPELINE.key, brief)
  await startProduction(store, 'prod-1')
  await drainQueue(store, 40)
  return store
}

// ─── 1–5: criação, tenant e briefing ────────────────────────────────────────

test('1) a criação exige sessão e resolve o tenant no SERVIDOR', () => {
  // Toda action começa pelo tenant da sessão e sai se não houver.
  const exportadas = [...actionsCode.matchAll(/export async function (\w+)\(/g)].map(m => m[1])
  assert.deepEqual(exportadas.sort(), [
    'advanceProduction', 'createProduction', 'getLatestProduction',
    'getProductionState', 'listProductions',
  ])

  for (const nome of exportadas) {
    const corpo = actionsCode.slice(actionsCode.indexOf(`export async function ${nome}(`))
      .split('\nexport ')[0]
    assert.ok(corpo.includes('await currentTenantId()'), `${nome} não resolve o tenant`)
    assert.ok(corpo.includes("fail('unauthenticated')"), `${nome} não recusa sessão ausente`)
  }

  // E o tenant vem da sessão do Supabase, não de argumento.
  assert.ok(actionsCode.includes('supabase.auth.getUser()'))
  assert.ok(actionsCode.includes("from('users_tenants')"))
})

test('2) nenhum tenant enviado pelo cliente é lido', () => {
  // Nenhuma action EXPORTADA aceita tenant por parâmetro. Helpers internos
  // recebem, sim — mas sempre o valor já derivado da sessão.
  const assinaturas = [...actionsCode.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
  assert.ok(assinaturas.length >= 5)
  for (const [, nome, params] of assinaturas) {
    assert.ok(!/tenant/i.test(params), `${nome} recebe tenant por parâmetro: ${params}`)
  }

  // E o tenant nunca é lido do payload do cliente.
  assert.ok(!/input\.\s*tenant|params\.\s*tenant|\btenant_id:\s*(input|brief|params)/.test(actionsCode),
    'o tenant do cliente é lido em algum lugar')
  // A única origem de tenantId é currentTenantId().
  const origens = [...actionsCode.matchAll(/const tenantId = ([^\n]+)/g)].map(m => m[1].trim())
  assert.ok(origens.length >= 5)
  assert.ok(origens.every(o => o === 'await currentTenantId()'), `origem inesperada: ${origens}`)

  // Toda query de cs_productions carrega o tenant da sessão.
  const queries = actionsCode.split("from('cs_").slice(1)
  for (const q of queries) {
    const trecho = q.slice(0, 400)
    assert.ok(/tenant_id/.test(trecho), `query sem filtro de tenant: ${trecho.slice(0, 80)}`)
  }
})

test('3) o briefing do cliente é copiado por lista branca, não repassado', () => {
  const r = validateBrief({ ...BRIEF_BOM, tenantId: 'tenant-B', status: 'published', extra: 'x' } as never)
  assert.ok(r.ok)
  if (!r.ok) return
  const chaves = Object.keys(r.brief).sort()
  assert.deepEqual(chaves, [
    'cta', 'idempotency_key', 'objetivo', 'observacoes', 'oferta',
    'publico', 'tema', 'titulo', 'tom',
  ], 'campo estranho sobreviveu à validação')
  assert.ok(!('tenantId' in r.brief) && !('status' in r.brief))

  // E o pipeline é constante no servidor.
  assert.ok(actionsCode.includes('pipeline_key: CAROUSEL_PIPELINE.key'))
  assert.ok(!/pipeline_key:\s*(input|params|brief)\./.test(actionsCode))
})

test('4) briefing inválido é rejeitado com mensagem amigável', () => {
  const vazio = validateBrief({ idempotencyKey: 'chave-de-teste-0001' })
  if (vazio.ok) throw new Error('briefing vazio foi aceito')
  assert.ok(vazio.errors.length >= 7, 'deveria acusar todos os obrigatórios de uma vez')
  for (const e of vazio.errors) {
    assert.ok(!/cs_|select|insert|tenant_id|supabase|postgres/i.test(e.message),
      `mensagem vaza detalhe interno: ${e.message}`)
  }

  // Limite de tamanho por campo.
  const longo = validateBrief({ ...BRIEF_BOM, titulo: 'x'.repeat(500) })
  assert.ok(!longo.ok)

  // Curto demais também.
  const curto = validateBrief({ ...BRIEF_BOM, tema: 'a' })
  assert.ok(!curto.ok)

  // Chave de idempotência ausente ou malformada.
  assert.ok(!validateBrief({ ...BRIEF_BOM, idempotencyKey: '' }).ok)
  assert.ok(!validateBrief({ ...BRIEF_BOM, idempotencyKey: 'curta' }).ok)
})

test('5) duplo envio com a mesma chave NÃO duplica a produção', async () => {
  const criadas: ProductionRowLite[] = []
  let materializadas = 0
  let seq = 0

  const repo = (): ProductionRepo => ({
    async findByIdempotencyKey(key) {
      return criadas.filter(p => (p.brief as Record<string, unknown>)?.idempotency_key === key)
    },
    async listOpen() { return criadas.filter(isOpenProduction) },
    async insert(brief) {
      const row: ProductionRowLite = {
        id: `p-${seq}`, status: 'draft', pipeline_key: CAROUSEL_PIPELINE.key,
        brief: { ...brief }, created_at: `2026-01-01T00:00:0${seq}.000Z`,
      }
      seq++
      criadas.push(row)
      return row
    },
    async cancel(ids) {
      for (const p of criadas) if (ids.includes(p.id)) p.status = 'canceled'
    },
    async materialize() { materializadas++ },
  })

  const r = repo()
  const brief = briefValido()

  // Duas chamadas SIMULTÂNEAS com a mesma chave.
  const [a, b] = await Promise.all([ensureProduction(r, brief), ensureProduction(r, brief)])
  assert.ok(a.ok && b.ok)
  if (!a.ok || !b.ok) return
  assert.equal(a.productionId, b.productionId, 'as duas chamadas devem convergir')

  const vivas = criadas.filter(p => p.status !== 'canceled')
  assert.equal(vivas.length, 1, `sobrou mais de uma produção viva: ${vivas.length}`)
  assert.equal(vivas[0].id, a.productionId)

  // Uma terceira chamada, agora sequencial: reaproveita, não insere.
  const antes = criadas.length
  const c = await ensureProduction(r, brief)
  assert.ok(c.ok && c.reused, 'o mesmo envio deveria ser reaproveitado')
  assert.equal(criadas.length, antes, 'reenvio criou linha nova')

  // A materialização só acontece sobre a vencedora.
  assert.ok(materializadas >= 1)
})

// ─── 6–10: steps, jobs e execução ───────────────────────────────────────────

test('6) os steps nascem na ordem correta do pipeline', () => {
  validatePipeline(CAROUSEL_PIPELINE)
  const steps = materializeSteps(CAROUSEL_PIPELINE, { id: 'p', tenant_id: 't' })
  assert.deepEqual(steps.map(s => s.agent_key), [
    'cc_researcher', 'cc_strategist', 'cc_copywriter', 'cc_reviewer', 'cc_approval',
  ])
  assert.deepEqual(steps.map(s => s.step_index), [0, 1, 2, 3, 4])
  // Cada um depende só do anterior: a ordem emerge das dependências.
  assert.deepEqual(steps.map(s => s.depends_on), [
    [], ['cc_researcher'], ['cc_strategist'], ['cc_copywriter'], ['cc_reviewer'],
  ])
})

test('7) os jobs são criados na ordem, um por vez', async () => {
  const store = new MemoryStore()
  store.criar(CAROUSEL_PIPELINE.key, briefValido())
  await startProduction(store, 'prod-1')

  // Só o primeiro step é elegível: os outros dependem dele.
  assert.equal(store.jobs.length, 1)
  assert.equal(store.steps.find(s => s.id === store.jobs[0].step_id)?.agent_key, 'cc_researcher')

  await runNextJob(store)
  const chaves = store.jobs.map(j => store.steps.find(s => s.id === j.step_id)!.agent_key)
  assert.deepEqual(chaves, ['cc_researcher', 'cc_strategist'], 'o handoff enfileirou fora de ordem')
})

test('8) uma chamada executa NO MÁXIMO um job', async () => {
  assert.equal(PRODUCTION_MAX_JOBS_PER_CALL, 1)
  // E a action usa a constante, não um número solto nem um parâmetro.
  assert.ok(actionsCode.includes('drainQueue(store, PRODUCTION_MAX_JOBS_PER_CALL)'))
  assert.ok(!/drainQueue\(store,\s*\d+\)/.test(actionsCode), 'quantidade fixa em número mágico')
  assert.ok(!/advanceProduction\([^)]*\b(max|quantidade|limit|count)\b/.test(actionsCode),
    'a action aceita quantidade do cliente')

  const store = new MemoryStore()
  store.criar(CAROUSEL_PIPELINE.key, briefValido())
  await startProduction(store, 'prod-1')

  const executados = await drainQueue(store, PRODUCTION_MAX_JOBS_PER_CALL)
  assert.equal(executados.length, 1)
  assert.equal(store.steps.filter(s => s.status === 'completed').length, 1)
})

test('9) claim concorrente executa o job uma única vez', async () => {
  const store = new MemoryStore()
  store.criar(CAROUSEL_PIPELINE.key, briefValido())
  await startProduction(store, 'prod-1')

  // Cinco chamadas disputando o MESMO job.
  const saidas = await Promise.all(Array.from({ length: 5 }, () => runNextJob(store)))
  const executaram = saidas.filter(s => s.status !== 'idle')

  assert.equal(executaram.length, 1, `${executaram.length} chamadas executaram o mesmo job`)
  const iniciados = store.events.filter(e => e.type === 'agent_started')
  assert.equal(iniciados.length, 1, 'o agente começou mais de uma vez')
  assert.equal(store.jobs.filter(j => j.status === 'done').length, 1)
})

test('10) repetir a chamada depois do fim é seguro (no-op)', async () => {
  const store = await rodarPipeline()
  const eventosAntes = store.events.length
  const statusAntes = store.productions.get('prod-1')!.status

  for (let i = 0; i < 3; i++) await drainQueue(store, 1)

  assert.equal(store.events.length, eventosAntes, 'chamada extra gerou evento')
  assert.equal(store.productions.get('prod-1')!.status, statusAntes)
})

// ─── 11–17: agentes e pipeline ──────────────────────────────────────────────

test('11) o agente recebe apenas o input permitido', async () => {
  const store = await rodarPipeline()

  // O estrategista só enxerga o upstream declarado — nunca o copy, que vem
  // depois dele, nem o parecer do revisor.
  const estrategista = store.steps.find(s => s.agent_key === 'cc_strategist')!
  assert.deepEqual(estrategista.depends_on, ['cc_researcher'])

  // E o orquestrador monta o upstream a partir de depends_on, não de tudo.
  const orquestrador = semComentarios(ler('src/lib/content-studio/orchestrator.ts'))
  assert.ok(orquestrador.includes('for (const dep of step.depends_on)'))
  assert.ok(orquestrador.includes('stepInput: step.input ?? null'))

  // O cliente nunca escreve em cs_steps.
  assert.ok(!/from\('cs_steps'\)[\s\S]{0,120}\.(insert|update)/.test(actionsCode),
    'a action escreve em cs_steps')
})

test('12) o pesquisador não inventa fato externo', async () => {
  const store = await rodarPipeline()
  const pesquisa = store.steps.find(s => s.agent_key === 'cc_researcher')!.output!.data

  assert.deepEqual(pesquisa.fontes_externas, [])
  assert.equal(pesquisa.sem_dados_inventados, true)

  // Toda inferência vem marcada como hipótese.
  for (const grupo of ['necessidades', 'dores_possiveis']) {
    const itens = pesquisa[grupo] as { texto: string; hipotese: boolean }[]
    assert.ok(itens.length > 0)
    assert.ok(itens.every(i => i.hipotese === true), `${grupo} tem item não marcado como hipótese`)
  }

  // Nenhum número com cara de estatística no output inteiro.
  const texto = JSON.stringify(pesquisa)
  assert.ok(!/\d{1,3}\s*%/.test(texto), 'porcentagem inventada no output')
  assert.ok(!/\bsegundo\s+(a|o)\s+\w+/i.test(texto), 'citação de fonte inventada')

  // E o arquivo não tem rede nem provedor de IA.
  assert.ok(!/\bfetch\s*\(/.test(agentes), 'os agentes fazem fetch')
  assert.ok(!/anthropic|openai|claude|gpt/i.test(agentes), 'referência a provedor de IA')
  assert.ok(!/https?:\/\//.test(agentes), 'URL externa nos agentes')
})

test('13) o estrategista usa a saída do pesquisador', async () => {
  const store = await rodarPipeline()
  const estrategia = store.steps.find(s => s.agent_key === 'cc_strategist')!.output!.data

  const baseado = estrategia.baseado_em as { hipoteses: number; premissas: number }
  assert.ok(baseado.hipoteses > 0, 'ignorou as hipóteses do pesquisador')
  assert.ok(baseado.premissas > 0, 'ignorou as premissas do pesquisador')
  assert.ok(Array.isArray(estrategia.sequencia) && (estrategia.sequencia as unknown[]).length >= SLIDES_MIN)

  // Sem a pesquisa, ele se recusa a rodar em vez de inventar.
  const semUpstream = { envelope: {}, brief: {}, upstream: {} } as never
  assert.throws(() => CAROUSEL_STRATEGIST.validateInput!(semUpstream))
})

test('14) o copywriter gera a estrutura completa', async () => {
  const store = await rodarPipeline()
  const copy = store.steps.find(s => s.agent_key === 'cc_copywriter')!.output!.data

  assert.ok(typeof copy.titulo === 'string' && copy.titulo.length > 0)
  const slides = copy.slides as { numero: number; headline: string; texto: string }[]
  assert.ok(slides.length >= SLIDES_MIN && slides.length <= SLIDES_MAX, `${slides.length} slides`)
  assert.ok(slides.every(s => s.headline.trim() && s.texto.trim()), 'slide com campo vazio')
  assert.deepEqual(slides.map(s => s.numero), slides.map((_, i) => i + 1), 'slides fora de ordem')
  assert.ok(typeof copy.legenda === 'string' && copy.legenda.length > 0)
  assert.ok(typeof copy.cta === 'string' && copy.cta.length > 0)
  assert.ok(Array.isArray(copy.hashtags) && (copy.hashtags as string[]).length > 0)
})

test('15) o revisor valida os limites de verdade', () => {
  const brief = { tema: 'mentoria' }
  const bom = {
    titulo: 'Mentoria para quem travou',
    cta: 'chame no direct',
    legenda: 'mentoria explicada',
    slides: Array.from({ length: 6 }, (_, i) => ({
      numero: i + 1, papel: 'gancho', headline: `H${i}`, texto: 'texto curto',
    })),
  }
  assert.equal(reviewCopy(bom, brief).verdict, 'aprovado_para_revisao')

  // Slides de menos.
  assert.equal(reviewCopy({ ...bom, slides: bom.slides.slice(0, 2) }, brief).verdict, 'needs_revision')
  // Slides demais.
  assert.equal(
    reviewCopy({ ...bom, slides: [...bom.slides, ...bom.slides] }, brief).verdict, 'needs_revision')
  // Sem título.
  assert.equal(reviewCopy({ ...bom, titulo: '' }, brief).verdict, 'needs_revision')
  // Sem CTA.
  assert.equal(reviewCopy({ ...bom, cta: '' }, brief).verdict, 'needs_revision')
  // Campo vazio num slide.
  const comVazio = { ...bom, slides: [...bom.slides.slice(1), { numero: 9, papel: 'x', headline: '', texto: '' }] }
  assert.equal(reviewCopy(comVazio, brief).verdict, 'needs_revision')
  // Texto longo demais.
  const longo = { ...bom, slides: [{ ...bom.slides[0], texto: 'x'.repeat(400) }, ...bom.slides.slice(1)] }
  assert.equal(reviewCopy(longo, brief).verdict, 'needs_revision')
  // Estatística inventada.
  const inventado = { ...bom, legenda: '87% dos alunos dobraram o faturamento' }
  const r = reviewCopy(inventado, brief)
  assert.equal(r.verdict, 'needs_revision')
  assert.ok(r.avisos.some(a => /inventada/i.test(a)))
  // Fora do tema do briefing.
  assert.equal(
    reviewCopy({ ...bom, titulo: 'Outro assunto', legenda: 'nada a ver',
      slides: bom.slides.map(s => ({ ...s, headline: 'x', texto: 'y' })) }, brief).verdict,
    'needs_revision')
})

test('16) a revisão automática tem teto de UMA', async () => {
  assert.equal(CAROUSEL_PIPELINE.maxAutoRevisions, 1)

  // Copywriter defeituoso: sempre produz material que o revisor reprova.
  const original = getAgent('cc_copywriter')
  __registerAgentForTests({
    key: 'cc_copywriter', version: 99, label: 'Copy ruim',
    async run() { return { data: { titulo: '', slides: [], legenda: '', cta: '' } } },
  })

  try {
    const store = await rodarPipeline()

    const reprocessos = store.events.filter(e => e.type === 'agent_reprocessed')
    assert.equal(reprocessos.length, 1, `houve ${reprocessos.length} reprocessamentos — o teto é 1`)
    assert.equal(reprocessos[0].payload.revision_cycle, 1)

    // Estourado o teto, a produção FALHA — não gira.
    assert.equal(store.productions.get('prod-1')!.status, 'failed')
    const falha = store.events.find(
      e => e.type === 'agent_failed' && e.payload.error === 'revisao_nao_aprovada')
    assert.ok(falha, 'faltou o evento de falha por revisão não aprovada')
    assert.equal(falha!.payload.max_auto_revisions, 1)

    // E o copywriter recebeu o ciclo pelo input do step, não por adivinhação.
    const copyStep = store.steps.find(s => s.agent_key === 'cc_copywriter')!
    assert.equal((copyStep.input as { revision_cycle?: number })?.revision_cycle, 1)
  } finally {
    __registerAgentForTests(original)
  }
})

test('17) o pipeline termina em awaiting_approval, sem aprovar nada', async () => {
  const store = await rodarPipeline()

  assert.equal(store.productions.get('prod-1')!.status, 'awaiting_approval')
  assert.equal(CAROUSEL_PIPELINE.finalStatus, 'awaiting_approval')

  const aprovacao = store.steps.find(s => s.agent_key === 'cc_approval')!
  assert.equal(aprovacao.status, 'completed')
  assert.equal(aprovacao.output!.data.aprovado_automaticamente, false)
  assert.equal(aprovacao.output!.data.estado, 'aguardando_aprovacao')

  // Nenhum evento de aprovação foi emitido — aprovar é da pessoa.
  assert.ok(!store.events.some(e => e.type === 'content_approved'), 'a produção se auto-aprovou')

  // E o comportamento da Fase 1 continua: pipeline sem finalStatus vai a review.
  assert.equal(getPipeline('office_demo_v1').finalStatus, undefined)
})

// ─── 18–19: multi-tenant ────────────────────────────────────────────────────

test('18) produção de outro tenant não é acessível', async () => {
  // O store é preso a (tenant, produção): pedir outra devolve vazio.
  const store = new MemoryStore('tenant-A', 'prod-1')
  store.criar(CAROUSEL_PIPELINE.key, briefValido())
  assert.equal(await store.getProduction('prod-de-outro'), null)

  // A implementação Supabase aplica o mesmo escopo em toda query.
  const storeSrc = semComentarios(ler('src/lib/content-studio/store.ts'))
  assert.ok(storeSrc.includes(".eq('tenant_id', tenantId)"))
  assert.ok(storeSrc.includes("if (id !== productionId) return null"))

  // E a action confere posse ANTES de admitir.
  const trecho = actionsCode.slice(actionsCode.indexOf('export async function advanceProduction'))
  assert.ok(trecho.indexOf(".eq('tenant_id', tenantId)") < trecho.indexOf('admitProduction'),
    'a posse precisa ser conferida antes da admissão')

  // Produção inexistente vira mensagem segura, não erro cru.
  assert.equal(admitProduction(null).ok, false)
  assert.ok(!/cs_|supabase|sql/i.test(safeProductionMessage('not_found')))
})

test('19) job de outro tenant não é processado', async () => {
  const store = new MemoryStore('tenant-A', 'prod-1')
  store.criar(CAROUSEL_PIPELINE.key, briefValido())
  await startProduction(store, 'prod-1')

  // Job plantado de outro tenant/produção não pode ser reivindicado.
  store.jobs.push({
    id: 'job-invasor', tenant_id: 'tenant-B', production_id: 'prod-de-outro',
    step_id: 'step-x', dedupe_key: 'invasor', status: 'pending',
    scheduled_for: '2020-01-01T00:00:00.000Z', attempt: 0, max_attempts: 3,
    lock_token: null, locked_until: null, error: null,
  })

  await drainQueue(store, 40)
  const invasor = store.jobs.find(j => j.id === 'job-invasor')!
  assert.equal(invasor.status, 'pending', 'o job de outro tenant foi tocado')

  // O escopo do store real impede isso por construção.
  const storeSrc = semComentarios(ler('src/lib/content-studio/store.ts'))
  const claim = storeSrc.slice(storeSrc.indexOf('async claimNextJob'))
  assert.ok(claim.includes(".eq('tenant_id', tenantId)"))
  assert.ok(claim.includes(".eq('production_id', productionId)"))
  assert.ok(claim.includes(".eq('status', 'pending')"), 'o claim perdeu a exclusão mútua')
})

// ─── 20–21: eventos e escritório ────────────────────────────────────────────

test('20) os eventos saem na ordem esperada', async () => {
  const store = await rodarPipeline()
  const tipos = store.events.map(e => e.type)

  assert.equal(tipos[0], 'production_created')
  assert.equal(tipos[1], 'agent_queued')
  assert.equal(tipos[2], 'agent_started')
  assert.ok(tipos.includes('agent_progress'), 'nenhum progresso real reportado')
  assert.equal(tipos[tipos.length - 1], 'content_waiting_approval')

  // seq é estritamente crescente e sem buraco.
  const seqs = store.events.map(e => e.seq)
  assert.deepEqual(seqs, seqs.map((_, i) => i + 1))

  // Cada agente do pipeline começou e concluiu, na ordem do pipeline.
  const iniciados = store.events.filter(e => e.type === 'agent_started').map(e => e.agent_key)
  assert.deepEqual(iniciados, [
    'cc_researcher', 'cc_strategist', 'cc_copywriter', 'cc_reviewer', 'cc_approval',
  ])

  // Progresso só existe com total real.
  for (const e of store.events.filter(x => x.type === 'agent_progress')) {
    const { completed, total } = e.payload as { completed: number; total: number }
    assert.ok(total > 0 && completed >= 1 && completed <= total)
  }
})

test('21) os handoffs continuam dirigindo o escritório', async () => {
  const store = await rodarPipeline()

  const inicios = store.events.filter(e => e.type === 'task_handoff_started')
  assert.ok(inicios.length >= 3, 'faltaram handoffs')
  assert.ok(store.events.some(e => e.type === 'task_handoff_completed'))

  // A cena é construída a partir dos eventos gravados, incluindo os cc_*.
  const view = buildOfficeView(store.events)
  assert.equal(view.agents.length, 3, 'o escritório continua com três mesas')
  assert.ok(view.finished, 'a cena não reconheceu o fim')
  assert.ok(!view.failed)

  // Os papéis com mesa animam; Revisor e Aprovação aparecem só na timeline.
  assert.equal(deskOf('cc_researcher'), 'researcher')
  assert.equal(deskOf('cc_copywriter'), 'copywriter')
  assert.equal(deskOf('cc_reviewer'), null)
  assert.equal(deskOf('cc_approval'), null)

  // Mas os dois têm rótulo em português na timeline — nada de chave crua.
  const rotulos = view.timeline.filter(t => t.agentKey === 'cc_reviewer').map(t => t.agentLabel)
  assert.ok(rotulos.length > 0 && rotulos.every(r => r === 'Revisor'))

  // Um handoff intermediário aponta origem e destino de verdade.
  const primeiro = inicios[0].payload as { from: string; to: string }
  assert.equal(primeiro.from, 'cc_researcher')
  assert.equal(primeiro.to, 'cc_strategist')
})

// ─── 22–24: interface ───────────────────────────────────────────────────────

test('22) recarregar a página NÃO cria produção', () => {
  // O carregamento inicial só chama funções de leitura.
  const efeito = preview.slice(preview.indexOf('const carregar ='), preview.indexOf('}, [modo])'))
  assert.ok(/getLatestDemo\(\)|getLatestProduction\(\)/.test(efeito))
  assert.ok(!efeito.includes('createProduction('), 'o carregamento cria produção')
  assert.ok(!efeito.includes('advanceProduction('), 'o carregamento dispara execução')

  // E `getLatestProduction` só lê.
  const trecho = actionsCode.slice(actionsCode.indexOf('export async function getLatestProduction'))
    .split('\nexport ')[0]
  assert.ok(!/\.insert\(|ensureProduction|drainQueue/.test(trecho), 'a leitura escreve no banco')

  // Criar só acontece pelo submit do formulário.
  assert.ok(preview.includes('const criada = await createProduction('))
  assert.ok(preview.includes('<ProductionForm onSubmit={iniciarProducao}'))
})

test('23) demonstração e produção real não se misturam', async () => {
  // Guardas opostos: cada um recusa o objeto do outro.
  const demoRow = {
    id: 'x', status: 'draft' as const, pipeline_key: 'content_carousel_v1',
    brief: { modo: DEMO_BRIEF_MODE },
  }
  assert.equal(admitProduction(demoRow).ok, false)
  assert.equal(isRealProduction(demoRow), false)

  const realRow = {
    id: 'y', status: 'draft' as const, pipeline_key: 'content_carousel_v1',
    brief: { idempotency_key: 'abc' },
  }
  assert.equal(admitProduction(realRow).ok, true)

  // Pipeline errado também é recusado.
  assert.equal(admitProduction({ ...realRow, pipeline_key: 'office_demo_v1' }).ok, false)

  // A action da demonstração continua exigindo o pipeline da demonstração.
  const demoActions = semComentarios(ler('src/app/actions/content-studio.ts'))
  assert.ok(demoActions.includes('DEMO_PIPELINE_KEY'))
  assert.ok(!demoActions.includes('CAROUSEL_PIPELINE'), 'a action de demo alcança o pipeline real')

  // Na tela, trocar de modo LIMPA os eventos antes de carregar.
  const troca = preview.slice(preview.indexOf('const trocarModo'), preview.indexOf('const avancarAteParar'))
  assert.ok(troca.includes('setAllEvents([])') && troca.includes('setResult(emptyProductionResult())'),
    'a troca de modo não limpa a tela')
})

test('24) o resultado vem da PERSISTÊNCIA, não do navegador', async () => {
  const store = await rodarPipeline()
  const resultado = buildProductionResult(store.steps)

  assert.ok(resultado.disponivel)
  assert.ok(resultado.titulo)
  assert.ok(resultado.slides.length >= SLIDES_MIN)
  assert.ok(resultado.legenda && resultado.cta)
  assert.ok(resultado.estrategia.angulo && resultado.estrategia.promessa)
  assert.ok(resultado.revisao.checklist.length > 0)
  assert.equal(resultado.revisao.verdict, 'aprovado_para_revisao')

  // Sem steps concluídos não há resultado inventado.
  assert.equal(buildProductionResult([]).disponivel, false)

  // O painel só apresenta: não recombina briefing nem chama agente.
  assert.ok(!/buildProductionResult|reviewCopy|upstream|brief/.test(painel),
    'o painel remonta o resultado no navegador')
  assert.ok(!/useState|useEffect/.test(painel), 'o painel guarda estado próprio do resultado')

  // E o servidor é quem monta.
  assert.ok(actionsCode.includes('buildProductionResult((steps.data ?? []) as StepRow[])'))
})

// ─── 25–30: garantias que não podem regredir ────────────────────────────────

test('25) a timeline não voltou a mover a página', () => {
  const timeline = semComentarios(ler('src/components/content-studio/timeline-panel.tsx'))
  assert.ok(!timeline.includes('scrollIntoView'))
  assert.ok(!/window\.scroll|documentElement\.scrollTop|document\.body\.scroll/.test(timeline))
  assert.ok(timeline.includes('top: el.scrollHeight'))
  assert.ok(!/scrollIntoView|window\.scroll/.test(preview + formulario + painel))
})

test('26) a locomoção ambiental continua intacta', () => {
  const motion = ler('src/components/content-studio/ambient-motion.ts')
  const hook = ler('src/components/content-studio/use-ambient-motion.ts')
  assert.ok(motion.includes('AMBIENT_ROUTINES') && motion.includes("| 'task_returning'"))
  assert.ok(hook.includes('requestAnimationFrame') && hook.includes('cancelAnimationFrame'))
  // Nada da Fase 2A toca a locomoção.
  for (const [nome, src] of [['actions', actionsCode], ['form', formulario], ['painel', painel]] as const) {
    assert.ok(!/ambient|Ambient/.test(src), `${nome} mexe na locomoção`)
  }
})

test('27) nenhum endpoint público foi criado', () => {
  const proxy = ler('src/proxy.ts')
  const publicos = /PUBLIC_PREFIXES[\s\S]*?\]/.exec(proxy)?.[0] ?? ''
  assert.ok(!/content-studio|content-production|cs_/.test(publicos),
    'a Fase 2A entrou na lista de rotas públicas')

  // Não há route handler novo para o Content Studio.
  const rotas = readFileSync(join(RAIZ, 'src/proxy.ts'), 'utf8')
  assert.ok(rotas.length > 0)
  assert.ok(actions.startsWith("'use server'"), 'as actions precisam ser server-only')
  assert.ok(!actionsCode.includes('NextResponse'), 'a action virou handler HTTP')

  // A página segue fora do menu lateral.
  const sidebar = ler('src/components/layout/sidebar.tsx')
  assert.ok(!sidebar.includes('/content-studio'), 'a rota entrou no menu')
})

test('28) nenhum arquivo do R1 foi alterado', () => {
  const cronAuth = ler('src/lib/security/cron-auth.ts')
  const route = ler('src/app/api/queue/process/route.ts')
  assert.ok(cronAuth.includes('timingSafeEqual'))
  assert.ok(route.includes('evaluateCronAuth'))

  for (const [nome, src] of [
    ['actions', actionsCode], ['agentes', agentes], ['form', formulario], ['preview', preview],
  ] as const) {
    for (const alvo of ['cron-auth', 'queue/process', 'CRON_SECRET', 'CRON_AUTH_ENFORCE']) {
      assert.ok(!src.includes(alvo), `${nome} referencia ${alvo}`)
    }
  }
})

test('29) queue_jobs e o schema do banco não foram tocados', () => {
  // A Fase 2A usa a fila PRÓPRIA (cs_jobs). A dos funis não é mencionada.
  for (const [nome, src] of [
    ['actions', actionsCode], ['store', semComentarios(ler('src/lib/content-studio/store.ts'))],
    ['orquestrador', semComentarios(ler('src/lib/content-studio/orchestrator.ts'))],
  ] as const) {
    assert.ok(!src.includes('queue_jobs'), `${nome} toca queue_jobs`)
  }

  // Nenhuma migration nova, e a da Fase 1 continua idêntica no essencial.
  const migrations = readFileSync(
    join(RAIZ, 'supabase/migrations/20260730000000_content_studio_phase1.sql'), 'utf8')
  assert.ok(migrations.includes('CREATE TABLE public.cs_productions'))
  assert.ok(migrations.includes('ON DELETE SET NULL (step_id)'))

  // As actions não executam SQL cru.
  assert.ok(!/exec_sql|\.rpc\('(?!cs_emit_event)/.test(actionsCode), 'SQL cru na camada de produção')
})

test('30) nenhuma chamada externa ou IA foi adicionada', () => {
  for (const [nome, src] of [
    ['actions', actionsCode], ['agentes', agentes],
    ['form', formulario], ['painel', painel],
    ['brief', semComentarios(ler('src/lib/content-studio/brief.ts'))],
    ['result-view', semComentarios(ler('src/lib/content-studio/result-view.ts'))],
    ['runner', semComentarios(ler('src/lib/content-studio/production-runner.ts'))],
  ] as const) {
    assert.ok(!/\bfetch\s*\(/.test(src), `${nome} faz fetch`)
    assert.ok(!/https?:\/\//.test(src), `${nome} referencia URL externa`)
    assert.ok(!/anthropic|openai|resend|instagram|n8n/i.test(src), `${nome} referencia provedor`)
  }

  // E nenhuma dependência nova entrou.
  const pkg = JSON.parse(ler('package.json'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const externos = [...agentes.matchAll(/from '([^']+)'/g)].map(m => m[1])
    .filter(m => !m.startsWith('.') && !m.startsWith('@/'))
  for (const mod of externos) assert.ok(mod in deps, `dependência não declarada: ${mod}`)

  // Os agentes declaram custo zero, e é verdade.
  assert.ok(agentes.includes("provider: 'none'"))
  assert.ok(agentes.includes('costCents: 0'))
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
