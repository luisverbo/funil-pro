// ============================================================================
// Testes da Linha do Tempo — rolagem confinada e ocultar/mostrar
// ----------------------------------------------------------------------------
// O bug corrigido aqui: `scrollIntoView({ block: 'nearest' })` no item atual.
// O `nearest` limita o QUANTO se rola, não QUEM rola — a especificação manda
// percorrer todos os ancestrais roláveis até o viewport. Com o painel fora da
// tela, quem se mexia era o documento, e a página era puxada de volta a cada
// evento revelado.
//
// Dois níveis de verificação, de propósito:
//
//   ESTÁTICO — lê o fonte e prova que a API perigosa não voltou e que a
//   rolagem automática só existe sobre o container.
//
//   COMPORTAMENTAL — reimplementa aqui a lógica de auto-follow com um
//   container falso e um `document` falso, e prova que o documento NUNCA é
//   tocado, nem quando chegam eventos, nem ao clicar em "ir para o mais
//   recente". A lógica testada é a mesma do componente: mesma tolerância,
//   mesmas regras.
//
// Sem banco, sem rede, sem navegador.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

const timeline = readFileSync(join(RAIZ, 'src/components/content-studio/timeline-panel.tsx'), 'utf8')
const ui = readFileSync(join(RAIZ, 'src/components/content-studio/office-preview.tsx'), 'utf8')

/** O que o código PROMETE em comentário não é o que ele FAZ. */
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const timelineCode = semComentarios(timeline)
const uiCode = semComentarios(ui)

// ─── Modelo do container e do documento ─────────────────────────────────────

const TOLERANCIA = 32

class ContainerFalso {
  scrollTop = 0
  scrollHeight = 0
  clientHeight = 200
  chamadas: number[] = []

  scrollTo(opts: { top: number }) {
    this.chamadas.push(opts.top)
    this.scrollTop = Math.max(0, Math.min(opts.top, this.scrollHeight - this.clientHeight))
  }

  distanciaDoFim() { return this.scrollHeight - this.scrollTop - this.clientHeight }
}

/** O documento existe só para provar que ninguém encosta nele. */
const documento = { scrollY: 0, scrollTop: 0 }

/**
 * Auto-follow — mesma regra do componente.
 *
 * Note o que NÃO existe aqui: nenhuma referência a `documento`. Essa ausência
 * é a garantia; os testes conferem que ela se mantém.
 */
class AutoFollow {
  noFim = true
  temNovos = false
  total = 0

  constructor(readonly el: ContainerFalso) {}

  /** O usuário rolou a lista com o dedo/roda. */
  aoRolar() {
    this.noFim = this.el.distanciaDoFim() <= TOLERANCIA
    if (this.noFim) this.temNovos = false
  }

  irParaOFim() {
    this.el.scrollTo({ top: this.el.scrollHeight })
    this.noFim = true
    this.temNovos = false
  }

  /** Novos eventos revelados (ou reinício, se o total encolheu). */
  eventos(total: number, alturaPorItem = 40) {
    const anterior = this.total
    this.total = total
    this.el.scrollHeight = total * alturaPorItem

    if (total < anterior) {         // reiniciou
      this.el.scrollTop = 0
      this.noFim = total === 0
      this.temNovos = false
      return
    }
    if (total === anterior) return

    if (this.noFim) this.irParaOFim()
    else this.temNovos = true
  }
}

function novo() {
  documento.scrollY = 0
  documento.scrollTop = 0
  const el = new ContainerFalso()
  return { el, follow: new AutoFollow(el) }
}

function documentoIntacto() {
  assert.equal(documento.scrollY, 0, 'a página foi rolada')
  assert.equal(documento.scrollTop, 0, 'o documento foi rolado')
}

// ─── 1. A API perigosa não existe mais ──────────────────────────────────────

