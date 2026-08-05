// ============================================================================
// Testes de concorrência na criação da demonstração
// ----------------------------------------------------------------------------
// A pergunta que este arquivo responde: com duas chamadas simultâneas, a
// produção PERDEDORA chega a criar steps, jobs ou eventos antes de ser
// cancelada?
//
// O repositório em memória replica as garantias do Postgres que importam aqui:
//   • índice único (production_id, step_index) em cs_steps
//   • índice único de dedupe e "um job ativo por step" em cs_jobs
//   • pontos de suspensão entre leitura e escrita, para interleaving REAL
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEMO_BRIEF_MODE, DEMO_PIPELINE_KEY } from '../demo-guard'
import { ensureDemoProduction, type DemoRepo, type DemoRow } from '../demo-runner'
import { startProduction } from '../orchestrator'
import { OFFICE_PIPELINE } from '../pipeline'
import type {
  ContentStore, EmitEventInput, JobRow, ProductionRow, StepRow, StoredEvent,
} from '../types'

const RAIZ = process.cwd()
const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

/** Cede o controle — cria janela real de interleaving sob Promise.all. */
const cede = () => new Promise(r => setTimeout(r, 0))

// ─── "Banco" em memória com as travas que importam ──────────────────────────

class FakeDb {
  productions: ProductionRow[] = []
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0
  private relogio = 0

  /** Instantes distintos por padrão; `mesmoInstante` força o empate. */
  constructor(private mesmoInstante = false) {}

  novoId(prefixo: string) { return `${prefixo}-${++this.n}` }

  criarProducao(tenantId: string): ProductionRow {
    const t = this.mesmoInstante ? 0 : this.relogio++
    const p: ProductionRow = {
      id: this.novoId('prod'), tenant_id: tenantId, pipeline_key: DEMO_PIPELINE_KEY,
      title: 'Demo', brief: { modo: DEMO_BRIEF_MODE }, status: 'draft',
      next_event_seq: 0, created_by: null,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, t)).toISOString(),
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    this.productions.push(p)
    return p
  }

  stepsDe(id: string) { return this.steps.filter(s => s.production_id === id) }
  jobsDe(id: string) { return this.jobs.filter(j => j.production_id === id) }
  eventosDe(id: string) { return this.events.filter(e => e.production_id === id) }
  producao(id: string) { return this.productions.find(p => p.id === id)! }
}

/** ContentStore em memória sobre o FakeDb, com as travas de unicidade. */
function storeFor(db: FakeDb, tenantId: string, productionId: string): ContentStore {
  return {
    async getProduction(id) {
      return db.productions.find(p => p.id === id && p.tenant_id === tenantId) ?? null
    },
    async updateProductionStatus(id, status) {
      const p = db.productions.find(x => x.id === id)
      if (p) p.status = status
    },
    async transitionProductionStatus(id, expected, next) {
      // Espelha o CAS do Postgres: predicado e escrita no mesmo passo síncrono.
      const p = db.productions.find(x => x.id === id)
      if (!p || !expected.includes(p.status)) return false
      p.status = next
      return true
    },
    async listSteps(id) { return db.stepsDe(id).map(s => ({ ...s })) },

    async insertSteps(rows) {
      await cede()  // janela: outra chamada pode inserir aqui no meio
      // Índice único (production_id, step_index): se já existe, devolvemos os
      // existentes — mesmo comportamento do store real ao ver 23505.
      const jaTem = db.stepsDe(productionId)
      // `inserted: false` -> quem chegou depois NÃO reemite production_created.
      if (jaTem.length > 0) return { rows: jaTem.map(s => ({ ...s })), inserted: false }

      const criados = rows.map(r => ({
        ...r, id: db.novoId('step'), tenant_id: tenantId, production_id: productionId,
      }))
      db.steps.push(...criados)
      return { rows: criados.map(s => ({ ...s })), inserted: true }
    },

    async updateStep(id, patch) {
      const s = db.steps.find(x => x.id === id)
      if (s) Object.assign(s, patch)
    },

    async insertJob(job) {
      await cede()
      if (db.jobs.some(j => j.dedupe_key === job.dedupe_key)) return null
      if (db.jobs.some(j => j.step_id === job.step_id && (j.status === 'pending' || j.status === 'running'))) return null
      const criado: JobRow = { ...job, id: db.novoId('job'), tenant_id: tenantId, production_id: productionId }
      db.jobs.push(criado)
      return { ...criado }
    },

    async claimNextJob() { return null },
    async completeJob() { return true },
    async failJob() {},
    async recoverStaleJobs() { return 0 },

    async emitEvent(input: EmitEventInput) {
      const p = db.producao(input.productionId)
      p.next_event_seq += 1
      db.events.push({
        id: db.novoId('evt'), tenant_id: p.tenant_id, production_id: p.id,
        step_id: input.stepId ?? null, agent_key: input.agentKey ?? null,
        type: input.type, schema_version: 1, seq: p.next_event_seq,
        payload: input.payload ?? {}, ui_hint: input.uiHint ?? null,
        occurred_at: '2026-01-01T00:00:00.000Z',
      })
      return p.next_event_seq
    },
  }
}

