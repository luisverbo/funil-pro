// ============================================================================
// Testes da locomoção ambiental (V4.1)
// ----------------------------------------------------------------------------
// A máquina é PURA: recebe "quanto tempo visual passou" e devolve "onde o
// agente está". Sem React, sem rAF, sem relógio — por isso dá para varrer
// períodos inteiros aqui, milissegundo a milissegundo.
//
// O que estes testes protegem: que a camada de vida seja COSMÉTICA, que a
// tarefa real sempre vença, e que nada salte na tela.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  activityDuration,
  allowedAmbientAgents,
  AMBIENT_ROUTINES,
  ambientStateAt,
  isAmbientMoving,
  isAwayFromDesk,
  isHandoffActive,
  isTaskControlled,
  occupiedZones,
  resolveAmbient,
  TASK_RETURN_MS,
} from '../../../components/content-studio/ambient-motion'

const RAIZ = process.cwd()
const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

const hook = readFileSync(join(RAIZ, 'src/components/content-studio/use-ambient-motion.ts'), 'utf8')
const motion = readFileSync(join(RAIZ, 'src/components/content-studio/ambient-motion.ts'), 'utf8')
const cena = readFileSync(join(RAIZ, 'src/components/content-studio/office-scene.tsx'), 'utf8')
const avatar = readFileSync(join(RAIZ, 'src/components/content-studio/agent-avatar.tsx'), 'utf8')
const ui = readFileSync(join(RAIZ, 'src/components/content-studio/office-preview.tsx'), 'utf8')

const AGENTES = ['researcher', 'strategist', 'copywriter'] as const
const PERIODO = AMBIENT_ROUTINES.researcher.periodMs

/** Remove comentários: o que o código PROMETE não é o que ele faz. */
const sem = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

/** Estado dos três num instante. */
const snapshot = (t: number) =>
  AGENTES.map(k => ({ key: k, state: ambientStateAt(AMBIENT_ROUTINES[k], t) }))

// ─── 1, 2. Ritmo ───────────────────────────────────────────────────────────

test('1) o primeiro deslocamento acontece em até 6 segundos', () => {
  let primeiro = Infinity
  for (let t = 0; t <= 8_000; t += 50) {
    if (snapshot(t).some(a => isAmbientMoving(a.state))) { primeiro = t; break }
  }
  assert.ok(primeiro >= 3_000, `cedo demais: ${primeiro}ms (mínimo 3s)`)
  assert.ok(primeiro <= 6_000, `tarde demais: ${primeiro}ms (máximo 6s)`)
})

test('2) cada agente age em intervalos de 18 a 30 segundos', () => {
  for (const key of AGENTES) {
    const r = AMBIENT_ROUTINES[key]
    const saidas = [...r.startOffsetsMs].sort((a, b) => a - b)
    assert.ok(saidas.length >= 2, `${key} precisa de mais de uma saída por período`)

    // Inclui o intervalo que atravessa o fim do período.
    const intervalos = saidas.map((v, i) =>
      i === 0 ? v + r.periodMs - saidas[saidas.length - 1] : v - saidas[i - 1])

    for (const iv of intervalos) {
      assert.ok(iv >= 18_000, `${key}: intervalo curto demais (${iv}ms)`)
      assert.ok(iv <= 30_000, `${key}: intervalo longo demais (${iv}ms)`)
    }
  }
})

test('o escritório fica claramente movimentado', () => {
  let comAlguemFora = 0
  const amostras = PERIODO / 100
  for (let t = 0; t < PERIODO; t += 100) {
    if (snapshot(t).some(a => isAwayFromDesk(a.state))) comAlguemFora++
  }
  const fracao = comAlguemFora / amostras
  assert.ok(fracao > 0.5, `só ${Math.round(fracao * 100)}% do tempo com alguém fora da mesa`)
})

// ─── 3, 4. Simultaneidade ──────────────────────────────────────────────────

test('3) ocasionalmente há DOIS agentes em movimento', () => {
  let doisAndando = 0
  for (let t = 0; t < PERIODO; t += 50) {
    if (snapshot(t).filter(a => isAmbientMoving(a.state)).length === 2) doisAndando++
  }
  assert.ok(doisAndando > 0, 'nunca há dois em movimento — o escritório fica parado demais')
})

test('4) NUNCA há três agentes em movimento nem três fora da mesa', () => {
  for (let t = 0; t < PERIODO * 3; t += 25) {
    const s = snapshot(t)
    assert.ok(s.filter(a => isAmbientMoving(a.state)).length < 3, `três caminhando em t=${t}`)
    assert.ok(s.filter(a => isAwayFromDesk(a.state)).length < 3, `três fora da mesa em t=${t}`)
  }
})

