// ============================================================================
// Testes da locomoção ambiental (V4.1)
// ----------------------------------------------------------------------------
// A máquina de estados é PURA: recebe "quanto tempo visual passou" e devolve
// "onde o agente está". Sem React, sem rAF, sem relógio — por isso dá para
// varrer um ciclo inteiro milissegundo a milissegundo aqui.
//
// O que estes testes protegem: que a camada de vida seja COSMÉTICA. Se alguém
// fizer o ambiente competir com a tarefa real, ou criar evento, quebra.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AMBIENT_ROUTINES,
  ambientStateAt,
  cycleDuration,
  isAmbientMoving,
  isTaskControlled,
  resolveAmbient,
  type AmbientPhase,
} from '../../../components/content-studio/ambient-motion'

const RAIZ = process.cwd()
const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

const hook = readFileSync(join(RAIZ, 'src/components/content-studio/use-ambient-motion.ts'), 'utf8')
const motion = readFileSync(join(RAIZ, 'src/components/content-studio/ambient-motion.ts'), 'utf8')
const cena = readFileSync(join(RAIZ, 'src/components/content-studio/office-scene.tsx'), 'utf8')
const avatar = readFileSync(join(RAIZ, 'src/components/content-studio/agent-avatar.tsx'), 'utf8')

const AGENTES = ['researcher', 'strategist', 'copywriter'] as const

/** Remove comentários: um comentário que promete "nunca setInterval" não é código. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Varre um ciclo inteiro em passos de 100ms. */
function varrer(key: string, passo = 100) {
  const r = AMBIENT_ROUTINES[key]
  const total = cycleDuration(r)
  const amostras: { t: number; phase: AmbientPhase; waypoint: string | null }[] = []
  for (let t = 0; t < total; t += passo) {
    const e = ambientStateAt(r, t)
    amostras.push({ t, phase: e.phase, waypoint: e.waypoint })
  }
  return amostras
}

// ─── 1, 2. O agente realmente sai da mesa ──────────────────────────────────

test('1) agente ocioso muda de posição ao longo do ciclo', () => {
  for (const key of AGENTES) {
    const pontos = new Set(varrer(key).map(a => a.waypoint).filter(Boolean))
    assert.ok(pontos.size >= 2, `${key} precisa visitar ao menos dois pontos, visitou ${pontos.size}`)
  }
})

test('2) agente ocioso NÃO fica sempre na mesa', () => {
  for (const key of AGENTES) {
    const amostras = varrer(key)
    const foraDaMesa = amostras.filter(a => a.phase !== 'at_home_desk')
    const fracao = foraDaMesa.length / amostras.length
    assert.ok(fracao > 0.3, `${key} passa só ${Math.round(fracao * 100)}% do ciclo fora da mesa`)
    assert.ok(fracao < 0.9, `${key} quase nunca volta para a mesa (${Math.round(fracao * 100)}%)`)
  }
})

test('o ciclo percorre todas as fases, em ordem', () => {
  for (const key of AGENTES) {
    const fases = varrer(key).map(a => a.phase)
    for (const esperada of ['at_home_desk', 'ambient_walking', 'ambient_at_waypoint', 'returning_home'] as const) {
      assert.ok(fases.includes(esperada), `${key} nunca entra em ${esperada}`)
    }
    // Caminha ANTES de chegar; volta DEPOIS do último ponto.
    assert.ok(fases.indexOf('ambient_walking') < fases.indexOf('ambient_at_waypoint'),
      `${key} chega ao ponto sem caminhar`)
    assert.ok(fases.lastIndexOf('ambient_at_waypoint') < fases.indexOf('returning_home'),
      `${key} volta antes de terminar a última ação`)
  }
})

// ─── 3, 4. Determinismo e agendas distintas ────────────────────────────────

test('3) as rotas são determinísticas', () => {
  for (const key of AGENTES) {
    for (const t of [0, 1_500, 7_777, 23_400, 61_000, 187_321]) {
      const a = ambientStateAt(AMBIENT_ROUTINES[key], t)
      const b = ambientStateAt(AMBIENT_ROUTINES[key], t)
      assert.deepEqual(a, b, `${key} divergiu no mesmo instante`)
    }
  }
  // Nada de aleatório em NENHUM arquivo da camada.
  const codigo = semComentarios(motion + hook + cena + avatar)
  assert.ok(!/Math\.random/.test(codigo), 'a rotina não pode sortear nada')
  assert.ok(!/Date\.now\(\)/.test(semComentarios(motion + hook)), 'a rota não pode depender de que horas são')
})

