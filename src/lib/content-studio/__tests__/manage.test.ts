// ============================================================================
// Content Studio — gerenciamento e remoção segura de produções (soft delete)
// ----------------------------------------------------------------------------
// O que se prova: remover é `canceled` (nunca DELETE), a cota abre na hora, a
// produção cancelada não avança, não gera imagem, não chama IA e não é
// ressuscitada pelo cron; a ação em massa só alcança produções ABERTAS do
// tenant da sessão; a UI oferece o caminho (Gerenciar) sem window.confirm.
//
// Nenhum teste chama API real: providers falsos em tudo.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { __setContentAIProviderForTests, type ContentAIProvider } from '../ai/provider'
import { __setStudioImageProviderForTests, type StudioImageProvider } from '../images/provider'
import { runStudioSlideImage, type StudioImageStorage } from '../images/run'
import { runStudioCarousel } from '../studio/run'
import { runNextJob, startProduction } from '../orchestrator'
import { __registerAgentForTests } from '../agents/registry'
import {
  admitProduction, isOpenProduction, MAX_OPEN_PRODUCTIONS, PRODUCTION_PIPELINE_KEYS,
  PRODUCTION_TERMINAL, safeProductionMessage,
} from '../production-guard'
import { ensureProduction, type ProductionRepo, type ProductionRowLite } from '../production-runner'
import { validateStudioInput, STUDIO_PIPELINE_KEY } from '../studio/schema'
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

const actions = ler('src/app/actions/content-production.ts')
const actionsCode = semComentarios(actions)
const preview = ler('src/components/content-studio/office-preview.tsx')

// ─── Store em memória (índice único + CAS, como nas demais suítes) ──────────

class MemStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0

  criar(id: string, pipelineKey: string, status: ProductionStatus, tenant = 'tenant-A'): ProductionRow {
    const p: ProductionRow = {
      id, tenant_id: tenant, pipeline_key: pipelineKey, title: id,
      brief: { slides: 6 }, status, next_event_seq: 0, created_by: null,
      created_at: `2026-01-0${(this.n % 8) + 1}T00:00:00.000Z`, updated_at: 'z',
    }
    this.n++
    this.productions.set(p.id, p)
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
      const existentes = this.steps.filter(s => rows.some(r => r.step_index === s.step_index && r.production_id === s.production_id))
      return { rows: existentes.map(s => ({ ...s })), inserted: false }
    }
    const criados = rows.map(r => ({ ...r, id: `step-${++this.n}` }))
    this.steps.push(...criados)
    return { rows: criados.map(s => ({ ...s })), inserted: true }
  }
  async updateStep(id: string, patch: Partial<StepRow>) {
    const st = this.steps.find(x => x.id === id); if (st) Object.assign(st, patch)
  }
  async transitionStepStatus(id: string, expected: readonly StepRow['status'][], patch: Partial<StepRow> & { status: StepRow['status'] }) {
    const st = this.steps.find(x => x.id === id)
    if (!st || !expected.includes(st.status)) return false
    Object.assign(st, patch)
    return true
  }
  async insertJob(job: Omit<JobRow, 'id'>) {
    if (this.jobs.some(j => j.dedupe_key === job.dedupe_key)) return null
    const criado: JobRow = { ...job, id: `job-${++this.n}` }
    this.jobs.push(criado)
    return { ...criado }
  }
  async claimNextJob(now: Date, lockToken: string, lockSeconds: number) {
    for (const j of this.jobs) {
      if (j.status !== 'pending' || new Date(j.scheduled_for) > now) continue
      j.status = 'running'; j.lock_token = lockToken
      j.locked_until = new Date(now.getTime() + lockSeconds * 1000).toISOString()
      return { ...j }
    }
    return null
  }
  async completeJob(id: string, token: string) {
    const j = this.jobs.find(x => x.id === id)
    if (!j || j.lock_token !== token) return false
    j.status = 'done'; return true
  }
  async failJob(id: string, token: string, err: string, retryAt: Date | null) {
    const j = this.jobs.find(x => x.id === id)
    if (!j || j.lock_token !== token) return
    j.error = err; j.lock_token = null
    if (retryAt) { j.status = 'pending'; j.attempt++; j.scheduled_for = retryAt.toISOString() }
    else j.status = 'failed'
  }
  async recoverStaleJobs() { return 0 }
  async emitEvent(i: EmitEventInput) {
    const p = this.productions.get(i.productionId)!
    p.next_event_seq += 1
    this.events.push({
      id: `ev-${p.next_event_seq}`, tenant_id: p.tenant_id, production_id: p.id,
      step_id: i.stepId ?? null, agent_key: i.agentKey ?? null, type: i.type,
      schema_version: 1, seq: p.next_event_seq, payload: i.payload ?? {},
      ui_hint: i.uiHint ?? null, occurred_at: '2026-01-01T00:00:00.000Z',
    })
    return p.next_event_seq
  }
}

