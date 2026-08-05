// ============================================================================
// Testes do Office Preview V4 (camada visual)
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
const props = readFileSync(join(RAIZ, 'src/components/content-studio/office-props.tsx'), 'utf8')
const rig = readFileSync(join(RAIZ, 'src/components/content-studio/agent-rig.tsx'), 'utf8')

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
  assert.ok(avatar.includes('reducedMotion'), 'o avatar respeita a preferência')
  assert.ok(avatar.includes('!reducedMotion &&'), 'as classes de animação dependem da preferência')
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

  // O layout compacto tem viewBox retrato próprio.
  assert.ok(/compact: '0 0 \d+ \d+'/.test(cena), 'falta o viewBox do mobile')
})

test('9b) as três mesas cabem no viewBox, com folga para o personagem', () => {
  const vb = (nome: string) => {
    const m = new RegExp(`${nome}: '0 0 (\\d+) (\\d+)'`).exec(cena)!
    return { w: Number(m[1]), h: Number(m[2]) }
  }
  const bloco = cena.slice(cena.indexOf('const DESKS'), cena.indexOf('const VISIT_OFFSET'))
  const parse = (trecho: string) =>
    [...trecho.matchAll(/x:\s*(\d+),\s*y:\s*(\d+)/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]) }))

  const mesas = {
    wide: parse(bloco.slice(bloco.indexOf('wide:'), bloco.indexOf('compact:'))),
    compact: parse(bloco.slice(bloco.indexOf('compact:'))),
  }

  // Margem: meia-mesa (~76) + deslocamento da visita, e placa ~95px abaixo.
  for (const layout of ['wide', 'compact'] as const) {
    const { w, h } = vb(layout)
    const folga = layout === 'wide' ? 62 : 54
    for (const { x, y } of mesas[layout]) {
      assert.ok(x - 76 - folga > -20, `${layout}: mesa vaza à esquerda (x=${x})`)
      assert.ok(x + 76 + folga < w + 20, `${layout}: mesa vaza à direita (x=${x}, w=${w})`)
      assert.ok(y - 60 > 0, `${layout}: mesa vaza no topo (y=${y})`)
      assert.ok(y + 110 < h, `${layout}: placa vaza embaixo (y=${y}, h=${h})`)
    }
  }
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

  for (const [nome, bruto] of [['cena', cena], ['avatar', avatar], ['ui', ui], ['timeline', timeline], ['props', props]] as const) {
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

test('a cena é um escritório rico: salas, portas, móveis e decoração', () => {
  // Cenário
  for (const peca of ['cs-floorgrad', 'cs-wallgrad', 'cs-tiles', 'Divisórias', 'Rodapé', 'Corredor']) {
    assert.ok(cena.includes(peca), `a cena precisa de ${peca}`)
  }
  // Mobiliário e decoração vindos do catálogo de peças
  for (const peca of ['Desk', 'Chair', 'Monitor', 'Keyboard', 'Papers', 'Mug', 'Plant', 'Shelf', 'Door', 'Window', 'Lamp']) {
    assert.ok(props.includes(`export function ${peca}`), `falta a peça ${peca}`)
    assert.ok(cena.includes(`<${peca}`), `a cena não usa ${peca}`)
  }
  // Profundidade: perspectiva isométrica e sombras
  assert.ok(props.includes('IsoTop') || /M 0 -\d+ L \d+ \d+ L 0 \d+ L -\d+/.test(props), 'faltam superfícies isométricas')
  assert.equal(
    (props.match(/opacity="0\.1[0-9]?"/g) ?? []).length >= 3, true,
    'as peças precisam projetar sombra',
  )
  assert.ok(cena.includes('linearGradient') && cena.includes('radialGradient'), 'faltam gradientes de profundidade')

  // Três estações, uma por agente
  assert.equal(OFFICE_AGENT_ORDER.length, 3)
})

test('14) o rig mantém o personagem conectado: nenhuma junta pode saltar', () => {
  // A CAUSA da fragilidade até a V3.1: juntas com `transform` como ATRIBUTO
  // que também recebiam `transform` por animação. A animação sobrescreve o
  // atributo, então cada keyframe tinha de repetir o translate — e onde isso
  // faltava (ou quando a animação terminava), a peça saltava para a origem.
  assert.ok(rig.includes('export function Socket'), 'falta o nó de posição')
  assert.ok(rig.includes('export function Joint'), 'falta o nó de rotação')

  // Socket posiciona (atributo) e Joint gira (classe). Nunca os dois juntos.
  const socket = rig.slice(rig.indexOf('export function Socket'), rig.indexOf('export function Joint'))
  const joint = rig.slice(rig.indexOf('export function Joint'), rig.indexOf('export function Bone'))
  assert.ok(socket.includes('transform={`translate('), 'Socket precisa posicionar por atributo')
  assert.ok(!socket.includes('className'), 'Socket não pode ser animado')
  assert.ok(joint.includes('className={`cs-j cs-j--'), 'Joint precisa ser só classe')
  assert.ok(!joint.includes('transform='), 'Joint NÃO pode ter transform como atributo')

  // Nenhum keyframe do personagem mexe em translate: só rotação.
  const blocos = [...cena.matchAll(/@keyframes (cs-(?:pelvis|spine|head\w*|hip[LR]|knee[LR]|ankle[LR]|shoulder[LR]|elbow\w*|typing[LR]|give\w*|recv\w*|amb-\w+))\s*{([\s\S]*?)}\s*}/g)]
  assert.ok(blocos.length >= 12, 'poucas animações de junta encontradas')
  for (const [, nome, corpo] of blocos) {
    assert.ok(!/translate/.test(corpo), `${nome} mexe em translate — a junta pode saltar`)
  }

  // E toda junta gira na própria origem, que é onde o Socket a colocou.
  const regraJ = /\.cs-j\s*{([\s\S]*?)}/.exec(cena)![1]
  assert.ok(/transform-origin:\s*0 0/.test(regraJ), 'falta a origem única das juntas')

  // A cadeia completa existe, do chão à cabeça.
  for (const junta of ['pelvis', 'spine', 'neck', 'head', 'shoulderL', 'shoulderR',
                       'elbowL', 'elbowR', 'wristL', 'wristR',
                       'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR']) {
    assert.ok(rig.includes(`'${junta}'`), `o rig precisa da junta ${junta}`)
    assert.ok(avatar.includes(`name="${junta}"`) || avatar.includes(`'${junta}'`) ||
              avatar.includes(`? '${junta}'`) || avatar.includes(`: '${junta}'`),
      `o avatar precisa montar a junta ${junta}`)
  }
})

