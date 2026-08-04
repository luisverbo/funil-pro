// ============================================================================
// Testes do Office Preview V2 (camada visual)
// ----------------------------------------------------------------------------
// Nada de banco, nada de rede. A cena é derivada de eventos reais produzidos
// pelo orquestrador em memória — os mesmos que o backend gravaria em cs_events.
//
// O que estes testes protegem: a promessa de que a animação é DIRIGIDA pelos
// eventos. Se alguém trocar a posição do personagem por um timer, os casos de
// posição e handoff quebram.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { drainQueue, startProduction } from '../orchestrator'
import { OFFICE_PIPELINE } from '../pipeline'
import { __registerAgentForTests, getAgent } from '../agents/registry'
import {
  buildOfficeView,
  emptyOfficeView,
  productionStatusLabel,
  PRODUCTION_STATUS_LABEL,
  OFFICE_AGENT_ORDER,
} from '../view-model'
import type {
  ContentStore, EmitEventInput, JobRow, ProductionRow, StepRow, StoredEvent,
} from '../types'

const RAIZ = process.cwd()
const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

const cena = readFileSync(join(RAIZ, 'src/components/content-studio/office-scene.tsx'), 'utf8')
const avatar = readFileSync(join(RAIZ, 'src/components/content-studio/agent-avatar.tsx'), 'utf8')
const ui = readFileSync(join(RAIZ, 'src/components/content-studio/office-preview.tsx'), 'utf8')
const timeline = readFileSync(join(RAIZ, 'src/components/content-studio/timeline-panel.tsx'), 'utf8')

// ─── Store em memória ───────────────────────────────────────────────────────

class MemoryStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0

  createProduction(): ProductionRow {
    const p: ProductionRow = {
      id: 'prod-1', tenant_id: 'tenant-A', pipeline_key: OFFICE_PIPELINE.key,
      title: 'Demo', brief: { tema: 'x', publico: 'y' }, status: 'draft',
      next_event_seq: 0, created_by: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }
    this.productions.set(p.id, p)
    return p
  }

  async getProduction(id: string) { return this.productions.get(id) ?? null }
  async updateProductionStatus(id: string, status: ProductionRow['status']) {
    const p = this.productions.get(id); if (p) p.status = status
  }
  async listSteps(pid: string) { return this.steps.filter(s => s.production_id === pid).map(s => ({ ...s })) }
  async insertSteps(rows: Omit<StepRow, 'id'>[]) {
    const jaTem = this.steps.filter(s => s.production_id === rows[0]?.production_id)
    if (jaTem.length > 0) return { rows: jaTem.map(s => ({ ...s })), inserted: false }
    const created = rows.map(r => ({ ...r, id: `step-${++this.n}` }))
    this.steps.push(...created)
    return { rows: created.map(s => ({ ...s })), inserted: true }
  }
  async updateStep(id: string, patch: Partial<StepRow>) {
    const s = this.steps.find(x => x.id === id); if (s) Object.assign(s, patch)
  }
  async insertJob(job: Omit<JobRow, 'id'>) {
    if (this.jobs.some(j => j.dedupe_key === job.dedupe_key)) return null
    if (this.jobs.some(j => j.step_id === job.step_id && (j.status === 'pending' || j.status === 'running'))) return null
    const created: JobRow = { ...job, id: `job-${++this.n}` }
    this.jobs.push(created); return { ...created }
  }
  async claimNextJob(now: Date, lockToken: string, lockSeconds: number) {
    for (const j of this.jobs.filter(j => j.status === 'pending' && new Date(j.scheduled_for) <= now)) {
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
    if (retryAt) { j.status = 'pending'; j.attempt++ } else j.status = 'failed'
  }
  async recoverStaleJobs() { return 0 }
  async emitEvent(input: EmitEventInput) {
    const p = this.productions.get(input.productionId)!
    p.next_event_seq += 1
    this.events.push({
      id: `evt-${++this.n}`, tenant_id: p.tenant_id, production_id: p.id,
      step_id: input.stepId ?? null, agent_key: input.agentKey ?? null,
      type: input.type, schema_version: 1, seq: p.next_event_seq,
      payload: input.payload ?? {}, ui_hint: input.uiHint ?? null,
      occurred_at: new Date(2026, 0, 1, 0, 0, p.next_event_seq).toISOString(),
    })
    return p.next_event_seq
  }
}