function briefStudio() {
  const v = validateStudioInput({ tema: 'organizar leads', slides: 6, idempotencyKey: 'managetest0001' })
  if (!v.ok) throw new Error('brief inválido')
  return v.brief
}

const providerAnthropicProibido: ContentAIProvider = {
  async call() { throw new Error('TESTE: Anthropic chamado durante remoção/cancelamento') },
}
const providerImagemProibido: StudioImageProvider = {
  async generate() { throw new Error('TESTE: OpenAI chamado durante remoção/cancelamento') },
}
const storageNulo: StudioImageStorage = {
  async upload() { throw new Error('TESTE: storage tocado durante remoção') },
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Servidor: soft delete, tenant e idempotência (código das actions)
// ════════════════════════════════════════════════════════════════════════════

test('1) as ações exigem sessão e resolvem o tenant no servidor', () => {
  for (const nome of ['removeContentProduction', 'removeAllOpenContentProductions']) {
    const corpo = actionsCode.slice(actionsCode.indexOf(`export async function ${nome}`)).split('\nexport ')[0]
    assert.ok(corpo.includes('await currentTenantId()'), `${nome} sem tenant da sessão`)
    assert.ok(corpo.includes("fail('unauthenticated')"), `${nome} sem recusa de sessão`)
    assert.ok(corpo.includes(".eq('tenant_id', tenantId)"), `${nome} sem escopo de tenant`)
  }
  // A individual só recebe productionId; nenhuma aceita status/pipeline/IDs de steps.
  assert.ok(actionsCode.includes('export async function removeContentProduction(productionId: string)'))
  assert.ok(actionsCode.includes('export async function removeAllOpenContentProductions()'))
})

test('2) remover é SOFT DELETE: canceled via CAS, nenhum DELETE físico', () => {
  const individual = actionsCode.slice(actionsCode.indexOf('export async function removeContentProduction')).split('\nexport ')[0]
  assert.ok(individual.includes("transitionProductionStatus("), 'sem transição atômica')
  assert.ok(individual.includes("'canceled'"), 'não usa o status canceled existente')
  assert.ok(individual.includes('wrong_pipeline'), 'pipeline desconhecido não é recusado')

  // NENHUM delete físico em lugar algum das actions ou da camada de imagens.
  const fontes = [actionsCode, semComentarios(ler('src/lib/content-studio/store.ts'))].join('\n')
  assert.ok(!/\.delete\(\)/.test(fontes), 'DELETE físico encontrado')
  assert.ok(!/storage[\s\S]{0,40}\.remove\(/.test(fontes), 'remoção de arquivo do Storage encontrada')
  assert.ok(!/DROP |TRUNCATE |DELETE FROM/i.test(fontes), 'SQL destrutivo encontrado')
})

test('3) idempotência: já cancelada devolve sucesso seguro sem transição', () => {
  const individual = actionsCode.slice(actionsCode.indexOf('export async function removeContentProduction')).split('\nexport ')[0]
  // O caminho "já canceled" não tenta transicionar de novo (removed=0).
  assert.ok(individual.includes("candidata.status !== 'canceled'"), 'replay não é curto-circuitado')
  // E o CAS em memória confirma: canceled -> canceled não transiciona.
  const store = new MemStore()
  store.criar('p1', STUDIO_PIPELINE_KEY, 'canceled')
  return store.transitionProductionStatus('p1', ['draft', 'running'], 'canceled').then(v => {
    assert.equal(v, false)
  })
})

test('4) a ação em massa seleciona no SERVIDOR só as ABERTAS (isOpenProduction)', () => {
  const massa = actionsCode.slice(actionsCode.indexOf('export async function removeAllOpenContentProductions')).split('\nexport ')[0]
  assert.ok(massa.includes('filter(isOpenProduction)'), 'não usa a semântica de aberta')
  assert.ok(massa.includes('PRODUCTION_TERMINAL'), 'terminais não são excluídas do predicado')
  // O predicado se repete NA UPDATE — entre a leitura e a escrita nada muda de mão.
  const updates = massa.split('.update(')
  assert.ok(updates.length >= 2 && updates[1].includes("not('status', 'in'"), 'UPDATE sem predicado de status')
  assert.ok(!/removeAllOpenContentProductions\([^)]*productionId/.test(actionsCode), 'a ação em massa recebe IDs do cliente')
})

test('5) semântica de aberta: awaiting_approval NÃO é cancelada pela massa', () => {
  const linhas: ProductionRowLite[] = [
    { id: 'a', status: 'running', pipeline_key: 'content_carousel_v1', brief: {}, created_at: '1' },
    { id: 'b', status: 'awaiting_approval', pipeline_key: STUDIO_PIPELINE_KEY, brief: {}, created_at: '2' },
    { id: 'c', status: 'approved', pipeline_key: STUDIO_PIPELINE_KEY, brief: {}, created_at: '3' },
    { id: 'd', status: 'published', pipeline_key: 'content_carousel_quick_v1', brief: {}, created_at: '4' },
    { id: 'e', status: 'draft', pipeline_key: STUDIO_PIPELINE_KEY, brief: {}, created_at: '5' },
  ]
  const abertas = linhas.filter(isOpenProduction).map(l => l.id)
  assert.deepEqual(abertas, ['a', 'e'], 'a massa alcançaria produções terminais')
  // Mas a REMOÇÃO INDIVIDUAL alcança awaiting_approval (Remover da lista).
  assert.ok(PRODUCTION_TERMINAL.includes('awaiting_approval'))
  const individual = actionsCode.slice(actionsCode.indexOf('const REMOVABLE_STATUSES')).split('\n]')[0]
  assert.ok(individual.includes("'awaiting_approval'"), 'terminal não pode ser removida individualmente')
  assert.ok(!individual.includes("'canceled'"), 'canceled entre os removíveis quebraria a idempotência')
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Cota liberada e lista limpa
// ════════════════════════════════════════════════════════════════════════════

test('6) canceled sai da lista, não conta para a cota e libera criação', async () => {
  // Três abertas = cota cheia.
  const abertas: ProductionRowLite[] = [
    { id: 'a', status: 'running', pipeline_key: 'content_carousel_v1', brief: {}, created_at: '1' },
    { id: 'b', status: 'running', pipeline_key: 'content_carousel_quick_v1', brief: {}, created_at: '2' },
    { id: 'c', status: 'running', pipeline_key: STUDIO_PIPELINE_KEY, brief: {}, created_at: '3' },
  ]
  assert.equal(abertas.filter(isOpenProduction).length, MAX_OPEN_PRODUCTIONS)

  // Cancelar UMA delas abre a vaga imediatamente.
  const depois = abertas.map(p => p.id === 'b' ? { ...p, status: 'canceled' as ProductionStatus } : p)
  assert.equal(depois.filter(isOpenProduction).length, MAX_OPEN_PRODUCTIONS - 1)

  // E ensureProduction agora ACEITA uma nova produção.
  let inseriu = false
  const repo: ProductionRepo = {
    async findByIdempotencyKey() { return [] },
    async listOpen() { return depois.filter(isOpenProduction) },
    async insert(brief) {
      inseriu = true
      return { id: 'nova', status: 'draft', pipeline_key: STUDIO_PIPELINE_KEY, brief, created_at: '9' }
    },
    async cancel() { /* noop */ },
    async materialize() { /* noop */ },
  }
  const r = await ensureProduction(repo, briefStudio(), ['tema'])
  assert.equal(r.ok, true)
  assert.equal(inseriu, true, 'a vaga não abriu após o cancelamento')

  // listProductions e listAfterRemoval escondem canceled na QUERY.
  assert.ok((actionsCode.match(/\.neq\('status', 'canceled'\)/g) ?? []).length >= 2,
    'alguma listagem não filtra canceled')
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Cancelada não processa mais NADA
// ════════════════════════════════════════════════════════════════════════════

test('7) cancelada não é avançável nem continuável — e nunca chama a IA', async () => {
  const row = { id: 'p', status: 'canceled' as ProductionStatus, pipeline_key: STUDIO_PIPELINE_KEY, brief: {} }
  const admissao = admitProduction(row)
  assert.equal(admissao.ok, false)
  assert.equal(admissao.ok === false && admissao.reason, 'not_advanceable')

  // runStudioCarousel numa cancelada com steps completos NÃO ressuscita o
  // status: o CAS de finalização exige draft/queued/running.
  __setContentAIProviderForTests(providerAnthropicProibido)
  const store = new MemStore()
  const p = store.criar('p', STUDIO_PIPELINE_KEY, 'canceled')
  const dados = { ok: true }
  ;['cst_strategist', 'cst_copywriter', 'cst_designer'].forEach((k, i) => {
    store.steps.push({
      id: `s${i}`, production_id: 'p', tenant_id: 'tenant-A', agent_key: k, step_index: i,
      depends_on: [], status: 'completed', input: null,
      output: { data: dados, artifacts: [], usage: undefined },
      attempt: 0, error: null, started_at: 'x', completed_at: 'x',
    })
  })
  const r = await runStudioCarousel(store, p, briefStudio())
  assert.equal(r.state, 'reused')
  assert.equal(store.productions.get('p')!.status, 'canceled', 'a produção ressuscitou')
  assert.equal(store.events.filter(e => e.type === 'content_waiting_approval').length, 0)
})

test('8) cancelada não gera nem regenera imagem — OpenAI intocada', async () => {
  // A action recusa ANTES do runner: canceled/failed não recebem arte nova.
  const carga = actionsCode.slice(actionsCode.indexOf('async function loadStudioProductionForImages')).split('\nexport ')[0]
  assert.ok(carga.includes("'canceled'"), 'a carga de imagens não recusa canceled')

  // E mesmo que algo chegasse ao runner, o provider proibido explodiria o
  // teste — aqui provamos que a validação de texto/steps segura primeiro.
  __setStudioImageProviderForTests(providerImagemProibido)
  const store = new MemStore()
  const p = store.criar('p', STUDIO_PIPELINE_KEY, 'canceled')
  const r = await runStudioSlideImage(store, storageNulo, p, 1)
  assert.equal(r.state, 'invalid')
  assert.equal(store.steps.length, 0)
})

test('9) jobs pending de produção cancelada morrem no claim — sem agente, sem retry', async () => {
  // Agente registrado que EXPLODE se rodar: prova que o cron não ressuscita.
  __registerAgentForTests({
    key: 'stub_a',
    version: 'test',
    async run() { throw new Error('TESTE: agente executou para produção cancelada') },
  } as never)

  const store = new MemStore()
  const p = store.criar('p', 'stub_v1', 'running')
  store.steps.push({
    id: 'st', production_id: 'p', tenant_id: 'tenant-A', agent_key: 'stub_a', step_index: 0,
    depends_on: [], status: 'queued', input: null, output: null, attempt: 0,
    error: null, started_at: null, completed_at: null,
  })
  store.jobs.push({
    id: 'j1', tenant_id: 'tenant-A', production_id: 'p', step_id: 'st',
    status: 'pending', attempt: 0, max_attempts: 3, scheduled_for: '2020-01-01T00:00:00.000Z',
    locked_until: null, lock_token: null, dedupe_key: 'd1', error: null,
  } as JobRow)

  // A produção é cancelada DEPOIS do job entrar na fila.
  p.status = 'canceled'

  const outcome = await runNextJob(store)
  assert.equal(outcome.status, 'failed')
  const job = store.jobs.find(j => j.id === 'j1')!
  assert.equal(job.status, 'failed', 'o job não terminou')
  assert.equal(job.error, 'produção cancelada')
  // Terminal: sem reagendamento, o cron seguinte não o vê como pending.
  const segunda = await runNextJob(store)
  assert.equal(segunda.status, 'idle')
  assert.equal(store.productions.get('p')!.status, 'canceled', 'o cron ressuscitou a produção')
})

test('10) startProduction recusa produção cancelada', async () => {
  const store = new MemStore()
  store.criar('p', 'stub_v1', 'canceled')
  await assert.rejects(() => startProduction(store, 'p'), /production_not_startable/)
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Interface
// ════════════════════════════════════════════════════════════════════════════

test('11) botão Gerenciar ao lado do seletor, acessível no mobile', () => {
  assert.ok(preview.includes('aria-label="Gerenciar produções"'), 'sem texto acessível')
  assert.ok(preview.includes('setGerenciando(true)'), 'o botão não abre o painel')
  // Ícone no mobile, texto no desktop.
  assert.ok(preview.includes('hidden sm:inline'), 'sem variante mobile')
})

test('12) modal próprio (sem window.confirm), com confirmações distintas', () => {
  assert.ok(!semComentarios(preview).includes('window.confirm'), 'window.confirm usado')
  assert.ok(preview.includes('role="dialog"') && preview.includes('aria-modal="true"'))
  assert.ok(preview.includes('animate-modal-in'), 'não reutiliza o padrão visual de modal')
  // Textos exigidos:
  assert.ok(preview.includes('Cancelar e remover esta produção?'))
  assert.ok(preview.includes('O processamento será interrompido e ela sumirá da lista.'))
  assert.ok(preview.includes('Remover esta produção da lista?'))
  assert.ok(preview.includes('O histórico será preservado no sistema.'))
  assert.ok(preview.includes('A produção será removida da lista e não continuará sendo processada.'))
  assert.ok(preview.includes('produções em andamento?') || preview.includes('em andamento?'))
  assert.ok(preview.includes('Elas não continuarão sendo processadas.'))
  assert.ok(preview.includes('Voltar') && preview.includes('Confirmar remoção'))
  // Rótulos por tipo:
  assert.ok(preview.includes("'Cancelar e remover'") || preview.includes('>Cancelar e remover<'))
  assert.ok(preview.includes("'Remover da lista'") || preview.includes('>Remover da lista<'))
  assert.ok(preview.includes('Limpar todas em andamento'))
  // Mobile: painel ancorado embaixo; desktop: centralizado.
  assert.ok(preview.includes('items-end') && preview.includes('sm:items-center'))
})

test('13) só ABERTAS ganham "Cancelar e remover"; terminais, "Remover da lista"', () => {
  // A distinção na UI usa a MESMA fonte de verdade do servidor.
  assert.ok(preview.includes('PRODUCTION_TERMINAL.includes(p.status)'),
    'a UI inventou a própria noção de aberta')
})

test('14) após remover: lista, seleção e tela atualizam sem refresh; toast', () => {
  const codigo = semComentarios(preview)
  const aplicar = codigo.slice(codigo.indexOf('const aplicarRemocao'), codigo.indexOf('const removerProducao'))
  assert.ok(aplicar.includes('setProducoes(dados.productions)'), 'o seletor não atualiza')
  assert.ok(aplicar.includes('Produção removida. Agora você pode criar outra.'), 'sem toast')
  assert.ok(aplicar.includes('limparTela()'), 'sem estado vazio quando tudo é removido')
  assert.ok(aplicar.includes('dados.productions[0]'), 'não seleciona a mais recente restante')
  // Nenhum reload forçado.
  assert.ok(!codigo.includes('location.reload'), 'refresh manual embutido')
})

test('15) a mensagem de limite ganhou o caminho: botão Gerenciar produções', () => {
  assert.equal(
    safeProductionMessage('too_many_open'),
    'Você já tem 3 produções em andamento. Remova ou conclua uma para criar outra.',
  )
  assert.ok(preview.includes("safeProductionMessage('too_many_open')"), 'a UI não reconhece o limite')
  assert.ok(preview.includes('Gerenciar produções'), 'sem botão ao lado do aviso')
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Regressões
// ════════════════════════════════════════════════════════════════════════════

test('16) produções antigas seguem legíveis ANTES de removidas; nada muda nelas', () => {
  // As quatro gerações continuam na lista branca de leitura/remoção.
  assert.deepEqual([...PRODUCTION_PIPELINE_KEYS], [
    'content_carousel_v1', 'content_carousel_ai_v1', 'content_carousel_quick_v1',
    'content_carousel_studio_v1',
  ])
  // A remoção não toca steps/outputs: as actions de remoção não escrevem em
  // cs_steps nem em cs_events.
  // Âncoras de CÓDIGO (comentários são removidos): o bloco de remoção vai de
  // REMOVABLE_STATUSES até a primeira função da seção de imagens.
  const remover = actionsCode.slice(
    actionsCode.indexOf('const REMOVABLE_STATUSES'),
    actionsCode.indexOf('function studioImageStorage'),
  )
  assert.ok(!remover.includes("from('cs_steps')"), 'a remoção mexe em steps')
  assert.ok(!remover.includes("from('cs_events')"), 'a remoção mexe em eventos')
  assert.ok(!remover.includes('storage'), 'a remoção toca o Storage')
})

test('17) R1 intacto; CRON_AUTH_ENFORCE continua opcional; nenhuma migration', () => {
  assert.ok(ler('src/lib/security/cron-auth.ts').includes('timingSafeEqual'))
  assert.ok(ler('src/app/api/queue/process/route.ts').includes('evaluateCronAuth'))
  assert.ok(ler('src/lib/security/cron-auth.ts').includes('CRON_AUTH_ENFORCE'))
  const remover = actionsCode.slice(actionsCode.indexOf('const REMOVABLE_STATUSES'))
  assert.ok(!/CREATE TABLE|ALTER TABLE|exec_sql/i.test(remover), 'SQL/migration na remoção')
  // Nenhum status de job inventado: só os que o schema já conhece.
  assert.ok(!/'paused'|'cancelled'|'aborted'/.test(actionsCode), 'status de job inventado')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (err) { results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) }) }
    finally {
      __setContentAIProviderForTests(null)
      __setStudioImageProviderForTests(null)
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