test('15) tronco e pernas permanecem ligados em todos os estados', () => {
  // A pelve é o pai das duas pernas E vizinha da coluna: uma peça só.
  const pelve = avatar.slice(avatar.indexOf('name="pelvis"'), avatar.indexOf('name="spine"'))
  assert.ok(pelve.includes('<Leg side="L"') && pelve.includes('<Leg side="R"'),
    'as duas pernas precisam pendurar na pelve')
  assert.ok(/Bacia|bacia/.test(pelve), 'falta a bacia ligando tronco e pernas')

  // Nos estados de entrega e recebimento, NADA anima pelve, quadril ou joelho
  // — é o que impede o tronco de sair de cima das pernas.
  for (const estado of ['give', 'receive']) {
    const regras = cena.split('\n').filter(l => l.includes(`.cs-char--${estado} `))
    assert.ok(regras.length >= 3, `${estado} precisa de regras`)
    for (const r of regras) {
      for (const proibida of ['cs-j--pelvis', 'cs-j--hip', 'cs-j--knee', 'cs-j--ankle']) {
        assert.ok(!r.includes(proibida), `${estado} não pode animar ${proibida}`)
      }
    }
  }

  // A coluna é o único ponto que inclina o tronco — e gira na cintura.
  const inclina = cena.split('\n').filter(l => /cs-(give|recv)Lean/.test(l) && l.includes('animation'))
  assert.ok(inclina.every(l => l.includes('cs-j--spine')), 'só a coluna pode inclinar o tronco')
})