/** Roda a demonstração completa e devolve os eventos reais. */
async function eventos(): Promise<StoredEvent[]> {
  const store = new MemoryStore()
  const p = store.createProduction()
  await startProduction(store, p.id)
  await drainQueue(store, 30)
  return store.events
}

/** Estado da cena logo após o evento de índice `i`. */
function ate(ev: StoredEvent[], tipo: string, agente?: string) {
  const i = ev.findIndex(e => e.type === tipo && (!agente || e.agent_key === agente))
  assert.notEqual(i, -1, `evento ${tipo}${agente ? ` de ${agente}` : ''} não existe`)
  return buildOfficeView(ev.slice(0, i + 1))
}

// ─── 1. Todos os eventos geram o estado visual correto ──────────────────────

test('1) cada evento produz o estado visual esperado', async () => {
  const ev = await eventos()

  assert.equal(emptyOfficeView().agents[0].state, 'idle', 'sem evento, ninguém se mexe')

  const q = ate(ev, 'agent_queued', 'researcher').agents[0]
  assert.equal(q.state, 'queued')
  assert.equal(q.atDesk, 'researcher', 'na fila, fica na própria mesa')

  const s = ate(ev, 'agent_started', 'researcher').agents[0]
  assert.equal(s.state, 'working')
  assert.equal(s.carryingFolder, false)

  const pr = ate(ev, 'agent_progress', 'researcher').agents[0]
  assert.ok(pr.progress, 'progresso real vira barra')
  assert.equal(pr.progress!.total, 3)

  const c = ate(ev, 'agent_completed', 'researcher').agents[0]
  assert.equal(c.state, 'done')
  assert.equal(c.progress, null)

  // Estado final: todos concluídos, produção pronta.
  const fim = buildOfficeView(ev)
  assert.ok(fim.agents.every(a => a.state === 'done'))
  assert.equal(fim.finished, true)
  assert.equal(fim.failed, false)
  assert.ok(fim.agents.every(a => a.atDesk === a.key), 'todos terminam na própria mesa')
})

// ─── 2, 3, 4. Handoff: caminhada, pasta e retorno ──────────────────────────

test('2) o handoff leva o agente de origem até a mesa do destino', async () => {
  const ev = await eventos()
  const durante = ate(ev, 'task_handoff_started')
  const pesquisador = durante.agents.find(a => a.key === 'researcher')!

  assert.equal(pesquisador.state, 'walking')
  assert.equal(pesquisador.atDesk, 'strategist', 'a posição vira a mesa do destino')
  assert.notEqual(pesquisador.atDesk, pesquisador.key)
  assert.equal(pesquisador.handoffTo, 'strategist')
})

test('3) a pasta acompanha o agente durante a entrega', async () => {
  const ev = await eventos()

  const antes = ate(ev, 'agent_completed', 'researcher').agents.find(a => a.key === 'researcher')!
  assert.equal(antes.carryingFolder, false, 'antes de sair, sem pasta')

  const durante = ate(ev, 'task_handoff_started').agents.find(a => a.key === 'researcher')!
  assert.equal(durante.carryingFolder, true, 'saiu com a pasta')

  const depois = ate(ev, 'task_handoff_completed').agents.find(a => a.key === 'researcher')!
  assert.equal(depois.carryingFolder, false, 'entregou a pasta')

  // E quem recebeu registra o recebimento.
  const destino = ate(ev, 'task_handoff_completed').agents.find(a => a.key === 'strategist')!
  assert.equal(destino.receivedFolder, true)
})

test('4) o agente volta à própria mesa depois de entregar', async () => {
  const ev = await eventos()

  const durante = ate(ev, 'task_handoff_started').agents.find(a => a.key === 'researcher')!
  assert.equal(durante.atDesk, 'strategist')

  const depois = ate(ev, 'task_handoff_completed').agents.find(a => a.key === 'researcher')!
  assert.equal(depois.atDesk, 'researcher', 'voltou para a própria mesa')
  assert.equal(depois.state, 'done')
})

test('a posição é sempre derivada dos eventos, nunca de timer', () => {
  // A cena lê `agent.atDesk`; não há relógio nem contador dentro dela.
  assert.ok(cena.includes('desks[agent.atDesk]'), 'a cena precisa usar atDesk')
  assert.ok(!/setTimeout|setInterval|Date\.now\(\)/.test(cena), 'a cena não pode ter timer')
  assert.ok(!/setTimeout|setInterval/.test(avatar), 'o avatar não pode ter timer')
})

