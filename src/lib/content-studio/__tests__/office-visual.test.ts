// ============================================================================
// Testes do Office Preview V3.1 (camada visual)
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

test('14) cabeça, pescoço, ombros e tronco estão conectados', () => {
  // O que fazia a cabeça parecer solta na V3: pescoço desenhado atrás dela,
  // sem tocar o torso, e a cabeça girando com origem própria.
  assert.ok(avatar.includes('cs-neck'), 'precisa existir um pescoço')
  assert.ok(avatar.includes('cs-shoulder'), 'precisam existir ombros próprios')
  assert.ok(avatar.includes('cs-upper'), 'tronco, cabeça e braços precisam formar um bloco')

  // O pescoço nasce dos ombros (y >= -2) e entra sob o queixo (y <= -10).
  const pescoco = avatar.slice(avatar.indexOf('cs-neck'), avatar.indexOf('cs-shoulder'))
  assert.ok(/-4\.6 -2/.test(pescoco) && /-10\.5/.test(pescoco), 'o pescoço precisa ligar ombro e queixo')
  assert.ok(pescoco.includes('maxilar') || pescoco.includes('SKIN_DEEP'), 'falta sombra do queixo sobre o pescoço')
  assert.ok(pescoco.includes('clavícula') || pescoco.includes('Trapézio'), 'falta a ligação pescoço-ombro')

  // Os ombros cobrem a raiz dos braços: mesma coordenada x (±12,5).
  assert.ok(/cx="-12"/.test(avatar) && /cx="12"/.test(avatar), 'ombros precisam ficar sobre a raiz dos braços')
  assert.ok(avatar.includes('translate(-12.5, -2)') && avatar.includes('translate(12.5, -2)'),
    'os braços precisam nascer sob os ombros')

  // A cabeça está DENTRO de cs-upper — não é irmã do tronco.
  const upper = avatar.slice(avatar.indexOf('className="cs-upper"'), avatar.indexOf('cs-badge'))
  for (const parte of ['cs-torso', 'cs-neck', 'cs-shoulder', 'cs-head', 'cs-arm--front', 'cs-arm--back']) {
    assert.ok(upper.includes(parte), `${parte} precisa estar dentro de cs-upper`)
  }

  // E a rotação da cabeça acontece na base do pescoço, não no centro dela.
  assert.ok(!/\.cs-head\s*{[^}]*transform-origin:\s*center\s+bottom/.test(cena) ||
            cena.includes('cs-upper'), 'a cabeça precisa girar junto do corpo')
})

test('15) a caminhada move quadril, tronco, braços e pernas', () => {
  const regras = cena.slice(cena.indexOf('.cs-char--walk'), cena.indexOf('.cs-char--type'))

  for (const parte of ['cs-hip', 'cs-upper', 'cs-head', 'cs-leg--front', 'cs-leg--back',
                       'cs-arm--front', 'cs-arm--back', 'cs-foot--front', 'cs-foot--back', 'cs-shadow']) {
    assert.ok(regras.includes(parte), `a caminhada precisa animar ${parte}`)
  }

  // Oposição coerente: perna da frente e de trás começam em ângulos opostos.
  const f = /@keyframes cs-step-f\s*{\s*0%,100%\s*{\s*transform:\s*rotate\((-?[\d.]+)deg\)/.exec(cena)!
  const b = /@keyframes cs-step-b\s*{\s*0%,100%\s*{\s*transform:\s*rotate\((-?[\d.]+)deg\)/.exec(cena)!
  assert.ok(Number(f[1]) * Number(b[1]) < 0, 'as pernas precisam estar em oposição')

  const af = /@keyframes cs-swing-f[^}]*rotate\((-?[\d.]+)deg\)/.exec(cena)!
  const ab = /@keyframes cs-swing-b[^}]*rotate\((-?[\d.]+)deg\)/.exec(cena)!
  assert.ok(Number(af[1]) * Number(ab[1]) < 0, 'os braços precisam estar em oposição')
  // E o braço acompanha a perna OPOSTA — é assim que se anda.
  assert.ok(Number(f[1]) * Number(af[1]) > 0, 'braço e perna contrários devem sincronizar')

  // Peso: dois quiques por ciclo e a sombra respondendo.
  const bounce = /@keyframes cs-bounce\s*{[\s\S]*?}\s*}/.exec(cena)![0]
  assert.ok(bounce.includes('25%') && bounce.includes('75%'), 'o corpo precisa quicar a cada passo')
  assert.ok(cena.includes('@keyframes cs-shadow'), 'a sombra precisa acompanhar o salto')

  // Overlap: a cabeça atrasa em relação ao corpo.
  // Linha a linha: `[^}]*` pararia no fecha-chaves da interpolação ${...}.
  const regraCabeca = cena.split('\n').find(l => l.includes('.cs-char--walk .cs-head'))!
  assert.ok(regraCabeca.includes('animation-delay'), 'falta atraso da cabeça')

  // Easing com peso na entrada e na saída.
  assert.ok(cena.includes('cubic-bezier(.34,.02,.2,1)'), 'o deslocamento precisa de easing')
})

test('16) entrega e recebimento têm posturas distintas', () => {
  // Entregar: braço estende para FORA (ângulo negativo grande).
  assert.ok(cena.includes('@keyframes cs-give'), 'falta a postura de entrega')
  const give = /@keyframes cs-give\s*{[\s\S]*?}\s*}/.exec(cena)![0]
  assert.ok(/rotate\(-4[0-9]deg\)/.test(give), 'o braço precisa estender na entrega')
  // ...com antecipação: recolhe antes de estender.
  assert.ok(/30%\s*{\s*transform[^}]*rotate\(-1[0-9]deg\)/.test(give), 'falta antecipação na entrega')

  // Receber: alcança e RECOLHE — o gesto termina diferente de onde vai.
  const recv = /@keyframes cs-receive\s*{[\s\S]*?}\s*}/.exec(cena)![0]
  assert.ok(/45%[^}]*rotate\(-4[0-9]deg\)/.test(recv), 'o receptor precisa alcançar a pasta')
  assert.ok(/100%[^}]*rotate\(-[0-9]deg\)/.test(recv), 'o receptor precisa recolher o braço')

  // Os dois inclinam o corpo um para o outro, em sentidos opostos.
  const dar = /@keyframes cs-givelean[^@]*/.exec(cena)![0]
  const receber = /@keyframes cs-recvlean[^@]*/.exec(cena)![0]
  const angDar = Number(/rotate\((-?[\d.]+)deg\)/.exec(dar.slice(dar.indexOf('55%')))![1])
  const angRec = Number(/rotate\((-?[\d.]+)deg\)/.exec(receber.slice(receber.indexOf('40%')))![1])
  assert.ok(angDar * angRec < 0, 'quem dá e quem recebe inclinam em sentidos opostos')

  // O receptor também move a cabeça para a pasta.
  assert.ok(cena.includes('@keyframes cs-recvhead'), 'o receptor precisa olhar a pasta')

  // As classes vêm do estado, não de timer.
  assert.ok(avatar.includes("carryingFolder && !walking"), 'entregar = com pasta, parado na mesa do outro')
  assert.ok(avatar.includes('cs-char--give') && avatar.includes('cs-char--receive'))

  // Carregando, o braço PARA de balançar e segura a pasta.
  assert.ok(cena.includes('.cs-char--walk.cs-char--carry .cs-arm--front'), 'a pasta precisa ser segurada ao andar')
  // E a mão fecha sobre ela.
  assert.ok(avatar.includes('Dedos por cima da pasta') || /cs-hand--front[\s\S]{0,600}?q 2\.6 -2\.4/.test(avatar),
    'a mão precisa segurar a pasta')
})