test('4) cada agente tem agenda própria — nunca saem juntos', () => {
  const atrasos = AGENTES.map(k => AMBIENT_ROUTINES[k].startDelayMs)
  assert.equal(new Set(atrasos).size, 3, 'os atrasos iniciais precisam ser distintos')

  // Os ciclos têm a MESMA duração de propósito: com durações diferentes eles
  // entrariam em fase mais cedo ou mais tarde e passariam a caminhar juntos.
  const ciclos = AGENTES.map(k => cycleDuration(AMBIENT_ROUTINES[k]))
  assert.equal(new Set(ciclos).size, 1, 'os ciclos precisam fechar no mesmo período')

  // Rotas diferentes: nenhum par compartilha os mesmos pontos.
  const rotas = AGENTES.map(k => AMBIENT_ROUTINES[k].legs.map(l => l.waypoint).join('>'))
  assert.equal(new Set(rotas).size, 3, 'as rotas precisam ser diferentes')

  // E na prática, ao longo de vários ciclos: nunca dois caminhando ao mesmo
  // tempo, nem dois fora da mesa ao mesmo tempo.
  const periodo = cycleDuration(AMBIENT_ROUTINES.researcher)
  let andandoJuntos = 0
  let foraJuntos = 0
  for (let t = 0; t < periodo * 4; t += 100) {
    const estados = AGENTES.map(k => ambientStateAt(AMBIENT_ROUTINES[k], t))
    if (estados.filter(isAmbientMoving).length > 1) andandoJuntos++
    if (estados.filter(e => e.phase !== 'at_home_desk').length > 1) foraJuntos++
  }
  assert.equal(andandoJuntos, 0, `${andandoJuntos} instantes com dois agentes caminhando`)
  assert.equal(foraJuntos, 0, `${foraJuntos} instantes com dois agentes fora da mesa`)
})

// ─── 5, 6, 7. A camada não toca em dado nenhum ─────────────────────────────

test('5,6,7) o movimento ambiental não cria evento, não altera timeline, não chama backend', () => {
  for (const [nome, bruto] of [['máquina', motion], ['hook', hook]] as const) {
    const src = semComentarios(bruto)
    assert.ok(!/emitEvent|cs_events|advanceDemo|startDemoProduction|getDemoState/.test(src),
      `${nome} não pode tocar em dados`)
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|supabase/i.test(src), `${nome} não pode chamar backend`)
    assert.ok(!/https?:\/\//.test(src), `${nome} não pode ter URL`)
  }
  // A view-model de negócio não ganhou nada por causa disso.
  const vm = readFileSync(join(RAIZ, 'src/lib/content-studio/view-model.ts'), 'utf8')
  assert.ok(!/ambient|waypoint|rotina/i.test(vm), 'a camada de vida não pode virar estado persistido')

  // E a máquina não importa nada do domínio: é geometria e tempo.
  assert.ok(!/from '@\/lib\/content-studio/.test(motion), 'a máquina não pode depender do domínio')
})

// ─── 8 a 11. Prioridade absoluta dos eventos reais ─────────────────────────

test('8,9,10,11) qualquer evento real interrompe a rotina', () => {
  // Todo estado visual que não seja idle vem de um evento — e todos cedem.
  const porEvento: Record<string, string> = {
    agent_queued: 'queued',
    agent_started: 'working',
    agent_completed: 'done',
    task_handoff_started: 'walking',
    agent_retrying: 'queued',
    agent_failed: 'error',
  }

  for (const [evento, estado] of Object.entries(porEvento)) {
    const r = resolveAmbient({
      agentKey: 'researcher',
      visualState: estado,
      isFocus: false,
      // Instante em que a rotina estaria em pleno andamento.
      elapsedMs: AMBIENT_ROUTINES.researcher.startDelayMs + 1_000,
    })
    assert.equal(r.phase, 'task_controlled', `${evento} (${estado}) não interrompeu a rotina`)
    assert.equal(r.waypoint, null, `${evento} deixou o agente preso a um ponto`)
    assert.equal(isAmbientMoving(r), false, `${evento} deixou o agente andando por conta própria`)
  }

  // O foco também interrompe, mesmo com o agente ocioso.
  const focado = resolveAmbient({
    agentKey: 'researcher', visualState: 'idle', isFocus: true,
    elapsedMs: AMBIENT_ROUTINES.researcher.startDelayMs + 1_000,
  })
  assert.equal(focado.phase, 'task_controlled', 'o agente em foco não pode ter rotina')

  // `idle` sem foco é o ÚNICO caso em que a rotina roda.
  const livre = resolveAmbient({
    agentKey: 'researcher', visualState: 'idle', isFocus: false,
    elapsedMs: AMBIENT_ROUTINES.researcher.startDelayMs + 1_000,
  })
  assert.notEqual(livre.phase, 'task_controlled')
  assert.equal(isTaskControlled('idle'), false)
  for (const s of ['queued', 'working', 'walking', 'done', 'error']) {
    assert.equal(isTaskControlled(s), true, `${s} deveria ser controlado pela tarefa`)
  }
})

test('12) o retorno é interpolado — nunca teleporte', () => {
  // Quando a rotina cede, o alvo vira a mesa. Quem leva o personagem até lá é
  // a transição CSS de `.cs-actor` — a mesma do handoff.
  assert.ok(cena.includes('.cs-actor  { transition: transform'), 'falta a transição de deslocamento')
  // Nenhum salto: a cena não reposiciona sem transição.
  assert.ok(!/style=\{\{\s*transform[^}]*\}\}\s*\/>/m.test(cena) || cena.includes('cs-actor'),
    'toda mudança de posição precisa passar pela classe com transição')

  // O agente em rotina usa o MESMO ciclo de passos do handoff.
  assert.ok(avatar.includes("'cs-char--walk cs-char--amb-walk'"), 'a caminhada ambiental usa o rig')
})