// ─── 5, 6. Reserva de zonas ────────────────────────────────────────────────

test('5,6) dois agentes nunca ocupam o mesmo waypoint nem o mesmo trecho', () => {
  // A exclusividade é ESTRUTURAL: as zonas dos três são disjuntas.
  const zonas = AGENTES.map(k => new Set(AMBIENT_ROUTINES[k].zones))
  for (let i = 0; i < zonas.length; i++) {
    for (let j = i + 1; j < zonas.length; j++) {
      const comuns = [...zonas[i]].filter(z => zonas[j].has(z))
      assert.deepEqual(comuns, [], `${AGENTES[i]} e ${AGENTES[j]} compartilham zonas: ${comuns}`)
    }
  }

  // E na prática, varrendo três períodos: nenhuma zona ocupada duas vezes.
  for (let t = 0; t < PERIODO * 3; t += 25) {
    const ocupadas: string[] = []
    for (const key of AGENTES) {
      ocupadas.push(...occupiedZones(AMBIENT_ROUTINES[key], ambientStateAt(AMBIENT_ROUTINES[key], t)))
    }
    assert.equal(new Set(ocupadas).size, ocupadas.length, `zona disputada em t=${t}: ${ocupadas}`)
  }
})

test('cada agente tem waypoints próprios e rotas determinísticas', () => {
  const todos = AGENTES.flatMap(k => AMBIENT_ROUTINES[k].legs.map(l => l.waypoint))
  assert.equal(new Set(todos).size, todos.length, 'waypoints repetidos entre agentes')

  for (const key of AGENTES) {
    for (const t of [0, 3_333, 12_500, 47_000, 123_456]) {
      assert.deepEqual(
        ambientStateAt(AMBIENT_ROUTINES[key], t),
        ambientStateAt(AMBIENT_ROUTINES[key], t),
        `${key} divergiu no mesmo instante`,
      )
    }
  }
  assert.ok(!/Math\.random/.test(sem(motion + hook + cena + avatar)), 'nada pode ser sorteado')
})

// ─── 7, 8, 9. Coreografia de saída ─────────────────────────────────────────

test('7) tarefa recebida fora da mesa entra em task_returning', () => {
  const r = resolveAmbient({
    agentKey: 'researcher',
    visualState: 'queued',
    allowed: false,
    elapsedMs: 5_000,
    returningUntilMs: 5_000 + TASK_RETURN_MS,
  })
  assert.equal(r.phase, 'task_returning', 'o agente precisa voltar andando')

  // Passado o retorno, a tarefa assume.
  const depois = resolveAmbient({
    agentKey: 'researcher', visualState: 'queued', allowed: false,
    elapsedMs: 5_000 + TASK_RETURN_MS + 1, returningUntilMs: 5_000 + TASK_RETURN_MS,
  })
  assert.equal(depois.phase, 'task_controlled')
})

test('8) task_returning usa a pose de caminhada', () => {
  assert.equal(isAmbientMoving({ phase: 'task_returning', waypoint: null, action: null }), true)
  // A cena liga o ciclo de passos do rig para essa fase.
  assert.ok(cena.includes('isAmbientMoving(amb)'), 'a cena precisa ligar a caminhada')
  assert.ok(avatar.includes("'cs-char--walk cs-char--amb-walk'"), 'usa o mesmo rig do handoff')
})

test('9) queued/working só assumem a pose final ao chegar à mesa', () => {
  // Durante o retorno, a fase NÃO é task_controlled — é o que impede o
  // personagem de deslizar já com a pose de trabalho.
  for (const estado of ['queued', 'working']) {
    const durante = resolveAmbient({
      agentKey: 'researcher', visualState: estado, allowed: false,
      elapsedMs: 1_000, returningUntilMs: 1_000 + TASK_RETURN_MS,
    })
    assert.equal(durante.phase, 'task_returning', `${estado} assumiu a pose antes de chegar`)
  }
  // E a cena não trata task_returning como posição de waypoint.
  assert.ok(cena.includes("estado.phase !== 'task_returning'") || cena.includes("phase === 'task_returning'"),
    'a cena precisa distinguir o retorno')
})

// ─── 10, 11. Handoff e erro ────────────────────────────────────────────────