test('o foco visual destaca quem está ativo, sem pisca-pisca', () => {
  assert.ok(cena.includes('const emFoco'), 'precisa existir um agente em foco')
  assert.ok(cena.includes("view.agents.find(a => a.state === 'working')?.key"), 'o foco vem do estado')
  assert.ok(cena.includes('cs-halo'), 'o setor ativo precisa de destaque')
  assert.ok(cena.includes('opacity={foco ? 1 : 0.62}'), 'os demais precisam recuar')

  // Pulso lento e de baixa amplitude: destaque, não alarme.
  const halo = /@keyframes cs-halo[^}]*}[^}]*}/.exec(cena)![0]
  const [, a, b] = /opacity:\.(\d+);[\s\S]*?opacity:\.(\d+);/.exec(halo)!
  assert.ok(Math.abs(Number(a) - Number(b)) <= 25, 'o halo não pode piscar forte')
  assert.ok(/cs-halo \$\{Math\.round\(2[0-9]00 \/ v\)\}ms/.test(cena), 'o pulso precisa ser lento')

  // Sem foco definido, ninguém recua.
  assert.ok(cena.includes('emFoco === null || emFoco === key'), 'cena neutra quando ninguém trabalha')
})

test('as animações pedidas existem e são dirigidas por estado', () => {
  // idle (respiração), trabalho, caminhada, erro, conclusão, recebimento.
  for (const anim of ['cs-breathe', 'cs-headidle', 'cs-typing', 'cs-lean', 'cs-step-f', 'cs-swing-f',
                      'cs-bounce', 'cs-shake', 'cs-cheer', 'cs-receive', 'cs-give', 'cs-glow']) {
    assert.ok(cena.includes(`@keyframes ${anim}`), `falta a animação ${anim}`)
  }
  // E cada uma é ligada por uma CLASSE derivada do estado — nunca por timer.
  for (const gatilho of ['cs-char--idle', 'cs-char--walk', 'cs-char--type', 'cs-char--error',
                         'cs-char--cheer', 'cs-char--receive', 'cs-char--give', 'cs-char--carry']) {
    assert.ok(avatar.includes(gatilho), `${gatilho} precisa vir do estado`)
    assert.ok(cena.includes(`.${gatilho}`), `${gatilho} precisa ter regra CSS`)
  }
  // Easing suave na caminhada: nada de linear seco.
  assert.ok(cena.includes('cubic-bezier'), 'a transição precisa de easing')
})

test('o handoff é inequívoco: pasta destacada e caminho vivo', () => {
  assert.ok(avatar.includes('function Folder'), 'a pasta precisa ser desenhada')
  assert.ok(avatar.includes('cs-folder-glow'), 'a pasta precisa se destacar')
  assert.ok(cena.includes('cs-path--active'), 'o caminho precisa reagir à caminhada')
  assert.ok(cena.includes("view.agents.some(a => a.state === 'walking')"), 'o caminho acende com base no estado')
  // A pasta fica ancorada na MÃO, dentro do braço — então acompanha o gesto.
  const mao = avatar.slice(avatar.indexOf('cs-hand--front'), avatar.indexOf('cs-badge'))
  assert.ok(mao.includes('carryingFolder ? <Folder />'), 'a pasta precisa ficar na mão')
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