test('16) entrega e recebimento têm poses distintas e completas', () => {
  // Entregar: antecipa (recolhe), estende e SEGURA.
  const give = /@keyframes cs-giveArm\s*{[\s\S]*?}\s*}/.exec(cena)![0]
  assert.ok(/28%[^}]*rotate\(-1[0-9]deg\)/.test(give), 'falta antecipação na entrega')
  assert.ok(/62%,100%[^}]*rotate\(-5[0-9]deg\)/.test(give), 'o braço precisa estender e segurar')
  assert.ok(cena.includes('cs-giveArm') && cena.includes('cs-giveElb'), 'ombro e cotovelo participam')
  assert.ok(/cs-giveArm[^;]*forwards/.test(cena), 'a pose de entrega precisa se manter')

  // Receber: alcança e RECOLHE — termina diferente de onde foi.
  const recv = /@keyframes cs-recvArm\s*{[\s\S]*?}\s*}/.exec(cena)![0]
  assert.ok(/46%[^}]*rotate\(-5[0-9]deg\)/.test(recv), 'o receptor precisa alcançar')
  assert.ok(/100%[^}]*rotate\(-[0-9]deg\)/.test(recv), 'o receptor precisa recolher')
  const recvElb = /@keyframes cs-recvElb\s*{[\s\S]*?}\s*}/.exec(cena)![0]
  assert.ok(/100%[^}]*rotate\(4[0-9]deg\)/.test(recvElb), 'o cotovelo precisa dobrar ao absorver')

  // Os dois inclinam em sentidos OPOSTOS, um para o outro.
  const dar = /@keyframes cs-giveLean[\s\S]*?}\s*}/.exec(cena)![0]
  const receber = /@keyframes cs-recvLean[\s\S]*?}\s*}/.exec(cena)![0]
  const angDar = Number(/5[0-9]%\s*{\s*transform:\s*rotate\((-?[\d.]+)deg\)/.exec(dar)![1])
  const angRec = Number(/4[0-9]%\s*{\s*transform:\s*rotate\((-?[\d.]+)deg\)/.exec(receber)![1])
  assert.ok(angDar * angRec < 0, 'quem dá e quem recebe inclinam em sentidos opostos')

  // O receptor também olha para a pasta.
  assert.ok(cena.includes('@keyframes cs-recvHead'), 'o receptor precisa reagir com a cabeça')

  // As classes vêm do estado, nunca de timer.
  assert.ok(avatar.includes('carryingFolder && !walking'), 'entregar = com pasta, parado')
  assert.ok(avatar.includes('cs-char--give') && avatar.includes('cs-char--receive'))

  // Ao andar carregando, o braço trava contra o corpo em vez de balançar.
  assert.ok(cena.includes('.cs-char--walk.cs-char--carry .cs-j--shoulderR'), 'a pasta precisa ser segurada')
})

test('S1) Safari: toda junta tem reference box e origem explícitos', () => {
  // O valor inicial de `transform-box` para SVG varia entre implementações.
  // Sem declará-lo, a origem de rotação de CADA junta muda de navegador para
  // navegador — no Safari o membro giraria em torno de outro ponto.
  const regra = /\.cs-j\s*{([\s\S]*?)}/.exec(cena)![1]
  assert.ok(/transform-box:\s*view-box/.test(regra), 'falta transform-box explícito nas juntas')
  assert.ok(/transform-origin:\s*0 0/.test(regra), 'a junta precisa girar na própria origem')

  // Toda animação que usa scale/rotate precisa de reference box declarado —
  // senão escala a partir do centro do viewBox, não do próprio elemento.
  const linhas = cena.split('\n')
  for (const linha of linhas) {
    if (!linha.includes('transform-origin:')) continue
    if (linha.trim().startsWith('//') || linha.trim().startsWith('*')) continue
    const naRegraDasJuntas = linha.includes('transform-origin: 0 0')
    assert.ok(
      naRegraDasJuntas || linha.includes('transform-box:'),
      `transform-origin sem transform-box (o Safari escolheria outro ponto): ${linha.trim()}`,
    )
  }

  // A sombra ESCALA — é o caso mais sensível de todos.
  const sombra = linhas.find(l => l.includes('.cs-char--walk .cs-shadow'))!
  assert.ok(sombra.includes('transform-box: fill-box'), 'a sombra precisa escalar na própria caixa')
})