// ─── 5, 6. Pausa e velocidade são só visuais ───────────────────────────────

test('5) pausar não toca no backend nem nos eventos persistidos', () => {
  // O estado `pausado` só aparece no efeito de revelação.
  const usos = [...ui.matchAll(/pausado/g)].length
  assert.ok(usos >= 3, 'pausado precisa existir')

  // Nenhuma action é chamada em função de pausa.
  const efeito = ui.slice(ui.indexOf('if (pausado) return'), ui.indexOf('if (pausado) return') + 420)
  assert.ok(!efeito.includes('advanceDemo'), 'pausa não pode chamar o servidor')
  assert.ok(!efeito.includes('startDemoProduction'))
  assert.ok(!efeito.includes('getDemoState'))

  // O laço de avanço não consulta `pausado`: o backend segue processando.
  const laco = ui.slice(ui.indexOf('for (let i = 0; i < MAX_TICKS'), ui.indexOf('} catch {'))
  assert.ok(!laco.includes('pausado'), 'a pausa não pode interromper o processamento real')
})

test('6) a velocidade altera apenas a reprodução visual', () => {
  const efeito = ui.slice(ui.indexOf('if (pausado) return'), ui.indexOf('const view: OfficeView'))
  assert.ok(efeito.includes('FATOR[velocidade]'), 'a velocidade divide o intervalo de revelação')

  // Não entra em nenhuma chamada de servidor.
  const chamadas = [...ui.matchAll(/(advanceDemo|startDemoProduction|getDemoState|getLatestDemo)\([^)]*\)/g)]
  for (const [chamada] of chamadas) {
    assert.ok(!/velocidade|FATOR|speed/.test(chamada), `velocidade vazou para o servidor: ${chamada}`)
  }
  // A cena recebe a velocidade só para encurtar a transição.
  assert.ok(cena.includes('Math.max(speed, 0.25)'))
})

// ─── 7. prefers-reduced-motion ─────────────────────────────────────────────

test('7) reduced-motion elimina os movimentos longos', () => {
  assert.ok(ui.includes("useMediaQuery('(prefers-reduced-motion: reduce)')"), 'a preferência é lida')
  assert.ok(ui.includes('reducedMotion ? 120 :'), 'a revelação encurta')

  // A caminhada some (duração 0) e as animações contínuas são desligadas.
  assert.ok(cena.includes('const walkMs = reducedMotion ? 0 :'), 'transição zerada')
  assert.ok(cena.includes('@media (prefers-reduced-motion: reduce)'), 'guarda no CSS também')
  assert.ok(cena.includes('animation: none !important'))
  assert.ok(avatar.includes('reducedMotion ?'), 'o avatar respeita a preferência')
})

// ─── 8. "review" nunca aparece cru ─────────────────────────────────────────

test('8) o estado review é exibido como "Aguardando aprovação"', () => {
  assert.equal(productionStatusLabel('review'), 'Aguardando aprovação')
  assert.equal(productionStatusLabel('queued'), 'Na fila')
  assert.equal(productionStatusLabel('running'), 'Em andamento')
  assert.equal(productionStatusLabel('failed'), 'Falhou')
  assert.equal(productionStatusLabel(null), 'Não iniciada')

  // Um estado desconhecido nunca vaza cru para a tela.
  assert.equal(productionStatusLabel('estado_novo_qualquer'), 'Em andamento')

  // Todos os estados possíveis têm rótulo em português.
  for (const [tecnico, amigavel] of Object.entries(PRODUCTION_STATUS_LABEL)) {
    assert.notEqual(amigavel, tecnico, `${tecnico} não foi traduzido`)
    assert.ok(!/_/.test(amigavel), `${amigavel} parece valor técnico`)
  }

  // A tela usa o rótulo, não o valor.
  assert.ok(ui.includes('productionStatusLabel(status)'))
  assert.ok(!/Produção:\s*\{status\}/.test(ui), 'status cru na interface')
})

// ─── 9. Mobile sem rolagem horizontal ──────────────────────────────────────