function repoFor(db: FakeDb, tenantId: string): DemoRepo {
  return {
    async listDemos(): Promise<DemoRow[]> {
      await cede()
      return db.productions
        .filter(p => p.tenant_id === tenantId && p.pipeline_key === DEMO_PIPELINE_KEY)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(p => ({ id: p.id, status: p.status, pipeline_key: p.pipeline_key, brief: p.brief, created_at: p.created_at }))
    },
    async insertDemo(): Promise<DemoRow> {
      await cede()
      const p = db.criarProducao(tenantId)
      return { id: p.id, status: p.status, pipeline_key: p.pipeline_key, brief: p.brief, created_at: p.created_at }
    },
    async cancelDemos(ids) {
      await cede()
      for (const id of ids) {
        const p = db.productions.find(x => x.id === id)
        if (p) p.status = 'canceled'
      }
    },
    async materialize(productionId) {
      await startProduction(storeFor(db, tenantId, productionId), productionId)
    },
  }
}

// ─── O teste concorrente pedido ─────────────────────────────────────────────

async function cenarioConcorrente(mesmoInstante: boolean) {
  const db = new FakeDb(mesmoInstante)
  const repo = () => repoFor(db, 'tenant-A')

  // Duas chamadas realmente simultâneas.
  const [a, b] = await Promise.all([
    ensureDemoProduction(repo()),
    ensureDemoProduction(repo()),
  ])
  return { db, a, b }
}

test('duas chamadas simultâneas devolvem a MESMA produção', async () => {
  for (const mesmoInstante of [false, true]) {
    const { a, b } = await cenarioConcorrente(mesmoInstante)
    assert.equal(a.productionId, b.productionId, `divergiram (empate=${mesmoInstante})`)
  }
})

test('existe uma única produção ativa; as demais ficam canceladas', async () => {
  const { db, a } = await cenarioConcorrente(false)

  const ativas = db.productions.filter(p => p.status !== 'canceled')
  assert.equal(ativas.length, 1, `esperava 1 ativa, achei ${ativas.length}`)
  assert.equal(ativas[0].id, a.productionId)

  const canceladas = db.productions.filter(p => p.status === 'canceled')
  assert.equal(db.productions.length, ativas.length + canceladas.length)
})

test('somente a vencedora tem steps', async () => {
  const { db, a } = await cenarioConcorrente(false)

  assert.equal(db.stepsDe(a.productionId).length, 3, 'a vencedora precisa dos 3 passos')
  for (const p of db.productions.filter(p => p.id !== a.productionId)) {
    assert.equal(db.stepsDe(p.id).length, 0, `perdedora ${p.id} tem steps`)
  }
  assert.equal(db.steps.length, 3, 'nenhum step duplicado no banco inteiro')
})

test('somente a vencedora tem jobs', async () => {
  const { db, a } = await cenarioConcorrente(false)

  assert.equal(db.jobsDe(a.productionId).length, 1, 'só o primeiro passo é enfileirado')
  for (const p of db.productions.filter(p => p.id !== a.productionId)) {
    assert.equal(db.jobsDe(p.id).length, 0, `perdedora ${p.id} tem job`)
  }
  assert.equal(db.jobs.length, 1, 'nenhum job duplicado')
})

test('somente a vencedora tem eventos de execução', async () => {
  const { db, a } = await cenarioConcorrente(false)

  const daVencedora = db.eventosDe(a.productionId)
  assert.ok(daVencedora.length > 0)
  assert.deepEqual(
    daVencedora.map(e => e.type),
    ['production_created', 'agent_queued'],
    'a vencedora nasce com exatamente estes eventos',
  )

  for (const p of db.productions.filter(p => p.id !== a.productionId)) {
    assert.equal(db.eventosDe(p.id).length, 0, `perdedora ${p.id} emitiu evento`)
    assert.equal(db.producao(p.id).next_event_seq, 0, `perdedora ${p.id} moveu o contador`)
  }
})