test('S2) a troca de estado devolve as juntas ao repouso sem estalo', () => {
  // Quando uma classe sai — o `forwards` da entrega, o `--carry` que trava o
  // braço — o transform desaparece de uma vez. A transition interpola essa
  // volta, e é o que impede o membro de piscar para a pose neutra.
  const regra = /\.cs-j\s*{([\s\S]*?)}/.exec(cena)![1]
  assert.ok(/transition:\s*transform/.test(regra), 'falta transição de retorno nas juntas')

  const ms = Number(/transition:\s*transform\s+(\d+)ms/.exec(regra)![1])
  assert.ok(ms >= 150 && ms <= 600, `retorno fora de faixa confortável: ${ms}ms`)

  // Todo estado que TRAVA uma junta com transform estático precisa da rede.
  const travas = cena.split('\n').filter(l => /animation:\s*none/.test(l) && l.includes('transform:'))
  assert.ok(travas.length >= 2, 'as travas de pose precisam existir')
  for (const t of travas) {
    assert.ok(/\.cs-j--/.test(t), `trava fora de uma junta: ${t.trim()}`)
  }

  // `forwards` só é aceitável porque a transition cobre a saída.
  assert.ok(/cs-giveArm[^;]*forwards/.test(cena), 'a entrega precisa manter a pose')
})

test('S3) mobile: sem filtro contínuo e nada é cortado no viewBox', () => {
  // `filter` num grupo grande obriga o Safari/iOS a manter uma camada
  // rasterizada enquanto durar — custo contínuo por um efeito decorativo.
  assert.ok(!/filter:\s*(saturate|blur|drop-shadow|grayscale)/.test(cena),
    'filtro contínuo na cena — caro no iOS')
  assert.ok(!/<filter\b/.test(cena + props + avatar), 'filtro SVG na cena — caro no iOS')

  // Animação só existe onde o elemento é realmente desenhado.
  assert.ok(cena.includes('{on && (') || props.includes('{on && ('),
    'as linhas do monitor só devem existir com o monitor aceso')
  assert.ok(avatar.includes('carryingFolder ? <Folder />'), 'o glow só existe com a pasta')

  // O personagem cabe no viewBox mesmo deslocado para a mesa do colega.
  const vb = (nome: string) => {
    const m = new RegExp(`${nome}: '0 0 (\\d+) (\\d+)'`).exec(cena)!
    return { w: Number(m[1]), h: Number(m[2]) }
  }
  const bloco = cena.slice(cena.indexOf('const DESKS'), cena.indexOf('const VISIT_OFFSET'))
  const parse = (t: string) => [...t.matchAll(/x:\s*(\d+),\s*y:\s*(\d+)/g)].map(m => ({ x: +m[1], y: +m[2] }))
  const mesas = {
    wide: parse(bloco.slice(bloco.indexOf('wide:'), bloco.indexOf('compact:'))),
    compact: parse(bloco.slice(bloco.indexOf('compact:'))),
  }
  const offsets = /VISIT_OFFSET[^=]*=\s*{\s*wide:\s*(\d+),\s*compact:\s*(\d+)/.exec(cena)!
  const visita = { wide: Number(offsets[1]), compact: Number(offsets[2]) }

  // Meia-largura do personagem (~19) + deslocamento da visita.
  for (const layout of ['wide', 'compact'] as const) {
    const { w, h } = vb(layout)
    for (const { x, y } of mesas[layout]) {
      const esq = x - visita[layout] - 19
      const dir = x + visita[layout] + 19
      assert.ok(esq > 0, `${layout}: personagem cortado à esquerda (x=${x})`)
      assert.ok(dir < w, `${layout}: personagem cortado à direita (x=${x}, w=${w})`)
      // Em pé fica 26px à frente da mesa; a sombra vai até ~+60.
      assert.ok(y + 26 + 60 < h, `${layout}: personagem cortado embaixo (y=${y}, h=${h})`)
      assert.ok(y - 56 > 0, `${layout}: balão cortado no topo (y=${y})`)
    }
  }
})

test('S4) reduced-motion desliga também as micro-rotinas', () => {
  // Duas camadas: o CSS mata toda animação da cena...
  const bloco = /@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)}\s*}/.exec(cena)![1]
  assert.ok(/animation:\s*none\s*!important/.test(bloco), 'reduced-motion precisa parar as animações')
  assert.ok(/transition:\s*none\s*!important/.test(bloco), 'reduced-motion precisa parar as transições')
  assert.ok(/\.cs-scene \*/.test(bloco), 'a regra precisa alcançar a cena inteira — inclusive o ambiente')

  // ...e o avatar nem chega a aplicar a classe de ambiente.
  assert.ok(/!reducedMotion && parado && ambient !== undefined/.test(avatar),
    'a classe de ambiente precisa depender de reducedMotion')
})