test('9) o layout mobile não exige rolagem horizontal', () => {
  assert.ok(ui.includes('overflow-x-hidden'), 'o contêiner precisa travar a rolagem lateral')
  assert.ok(ui.includes("useMediaQuery('(max-width: 639px)')"), 'detecta o celular')
  assert.ok(ui.includes("layout={compact ? 'compact' : 'wide'}"), 'troca o layout da cena')

  // O SVG escala pela largura disponível — nunca por pixels fixos.
  assert.ok(cena.includes("width: '100%'"), 'o SVG acompanha a largura')
  assert.ok(cena.includes('viewBox'), 'usa viewBox, não tamanho fixo')
  // Só a TAG de abertura do <svg> — os rects internos (janelas, monitores)
  // têm tamanho fixo de propósito, dentro do viewBox.
  const tagSvg = cena.slice(cena.indexOf('<svg'), cena.indexOf('>', cena.indexOf('<svg')))
  assert.ok(!/width="\d+"|height="\d+"/.test(tagSvg), 'o svg raiz não pode ter tamanho fixo')

  // O layout compacto empilha em zigue-zague, dentro de um viewBox estreito.
  assert.ok(cena.includes("compact: '0 0 420 580'"))
})

test('9b) as três mesas cabem no viewBox, com folga para o personagem', () => {
  const bloco = cena.slice(cena.indexOf('const DESKS'), cena.indexOf('const VIEWBOX'))
  const pares = [...bloco.matchAll(/x:\s*(\d+),\s*y:\s*(\d+)/g)].map(m => [Number(m[1]), Number(m[2])])
  assert.equal(pares.length, 6, 'três mesas em dois layouts')

  const [wide, compact] = [pares.slice(0, 3), pares.slice(3)]
  // Margem: o personagem tem ~16px de meia-largura e a mesa ~62px.
  for (const [x, y] of wide) {
    assert.ok(x >= 70 && x <= 730, `mesa wide fora do viewBox: x=${x}`)
    assert.ok(y >= 60 && y <= 300, `mesa wide fora do viewBox: y=${y}`)
  }
  for (const [x, y] of compact) {
    assert.ok(x >= 70 && x <= 350, `mesa compacta fora do viewBox: x=${x}`)
    assert.ok(y >= 60 && y <= 500, `mesa compacta fora do viewBox: y=${y}`)
  }
  // Em compacto as mesas ficam em zigue-zague (x alterna).
  assert.notEqual(compact[0][0], compact[1][0], 'zigue-zague exige x diferente')
})

// ─── 10. Erro interrompe o que vem depois ──────────────────────────────────

test('10) falha trava os agentes seguintes', async () => {
  const original = getAgent('strategist')
  __registerAgentForTests({
    key: 'strategist', version: 1, label: 'Estrategista',
    run: async () => { throw new Error('falha proposital') },
  })

  try {
    const store = new MemoryStore()
    const p = store.createProduction()
    let agora = new Date('2026-01-01T00:00:00Z').getTime()
    const deps = { now: () => new Date(agora), newLockToken: () => `lock-${agora}` }

    await startProduction(store, p.id, deps)
    for (let i = 0; i < 6; i++) {
      await drainQueue(store, 5, deps)
      agora += 20 * 60 * 1000
    }

    const view = buildOfficeView(store.events)
    assert.equal(view.agents.find(a => a.key === 'strategist')!.state, 'error')
    assert.equal(view.failed, true)
    assert.equal(view.finished, false)

    // O pesquisador concluiu; o copywriter nunca começou.
    assert.equal(view.agents.find(a => a.key === 'researcher')!.state, 'done')
    assert.equal(view.agents.find(a => a.key === 'copywriter')!.state, 'idle')

    // Ninguém ficou andando nem segurando pasta.
    assert.ok(view.agents.every(a => a.state !== 'walking'))
    assert.ok(view.agents.every(a => !a.carryingFolder))
    assert.ok(view.agents.every(a => a.atDesk === a.key), 'todos param na própria mesa')
  } finally {
    __registerAgentForTests(original)
  }
})

// ─── 11. Refresh não cria produção ─────────────────────────────────────────

