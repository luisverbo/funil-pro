// ============================================================================
// Content Studio — modo VIRAL "capa com foto" (viral_cover_text_v1)
// ----------------------------------------------------------------------------
// O que se prova: UMA chamada de imagem por carrossel (5–8 slides), capa
// 1080×1350 com fotografia LIMPA em cima e painel preto embaixo (por PIXELS),
// slides internos 100% FunilPro, prompt fotográfico com curiosidade e
// proibições intactas, cor de destaque validada com contraste, marca-texto
// exato, e nada disso toca produções antigas. Nenhuma chamada real.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

import {
  ACCENT_COLORS, buildViralCoverPanelSvg, buildViralTextSlideSvg, composeViralCover,
  initialsOf, isValidAccentInput, layoutHighlighted, parseAccentColor,
  renderViralTextSlide, textColorFor, VIRAL_H, VIRAL_PANEL_H, VIRAL_PHOTO_H,
  VIRAL_VISUAL_MODE, VIRAL_W,
} from '../images/viral'
import {
  buildViralCoverPrompt, coerceDesignerCover, CURIOSITY_MECHANISMS,
  deriveViralCoverDirection, isValidViralIntensity, VIRAL_INTENSITY_DEFAULT,
  VIRAL_MINOR_GUARDS, VIRAL_TEXT_BANS,
} from '../images/viral-prompt'
import { runViralCover } from '../images/viral-run'
import { __setStudioImageProviderForTests, type StudioImageProvider } from '../images/provider'
import { type StudioImageStorage } from '../images/run'
import { buildProductionResult } from '../result-view'
import { validateStudioInput, STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY, STUDIO_STRATEGIST_KEY } from '../studio/schema'
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

function copyBoa(n: number) {
  return {
    title: 'T',
    slides: Array.from({ length: n }, (_, i) => ({
      number: i + 1,
      headline: i === 0 ? 'Ela criou algo que ninguém esperava' : `Headline do slide ${i + 1}`,
      body: `Texto de apoio do slide ${i + 1}, direto e claro.`,
      highlights: i === 0 ? ['ninguém esperava'] : [],
    })),
    caption: 'legenda', cta: 'Siga para a parte 2', hashtags: ['#a'],
    review: { approved: true, notes: [] },
  }
}
function arteBoa(n: number) {
  return {
    direction: { style: 'editorial', palette: 'grafite e âmbar', typography: 'sem serifa', mood: 'curiosidade' },
    slides: Array.from({ length: n }, (_, i) => ({
      number: i + 1, style: 'cena', composition: `composição ${i + 1}`,
      elements: ['objetos'], colors: 'grafite', layout: 'bloco inferior', imagePrompt: `cena ${i + 1}`,
    })),
  }
}
function planoBom(n: number) {
  return {
    bigIdea: 'a', angle: 'b', promise: 'c', audience: 'd', tone: 'e',
    beats: Array.from({ length: n }, (_, i) => ({ number: i + 1, purpose: `p${i + 1}` })),
  }
}

async function fotoClara(): Promise<Uint8Array> {
  // "Fotografia" sintética CLARA (cinza 190): qualquer escurecimento aparece.
  const buf = await sharp({ create: { width: 512, height: 768, channels: 3, background: { r: 190, g: 190, b: 190 } } }).png().toBuffer()
  return new Uint8Array(buf)
}

async function luminancia(jpeg: Uint8Array, left: number, top: number, w: number, h: number): Promise<number> {
  const { data } = await sharp(Buffer.from(jpeg)).extract({ left, top, width: w, height: h }).greyscale().raw().toBuffer({ resolveWithObject: true })
  let soma = 0
  for (let i = 0; i < data.length; i++) soma += data[i]
  return soma / data.length
}
async function fracaoClara(jpeg: Uint8Array, left: number, top: number, w: number, h: number, limiar = 200): Promise<number> {
  const { data } = await sharp(Buffer.from(jpeg)).extract({ left, top, width: w, height: h }).greyscale().raw().toBuffer({ resolveWithObject: true })
  let claros = 0
  for (let i = 0; i < data.length; i++) if (data[i] > limiar) claros++
  return claros / data.length
}

class MemStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0

  viral(n: number, accent = 'roxo'): ProductionRow {
    const v = validateStudioInput({
      tema: 'como ela fez isso', slides: n, idempotencyKey: 'viraltest000001', accentColor: accent,
    })
    if (!v.ok) throw new Error('brief inválido')
    const p: ProductionRow = {
      id: 'prod-viral', tenant_id: 'tenant-A', pipeline_key: 'content_carousel_studio_v1',
      title: 'Viral', brief: { ...v.brief, marca_negocio: 'FunilPro' },
      status: 'awaiting_approval', next_event_seq: 0, created_by: null, created_at: 'z', updated_at: 'z',
    }
    this.productions.set(p.id, p)
    const dados: Record<string, Record<string, unknown>> = {
      [STUDIO_STRATEGIST_KEY]: planoBom(n), [STUDIO_COPYWRITER_KEY]: copyBoa(n), [STUDIO_DESIGNER_KEY]: arteBoa(n),
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
  async updateProductionStatus(id: string, st: ProductionStatus) { const p = this.productions.get(id); if (p) p.status = st }
  async transitionProductionStatus(id: string, exp: readonly ProductionStatus[], next: ProductionStatus) {
    const p = this.productions.get(id); if (!p || !exp.includes(p.status)) return false; p.status = next; return true
  }
  async listSteps(id: string) { return this.steps.filter(s => s.production_id === id).map(s => ({ ...s })) }
  async insertSteps(rows: Omit<StepRow, 'id'>[]) {
    const conflito = rows.some(r => this.steps.some(s => s.production_id === r.production_id && s.step_index === r.step_index))
    if (conflito) {
      const existentes = this.steps.filter(s => rows.some(r => r.step_index === s.step_index))
      return { rows: existentes.map(s => ({ ...s })), inserted: false }
    }
    const criados = rows.map(r => ({ ...r, id: `step-v-${++this.n}` }))
    this.steps.push(...criados)
    return { rows: criados.map(s => ({ ...s })), inserted: true }
  }
  async updateStep(id: string, patch: Partial<StepRow>) { const st = this.steps.find(x => x.id === id); if (st) Object.assign(st, patch) }
  async transitionStepStatus(id: string, exp: readonly StepRow['status'][], patch: Partial<StepRow> & { status: StepRow['status'] }) {
    const st = this.steps.find(x => x.id === id); if (!st || !exp.includes(st.status)) return false
    Object.assign(st, patch); return true
  }
  async insertJob() { return null }
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
      ui_hint: i.uiHint ?? null, occurred_at: 'z',
    })
    return p.next_event_seq
  }
}

function providerFoto(capturas: { calls: number; prompts: string[]; sizes: string[]; qualities: string[] }): StudioImageProvider {
  return {
    async generate(req) {
      capturas.calls++
      capturas.prompts.push(req.prompt)
      capturas.sizes.push(req.size ?? '')
      capturas.qualities.push(req.quality ?? '')
      return { bytes: await fotoClara(), model: 'gpt-image-1', size: req.size ?? '1024x1024', quality: req.quality ?? 'medium', durationMs: 1 }
    },
  }
}
function storageFalso() {
  const uploads: { path: string; bytes: Uint8Array }[] = []
  const storage: StudioImageStorage = {
    async upload(path, bytes) { uploads.push({ path, bytes }); return { path, url: `https://cdn.example/${path}` } },
  }
  return { storage, uploads }
}

const GERAL_INPUT = { tema: 'organização de leads', headline: 'Ela criou algo que ninguém esperava', bigIdea: null, publico: null }

// ════════════════════════════════════════════════════════════════════════════
// 1. Modo, custo e concorrência
// ════════════════════════════════════════════════════════════════════════════