test('17) micro-rotinas são cosméticas: não tocam backend nem timeline', () => {
  assert.ok(cena.includes('function ambienteDe'), 'falta a camada de vida')

  const fn = cena.slice(cena.indexOf('function ambienteDe'), cena.indexOf('export default function OfficeScene'))
  // Deriva só de estado visual local — nada de evento, nada persistido.
  assert.ok(fn.includes("agent.state !== 'idle'"), 'só age sobre agentes ociosos')
  assert.ok(!/emitEvent|advanceDemo|fetch|timeline|cs_events/.test(fn), 'a camada de vida não pode tocar dados')
  // Determinística: a mesma cena no servidor e no cliente.
  assert.ok(fn.includes('indice % 3'), 'o índice vem da posição, não de sorteio')
  assert.ok(!/Math\.random/.test(cena + avatar + rig), 'nada pode ser aleatório')

  // A view-model não ganhou campo novo por causa disso.
  const vm = readFileSync(join(RAIZ, 'src/lib/content-studio/view-model.ts'), 'utf8')
  assert.ok(!/ambient|rotina|micro/i.test(vm), 'a camada de vida não pode virar estado persistido')

  // E as micro-rotinas não mexem em nada que sugira locomoção ou trabalho.
  const ambientes = cena.split('\n').filter(l => /\.cs-char--amb\d/.test(l))
  assert.ok(ambientes.length >= 4, 'precisa haver micro-rotinas')
  for (const r of ambientes) {
    for (const proibida of ['cs-j--pelvis', 'cs-j--hip', 'cs-j--knee', 'cs-j--ankle']) {
      assert.ok(!r.includes(proibida), `micro-rotina não pode animar ${proibida}`)
    }
  }
  // Ritmo lento: 11s ou mais, para não competir com a tarefa real.
  for (const r of ambientes) {
    const ms = Number(/Math\.round\((\d+) \/ v\)/.exec(r)?.[1] ?? 0)
    assert.ok(ms >= 11000, `micro-rotina rápida demais (${ms}ms) — competiria com a tarefa`)
  }
})