test('11) abrir ou recarregar a página apenas lê', () => {
  const efeito = ui.slice(ui.indexOf('getLatestDemo()'), ui.indexOf('getLatestDemo()') + 500)
  assert.ok(!efeito.includes('startDemoProduction'), 'montar a tela não pode criar produção')
  assert.ok(!efeito.includes('advanceDemo'), 'montar a tela não pode avançar')

  const reiniciar = ui.slice(ui.indexOf('const reiniciar'), ui.indexOf('const reiniciar') + 520)
  assert.ok(reiniciar.includes('getDemoState'))
  assert.ok(!reiniciar.includes('startDemoProduction'), 'reiniciar não cria produção')
  assert.ok(!reiniciar.includes('advanceDemo'), 'reiniciar não avança')
})

// ─── 12, 13, 14. Escopo intocado ───────────────────────────────────────────

test('12) nenhum arquivo do R1 foi alterado', () => {
  const cronAuth = readFileSync(join(RAIZ, 'src/lib/security/cron-auth.ts'), 'utf8')
  const route = readFileSync(join(RAIZ, 'src/app/api/queue/process/route.ts'), 'utf8')
  assert.ok(cronAuth.includes('timingSafeEqual'))
  assert.ok(route.includes('evaluateCronAuth'))

  for (const [nome, src] of [['cena', cena], ['avatar', avatar], ['ui', ui], ['timeline', timeline]] as const) {
    for (const alvo of ['cron-auth', 'queue/process', 'CRON_SECRET', 'CRON_AUTH_ENFORCE']) {
      assert.ok(!src.includes(alvo), `${nome} referencia ${alvo}`)
    }
  }
})

test('13) as Server Actions não mudaram de contrato', () => {
  const actions = readFileSync(join(RAIZ, 'src/app/actions/content-studio.ts'), 'utf8')
  const assinaturas = [...actions.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
    .map(([, nome, params]) => `${nome}(${params.trim()})`)

  assert.deepEqual(assinaturas.sort(), [
    'advanceDemo(productionId: string)',
    'getDemoState(productionId: string)',
    'getLatestDemo()',
    'startDemoProduction()',
  ], 'a camada visual não pode alterar o contrato das actions')

  // E continuam server-only, com as travas no lugar.
  assert.ok(actions.startsWith("'use server'"))
  assert.ok(actions.includes('drainQueue(store, DEMO_MAX_JOBS_PER_CALL)'))
  assert.ok(actions.includes('await ensureDemoProduction('))
})

test('14) nenhuma chamada externa foi adicionada na camada visual', () => {
  const semComentarios = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  for (const [nome, bruto] of [['cena', cena], ['avatar', avatar], ['ui', ui], ['timeline', timeline]] as const) {
    const src = semComentarios(bruto)
    assert.ok(!/\bfetch\s*\(/.test(src), `${nome} faz fetch`)
    assert.ok(!/https?:\/\//.test(src), `${nome} referencia URL externa`)
    // `url(#...)` é referência interna do SVG (gradiente), não recurso externo.
    assert.ok(!/<img\b|<image\b/.test(src), `${nome} carrega imagem externa`)
    assert.ok(!/url\((?!#)/.test(src), `${nome} referencia recurso por URL`)
    assert.ok(!/anthropic|openai|resend/i.test(src), `${nome} referencia provedor`)
    assert.ok(!src.includes('createAdminClient'), `${nome} importa service role`)
  }
  // A cena é desenhada, não baixada.
  assert.ok(cena.includes('<svg'))
  assert.ok(avatar.includes('<circle') && avatar.includes('<rect'))
})

test('a cena tem escritório de verdade: piso, mesas, cadeiras e computadores', () => {
  for (const peca of ['cs-floor', 'cs-wall', 'Workstation', 'Cadeira', 'Monitor', 'Teclado']) {
    assert.ok(cena.includes(peca), `a cena precisa de ${peca}`)
  }
  // Três estações, uma por agente.
  assert.equal(OFFICE_AGENT_ORDER.length, 3)
  assert.ok(cena.includes('corredor central') || cena.includes('Corredor central'))

  // Personagem com corpo inteiro, não um círculo com emoji.
  for (const parte of ['cs-head', 'cs-arm', 'cs-leg', 'Tronco', 'Cabeça']) {
    assert.ok(avatar.includes(parte), `o personagem precisa de ${parte}`)
  }
  // Cada papel tem paleta e adereço próprios.
  assert.ok(avatar.includes('researcher') && avatar.includes('strategist') && avatar.includes('copywriter'))
  assert.ok(avatar.includes('Lupa') && avatar.includes('Bússola') && avatar.includes('Caneta'))
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