test('10) handoff interrompe imediatamente a rotina de todos', () => {
  const agentes = [
    { key: 'researcher', state: 'walking', carryingFolder: true },
    { key: 'strategist', state: 'idle' },
    { key: 'copywriter', state: 'idle' },
  ]
  assert.equal(isHandoffActive(agentes), true)
  assert.equal(allowedAmbientAgents(agentes, 'researcher').size, 0,
    'durante o handoff ninguém pode ter rotina')

  // Também vale para quem está apenas carregando a pasta, parado.
  const entregando = [
    { key: 'researcher', state: 'idle', carryingFolder: true },
    { key: 'strategist', state: 'idle' },
  ]
  assert.equal(allowedAmbientAgents(entregando, null).size, 0)
})

test('11) erro interrompe a rotina sem caminhada cosmética', () => {
  const r = resolveAmbient({
    agentKey: 'researcher', visualState: 'error', allowed: false,
    elapsedMs: 5_000, returningUntilMs: 5_000 + TASK_RETURN_MS,
  })
  assert.equal(r.phase, 'task_controlled', 'quem falhou não sai andando de volta')
  assert.equal(isAmbientMoving(r), false)

  // A cena também não agenda retorno para quem falhou.
  assert.ok(cena.includes("agent.state !== 'error'"), 'o erro não pode disparar a coreografia')
})

test('a encenação limita quem se move durante uma tarefa', () => {
  const trabalhando = [
    { key: 'researcher', state: 'working' },
    { key: 'strategist', state: 'idle' },
    { key: 'copywriter', state: 'idle' },
  ]
  assert.equal(allowedAmbientAgents(trabalhando, 'researcher').size, 1,
    'com alguém trabalhando, no máximo UM secundário se move')

  const parados = AGENTES.map(k => ({ key: k, state: 'idle' }))
  assert.equal(allowedAmbientAgents(parados, null).size, 3,
    'com a cena parada, todos os ociosos podem se mover')

  // Quem está em foco nunca entra na lista.
  assert.equal(allowedAmbientAgents(parados, 'researcher').has('researcher'), false)
})

// ─── 12 a 16. Relógio: pausa, aba oculta, limpeza ──────────────────────────

test('12,13) pausa congela o relógio e continuar retoma da mesma fase', () => {
  const h = sem(hook)
  assert.ok(/pausedRef\.current \|\| document\.visibilityState !== 'visible'/.test(h),
    'a pausa precisa congelar o tempo visual')
  // Congela sem zerar: o acumulado sobrevive à pausa.
  assert.ok(h.includes('visualRef.current +='), 'o tempo visual é acumulado')
  assert.ok(!/visualRef\.current\s*=\s*0/.test(h.replace(/useRef\(0\)/g, '')),
    'a pausa não pode zerar o tempo visual')
  // E a pausa da UI chega até a cena.
  assert.ok(ui.includes('paused={pausado}'), 'o botão Pausar precisa alcançar a cena')
  assert.ok(cena.includes('paused = false'), 'a cena precisa aceitar a pausa')
})

test('14,15) aba oculta não avança o relógio e voltar não causa salto', () => {
  const h = sem(hook)
  assert.ok(h.includes("document.addEventListener('visibilitychange'"), 'falta o listener de visibilidade')
  assert.ok(h.includes("document.visibilityState === 'visible'"), 'falta reancorar ao voltar')
  assert.ok(/anterior = performance\.now\(\)/.test(h), 'ao voltar, a referência precisa ser reancorada')

  // Teto por quadro: mesmo sem o listener, um delta gigante não vira salto.
  assert.ok(/Math\.min\(bruto, MAX_FRAME_MS\)/.test(h), 'falta o teto de avanço por quadro')
  const teto = Number(/MAX_FRAME_MS\s*=\s*(\d+)/.exec(motion + hook)![1])
  assert.ok(teto > 0 && teto <= 250, `teto por quadro fora de faixa: ${teto}ms`)
})