test('a perdedora fica cancelada e completamente inerte', async () => {
  const { db, a } = await cenarioConcorrente(false)

  const perdedoras = db.productions.filter(p => p.id !== a.productionId)
  assert.ok(perdedoras.length >= 1, 'o cenário precisa produzir ao menos uma perdedora')

  for (const p of perdedoras) {
    assert.equal(p.status, 'canceled', 'perdedora precisa estar cancelada')
    assert.equal(db.stepsDe(p.id).length, 0)
    assert.equal(db.jobsDe(p.id).length, 0)
    assert.equal(db.eventosDe(p.id).length, 0)
    assert.equal(p.next_event_seq, 0)
    // Cancelamento é lógico: a linha continua existindo para auditoria.
    assert.ok(db.productions.some(x => x.id === p.id), 'nada pode ser apagado')
  }
})

test('a chamada perdedora recebe a vencedora, não um erro', async () => {
  const { a, b } = await cenarioConcorrente(false)
  const perdedora = [a, b].find(r => r.canceled.length > 0)
  assert.ok(perdedora, 'uma das chamadas deve ter cancelado a própria')
  assert.notEqual(perdedora!.productionId, perdedora!.canceled[0], 'devolveu a vencedora')
})

test('cinco chamadas simultâneas ainda produzem uma única demonstração viva', async () => {
  const db = new FakeDb(true)   // todas no mesmo instante: pior caso
  const rs = await Promise.all(
    Array.from({ length: 5 }, () => ensureDemoProduction(repoFor(db, 'tenant-A'))),
  )

  const ids = new Set(rs.map(r => r.productionId))
  assert.equal(ids.size, 1, 'todas devem convergir para a mesma')

  const ativas = db.productions.filter(p => p.status !== 'canceled')
  assert.equal(ativas.length, 1)
  assert.equal(db.steps.length, 3, 'exatamente 3 steps no total')
  assert.equal(db.jobs.length, 1, 'exatamente 1 job no total')
  assert.equal(db.eventosDe(ativas[0].id).length, 2)
  assert.equal(db.events.length, 2, 'nenhum evento de perdedora')
})

test('a segunda chamada NÃO cria outra produção quando já existe uma aberta', async () => {
  const db = new FakeDb(false)
  const primeira = await ensureDemoProduction(repoFor(db, 'tenant-A'))
  const segunda = await ensureDemoProduction(repoFor(db, 'tenant-A'))

  assert.equal(segunda.productionId, primeira.productionId)
  assert.equal(segunda.reused, true, 'reaproveitou em vez de inserir')
  assert.equal(db.productions.length, 1, 'nenhuma produção extra foi criada')
  assert.equal(db.steps.length, 3)
  assert.equal(db.jobs.length, 1)
  assert.equal(db.events.length, 2, 'nenhum evento duplicado')
})

test('tenants diferentes não interferem entre si', async () => {
  const db = new FakeDb(true)
  const [a, b] = await Promise.all([
    ensureDemoProduction(repoFor(db, 'tenant-A')),
    ensureDemoProduction(repoFor(db, 'tenant-B')),
  ])

  assert.notEqual(a.productionId, b.productionId, 'cada tenant tem a sua')
  assert.equal(db.producao(a.productionId).tenant_id, 'tenant-A')
  assert.equal(db.producao(b.productionId).tenant_id, 'tenant-B')
  assert.equal(db.productions.filter(p => p.status !== 'canceled').length, 2)
  assert.equal(db.steps.length, 6, '3 para cada tenant')
})

// ─── A ordem, verificada no código ──────────────────────────────────────────

test('a materialização vem DEPOIS da eleição e do cancelamento', () => {
  const src = readFileSync(join(RAIZ, 'src/lib/content-studio/demo-runner.ts'), 'utf8')
  const corpo = src.slice(src.indexOf('export async function ensureDemoProduction'))

  // Caminho de criação: começa em insertDemo (antes dele há o atalho de
  // reaproveitamento, que nem chega a inserir).
  const criacao = corpo.slice(corpo.indexOf('repo.insertDemo()'))
  const ordem = ['listDemos(', 'pickWinningDemo(', 'cancelDemos(', 'materialize(']
  let pos = -1
  for (const marca of ordem) {
    const i = criacao.indexOf(marca)
    assert.ok(i > pos, `"${marca}" fora de ordem no caminho de criação`)
    pos = i
  }

  // E o atalho de reaproveitamento não insere nada.
  const atalho = corpo.slice(0, corpo.indexOf('repo.insertDemo()'))
  assert.ok(!atalho.includes('insertDemo('), 'o atalho não pode inserir')
  assert.ok(!atalho.includes('cancelDemos('), 'o atalho não cancela nada')

  // A materialização é literalmente o último passo antes do retorno.
  const depois = corpo.slice(corpo.lastIndexOf('materialize('))
  assert.ok(!depois.includes('insertDemo('), 'nada é inserido depois de materializar')
  assert.ok(!depois.includes('cancelDemos('), 'nada é cancelado depois de materializar')
})