// ─── 13, 14. Hook: cancelamento e reduced-motion ───────────────────────────

test('13) o hook cancela o requestAnimationFrame no unmount', () => {
  assert.ok(hook.includes('requestAnimationFrame'), 'o relógio precisa usar rAF')
  assert.ok(hook.includes('cancelAnimationFrame(frame)'), 'falta cancelar o rAF')
  assert.ok(/return \(\) => \{[\s\S]*?cancelAnimationFrame/.test(hook), 'o cancelamento precisa estar na limpeza')
  assert.ok(hook.includes('vivo = false'), 'o laço precisa parar de reagendar')

  // Nada de setInterval: com a aba em segundo plano ele continuaria rodando.
  const codigoHook = semComentarios(hook)
  assert.ok(!/setInterval/.test(codigoHook), 'setInterval não pode ser usado')
  assert.ok(codigoHook.includes('performance.now()'), 'o tempo visual vem de performance.now')
  assert.ok(!/Date\.now/.test(codigoHook), 'o tempo não pode vir do relógio de parede')
})

test('14) reduced-motion desliga a locomoção ambiental', () => {
  const r = resolveAmbient({
    agentKey: 'researcher', visualState: 'idle', isFocus: false,
    elapsedMs: 999_999, reducedMotion: true,
  })
  assert.equal(r.phase, 'task_controlled', 'reduced-motion precisa parar a rotina')

  // O hook nem liga o relógio.
  assert.ok(cena.includes('useAmbientOfficeMotion(OFFICE_AGENT_ORDER, !reducedMotion'),
    'o relógio precisa ser desligado por reduced-motion')
  assert.ok(hook.includes('return enabled ? mapa : parado'), 'desligado, o valor é derivado e estável')
})

// ─── 15, 16. Limites da cena ───────────────────────────────────────────────

test('15,16) nenhum waypoint sai do viewBox nem cai sobre uma mesa', () => {
  const vb = (nome: string) => {
    const m = new RegExp(`${nome}: '0 0 (\\d+) (\\d+)'`).exec(cena)!
    return { w: Number(m[1]), h: Number(m[2]) }
  }
  // Fatia o bloco do layout indo até o próximo layout (ou o fim) — parar no
  // primeiro "}," pegaria só o primeiro ponto.
  const bloco = (fonte: string, nome: string) => {
    const i = fonte.indexOf(nome + ': {')
    const resto = fonte.slice(i)
    const fim = resto.indexOf('\n  },')
    return fim === -1 ? resto : resto.slice(0, fim)
  }

  const wps = cena.slice(cena.indexOf('const WAYPOINTS'), cena.indexOf('export interface OfficeSceneProps'))
  const desksSrc = cena.slice(cena.indexOf('const DESKS'), cena.indexOf('const VISIT_OFFSET'))
  const parse = (t: string) =>
    [...t.matchAll(/(\w+):\s*{\s*x:\s*(\d+),\s*y:\s*(\d+)/g)].map(m => ({ nome: m[1], x: +m[2], y: +m[3] }))

  for (const layout of ['wide', 'compact'] as const) {
    const { w, h } = vb(layout)
    const pontos = parse(bloco(wps, layout))
    const mesas = parse(bloco(desksSrc, layout))

    assert.equal(pontos.length, 6, `${layout}: esperava 6 waypoints, achei ${pontos.length}`)

    for (const p of pontos) {
      // Meia-largura do personagem ~19; sombra desce ~60; balão sobe ~56.
      assert.ok(p.x - 19 > 0 && p.x + 19 < w, `${layout}/${p.nome}: fora do viewBox em x (${p.x}, w=${w})`)
      assert.ok(p.y - 56 > 0 && p.y + 60 < h, `${layout}/${p.nome}: fora do viewBox em y (${p.y}, h=${h})`)

      // Não pode cair sobre uma mesa: a mesa ocupa ~76 de meia-largura e a
      // faixa de -30 a +45 em y a partir do centro da estação.
      for (const m of mesas) {
        const sobreposto = Math.abs(p.x - m.x) < 60 && p.y > m.y - 34 && p.y < m.y + 46
        assert.ok(!sobreposto, `${layout}/${p.nome} cai sobre a mesa de ${m.nome}`)
      }
    }
  }
})

// ─── 17 a 21. Rig e escopo ─────────────────────────────────────────────────

test('17,18) o rig continua íntegro na caminhada ambiental', () => {
  // A caminhada ambiental reaproveita `cs-char--walk`: as mesmas regras que
  // movem pelve, coluna, quadris, joelhos e tornozelos juntos.
  const regras = cena.slice(cena.indexOf('.cs-char--walk '), cena.indexOf('.cs-char--type '))
  for (const junta of ['cs-j--pelvis', 'cs-j--spine', 'cs-j--hipR', 'cs-j--kneeR', 'cs-j--ankleR']) {
    assert.ok(regras.includes(junta), `a caminhada precisa animar ${junta}`)
  }

  // As poses de waypoint só tocam braço e cabeça — nunca a base do corpo.
  const acoes = cena.split('\n').filter(l => /\.cs-char--act-/.test(l))
  assert.ok(acoes.length >= 6, 'faltam poses de ação nos pontos')
  for (const a of acoes) {
    for (const proibida of ['cs-j--pelvis', 'cs-j--hip', 'cs-j--knee', 'cs-j--ankle']) {
      assert.ok(!a.includes(proibida), `a pose de waypoint não pode animar ${proibida}: ${a.trim()}`)
    }
  }

  // Socket/Joint continuam com os papéis separados.
  const rig = readFileSync(join(RAIZ, 'src/components/content-studio/agent-rig.tsx'), 'utf8')
  const socket = rig.slice(rig.indexOf('export function Socket'), rig.indexOf('export function Joint'))
  const joint = rig.slice(rig.indexOf('export function Joint'), rig.indexOf('export function Bone'))
  assert.ok(socket.includes('transform={`translate(') && !socket.includes('className'))
  assert.ok(joint.includes('className={`cs-j cs-j--') && !joint.includes('transform='))
})

test('19,20,21) nada fora da camada visual foi tocado', () => {
  const r1 = readFileSync(join(RAIZ, 'src/lib/security/cron-auth.ts'), 'utf8')
  const rota = readFileSync(join(RAIZ, 'src/app/api/queue/process/route.ts'), 'utf8')
  assert.ok(r1.includes('timingSafeEqual') && rota.includes('evaluateCronAuth'), 'R1 precisa estar intacto')

  const actions = readFileSync(join(RAIZ, 'src/app/actions/content-studio.ts'), 'utf8')
  const assinaturas = [...actions.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
    .map(([, n, p]) => `${n}(${p.trim()})`).sort()
  assert.deepEqual(assinaturas, [
    'advanceDemo(productionId: string)',
    'getDemoState(productionId: string)',
    'getLatestDemo()',
    'startDemoProduction()',
  ], 'a camada visual não pode mudar o contrato das actions')

  for (const [nome, src] of [['máquina', motion], ['hook', hook], ['cena', cena], ['avatar', avatar]] as const) {
    for (const alvo of ['cron-auth', 'queue/process', 'CRON_SECRET', 'CRON_AUTH_ENFORCE', 'createAdminClient']) {
      assert.ok(!src.includes(alvo), `${nome} referencia ${alvo}`)
    }
  }
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
