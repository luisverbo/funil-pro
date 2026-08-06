// ============================================================================
// Content Studio — MVP de imagens (Studio, sob demanda)
// ----------------------------------------------------------------------------
// O que se prova: OpenAI gera SÓ o fundo (prompt proíbe texto), o FunilPro
// compõe a arte final com sharp, o upload recebe BYTES, o banco só guarda
// metadados, uma chamada paga por slide (claim atômico + CAS de regeneração),
// e nada disso toca produções antigas, R1 ou o status principal da produção.
//
// NENHUM teste chama OpenAI real: provider falso de imagem instalado em todos.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

import {
  buildSlideOverlaySvg, composeSlideImage, escapeSvgText, SLIDE_H, SLIDE_W, wrapText,
} from '../images/compose'
import { buildImagePrompt, IMAGE_PROMPT_BANS, STUDIO_IMAGE_PROMPT_VERSION } from '../images/prompt'
import {
  __setStudioImageProviderForTests, preflightStudioImages,
  type StudioImageProvider,
} from '../images/provider'
import {
  imageStepIndex, runStudioSlideImage, slideOfImageStep, STUDIO_IMAGE_AGENT_KEY,
  type StudioImageStorage,
} from '../images/run'
import { buildProductionResult } from '../result-view'
import { buildOfficeView, deskOf, AGENT_LABELS } from '../view-model'
import { STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY, STUDIO_STRATEGIST_KEY } from '../studio/schema'
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
      number: i + 1,
      headline: i === 0 ? 'O lead respondeu. E agora, quem viu?' : `Headline concreta do slide ${i + 1}`,
      body: `Texto de apoio do slide ${i + 1}, curto e direto, sem enrolação.`,
    })),
    caption: 'Legenda que complementa o carrossel sem resumir os slides.',
    cta: 'Organize seus leads com o FunilPro',
    hashtags: ['#atendimento', '#leads'],
    review: { approved: true, notes: [] },
  }
}
function arteBoa() {
  return {
    direction: {
      style: 'editorial limpo', palette: 'grafite, branco e laranja',
      typography: 'sem serifa, títulos pesados', mood: 'organização depois do caos',
    },
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1,
      style: 'fundo com contraste', composition: `composição do slide ${i + 1}`,
      elements: ['ícone simples'], colors: 'grafite com laranja',
      layout: 'headline no topo', imagePrompt: `cena ilustrativa do slide ${i + 1}, luz suave`,
    })),
  }
}

/** PNG mínimo válido, gerado pelo próprio sharp — o "retorno da OpenAI". */
async function pngFalso(): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 40, g: 60, b: 90 } },
  }).png().toBuffer()
  return new Uint8Array(buf)
}

function providerImagem(contador?: { calls: number; prompts: string[] }, bytes?: Uint8Array): StudioImageProvider {
  return {
    async generate(req) {
      if (contador) { contador.calls++; contador.prompts.push(req.prompt) }
      return {
        bytes: bytes ?? await pngFalso(),
        model: 'fake-image-model', size: '1024x1024', quality: 'medium', durationMs: 5,
      }
    },
  }
}

/** Storage falso: registra o que recebeu — o teste inspeciona os BYTES. */
function storageFalso() {
  const uploads: { path: string; bytes: Uint8Array; contentType: string }[] = []
  const storage: StudioImageStorage = {
    async upload(path, bytes, contentType) {
      uploads.push({ path, bytes, contentType })
      return { path, url: `https://cdn.example/${path}` }
    },
  }
  return { storage, uploads }
}

// ─── Store em memória (mesmas travas: índice único + CAS) ───────────────────

class MemStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0

  criar(status: ProductionStatus = 'awaiting_approval'): ProductionRow {
    const p: ProductionRow = {
      id: 'prod-img', tenant_id: 'tenant-A', pipeline_key: 'content_carousel_studio_v1',
      title: 'Studio', brief: { slides: N, marca_negocio: 'FunilPro', cta: 'Organize seus leads' },
      status, next_event_seq: 0, created_by: null,
      created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    }
    this.productions.set(p.id, p)
    return p
  }

  /** Produção com os TRÊS steps de texto completos. */
  comTexto(status: ProductionStatus = 'awaiting_approval'): ProductionRow {
    const p = this.criar(status)
    const dados: Record<string, Record<string, unknown>> = {
      [STUDIO_STRATEGIST_KEY]: planoBom(),
      [STUDIO_COPYWRITER_KEY]: copyBoa(),
      [STUDIO_DESIGNER_KEY]: arteBoa(),
    }
    ;[STUDIO_STRATEGIST_KEY, STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY].forEach((k, i) => {
      this.steps.push({
        id: `step-${k}`, production_id: p.id, tenant_id: p.tenant_id, agent_key: k,
        step_index: i, depends_on: [], status: 'completed', input: null,
        output: { data: dados[k], artifacts: [], usage: undefined },
        attempt: 0, error: null, started_at: 'x', completed_at: 'x',
      })
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
    const criados = rows.map(r => ({ ...r, id: `step-${r.agent_key}-${r.step_index}-${++this.n}` }))
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
  async insertJob(job: Omit<JobRow, 'id'>) { this.jobs.push({ ...job, id: `job-${this.jobs.length}` }); return this.jobs[this.jobs.length - 1] }
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
      ui_hint: i.uiHint ?? null, occurred_at: '2026-01-01T00:00:00.000Z',
    })
    return p.next_event_seq
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Integração e configuração
// ════════════════════════════════════════════════════════════════════════════

test('1) a integração reutiliza a MESMA OPENAI_API_KEY do Whisper, sem variável nova', () => {
  // A integração pré-existente localizada pela auditoria:
  const whisper = ler('src/lib/agents/transcribe.ts')
  assert.ok(whisper.includes('OPENAI_API_KEY') && whisper.includes('api.openai.com'))

  // O provider de imagem usa a MESMA variável e o endpoint oficial de imagens.
  const provider = ler('src/lib/content-studio/images/provider.ts')
  assert.ok(provider.includes('process.env.OPENAI_API_KEY'), 'não usa a chave existente')
  assert.ok(provider.includes('api.openai.com/v1/images/generations'), 'endpoint errado')

  // Nenhuma variável nova, nada NEXT_PUBLIC, nenhum SDK no navegador.
  // Comentários fora: o que importa é o CÓDIGO não referenciar NEXT_PUBLIC.
  const fontes = ['images/provider.ts', 'images/prompt.ts', 'images/run.ts', 'images/compose.ts']
    .map(f => semComentarios(ler(`src/lib/content-studio/${f}`))).join('\n')
  assert.ok(!/NEXT_PUBLIC/.test(fontes), 'variável NEXT_PUBLIC na camada de imagens')
  assert.ok(!/OPENAI_IMAGE|OPENAI_API_KEY_2|IMAGES_KEY/.test(fontes), 'chave nova inventada')
  for (const comp of ['result-panel.tsx', 'office-preview.tsx']) {
    assert.ok(!ler(`src/components/content-studio/${comp}`).includes('OPENAI'),
      `${comp} referencia OpenAI no cliente`)
  }
})

test('2) preflight SEM chave falha antes de qualquer persistência', () => {
  const anterior = process.env.OPENAI_API_KEY
  delete process.env.OPENAI_API_KEY
  __setStudioImageProviderForTests(null)
  try {
    assert.throws(() => preflightStudioImages(), /studio_images:missing_key/)
    // Provider de teste instalado: preflight passa (o teste nunca chama rede).
    __setStudioImageProviderForTests(providerImagem())
    assert.doesNotThrow(() => preflightStudioImages())
  } finally {
    if (anterior !== undefined) process.env.OPENAI_API_KEY = anterior
    __setStudioImageProviderForTests(null)
  }
})

test('3) tenant só da sessão; pipeline studio obrigatório; prompt nunca do cliente', () => {
  const actions = semComentarios(ler('src/app/actions/content-production.ts'))
  const corpo = actions.slice(actions.indexOf('async function loadStudioProductionForImages'))
    .split('\nexport ')[0]
  assert.ok(corpo.includes(".eq('tenant_id', tenantId)"), 'tenant não vem da sessão')
  assert.ok(corpo.includes('wrong_pipeline'), 'não recusa pipelines de outras gerações')

  for (const nome of ['generateStudioSlideImage', 'generateAllStudioSlideImages']) {
    const fn = actions.slice(actions.indexOf(`export async function ${nome}`)).split('\nexport ')[0]
    assert.ok(fn.includes('await currentTenantId()'), `${nome} sem tenant da sessão`)
    assert.ok(fn.includes("fail('unauthenticated')"), `${nome} sem recusa de sessão`)
    assert.ok(!/prompt/i.test(fn.split('(')[0]), 'assinatura aceita prompt')
  }
  // O prompt nasce da direção PERSISTIDA do Designer, no servidor.
  const run = semComentarios(ler('src/lib/content-studio/images/run.ts'))
  assert.ok(run.includes('buildImagePromptV2(resultado.visual.geral, visualSlide'), 'o prompt não nasce do output do Designer')
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Validações e prompt
// ════════════════════════════════════════════════════════════════════════════

test('4) sem Copywriter+Designer concluídos: nada é criado nem chamado', async () => {
  const contador = { calls: 0, prompts: [] as string[] }
  __setStudioImageProviderForTests(providerImagem(contador))
  const { storage, uploads } = storageFalso()
  const store = new MemStore()
  const p = store.criar('running')  // produção SEM steps de texto

  const r = await runStudioSlideImage(store, storage, p, 1)
  assert.equal(r.state, 'invalid')
  assert.equal(r.errorCode, 'text_not_ready')
  assert.equal(contador.calls, 0)
  assert.equal(uploads.length, 0)
  assert.equal(store.steps.length, 0)
  assert.equal(store.events.length, 0)
})

test('5) slide fora da quantidade pedida é recusado sem efeito colateral', async () => {
  const contador = { calls: 0, prompts: [] as string[] }
  __setStudioImageProviderForTests(providerImagem(contador))
  const { storage } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()

  for (const invalido of [0, -1, N + 1, 99, 1.5, NaN]) {
    const r = await runStudioSlideImage(store, storage, p, invalido as number)
    assert.equal(r.state, 'invalid', `aceitou slide ${invalido}`)
  }
  assert.equal(contador.calls, 0)
  assert.equal(store.steps.filter(s => s.agent_key === STUDIO_IMAGE_AGENT_KEY).length, 0)
})

test('6) o prompt proíbe texto, letras, números, logotipos e marca-d\'água', async () => {
  // A constante fixa:
  assert.ok(IMAGE_PROMPT_BANS.includes('sem texto'))
  assert.ok(IMAGE_PROMPT_BANS.includes('sem letras'))
  assert.ok(IMAGE_PROMPT_BANS.includes('sem números'))
  assert.ok(IMAGE_PROMPT_BANS.includes('sem logotipos'))
  assert.ok(IMAGE_PROMPT_BANS.includes('sem marca-d\'água'))

  // E ela chega INTEIRA ao provider, mesmo com direção longa:
  const contador = { calls: 0, prompts: [] as string[] }
  __setStudioImageProviderForTests(providerImagem(contador))
  const { storage } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()
  await runStudioSlideImage(store, storage, p, 1)

  assert.equal(contador.prompts.length, 1)
  assert.ok(contador.prompts[0].includes(IMAGE_PROMPT_BANS), 'as proibições não chegaram ao provider')
  assert.ok(contador.prompts[0].includes('cena ilustrativa do slide 1'), 'a direção do Designer não chegou')
  assert.equal(STUDIO_IMAGE_PROMPT_VERSION, 'studio_image_v1')
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Uma chamada por slide: claim, concorrência e regeneração
// ════════════════════════════════════════════════════════════════════════════

test('7) replay após completed REUTILIZA — nenhuma segunda chamada', async () => {
  const contador = { calls: 0, prompts: [] as string[] }
  __setStudioImageProviderForTests(providerImagem(contador))
  const { storage, uploads } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()

  const a = await runStudioSlideImage(store, storage, p, 2)
  assert.equal(a.state, 'created')
  assert.ok(a.url)

  const b = await runStudioSlideImage(store, storage, p, 2)
  assert.equal(b.state, 'reused')
  assert.equal(b.url, a.url)
  assert.equal(contador.calls, 1, 'replay pagou de novo')
  assert.equal(uploads.length, 1)
})

test('8) CONCORRÊNCIA: 5 cliques simultâneos no mesmo slide → UMA chamada', async () => {
  let liberar!: () => void
  const barreira = new Promise<void>(res => { liberar = res })
  const contador = { calls: 0 }
  __setStudioImageProviderForTests({
    async generate() {
      contador.calls++
      await barreira
      return { bytes: await pngFalso(), model: 'fake', size: '1024x1024', quality: 'medium', durationMs: 1 }
    },
  })
  const { storage, uploads } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()

  const corridas = Array.from({ length: 5 }, () => runStudioSlideImage(store, storage, p, 3))
  await new Promise(res => setTimeout(res, 10))

  assert.equal(contador.calls, 1, `${contador.calls} chamadas — corrida de claim`)
  assert.equal(store.steps.filter(s => s.step_index === imageStepIndex(3)).length, 1)
  assert.equal(store.events.filter(e => e.type === 'agent_started').length, 1)

  liberar()
  const finais = await Promise.all(corridas)
  assert.equal(contador.calls, 1)
  assert.equal(uploads.length, 1)
  assert.equal(finais.filter(f => f.state === 'created').length, 1)
  assert.ok(finais.filter(f => f.state === 'in_progress').length >= 1)
})

test('9) slides diferentes são independentes; carrossel de N slides custa N chamadas', async () => {
  const contador = { calls: 0, prompts: [] as string[] }
  __setStudioImageProviderForTests(providerImagem(contador))
  const { storage, uploads } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()

  for (let n = 1; n <= N; n++) {
    const r = await runStudioSlideImage(store, storage, p, n)
    assert.equal(r.state, 'created', `slide ${n} não gerou`)
  }
  assert.equal(contador.calls, N, 'custo diferente de 1 chamada por slide')
  assert.equal(uploads.length, N)
  assert.equal(new Set(uploads.map(u => u.path)).size, N, 'paths colidiram')
})

test('10) falha NÃO se repete sozinha; "Tentar novamente" é explícito e com CAS', async () => {
  const contador = { calls: 0 }
  let falhar = true
  __setStudioImageProviderForTests({
    async generate() {
      contador.calls++
      if (falhar) {
        const err = new Error('studio_images:provider_error: status=500')
        ;(err as { code?: string }).code = 'studio_images:provider_error'
        throw err
      }
      return { bytes: await pngFalso(), model: 'fake', size: '1024x1024', quality: 'medium', durationMs: 1 }
    },
  })
  const { storage } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto('awaiting_approval')

  const a = await runStudioSlideImage(store, storage, p, 1)
  assert.equal(a.state, 'failed')
  assert.equal(store.steps.find(s => s.step_index === imageStepIndex(1))!.status, 'failed')
  // A geração visual NUNCA altera o status principal da produção.
  assert.equal(store.productions.get(p.id)!.status, 'awaiting_approval')

  // Sem retry explícito: nada acontece.
  const b = await runStudioSlideImage(store, storage, p, 1)
  assert.equal(b.state, 'failed_existing')
  assert.equal(contador.calls, 1)

  // Retry explícito: UMA nova tentativa controlada.
  falhar = false
  const c = await runStudioSlideImage(store, storage, p, 1, { retry: true })
  assert.equal(c.state, 'created')
  assert.equal(contador.calls, 2)
  assert.equal(store.steps.find(s => s.step_index === imageStepIndex(1))!.attempt, 1)
})

test('11) dois "Tentar novamente" simultâneos: o CAS deixa passar UM', async () => {
  let liberar!: () => void
  const barreira = new Promise<void>(res => { liberar = res })
  const contador = { calls: 0 }
  __setStudioImageProviderForTests({
    async generate() {
      contador.calls++
      await barreira
      return { bytes: await pngFalso(), model: 'fake', size: '1024x1024', quality: 'medium', durationMs: 1 }
    },
  })
  const { storage } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()

  // Step de imagem já FAILED (uma falha paga anterior).
  store.steps.push({
    id: 'step-img-falho', production_id: p.id, tenant_id: p.tenant_id,
    agent_key: STUDIO_IMAGE_AGENT_KEY, step_index: imageStepIndex(4),
    depends_on: [STUDIO_DESIGNER_KEY], status: 'failed', input: { slide: 4 },
    output: null, attempt: 0, error: 'x', started_at: 'x', completed_at: 'x',
  })

  const corridas = [
    runStudioSlideImage(store, storage, p, 4, { retry: true }),
    runStudioSlideImage(store, storage, p, 4, { retry: true }),
  ]
  await new Promise(res => setTimeout(res, 10))
  assert.equal(contador.calls, 1, 'os dois cliques pagaram')

  liberar()
  const [a, b] = await Promise.all(corridas)
  assert.deepEqual([a.state, b.state].sort(), ['created', 'in_progress'])
  assert.equal(contador.calls, 1)
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Storage e persistência
// ════════════════════════════════════════════════════════════════════════════

test('12) o upload recebe BYTES (JPEG real), com path de tenant e produção', async () => {
  __setStudioImageProviderForTests(providerImagem())
  const { storage, uploads } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()
  await runStudioSlideImage(store, storage, p, 1)

  assert.equal(uploads.length, 1)
  const u = uploads[0]
  assert.ok(u.bytes instanceof Uint8Array, 'upload não recebeu bytes')
  // JPEG de verdade (composição sharp), não o PNG cru da OpenAI:
  assert.equal(u.bytes[0], 0xff); assert.equal(u.bytes[1], 0xd8)
  assert.equal(u.contentType, 'image/jpeg')
  assert.ok(u.path.includes(p.tenant_id) && u.path.includes(p.id), 'path sem tenant/produção')
  assert.ok(u.path.startsWith('content-studio/'))
})

test('13) base64/bytes NUNCA entram no banco — só metadados seguros', async () => {
  // Fundo com bytes marcados: se o base64 dele vazar para steps/eventos, o
  // teste encontra.
  const marcador = await pngFalso()
  __setStudioImageProviderForTests(providerImagem(undefined, marcador))
  const { storage } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()
  await runStudioSlideImage(store, storage, p, 1)

  const b64 = Buffer.from(marcador).toString('base64')
  const persistido = JSON.stringify({ steps: store.steps, events: store.events, prods: [...store.productions.values()] })
  assert.ok(!persistido.includes(b64.slice(0, 48)), 'base64 do fundo foi para o banco')
  assert.ok(!/b64_json|"bytes"/.test(persistido), 'campo de bytes persistido')

  const step = store.steps.find(s => s.step_index === imageStepIndex(1))!
  const data = step.output!.data as Record<string, unknown>
  assert.equal(typeof data.url, 'string')
  assert.equal(typeof data.path, 'string')
  assert.equal(data.model, 'fake-image-model')
  assert.equal(data.size, '1024x1024')
  assert.equal(data.quality, 'medium')
  assert.equal(data.slide, 1)
  assert.equal(step.output!.usage!.imagesGenerated, 1)
  assert.equal(step.output!.usage!.promptVersion, 'studio_image_v2')
})

// ════════════════════════════════════════════════════════════════════════════
// 5. Composição FunilPro
// ════════════════════════════════════════════════════════════════════════════

test('14) o TEXTO nasce no overlay do FunilPro — como CAMINHOS, nunca <text>', () => {
  const svg = buildSlideOverlaySvg({
    headline: 'O lead respondeu. E agora?', body: 'Todo contato com dono e etapa.',
    cta: 'Organize seus leads', marca: 'FunilPro', slideNumber: 6, totalSlides: 6,
  })
  // Glifos vetoriais: o SVG contém <path> de texto e NENHUM elemento <text> —
  // é o que torna a rasterização independente de fontes do sistema (a causa
  // do overlay invisível na Vercel).
  assert.ok(!/<text[\s>]/.test(svg), 'ainda existe <text> dependente de fontconfig')
  assert.ok((svg.match(/<path /g) ?? []).length >= 4, 'headline/body/numeração/marca sem paths')
  // Contraste: véu em gradiente sob o texto; CTA tem o retângulo do botão.
  assert.ok(svg.includes('linearGradient'))
  assert.ok(svg.includes('<rect') && svg.includes('rx="16"'), 'botão do CTA ausente')

  // Copy maliciosa NUNCA vira markup: glifos são paths — nenhuma tag sobra.
  const malicioso = buildSlideOverlaySvg({
    headline: '<script>alert(1)</script>', body: 'a & b', slideNumber: 1, totalSlides: 5,
  })
  assert.ok(!malicioso.includes('<script'), 'copy injetou markup no SVG')
  assert.equal(escapeSvgText('<&>'), '&lt;&amp;&gt;')
})

test('15) composição sharp produz JPEG 1080×1080 REAL a partir do fundo', async () => {
  const fundo = await pngFalso()
  const arte = await composeSlideImage(fundo, {
    headline: 'Headline de teste com quebra de linha automática',
    body: 'Um corpo de texto longo o suficiente para quebrar em mais de uma linha na arte final.',
    cta: 'Chamada final', marca: 'FunilPro', slideNumber: 1, totalSlides: 6,
  })
  assert.equal(arte.contentType, 'image/jpeg')
  assert.equal(arte.width, SLIDE_W)
  assert.equal(arte.height, SLIDE_H)
  // O arquivo é uma imagem DE VERDADE — o sharp relê e confirma as dimensões.
  const meta = await sharp(Buffer.from(arte.bytes)).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.equal(meta.width, 1080)
  assert.equal(meta.height, 1080)
  assert.ok(arte.bytes.byteLength > 10_000, 'JPEG suspeito de vazio')
})

test('16) wrapText quebra, corta palavra gigante e limita linhas com reticências', () => {
  assert.deepEqual(wrapText('uma frase curta', 40, 3), ['uma frase curta'])
  const linhas = wrapText('palavras que precisam quebrar em duas linhas', 22, 3)
  assert.ok(linhas.length >= 2 && linhas.every(l => l.length <= 22))
  const gigante = wrapText('supercalifragilisticexpialidocious', 10, 4)
  assert.ok(gigante.every(l => l.length <= 10))
  const limitado = wrapText('um dois tres quatro cinco seis sete oito nove dez', 8, 2)
  assert.equal(limitado.length, 2)
  assert.ok(limitado[1].endsWith('…'))
})

// ════════════════════════════════════════════════════════════════════════════
// 6. Resultado, escritório e compatibilidade
// ════════════════════════════════════════════════════════════════════════════

test('17) status por slide vem dos STEPS: não gerado/gerando/pronto/falhou', async () => {
  __setStudioImageProviderForTests(providerImagem())
  const { storage } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()

  await runStudioSlideImage(store, storage, p, 1)  // pronto
  store.steps.push({
    id: 'i2', production_id: p.id, tenant_id: p.tenant_id, agent_key: STUDIO_IMAGE_AGENT_KEY,
    step_index: imageStepIndex(2), depends_on: [], status: 'running', input: null,
    output: null, attempt: 0, error: null, started_at: 'x', completed_at: null,
  })
  store.steps.push({
    id: 'i3', production_id: p.id, tenant_id: p.tenant_id, agent_key: STUDIO_IMAGE_AGENT_KEY,
    step_index: imageStepIndex(3), depends_on: [], status: 'failed', input: null,
    output: null, attempt: 0, error: 'x', started_at: 'x', completed_at: 'x',
  })

  const r = buildProductionResult(store.steps)
  assert.equal(r.imagens.length, N)
  assert.equal(r.imagens[0].status, 'pronto')
  assert.ok(r.imagens[0].url?.startsWith('https://cdn.example/'))
  assert.equal(r.imagens[1].status, 'gerando')
  assert.equal(r.imagens[2].status, 'falhou')
  assert.equal(r.imagens[3].status, 'nao_gerado')
  assert.equal(r.imagens[3].url, null)
  // A copy continua íntegra — imagem é anexo, não substituto.
  assert.equal(r.slides.length, N)
})

test('18) o Designer trabalha na cena durante a geração de imagem — eventos reais', async () => {
  __setStudioImageProviderForTests(providerImagem())
  const { storage } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()
  await runStudioSlideImage(store, storage, p, 1)

  assert.equal(deskOf(STUDIO_IMAGE_AGENT_KEY), 'researcher')  // a mesa do Designer
  assert.equal(AGENT_LABELS[STUDIO_IMAGE_AGENT_KEY], 'Designer')

  const started = store.events.find(e => e.type === 'agent_started')!
  assert.equal(started.agent_key, STUDIO_IMAGE_AGENT_KEY)
  const meio = buildOfficeView(store.events.filter(e => e.seq <= started.seq))
  assert.equal(meio.agents.find(a => a.key === 'researcher')!.state, 'working')
  assert.equal(meio.agents.find(a => a.key === 'researcher')!.label, 'Designer')

  const fim = buildOfficeView(store.events)
  assert.equal(fim.agents.find(a => a.key === 'researcher')!.state, 'done')
  assert.ok(!fim.failed)
})

test('19) UI: botões, custo dito antes, progresso "N de M"', () => {
  const painel = ler('src/components/content-studio/result-panel.tsx')
  assert.ok(painel.includes('Gerar imagens do carrossel'))
  assert.ok(painel.includes('Gerar imagem'))
  assert.ok(painel.includes('Regenerar'))
  assert.ok(painel.includes('Tentar novamente'))
  assert.ok(painel.includes('uma geração de imagem por slide'), 'custo não é dito antes')
  assert.ok(painel.includes('de {progressoImagens.total} imagens'), 'progresso N de M ausente')
  assert.ok(painel.includes('loading="lazy"'), 'preview sem carregamento otimizado')
  assert.ok(painel.includes('aspect-square'), 'preview fora da proporção de carrossel')

  const preview = semComentarios(ler('src/components/content-studio/office-preview.tsx'))
  const gerarTodas = preview.slice(preview.indexOf('const gerarTodas'), preview.indexOf('const limparTela'))
  assert.ok(!gerarTodas.includes('setInterval'), 'polling em gerarTodas')
  assert.ok(gerarTodas.includes('for (let i = 0; i < 10'), 'laço sem teto fechado')
  assert.ok(gerarTodas.includes('imagesDone === anterior'), 'sem parada por estagnação')
  // Retry só nasce dos botões explícitos: a action individual recebe o flag.
  assert.ok(preview.includes('...(retry ? { retry: true } : {})'))
})

test('20) produções antigas intactas; R1 intacto; nenhuma migration', () => {
  // Gerações sem Designer nunca ganham imagens (nem botões: comImagens exige
  // visual.disponivel).
  const antigo: StepRow[] = [{
    id: 's1', production_id: 'p', tenant_id: 't', agent_key: 'cc_quick_carousel',
    step_index: 0, depends_on: [], status: 'completed', input: null,
    output: { data: copyBoa() as unknown as Record<string, unknown>, artifacts: [], usage: undefined },
    attempt: 0, error: null, started_at: null, completed_at: null,
  }]
  const r = buildProductionResult(antigo)
  assert.equal(r.imagens.length, 0)
  assert.equal(r.visual.disponivel, false)

  // R1 e cron intocados; nenhuma migration/SQL na camada de imagens.
  assert.ok(ler('src/lib/security/cron-auth.ts').includes('timingSafeEqual'))
  assert.ok(ler('src/app/api/queue/process/route.ts').includes('evaluateCronAuth'))
  const fontes = ['images/provider.ts', 'images/prompt.ts', 'images/run.ts', 'images/compose.ts']
    .map(f => ler(`src/lib/content-studio/${f}`)).join('\n')
  assert.ok(!/CREATE TABLE|ALTER TABLE|exec_sql|insertJob|claimNextJob/.test(fontes),
    'a camada de imagens toca SQL ou fila')

  // O bucket é o REUTILIZADO — o mesmo do uploadQuizImage.
  const actions = ler('src/app/actions/content-production.ts')
  assert.ok(actions.includes("from('quiz-assets')"), 'bucket diferente do autorizado')
})

test('21) identidade dos steps de imagem não colide com os de texto', () => {
  assert.equal(imageStepIndex(1), 101)
  assert.equal(imageStepIndex(8), 108)
  assert.equal(slideOfImageStep({ agent_key: STUDIO_IMAGE_AGENT_KEY, step_index: 103 }), 3)
  assert.equal(slideOfImageStep({ agent_key: STUDIO_DESIGNER_KEY, step_index: 103 }), null)
  assert.equal(slideOfImageStep({ agent_key: STUDIO_IMAGE_AGENT_KEY, step_index: 2 }), null)
  // Os steps de texto usam 0..2 — distância segura de 100+.
  assert.ok(imageStepIndex(1) > 2)
})

test('22) prompt: injeção vinda da copy/designer não remove as proibições', () => {
  const geral = { estilo: 'x'.repeat(2000), paleta: null, tipografia: null, clima: null }
  const slide = {
    numero: 1, estilo: 'a', composicao: 'b', elementos: [], cores: 'c', layout: 'd',
    promptImagem: 'cena longa '.repeat(200),
  }
  const prompt = buildImagePrompt(geral, slide)
  assert.ok(prompt.length <= 1700, 'prompt sem teto')
  assert.ok(prompt.includes(IMAGE_PROMPT_BANS), 'o corte comeu as proibições')
  assert.ok(prompt.trimEnd().endsWith('no typography of any kind.'), 'proibição não é o sufixo final')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (err) { results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) }) }
    finally { __setStudioImageProviderForTests(null) }
  }
  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FALHA'} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
  if (failed.length > 0) process.exitCode = 1
}

void main()