test('a action delega a criação para ensureDemoProduction', () => {
  const actions = readFileSync(join(RAIZ, 'src/app/actions/content-studio.ts'), 'utf8')
  assert.ok(actions.includes('await ensureDemoProduction(supabaseDemoRepo(admin, tenantId))'))
  // materialize é o único ponto da action que inicia produção.
  const ocorrencias = (actions.match(/startProduction\(/g) ?? []).length
  assert.equal(ocorrencias, 1, 'startProduction só pode ser chamado em materialize')
  const materialize = actions.slice(actions.indexOf('async materialize('))
  assert.ok(materialize.includes('startProduction(store, productionId)'))
})

// ─── Demonstração forjada pelo cliente ──────────────────────────────────────

test('produção forjada pelo cliente fica presa ao pipeline stub, sem custo', async () => {
  const pipeline = readFileSync(join(RAIZ, 'src/lib/content-studio/pipeline.ts'), 'utf8')
  const office = readFileSync(join(RAIZ, 'src/lib/content-studio/agents/office.ts'), 'utf8')
  const registry = readFileSync(join(RAIZ, 'src/lib/content-studio/agents/registry.ts'), 'utf8')

  // 1. `office_demo_v1` só pode executar estes três agentes.
  assert.deepEqual(
    OFFICE_PIPELINE.steps.map(s => s.agentKey),
    ['researcher', 'strategist', 'copywriter'],
  )
  assert.equal(OFFICE_PIPELINE.key, DEMO_PIPELINE_KEY)

  // 2. Os três são stubs sem provedor externo. (Comentários fora: o que o
  //    código promete não é o que ele faz.)
  const semComentarios = office
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.ok(!/\bfetch\s*\(/.test(semComentarios))
  assert.ok(!/anthropic|openai|resend|graph\./i.test(semComentarios))
  assert.ok(!semComentarios.includes('process.env'), 'stub não lê credencial')
  assert.equal((office.match(/costCents: 0/g) ?? []).length, 3, 'os três declaram custo zero')

  // 3. Nenhum agente com IA está registrado — não há o que o pipeline alcance.
  assert.ok(!/anthropic|openai/i.test(registry))

  // 4. Existem outros pipelines (a Fase 2A acrescentou o de produção), e a
  //    garantia que importa não é a CONTAGEM: é que a demonstração continua
  //    presa ao seu, e que NENHUM pipeline alcança um agente com IA.
  const chaves = [...pipeline.matchAll(/key: '([^']+)'/g)].map(m => m[1])
  assert.ok(chaves.includes('office_demo_v1') && chaves.includes('stub_v1'))
  assert.equal(DEMO_PIPELINE_KEY, 'office_demo_v1',
    'a demonstração mudou de pipeline — o guard precisa acompanhar')

  // Todo agente registrado é determinístico e declara custo zero.
  const carrossel = readFileSync(
    join(RAIZ, 'src/lib/content-studio/agents/carousel.ts'), 'utf8')
  const carrosselSemComentarios = carrossel
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.ok(!/\bfetch\s*\(/.test(carrosselSemComentarios))
  assert.ok(!/anthropic|openai|claude|gpt/i.test(carrosselSemComentarios))
  assert.ok(!carrosselSemComentarios.includes('process.env'))
})

test('mesmo forjando o brief, o cliente não escolhe o pipeline', () => {
  const migration = readFileSync(
    join(RAIZ, 'supabase/migrations/20260730000000_content_studio_phase1.sql'), 'utf8')

  // O cliente até pode inserir em cs_productions — o GRANT por coluna permite
  // tenant_id, pipeline_key, title e brief. Mas a RLS obriga a nascer 'draft'
  // no PRÓPRIO tenant, e advanceDemo só admite office_demo_v1 marcado como
  // demonstração. Ou seja: o máximo que ele forja é outra demonstração dele.
  assert.ok(migration.includes('GRANT INSERT (tenant_id, pipeline_key, title, brief)'))
  assert.ok(migration.includes("AND status = 'draft'"))
  assert.ok(migration.includes('tenant_id = current_tenant_id()'))

  // E não há política de UPDATE/DELETE: ele não muda o status depois.
  assert.ok(!/CREATE POLICY[^;]*FOR UPDATE TO authenticated/.test(migration))
  assert.ok(!/CREATE POLICY[^;]*FOR DELETE TO authenticated/.test(migration))
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