test('16) unmount cancela rAF e remove listeners', () => {
  const h = sem(hook)
  assert.ok(h.includes('cancelAnimationFrame(frame)'), 'falta cancelar o rAF')
  assert.ok(h.includes("document.removeEventListener('visibilitychange'"), 'falta remover o listener')
  assert.ok(/return \(\) => \{[\s\S]*?cancelAnimationFrame[\s\S]*?removeEventListener/.test(h),
    'a limpeza precisa fazer as duas coisas')
  assert.ok(h.includes('vivo = false'), 'o laço precisa parar de reagendar')
  assert.ok(!/setInterval/.test(h), 'setInterval não pode ser usado')
  assert.ok(h.includes('performance.now()') && !/Date\.now/.test(h), 'o tempo vem de performance.now')
})

// ─── 17, 18, 19. A camada não toca em dado nenhum ──────────────────────────

test('17,18,19) o movimento ambiental não cria evento, não altera timeline, não chama backend', () => {
  for (const [nome, bruto] of [['máquina', motion], ['hook', hook]] as const) {
    const src = sem(bruto)
    assert.ok(!/emitEvent|cs_events|advanceDemo|startDemoProduction|getDemoState/.test(src),
      `${nome} não pode tocar em dados`)
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|supabase/i.test(src), `${nome} não pode chamar backend`)
    assert.ok(!/https?:\/\//.test(src), `${nome} não pode ter URL`)
  }
  assert.ok(!/from '@\/lib\/content-studio/.test(motion), 'a máquina não pode depender do domínio')

  const vm = readFileSync(join(RAIZ, 'src/lib/content-studio/view-model.ts'), 'utf8')
  assert.ok(!/ambient|waypoint|rotina/i.test(vm), 'a camada de vida não pode virar estado persistido')

  // A coreografia de saída é disparada pelo evento, mas não fala com ninguém.
  const efeito = cena.slice(cena.indexOf('const foraDaMesa'), cena.indexOf('const ambienteDe'))
  assert.ok(!/advanceDemo|emitEvent|fetch/.test(efeito), 'a coreografia não pode chamar o backend')
})

test('20) reduced-motion desabilita a locomoção ambiental', () => {
  const r = resolveAmbient({
    agentKey: 'researcher', visualState: 'idle', allowed: true,
    elapsedMs: 5_000, reducedMotion: true,
  })
  assert.equal(r.phase, 'task_controlled', 'reduced-motion precisa parar a rotina')
  assert.ok(cena.includes('useAmbientOfficeMotion(OFFICE_AGENT_ORDER, !reducedMotion'),
    'o relógio precisa ser desligado')
  assert.ok(hook.includes('states: enabled ? states : parado'), 'desligado, o valor é derivado')
})

// ─── 21. Limites da cena ───────────────────────────────────────────────────

test('21) waypoints dentro do viewBox e fora das mesas, nos dois layouts', () => {
  const vb = (nome: string) => {
    const m = new RegExp(`${nome}: '0 0 (\\d+) (\\d+)'`).exec(cena)!
    return { w: Number(m[1]), h: Number(m[2]) }
  }
  const bloco = (fonte: string, nome: string) => {
    const resto = fonte.slice(fonte.indexOf(nome + ': {'))
    const fim = resto.indexOf('\n  },')
    return fim === -1 ? resto : resto.slice(0, fim)
  }
  const parse = (t: string) =>
    [...t.matchAll(/(\w+):\s*{\s*x:\s*(\d+),\s*y:\s*(\d+)/g)].map(m => ({ nome: m[1], x: +m[2], y: +m[3] }))

  const wps = cena.slice(cena.indexOf('const WAYPOINTS'), cena.indexOf('export interface OfficeSceneProps'))
  const desksSrc = cena.slice(cena.indexOf('const DESKS'), cena.indexOf('const VISIT_OFFSET'))

  for (const layout of ['wide', 'compact'] as const) {
    const { w, h } = vb(layout)
    const pontos = parse(bloco(wps, layout))
    const mesas = parse(bloco(desksSrc, layout))
    assert.equal(pontos.length, 6, `${layout}: esperava 6 waypoints, achei ${pontos.length}`)

    for (const p of pontos) {
      assert.ok(p.x - 19 > 0 && p.x + 19 < w, `${layout}/${p.nome}: fora do viewBox em x`)
      assert.ok(p.y - 56 > 0 && p.y + 60 < h, `${layout}/${p.nome}: fora do viewBox em y`)
      for (const m of mesas) {
        const sobre = Math.abs(p.x - m.x) < 60 && p.y > m.y - 34 && p.y < m.y + 46
        assert.ok(!sobre, `${layout}/${p.nome} cai sobre a mesa de ${m.nome}`)
      }
    }
  }
})

// ─── 22, 23, 24. Escopo ────────────────────────────────────────────────────

test('22,23,24) nada fora da camada visual foi tocado', () => {
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
  ], 'o contrato das actions não pode mudar')

  for (const [nome, src] of [['máquina', motion], ['hook', hook], ['cena', cena], ['avatar', avatar]] as const) {
    for (const alvo of ['cron-auth', 'queue/process', 'CRON_SECRET', 'CRON_AUTH_ENFORCE', 'createAdminClient']) {
      assert.ok(!src.includes(alvo), `${nome} referencia ${alvo}`)
    }
  }

  // Sanidade das durações declaradas.
  for (const key of AGENTES) {
    const dur = activityDuration(AMBIENT_ROUTINES[key])
    assert.ok(dur > 5_000 && dur < 15_000, `${key}: saída de ${dur}ms fora do razoável`)
  }
  assert.equal(isTaskControlled('idle'), false)
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