test('1) o modo é versionado, é o PADRÃO para novas produções e persiste no brief', () => {
  assert.equal(VIRAL_VISUAL_MODE, 'viral_cover_text_v1')
  const v = validateStudioInput({ tema: 'teste do modo', slides: 6, idempotencyKey: 'viralmode000001' })
  assert.ok(v.ok)
  assert.equal(v.ok && v.brief.visual_mode, 'viral_cover_text_v1', 'o padrão não é o viral')
  // O modo por-slide continua aceito explicitamente — nada é reinterpretado.
  const v2 = validateStudioInput({ tema: 'teste', slides: 6, idempotencyKey: 'viralmode000002', visualMode: 'per_slide_v1' })
  assert.equal(v2.ok && v2.brief.visual_mode, 'per_slide_v1')
  // Equivalência de idempotência inclui modo e cor.
  const schema = ler('src/lib/content-studio/studio/schema.ts')
  assert.ok(schema.includes("'accent_color', 'visual_mode'"), 'fora da equivalência')
})

test('2) custo: UMA chamada de imagem para 5, 6, 7 e 8 slides — internos sem OpenAI', async () => {
  for (const n of [5, 6, 7, 8]) {
    const capturas = { calls: 0, prompts: [], sizes: [], qualities: [] } as never
    __setStudioImageProviderForTests(providerFoto(capturas))
    const { storage, uploads } = storageFalso()
    const store = new MemStore()
    const p = store.viral(n)

    const r = await runViralCover(store, storage, p, {})
    assert.equal(r.state, 'created', `n=${n}: ${r.state}`)
    assert.equal((capturas as { calls: number }).calls, 1, `n=${n}: custo diferente de 1 chamada`)
    // N arquivos: 1 capa + (n-1) slides de texto renderizados pelo FunilPro.
    assert.equal(uploads.length, n, `n=${n}: ${uploads.length} uploads`)
  }
})

test('3) CINCO cliques simultâneos na capa → UMA chamada', async () => {
  let liberar!: () => void
  const barreira = new Promise<void>(res => { liberar = res })
  let calls = 0
  __setStudioImageProviderForTests({
    async generate(req) {
      calls++
      await barreira
      return { bytes: await fotoClara(), model: 'gpt-image-1', size: req.size ?? '', quality: req.quality ?? '', durationMs: 1 }
    },
  })
  const { storage } = storageFalso()
  const store = new MemStore()
  const p = store.viral(5)

  const cliques = Array.from({ length: 5 }, () => runViralCover(store, storage, p, {}))
  await new Promise(res => setTimeout(res, 10))
  assert.equal(calls, 1, `${calls} chamadas — claim quebrado`)
  liberar()
  const finais = await Promise.all(cliques)
  assert.equal(calls, 1)
  assert.equal(finais.filter(f => f.state === 'created').length, 1)

  // Replay reutiliza; regenerar é explícito e muda o path por attempt.
  const replay = await runViralCover(store, storage, p, {})
  assert.equal(replay.state, 'reused')
  assert.equal(calls, 1)
})

test('4) regeneração explícita: novo attempt, novos paths, anteriores preservados', async () => {
  const capturas = { calls: 0, prompts: [], sizes: [], qualities: [] } as never
  __setStudioImageProviderForTests(providerFoto(capturas))
  const { storage, uploads } = storageFalso()
  const store = new MemStore()
  const p = store.viral(5)

  await runViralCover(store, storage, p, {})
  await runViralCover(store, storage, p, { retry: true })
  assert.equal((capturas as { calls: number }).calls, 2)
  assert.equal(uploads.length, 10)  // 5 + 5, nada sobrescrito na lista
  assert.ok(uploads[0].path.includes('-a0.') && uploads[5].path.includes('-a1.'))
})