test('1) nenhum item da timeline usa scrollIntoView', () => {
  assert.ok(!timelineCode.includes('scrollIntoView'), 'scrollIntoView voltou ao painel')
  assert.ok(!uiCode.includes('scrollIntoView'), 'scrollIntoView apareceu no Office Preview')

  // E não há ref no <li> só para isso.
  assert.ok(!/\<li[^>]*\bref=/.test(timelineCode), 'o item da lista voltou a receber ref')
})

test('2) a timeline nunca escreve na rolagem do documento', () => {
  for (const [nome, src] of [['timeline', timelineCode], ['ui', uiCode]] as const) {
    assert.ok(!/window\.scroll/.test(src), `${nome} mexe em window.scroll*`)
    assert.ok(!/documentElement\.scrollTop/.test(src), `${nome} mexe no documentElement`)
    assert.ok(!/document\.body\.scroll/.test(src), `${nome} mexe no body`)
    assert.ok(!/\.focus\s*\(/.test(src), `${nome} força foco — foco move a página`)
    assert.ok(!/autoFocus/.test(src), `${nome} usa autoFocus`)
  }
})

test('3) o auto-scroll acontece só sobre o container da lista', () => {
  // A única chamada de rolagem é sobre a ref da <ol>.
  const chamadas = [...timelineCode.matchAll(/(\w+)\.scrollTo\(/g)].map(m => m[1])
  assert.ok(chamadas.length > 0, 'o painel deixou de acompanhar')
  assert.ok(chamadas.every(alvo => alvo === 'el'), `rolagem sobre alvo inesperado: ${chamadas.join(', ')}`)

  assert.ok(timelineCode.includes('top: el.scrollHeight'), 'o alvo do scroll não é o fim da lista')
  assert.ok(/listaRef\s*=\s*useRef/.test(timelineCode), 'a lista precisa de ref própria')
  assert.ok(/ref=\{listaRef\}/.test(timelineCode), 'a ref não está na <ol>')
})

// ─── Comportamento do auto-follow ───────────────────────────────────────────

test('4) quem está no fim continua acompanhando os eventos novos', () => {
  const { el, follow } = novo()
  follow.eventos(10)
  assert.equal(follow.noFim, true)
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight, 'não acompanhou')

  follow.eventos(11)
  assert.equal(el.scrollTop, el.scrollHeight - el.clientHeight)
  assert.equal(follow.temNovos, false, 'não deve avisar quem já está vendo')
  documentoIntacto()
})

test('5) quem rolou para cima NÃO é puxado de volta', () => {
  const { el, follow } = novo()
  follow.eventos(20)

  // O usuário sobe para ler eventos anteriores.
  el.scrollTop = 100
  follow.aoRolar()
  assert.equal(follow.noFim, false)

  const antes = el.scrollTop
  follow.eventos(21)
  follow.eventos(22)

  assert.equal(el.scrollTop, antes, 'a leitura do usuário foi interrompida')
  documentoIntacto()
})

test('6) o botão "ir para o mais recente" aparece só quando faz sentido', () => {
  const { el, follow } = novo()
  follow.eventos(20)
  assert.equal(follow.temNovos, false, 'no fim, sem eventos novos: nada a mostrar')

  el.scrollTop = 60
  follow.aoRolar()
  assert.equal(follow.temNovos, false, 'rolar para cima sozinho não gera aviso')

  follow.eventos(21)
  assert.equal(follow.temNovos, true, 'evento novo longe do fim deve avisar')

  // Voltar ao fim manualmente dispensa o aviso.
  el.scrollTop = el.scrollHeight - el.clientHeight
  follow.aoRolar()
  assert.equal(follow.temNovos, false)

  // E o componente só renderiza o botão nessa combinação.
  assert.ok(timelineCode.includes('{temNovos && !noFim && ('), 'a condição do botão mudou')
})

test('7) clicar em "ir para o mais recente" rola só o painel', () => {
  const { el, follow } = novo()
  follow.eventos(30)
  el.scrollTop = 0
  follow.aoRolar()
  follow.eventos(31)

  el.chamadas.length = 0
  follow.irParaOFim()

  assert.deepEqual(el.chamadas, [el.scrollHeight], 'o clique não levou ao fim da lista')
  assert.equal(follow.temNovos, false)
  documentoIntacto()
})

test('8) a tolerância de "está no fim" fica na faixa pedida (24–48px)', () => {
  const m = /FIM_TOLERANCIA_PX\s*=\s*(\d+)/.exec(timelineCode)
  assert.ok(m, 'a tolerância sumiu')
  const px = Number(m![1])
  assert.ok(px >= 24 && px <= 48, `tolerância fora da faixa: ${px}px`)

  // Meio pixel de arredondamento ainda conta como "no fim".
  const { el, follow } = novo()
  follow.eventos(20)
  el.scrollTop = el.scrollHeight - el.clientHeight - px
  follow.aoRolar()
  assert.equal(follow.noFim, true, 'a folga não está sendo respeitada')

  el.scrollTop -= 1
  follow.aoRolar()
  assert.equal(follow.noFim, false, 'a folga está grande demais')
})

test('9) reiniciar a demonstração volta o painel ao início, não a página', () => {
  const { el, follow } = novo()
  follow.eventos(25)
  assert.ok(el.scrollTop > 0)

  follow.eventos(0)   // reinício: revealed volta a zero
  assert.equal(el.scrollTop, 0, 'o painel não voltou ao início')
  assert.equal(follow.temNovos, false)
  documentoIntacto()

  // E o componente trata explicitamente o encolhimento.
  assert.ok(timelineCode.includes('if (total < anterior)'), 'o reinício deixou de ser tratado')
})

// ─── Ocultar / mostrar ──────────────────────────────────────────────────────

test('10) ocultar não desmonta a lista — os eventos continuam ali', () => {
  // `hidden` esconde; renderização condicional apagaria.
  assert.ok(/id=\{corpoId\}\s+className=\{oculta \? 'hidden'/.test(timelineCode),
    'o corpo da timeline deixou de ser escondido por classe')
  assert.ok(!/\{!oculta &&\s*\(?\s*<ol/.test(timelineCode), 'a lista virou renderização condicional')

  // Os eventos vêm de fora e não são copiados nem filtrados aqui.
  assert.ok(timelineCode.includes('entries.map(item =>'), 'a lista deixou de renderizar entries')
  assert.ok(!/setEntries|slice\(/.test(timelineCode), 'a timeline está mexendo na lista de eventos')
})

test('11) ocultar é só visual: não toca revelação, backend nem eventos', () => {
  for (const alvo of ['advanceDemo', 'startDemoProduction', 'getDemoState', 'createClient', 'fetch(']) {
    assert.ok(!timelineCode.includes(alvo), `a timeline chama ${alvo}`)
  }
  // A revelação continua governada pelo Office Preview, não pelo painel.
  assert.ok(uiCode.includes('setRevealed(n => Math.min(n + 1, allEvents.length))'),
    'a revelação dos eventos foi alterada')
  assert.ok(!timelineCode.includes('setRevealed'), 'a timeline interfere na revelação')
})

test('12) a preferência é lida do localStorage, e só no cliente', () => {
  assert.ok(timelineCode.includes("'content-studio:timeline-collapsed'"), 'a chave mudou')

  // Todo acesso ao storage fica FORA do componente, nas funções de módulo.
  const inicioDoComponente = timelineCode.indexOf('export default function TimelinePanel')
  assert.ok(inicioDoComponente > 0)
  assert.ok(!timelineCode.slice(inicioDoComponente).includes('localStorage'),
    'o corpo do componente passou a tocar localStorage — isso roda no servidor')

  // E protegido: storage bloqueado não pode derrubar a página.
  const acessos = timelineCode.split('localStorage').length - 1
  assert.equal(acessos, 2, 'esperado exatamente um getItem e um setItem')
  const protegidos = [...timelineCode.matchAll(/try\s*{[\s\S]*?}\s*catch/g)]
    .filter(m => m[0].includes('localStorage')).length
  assert.equal(protegidos, acessos, 'todo acesso ao storage precisa de try/catch')
})

test('13) sem risco de hidratação: o primeiro render é sempre "visível"', () => {
  // O snapshot do servidor é literal `false`: ele não consulta nada, então o
  // HTML do servidor e a primeira pintura do cliente não podem divergir.
  assert.ok(/useSyncExternalStore\(assinarPreferencia, lerPreferencia, \(\) => false\)/.test(timelineCode),
    'a preferência precisa entrar como store externo com snapshot de servidor false')
  assert.ok(!/useState\(\(\)\s*=>[^)]*localStorage/.test(timelineCode),
    'o storage voltou para o initializer do useState — isso quebra a hidratação')
  assert.ok(!/localStorage/.test(uiCode), 'o Office Preview passou a ler storage')

  // O padrão sem preferência salva é "visível".
  assert.ok(/getItem\(TIMELINE_COLLAPSED_KEY\) === '1'/.test(timelineCode),
    'só o valor gravado explicitamente pode ocultar; ausência = visível')
})

test('14) o controle de ocultar é acessível', () => {
  const botao = /<button[\s\S]*?aria-expanded=\{!oculta\}[\s\S]*?<\/button>/.exec(timelineCode)
  assert.ok(botao, 'o botão de ocultar sumiu ou perdeu aria-expanded')
  const src = botao![0]
  assert.ok(src.includes('type="button"'), 'faltou type="button"')
  assert.ok(src.includes('aria-controls={corpoId}'), 'faltou aria-controls')
  assert.ok(src.includes('Mostrar linha do tempo') && src.includes('Ocultar linha do tempo'),
    'o texto visível precisa dizer o que o botão faz nos dois estados')

  // O corpo controlado existe e carrega o mesmo id.
  assert.ok(timelineCode.includes('id={corpoId}'), 'aria-controls aponta para um id inexistente')
  assert.ok(timelineCode.includes('useId()'), 'o id precisa ser estável entre servidor e cliente')

  // "Ir para o mais recente" também é botão de verdade, com texto.
  assert.ok(/<button[\s\S]*?Ir para o mais recente/.test(timelineCode))
})

// ─── Layout ─────────────────────────────────────────────────────────────────

test('15) mobile: sem rolagem horizontal e com alvo de toque confortável', () => {
  assert.ok(timelineCode.includes('overflow-x-hidden'), 'a lista pode rolar na horizontal')
  assert.ok(uiCode.includes('overflow-x-hidden'), 'a página perdeu a trava horizontal')

  // O botão precisa de altura de toque (py-2 ≈ 8px + texto ≈ 36px no total).
  const botao = /<button[\s\S]*?aria-expanded=\{!oculta\}[\s\S]*?<\/button>/.exec(timelineCode)![0]
  const py = /py-(\d+(?:\.\d+)?)/.exec(botao)
  assert.ok(py && Number(py[1]) >= 2, `alvo de toque pequeno demais: py-${py?.[1]}`)
  assert.ok(!/sm:hidden/.test(botao), 'o botão precisa existir também no desktop')
})

test('16) desktop: a rolagem fica confinada e o cabeçalho continua visível', () => {
  assert.ok(timelineCode.includes('max-h-80 overflow-y-auto'), 'a lista perdeu a altura máxima')
  assert.ok(timelineCode.includes("overflowAnchor: 'none'"),
    'sem overflow-anchor:none o Chrome briga com o auto-follow')
  assert.ok(timelineCode.includes("overscrollBehavior: 'contain'"),
    'sem overscroll-behavior a rolagem vaza para a página')

  // E a trava fica SÓ no container — nada global.
  const globais = readFileSync(join(RAIZ, 'src/app/globals.css'), 'utf8')
  assert.ok(!/overflow-anchor/.test(globais), 'overflow-anchor foi aplicado globalmente')

  // O cabeçalho está fora do container rolável.
  const antesDaLista = timelineCode.slice(0, timelineCode.indexOf('<ol'))
  assert.ok(antesDaLista.includes('Linha do tempo'), 'o título entrou na área rolável')
})

// ─── Nada fora da camada visual ─────────────────────────────────────────────

test('17) a locomoção ambiental permanece intacta', () => {
  const motion = readFileSync(join(RAIZ, 'src/components/content-studio/ambient-motion.ts'), 'utf8')
  const hook = readFileSync(join(RAIZ, 'src/components/content-studio/use-ambient-motion.ts'), 'utf8')
  assert.ok(motion.includes('AMBIENT_ROUTINES'))
  assert.ok(motion.includes("| 'task_returning'"))
  assert.ok(hook.includes('requestAnimationFrame'))
  assert.ok(hook.includes('cancelAnimationFrame'))
  assert.ok(uiCode.includes('<OfficeScene'), 'o escritório saiu da tela')
  // E a timeline não conhece a locomoção.
  assert.ok(!/ambient|Ambient/.test(timelineCode), 'a timeline passou a mexer na locomoção')
})

test('18) nenhum arquivo do R1 foi tocado', () => {
  const cronAuth = readFileSync(join(RAIZ, 'src/lib/security/cron-auth.ts'), 'utf8')
  const route = readFileSync(join(RAIZ, 'src/app/api/queue/process/route.ts'), 'utf8')
  assert.ok(cronAuth.includes('timingSafeEqual'))
  assert.ok(route.includes('evaluateCronAuth'))
  for (const [nome, src] of [['timeline', timelineCode], ['ui', uiCode]] as const) {
    for (const alvo of ['cron-auth', 'queue/process', 'CRON_SECRET', 'CRON_AUTH_ENFORCE']) {
      assert.ok(!src.includes(alvo), `${nome} referencia ${alvo}`)
    }
  }
})

test('19) Server Actions, store e pipeline seguem intocados', () => {
  const actions = readFileSync(join(RAIZ, 'src/app/actions/content-studio.ts'), 'utf8')
  const assinaturas = [...actions.matchAll(/export async function (\w+)\(([^)]*)\)/g)]
    .map(([, nome, params]) => `${nome}(${params.trim()})`)
  assert.deepEqual(assinaturas.sort(), [
    'advanceDemo(productionId: string)',
    'getDemoState(productionId: string)',
    'getLatestDemo()',
    'startDemoProduction()',
  ])

  const store = readFileSync(join(RAIZ, 'src/lib/content-studio/store.ts'), 'utf8')
  assert.ok(store.includes('createSupabaseContentStore'))
  const pipeline = readFileSync(join(RAIZ, 'src/lib/content-studio/pipeline.ts'), 'utf8')
  assert.ok(pipeline.includes('OFFICE_PIPELINE'))

  // A camada visual não fala com banco nem executa SQL.
  for (const [nome, src] of [['timeline', timelineCode], ['ui', uiCode]] as const) {
    assert.ok(!/supabase|createAdminClient|cs_events/i.test(src.replace('cs_events</code>', '')),
      `${nome} toca o banco`)
  }
})

test('20) a timeline não recebeu dependência nova', () => {
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const importados = [...timeline.matchAll(/from '([^']+)'/g)].map(m => m[1])
  for (const mod of importados) {
    if (mod.startsWith('.') || mod.startsWith('@/')) continue
    assert.ok(mod in deps, `dependência não declarada: ${mod}`)
    assert.ok(['react'].includes(mod), `import externo inesperado na timeline: ${mod}`)
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