test('18) agentes ociosos não roubam o foco do agente ativo', () => {
  const fn = cena.slice(cena.indexOf('function ambienteDe'), cena.indexOf('export default function OfficeScene'))

  // Quem está em foco nunca recebe micro-rotina.
  assert.ok(fn.includes('emFoco === agent.key') && fn.includes('return undefined'),
    'o agente em foco não pode ter micro-rotina')

  // Quem trabalha, anda, entrega, recebe, falha ou concluiu também não.
  assert.ok(fn.includes("agent.state !== 'idle'"), 'só idle recebe micro-rotina')

  // E o avatar só aplica a classe quando está realmente parado.
  assert.ok(avatar.includes("parado && ambient !== undefined"), 'a classe depende de estar parado')

  // O foco continua vindo do estado, e os demais recuam.
  assert.ok(cena.includes("view.agents.find(a => a.state === 'working')?.key"))
  const recuo = /opacity=\{foco \? 1 : ([\d.]+)\}/.exec(cena)
  assert.ok(recuo, 'os demais precisam recuar')
  assert.ok(Number(recuo![1]) <= 0.7, `recuo fraco demais: ${recuo![1]}`)
  // Sem filtro: o custo de rasterização no iOS não compensa a dessaturação.
  assert.ok(!/filter:\s*saturate/.test(cena), 'o recuo não pode usar filtro')
  assert.ok(cena.includes('emFoco === null || emFoco === key'), 'cena neutra quando ninguém trabalha')
})

test('as animações pedidas existem e são dirigidas por estado', () => {
  // idle, trabalho, caminhada, entrega, recebimento, erro, conclusão.
  for (const anim of ['cs-breathe', 'cs-headidle', 'cs-typingR', 'cs-lean', 'cs-hipR', 'cs-shoulderR',
                      'cs-bounce', 'cs-shake', 'cs-cheer', 'cs-recvArm', 'cs-giveArm', 'cs-glow']) {
    assert.ok(cena.includes(`@keyframes ${anim}`), `falta a animação ${anim}`)
  }
  // Cada uma é ligada por uma CLASSE derivada do estado — nunca por timer.
  for (const gatilho of ['cs-char--idle', 'cs-char--walk', 'cs-char--type', 'cs-char--error',
                         'cs-char--cheer', 'cs-char--receive', 'cs-char--give', 'cs-char--carry']) {
    assert.ok(avatar.includes(gatilho), `${gatilho} precisa vir do estado`)
    assert.ok(cena.includes(`.${gatilho}`), `${gatilho} precisa ter regra CSS`)
  }
  assert.ok(cena.includes('cubic-bezier'), 'a transição precisa de easing')
})

test('a caminhada move a cadeia inteira, com oposição e peso', () => {
  const regras = cena.slice(cena.indexOf('.cs-char--walk '), cena.indexOf('.cs-char--type '))

  // Cadeia completa: da pelve ao tornozelo, e da coluna ao cotovelo.
  for (const junta of ['cs-j--pelvis', 'cs-j--spine', 'cs-j--head',
                       'cs-j--hipR', 'cs-j--hipL', 'cs-j--kneeR', 'cs-j--kneeL',
                       'cs-j--ankleR', 'cs-j--ankleL',
                       'cs-j--shoulderR', 'cs-j--shoulderL', 'cs-j--elbowR', 'cs-j--elbowL',
                       'cs-shadow']) {
    assert.ok(regras.includes(junta), `a caminhada precisa animar ${junta}`)
  }

  const ang = (nome: string) =>
    Number(/0%,100%\s*{\s*transform:\s*rotate\((-?[\d.]+)deg\)/
      .exec(new RegExp(`@keyframes ${nome}\\s*{[\\s\\S]*?}\\s*}`).exec(cena)![0])![1])

  // Pernas em oposição; braços em oposição; braço acompanha a perna CONTRÁRIA.
  assert.ok(ang('cs-hipR') * ang('cs-hipL') < 0, 'as pernas precisam estar em oposição')
  assert.ok(ang('cs-shoulderR') * ang('cs-shoulderL') < 0, 'os braços precisam estar em oposição')
  assert.ok(ang('cs-hipR') * ang('cs-shoulderR') < 0, 'braço e perna do mesmo lado vão em sentidos opostos')
  // Pelve e coluna giram contra — é o que dá centro de massa.
  assert.ok(ang('cs-pelvis') * ang('cs-spine') < 0, 'pelve e coluna precisam girar em oposição')

  // Peso: dois quiques por ciclo e sombra respondendo.
  const bounce = /@keyframes cs-bounce\s*{[\s\S]*?}\s*}/.exec(cena)![0]
  assert.ok(bounce.includes('25%') && bounce.includes('75%'), 'o corpo precisa quicar a cada passo')

  // Transferência de peso: o joelho dobra na fase de balanço.
  const joelho = /@keyframes cs-kneeR\s*{[\s\S]*?}\s*}/.exec(cena)![0]
  assert.ok(/3[0-9]%[^}]*rotate\(3[0-9]deg\)/.test(joelho), 'o joelho precisa dobrar ao balançar')

  // Overlap: a cabeça chega depois do corpo.
  const cabeca = cena.split('\n').find(l => l.includes('.cs-char--walk .cs-j--head'))!
  assert.ok(cabeca.includes('animation-delay'), 'falta atraso da cabeça')
})