test('5) modelo/qualidade/tamanho decididos no SERVIDOR: gpt-image-1, high, vertical', async () => {
  const capturas = { calls: 0, prompts: [] as string[], sizes: [] as string[], qualities: [] as string[] }
  __setStudioImageProviderForTests(providerFoto(capturas as never))
  const { storage } = storageFalso()
  const store = new MemStore()
  await runViralCover(store, storage, store.viral(5), {})
  assert.equal(capturas.qualities[0], 'high', 'a capa viral não é premium')
  assert.equal(capturas.sizes[0], '1024x1536', 'saída não é vertical')

  // O provider não tem fallback silencioso de modelo; erro vira failed.
  const provider = semComentarios(ler('src/lib/content-studio/images/provider.ts'))
  assert.ok(provider.includes("STUDIO_IMAGE_MODEL = 'gpt-image-1'"))
  assert.ok(!/fallback|gpt-image-0|dall-e/i.test(provider), 'fallback de modelo')
  // Cliente nunca envia model/quality/size livres.
  const actions = semComentarios(ler('src/app/actions/content-production.ts'))
  const fn = actions.slice(actions.indexOf('export async function generateViralCoverImage')).split('\nexport ')[0]
  assert.ok(!/opts\?\.(model|quality|size|prompt)/.test(fn))
  assert.ok(fn.includes('isValidViralIntensity'), 'intensidade sem lista branca')
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Prompt fotográfico
// ════════════════════════════════════════════════════════════════════════════

test('6) o prompt exige fotografia REAL com curiosidade e cena extraordinária possível', () => {
  const d = deriveViralCoverDirection(GERAL_INPUT)
  const p = buildViralCoverPrompt(d, 'curiosidade_maxima')
  for (const marca of [
    'photorealistic editorial advertising photography', 'real physical scene',
    'extraordinary but believable', 'clear human story', 'Scroll-stopping curiosity',
    'commercial lighting', 'realistic skin, hands', 'Foreground', 'Middle ground', 'Background',
    'focal', 'reactions', 'shadows and reflections', 'color grading', 'campaign finish',
    'improbable at first glance yet remain completely possible',
  ]) {
    assert.ok(p.toLowerCase().includes(marca.toLowerCase()), `falta "${marca}"`)
  }
  // Tecnologia real, telas desfocadas, sem holograma/neon.
  assert.ok(p.includes('blurred') && p.includes('no holograms'))
})

test('7) proibições OBRIGATÓRIAS presentes e NUNCA cortadas', () => {
  const d = deriveViralCoverDirection(GERAL_INPUT)
  d.coverConcept = 'x'.repeat(8000)  // estoura o teto de propósito
  const p = buildViralCoverPrompt(d, 'forte')
  assert.ok(p.length <= 4200, 'sem teto')
  for (const proibido of [
    'illustration', 'cartoon', 'childish drawing', 'clip-art', 'line art', 'outline',
    'wireframe', 'icon-only composition', 'isolated icon', 'generic app mockup',
    'neon smartphone drawing', 'abstract technology symbols', 'floating UI',
    'empty black background', 'generic stock-photo pose', 'low-detail environment',
    'cheap template appearance',
  ]) {
    assert.ok(p.includes(proibido), `não proíbe "${proibido}"`)
  }
  assert.ok(p.includes(VIRAL_TEXT_BANS), 'proibição de texto cortada')
  assert.ok(VIRAL_TEXT_BANS.includes('no readable letters') && VIRAL_TEXT_BANS.includes('no watermarks'))
})

test('8) mecanismos de curiosidade: 6 aprovados, no MÁXIMO 2 por capa, determinísticos', () => {
  assert.equal(CURIOSITY_MECHANISMS.length, 6)
  const a = deriveViralCoverDirection(GERAL_INPUT)
  const b = deriveViralCoverDirection(GERAL_INPUT)
  assert.deepEqual(a.curiosityMechanisms, b.curiosityMechanisms, 'não determinístico')
  assert.ok(a.curiosityMechanisms.length <= 2 && a.curiosityMechanisms.length >= 1)
  assert.ok(a.visualQuestion.includes('?'), 'sem pergunta mental específica')

  // O bloco `cover` do Designer é aceito, mas SEMPRE limitado a 2 mecanismos.
  const doDesigner = coerceDesignerCover({
    coverConcept: 'conceito', visualQuestion: 'o que houve?', mainSubject: 'uma pessoa comum',
    curiosityMechanisms: ['contraste', 'escala', 'reacao', 'misterio'],
  })
  assert.ok(doDesigner)
  assert.equal(doDesigner!.curiosityMechanisms.length, 2)
  // Lixo não passa: mecanismo desconhecido cai fora.
  const comLixo = coerceDesignerCover({
    coverConcept: 'c', visualQuestion: 'q?', mainSubject: 's', curiosityMechanisms: ['hack'],
  })
  assert.ok(comLixo!.curiosityMechanisms.every(m => (CURIOSITY_MECHANISMS as readonly string[]).includes(m)))
})

test('9) menores de idade: salvaguardas SEMPRE no prompt', () => {
  const p = buildViralCoverPrompt(deriveViralCoverDirection(GERAL_INPUT), VIRAL_INTENSITY_DEFAULT)
  assert.ok(p.includes(VIRAL_MINOR_GUARDS))
  for (const marca of ['anonymous, illustrative', 'not resembling any real identifiable person', 'age-appropriate', 'nothing sexualized', 'never presented as documentary']) {
    assert.ok(VIRAL_MINOR_GUARDS.includes(marca), `salvaguarda ausente: ${marca}`)
  }
  assert.equal(isValidViralIntensity('curiosidade_maxima'), true)
  assert.equal(isValidViralIntensity('brutal'), false)
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Capa: estrutura por PIXELS
// ════════════════════════════════════════════════════════════════════════════

test('10) capa 1080×1350: foto CLARA em cima, painel preto embaixo, headline no painel', async () => {
  const foto = await fotoClara()
  const capa = await composeViralCover(foto, {
    headline: 'Ela criou algo que ninguém esperava aqui',
    highlights: ['ninguém esperava'],
    marca: 'FunilPro', iniciais: 'FP', totalSlides: 6, accentHex: ACCENT_COLORS.roxo,
  })
  assert.equal(capa.width, VIRAL_W)
  assert.equal(capa.height, VIRAL_H)
  const meta = await sharp(Buffer.from(capa.bytes)).metadata()
  assert.equal(meta.width, 1080)
  assert.equal(meta.height, 1350)

  // (a) A FOTO NÃO FOI ESCURECIDA: a região central superior continua clara
  // (cinza 190 do sintético) — nenhum véu sobre a fotografia inteira.
  const lumFoto = await luminancia(capa.bytes, 200, 200, 600, 400)
  assert.ok(lumFoto > 170, `foto escurecida (lum ${lumFoto.toFixed(1)})`)

  // (b) O painel inferior é PRETO (quase 10/10/10) fora dos glifos.
  const lumPainelBorda = await luminancia(capa.bytes, VIRAL_W - 120, VIRAL_H - 60, 100, 40)
  assert.ok(lumPainelBorda < 40, `painel não é preto (lum ${lumPainelBorda.toFixed(1)})`)

  // (c) A HEADLINE vive NO PAINEL: glifos claros abaixo da foto...
  const glifosPainel = await fracaoClara(capa.bytes, 72, VIRAL_PHOTO_H + 100, 900, VIRAL_PANEL_H - 160)
  assert.ok(glifosPainel > 0.01, `headline ausente do painel (${glifosPainel.toFixed(4)})`)

  // (d) ...e NENHUM texto sobre a fotografia: na foto clara (190), glifos
  // brancos puros (>235) não existem — a região superior fica sem overlay.
  const glifosNaFoto = await fracaoClara(capa.bytes, 72, 140, 900, 600, 235)
  assert.ok(glifosNaFoto < 0.002, `texto sobre a foto (${glifosNaFoto.toFixed(4)})`)

  // (e) O MARCA-TEXTO roxo aparece no painel: pixels saturados da cor.
  const { data } = await sharp(Buffer.from(capa.bytes))
    .extract({ left: 0, top: VIRAL_PHOTO_H, width: VIRAL_W, height: VIRAL_PANEL_H })
    .raw().toBuffer({ resolveWithObject: true })
  let roxos = 0
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (b > 120 && r > 60 && g < r && g < b) roxos++  // assinatura do #7C3AED
  }
  assert.ok(roxos > 500, `marca-texto ausente (${roxos} px)`)

  // (f) Marca/contador no painel (topo do painel tem glifos).
  const topoPainel = await fracaoClara(capa.bytes, 60, VIRAL_PHOTO_H + 10, 960, 70)
  assert.ok(topoPainel > 0.005, 'marca/contador ausentes')

  // (g) O resultado difere da foto-base (painel + glifos mudam a média).
  const mediaTotal = await luminancia(capa.bytes, 0, 0, VIRAL_W, VIRAL_H)
  assert.ok(Math.abs(mediaTotal - 190) > 30, 'capa igual à foto-base')
})

test('11) slides internos: fundo PRETO, texto branco, marca, contador, seta e CTA', async () => {
  const interno = await renderViralTextSlide({
    headline: 'O que ela fez primeiro', body: 'Um passo simples que ninguém percebe.',
    highlights: ['ninguém percebe'], marca: 'FunilPro', iniciais: 'FP',
    slideNumber: 3, totalSlides: 6, accentHex: ACCENT_COLORS.roxo,
  })
  const meta = await sharp(Buffer.from(interno.bytes)).metadata()
  assert.equal(meta.width, 1080)
  assert.equal(meta.height, 1350)
  // Fundo preto nas bordas.
  assert.ok((await luminancia(interno.bytes, 20, 700, 40, 200)) < 30, 'fundo não é preto')
  // Texto branco presente.
  assert.ok((await fracaoClara(interno.bytes, 72, 300, 900, 400)) > 0.01, 'texto ausente')
  // Cabeçalho (marca + contador).
  assert.ok((await fracaoClara(interno.bytes, 60, 60, 960, 80)) > 0.004, 'cabeçalho ausente')
  // Seta de continuação (não é o último).
  const svg = buildViralTextSlideSvg({
    headline: 'H', body: 'B', highlights: [], marca: 'M', iniciais: 'M',
    slideNumber: 2, totalSlides: 6, accentHex: '#7C3AED',
  })
  assert.ok(svg.includes('stroke-linejoin'), 'sem seta de continuação')

  // Último slide: CTA FORTE na cor de destaque, sem seta.
  const ultimo = buildViralTextSlideSvg({
    headline: 'H', body: 'B', highlights: [], marca: 'M', iniciais: 'M',
    slideNumber: 6, totalSlides: 6, accentHex: '#7C3AED', cta: 'Siga o perfil',
  })
  assert.ok(ultimo.includes('#7C3AED') && ultimo.includes('rx="20"'), 'CTA sem botão de destaque')
  assert.ok(!ultimo.includes('stroke-linejoin'), 'seta no último slide')
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Cor, contraste e marca-texto
// ════════════════════════════════════════════════════════════════════════════

test('12) cor: lista branca + hex validado; CSS livre e lixo caem no padrão roxo', () => {
  assert.equal(parseAccentColor('roxo'), '#7C3AED')
  assert.equal(parseAccentColor('azul'), '#2563EB')
  assert.equal(parseAccentColor('#AB12CD'), '#AB12CD')
  for (const invalido of ['red; background:url(x)', 'rgb(1,2,3)', '#12345', '#GGGGGG', 'javascript:', 42, null]) {
    assert.equal(parseAccentColor(invalido), '#7C3AED', `aceitou ${String(invalido)}`)
    assert.equal(isValidAccentInput(invalido), false)
  }
  // Persistência no brief validado.
  const v = validateStudioInput({ tema: 'teste de cor', slides: 5, idempotencyKey: 'viralcor0000001', accentColor: '#ab12cd' })
  assert.equal(v.ok && v.brief.accent_color, '#AB12CD')
  const v2 = validateStudioInput({ tema: 'teste de cor', slides: 5, idempotencyKey: 'viralcor0000002', accentColor: 'vermelho' })
  assert.equal(v2.ok && v2.brief.accent_color, '#DC2626')
})

test('13) contraste calculado: texto branco em cores escuras, preto em claras', () => {
  assert.equal(textColorFor('#7C3AED'), '#ffffff')  // roxo -> branco
  assert.equal(textColorFor('#DC2626'), '#ffffff')  // vermelho -> branco
  assert.equal(textColorFor('#FACC15'), '#111111')  // amarelo -> preto
  assert.equal(textColorFor('#FFFFFF'), '#111111')
  assert.equal(textColorFor('#000000'), '#ffffff')
})

test('14) marca-texto: correspondência EXATA, máx. 2 na capa, multi-linha, sem invenção', () => {
  // Match exato marca o intervalo certo.
  const linhas = layoutHighlighted('Ela criou algo que ninguém esperava aqui', ['ninguém esperava'], 900, 60, 4)
  const destacados = linhas.flatMap(l => l.segmentos.filter(s => s.destacado).map(s => s.texto)).join(' ')
  assert.ok(destacados.toLowerCase().includes('ninguém'), 'trecho não destacado')

  // Frase inexistente: NADA é destacado (e nada é inventado).
  const sem = layoutHighlighted('Texto qualquer sem o trecho', ['frase que não existe'], 900, 60, 4)
  assert.ok(sem.every(l => l.segmentos.every(s => !s.destacado)))

  // A frase inteira nunca vira destaque.
  const inteira = layoutHighlighted('Frase completa', ['Frase completa'], 900, 60, 4)
  assert.ok(inteira.every(l => l.segmentos.every(s => !s.destacado)), 'headline inteira destacada')

  // Destaque atravessando a quebra: os DOIS lados da linha ficam marcados.
  const multi = layoutHighlighted(
    'palavra palavra destaque grande atravessando linha aqui',
    ['destaque grande atravessando'], 700, 56, 4)
  const linhasComMarca = multi.filter(l => l.segmentos.some(s => s.destacado)).length
  assert.ok(linhasComMarca >= 2, 'destaque não atravessa linhas')

  // A capa aceita no máximo DOIS destaques (o SVG corta o excedente).
  const painel = buildViralCoverPanelSvg({
    headline: 'um dois três quatro cinco seis', highlights: ['um', 'dois', 'três', 'quatro'],
    marca: 'M', iniciais: 'M', totalSlides: 5, accentHex: '#7C3AED',
  })
  assert.ok((painel.match(/rx="10"/g) ?? []).length <= 2, 'mais de 2 marca-textos na capa')

  // Copywriter v2: highlights validados no parser (máx. 2, opcional).
  const schema = ler('src/lib/content-studio/studio/schema.ts')
  assert.ok(schema.includes('highlights: lista(item.highlights'), 'parser sem highlights')
})

test('15) tipografia: Archivo Black embutida, acentos, auto-shrink sem corte', async () => {
  const fonts = ler('src/lib/content-studio/images/fonts.ts')
  assert.ok(fonts.includes('ARCHIVO_BLACK_B64') && fonts.includes('SIL Open Font'))
  const viral = semComentarios(ler('src/lib/content-studio/images/viral.ts'))
  assert.ok(!/<text[\s>]/.test(viral), 'viral usa <text> dependente de fontconfig')

  // Acentos do português renderizam glifos (paths não vazios).
  const svg = buildViralCoverPanelSvg({
    headline: 'Atenção: você não perderá a promoção de São João',
    highlights: [], marca: 'Marca', iniciais: 'MA', totalSlides: 5, accentHex: '#7C3AED',
  })
  assert.ok((svg.match(/<path /g) ?? []).length >= 3, 'acentos sem glifo')

  // Headline gigante: reduz a fonte e NUNCA estoura o painel (compõe válido).
  const capa = await composeViralCover(await fotoClara(), {
    headline: 'Uma headline extraordinariamente comprida que precisaria de muitas linhas para caber inteira no painel',
    highlights: [], marca: 'M', iniciais: 'M', totalSlides: 5, accentHex: '#7C3AED',
  })
  const meta = await sharp(Buffer.from(capa.bytes)).metadata()
  assert.equal(meta.height, 1350)
})

test('16) avatar ausente: círculo com INICIAIS — nada quebra', () => {
  assert.equal(initialsOf('FunilPro'), 'Fu')
  assert.equal(initialsOf('LC Marketing'), 'LM')
  assert.equal(initialsOf(''), 'FP')
  const svg = buildViralCoverPanelSvg({
    headline: 'H', highlights: [], marca: 'LC Marketing', iniciais: initialsOf('LC Marketing'),
    totalSlides: 5, accentHex: '#7C3AED',
  })
  assert.ok(svg.includes('<circle'), 'sem círculo de avatar')
})

// ════════════════════════════════════════════════════════════════════════════
// 5. UI, resultado e compatibilidade
// ════════════════════════════════════════════════════════════════════════════

test('17) UI: "Gerar foto da capa" com aviso de 1 geração; SEM "Gerar todas" no viral', () => {
  const painel = ler('src/components/content-studio/result-panel.tsx')
  assert.ok(painel.includes('Gerar foto da capa'))
  assert.ok(painel.includes('1 geração de imagem'))
  assert.ok(painel.includes('Os demais slides são montados pelo FunilPro'))
  assert.ok(painel.includes('Regenerar capa'))
  assert.ok(painel.includes("'Forte'") && painel.includes("'Curiosidade máxima'"))
  // O gate: comImagens (Gerar todas + botões por slide) EXCLUI o viral.
  const codigo = semComentarios(painel)
  assert.ok(codigo.includes('const comImagens = !ehViral &&'), '"Gerar todas" vaza para o viral')
  assert.ok(painel.includes('Baixar slide'), 'sem download dos slides internos')
  // Formulário: cor de destaque com custom hex validado no cliente também.
  const form = ler('src/components/content-studio/quick-create-form.tsx')
  assert.ok(form.includes('Cor de destaque'))
  assert.ok(form.includes('^#[0-9a-fA-F]{6}$'), 'hex sem validação no cliente')
})

test('18) resultado: capa+slides+metadados; aprovação continua a mesma', async () => {
  const capturas = { calls: 0, prompts: [], sizes: [], qualities: [] } as never
  __setStudioImageProviderForTests(providerFoto(capturas))
  const { storage } = storageFalso()
  const store = new MemStore()
  const p = store.viral(6)
  await runViralCover(store, storage, p, { intensity: 'forte' })

  const r = buildProductionResult(store.steps)
  assert.ok(r.viral, 'resultado sem bloco viral')
  assert.equal(r.viral!.cover.status, 'pronto')
  assert.ok(r.viral!.cover.url?.includes('/viral/slide-1-a0.jpg'))
  assert.equal(r.viral!.cover.modelo, 'gpt-image-1')
  assert.equal(r.viral!.cover.qualidade, 'high')
  assert.equal(r.viral!.cover.intensity, 'forte')
  assert.equal(r.viral!.cover.accentHex, '#7C3AED')
  assert.equal(r.viral!.textSlides.length, 5)  // slides 2..6
  // A produção segue aprovável pelo fluxo existente (status intocado).
  assert.equal(store.productions.get(p.id)!.status, 'awaiting_approval')
  // Base64 jamais no banco.
  const persistido = JSON.stringify({ steps: store.steps, events: store.events })
  assert.ok(!/b64_json|"bytes"/.test(persistido))
})

test('19) produções antigas NÃO são reinterpretadas; per-slide bloqueado no viral', () => {
  // Step antigo de imagem por-slide no índice 101 SEM kind viral: o resultado
  // continua como imagens por slide, nunca vira "capa".
  const store = new MemStore()
  const p = store.viral(5)
  store.steps.push({
    id: 'img-old', production_id: p.id, tenant_id: p.tenant_id,
    agent_key: 'cst_image_designer', step_index: 101, depends_on: [], status: 'completed',
    input: null, output: { data: { slide: 1, url: 'https://x/antiga.jpg', model: 'gpt-image-1', mode: 'premium' }, artifacts: [], usage: undefined },
    attempt: 0, error: null, started_at: 'x', completed_at: 'x',
  })
  const r = buildProductionResult(store.steps)
  assert.equal(r.viral, null, 'produção antiga reinterpretada como viral')
  assert.equal(r.imagens[0]?.status, 'pronto')

  // E as actions por-slide RECUSAM produções do modo viral (slot da capa).
  const actions = semComentarios(ler('src/app/actions/content-production.ts'))
  assert.ok((actions.match(/visual_mode [!=]== VIRAL_VISUAL_MODE/g) ?? []).length >= 3,
    'per-slide não bloqueia viral')
})

test('20) R1 intacto; nenhuma migration; nenhuma variável nova', () => {
  assert.ok(ler('src/lib/security/cron-auth.ts').includes('timingSafeEqual'))
  assert.ok(ler('src/app/api/queue/process/route.ts').includes('evaluateCronAuth'))
  const fontes = ['viral.ts', 'viral-prompt.ts', 'viral-run.ts']
    .map(f => semComentarios(ler(`src/lib/content-studio/images/${f}`))).join('\n')
  assert.ok(!/CREATE TABLE|ALTER TABLE|exec_sql|NEXT_PUBLIC|OPENAI_VIRAL/i.test(fontes))
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