test('o handoff é inequívoco: pasta destacada e caminho vivo', () => {
  assert.ok(avatar.includes('function Folder'), 'a pasta precisa ser desenhada')
  assert.ok(avatar.includes('cs-folder-glow'), 'a pasta precisa se destacar')
  assert.ok(cena.includes('cs-path--active'), 'o caminho precisa reagir à caminhada')
  assert.ok(cena.includes("view.agents.some(a => a.state === 'walking')"), 'o caminho acende com base no estado')
  // A pasta fica ancorada na MÃO, dentro do braço — então acompanha o gesto.
  // A mão é o Joint `wristR`, no fim da cadeia do braço da frente.
  assert.ok(rig.includes("'wristR'"), 'o rig precisa ter punho')
  const braco = avatar.slice(avatar.indexOf('<Arm side="R"'), avatar.indexOf('</Arm>'))
  assert.ok(braco.includes('carryingFolder ? <Folder />'), 'a pasta precisa ficar na mão')
  const arm = avatar.slice(avatar.indexOf('function Arm'), avatar.indexOf('export interface AgentAvatarProps'))
  assert.ok(arm.includes("name={side === 'L' ? 'wristL' : 'wristR'}") && arm.includes('{children}'),
    'o que a mão segura precisa pendurar no punho')
})

test('o mobile tem planta própria, não a mesma cena espremida', () => {
  const bloco = cena.slice(cena.indexOf('const DESKS'), cena.indexOf('const VISIT_OFFSET'))
  const wide = [...bloco.slice(bloco.indexOf('wide:'), bloco.indexOf('compact:')).matchAll(/x:\s*(\d+),\s*y:\s*(\d+)/g)]
    .map(m => [Number(m[1]), Number(m[2])])
  const compact = [...bloco.slice(bloco.indexOf('compact:')).matchAll(/x:\s*(\d+),\s*y:\s*(\d+)/g)]
    .map(m => [Number(m[1]), Number(m[2])])

  assert.equal(wide.length, 3)
  assert.equal(compact.length, 3)
  // Wide: alinhado na horizontal. Compact: em L, ocupando a vertical.
  assert.ok(wide.every(([, y]) => y === wide[0][1]), 'no desktop as mesas ficam alinhadas')
  assert.ok(new Set(compact.map(([, y]) => y)).size === 3, 'no mobile as mesas se distribuem na vertical')
  assert.notEqual(compact[0][0], compact[1][0], 'no mobile a planta é em zigue-zague')

  // Proporção do viewBox: paisagem no desktop, retrato no mobile.
  const dimensoes = (nome: string) => {
    const m = new RegExp(`${nome}: '0 0 (\\d+) (\\d+)'`).exec(cena)!
    return { w: Number(m[1]), h: Number(m[2]) }
  }
  const { w: lw, h: lh } = dimensoes('wide')
  const { w: cw, h: ch } = dimensoes('compact')
  assert.ok(lw > lh, 'desktop precisa ser paisagem')
  assert.ok(ch > cw, 'mobile precisa ser retrato')
  // E o retrato não pode ser desproporcionalmente alto (rolagem infinita).
  assert.ok(ch / cw < 1.5, `mobile alto demais: ${cw}x${ch}`)
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
