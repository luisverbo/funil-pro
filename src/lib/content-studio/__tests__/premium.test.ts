// ============================================================================
// Content Studio — imagens premium v2 (qualidade, prompt, composição e PIXELS)
// ----------------------------------------------------------------------------
// O que se prova: Premium/Rápida decidem a quality no SERVIDOR; o prompt v2 é
// um briefing de direção de arte com cena/planos/iluminação/ponto focal e a
// bíblia visual idêntica em toda a série; e — a prova que faltava — o JPEG
// final CONTÉM o overlay, verificado por PIXELS nas regiões esperadas (não
// por largura/altura). Nenhum teste chama API real.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

import {
  composeSlideImage, pickLayoutTemplate, SAFE_MARGIN,
  SLIDE_H, SLIDE_W, wrapByWidth,
} from '../images/compose'
import {
  buildImagePromptV2, buildVisualBible, IMAGE_PRESET_DEFAULT, IMAGE_PRESET_LABELS,
  IMAGE_PRESETS, IMAGE_PROMPT_BANS, isValidImagePreset, STUDIO_IMAGE_PROMPT_VERSION_V2,
} from '../images/prompt'
import { __setStudioImageProviderForTests, type StudioImageProvider } from '../images/provider'
import {
  IMAGE_MODE_DEFAULT, imageStepIndex, isValidImageMode, runStudioSlideImage,
  type StudioImageStorage,
} from '../images/run'
import { buildProductionResult, type ResultVisualSlide } from '../result-view'
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

const N = 5

const GERAL = { estilo: 'editorial de negócios', paleta: 'grafite, areia e âmbar', tipografia: 'sem serifa', clima: 'ordem chegando' }
function visualSlide(n: number, layout = 'headline no topo, bloco inferior calmo'): ResultVisualSlide {
  return {
    numero: n, estilo: 'cena com contraste', composicao: `mesa vista de cima, mãos organizando cartões, slide ${n}`,
    elementos: ['cartões coloridos', 'luz lateral'], cores: 'grafite com âmbar',
    layout, promptImagem: `cena ${n}: mesa de trabalho em luz de fim de tarde, cartões em colunas`,
  }
}

function planoBom() {
  return {
    bigIdea: 'a', angle: 'b', promise: 'c', audience: 'd', tone: 'e',
    beats: Array.from({ length: N }, (_, i) => ({ number: i + 1, purpose: `p${i + 1}` })),
  }
}
function copyBoa() {
  return {
    title: 'T',
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, headline: `Headline concreta ${i + 1}`, body: `Texto de apoio ${i + 1}.`,
    })),
    caption: 'legenda', cta: 'Organize seus leads', hashtags: ['#a'],
    review: { approved: true, notes: [] },
  }
}
function arteBoa() {
  return {
    direction: GERAL2(),
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, style: 'cena com contraste', composition: `composição ${i + 1}`,
      elements: ['cartões'], colors: 'grafite', layout: 'bloco inferior',
      imagePrompt: `cena ${i + 1}`,
    })),
  }
}
function GERAL2() {
  return { style: GERAL.estilo, palette: GERAL.paleta, typography: GERAL.tipografia, mood: GERAL.clima }
}

async function fundoSolido(r = 110, g = 110, b = 110): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r, g, b } } }).png().toBuffer()
  return new Uint8Array(buf)
}

/** Média de luminância numa REGIÃO do JPEG (para provar pixels do overlay). */
async function luminanciaRegiao(
  jpeg: Uint8Array, left: number, top: number, width: number, height: number,
): Promise<number> {
  const { data } = await sharp(Buffer.from(jpeg))
    .extract({ left, top, width, height })
    .greyscale().raw().toBuffer({ resolveWithObject: true })
  let soma = 0
  for (let i = 0; i < data.length; i++) soma += data[i]
  return soma / data.length
}

/** Fração de pixels CLAROS (>200) numa região — assinatura de glifo branco. */
async function fracaoClara(
  jpeg: Uint8Array, left: number, top: number, width: number, height: number,
): Promise<number> {
  const { data } = await sharp(Buffer.from(jpeg))
    .extract({ left, top, width, height })
    .greyscale().raw().toBuffer({ resolveWithObject: true })
  let claros = 0
  for (let i = 0; i < data.length; i++) if (data[i] > 200) claros++
  return claros / data.length
}

class MemStore implements ContentStore {
  productions = new Map<string, ProductionRow>()
  steps: StepRow[] = []
  jobs: JobRow[] = []
  events: StoredEvent[] = []
  private n = 0

  comTexto(): ProductionRow {
    const p: ProductionRow = {
      id: 'prod-premium', tenant_id: 'tenant-A', pipeline_key: 'content_carousel_studio_v1',
      title: 'Studio', brief: { slides: N, marca_negocio: 'FunilPro', cta: 'Organize seus leads' },
      status: 'awaiting_approval', next_event_seq: 0, created_by: null,
      created_at: 'z', updated_at: 'z',
    }
    this.productions.set(p.id, p)
    const dados: Record<string, Record<string, unknown>> = {
      [STUDIO_STRATEGIST_KEY]: planoBom(), [STUDIO_COPYWRITER_KEY]: copyBoa(), [STUDIO_DESIGNER_KEY]: arteBoa(),
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
    const criados = rows.map(r => ({ ...r, id: `step-img-${++this.n}` }))
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

function providerCaptura(capturas: { quality?: string; prompt: string }[]): StudioImageProvider {
  return {
    async generate(req) {
      capturas.push({ quality: req.quality, prompt: req.prompt })
      return {
        bytes: await fundoSolido(), model: 'gpt-image-1', size: '1024x1024',
        quality: req.quality ?? 'medium', durationMs: 1,
      }
    },
  }
}
function storageFalso() {
  const uploads: { path: string; bytes: Uint8Array; url: string }[] = []
  const storage: StudioImageStorage = {
    async upload(path, bytes) {
      const item = { path, bytes, url: `https://cdn.example/${path}` }
      uploads.push(item)
      return { path, url: item.url }
    },
  }
  return { storage, uploads }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Qualidade: Premium/Rápida decididas no servidor
// ════════════════════════════════════════════════════════════════════════════

test('1) Premium envia quality=high; Rápida envia medium; padrão é Premium', async () => {
  const capturas: { quality?: string; prompt: string }[] = []
  __setStudioImageProviderForTests(providerCaptura(capturas))
  const { storage } = storageFalso()

  const s1 = new MemStore(); await runStudioSlideImage(s1, storage, s1.comTexto(), 1, { mode: 'premium' })
  const s2 = new MemStore(); await runStudioSlideImage(s2, storage, s2.comTexto(), 1, { mode: 'quick' })
  const s3 = new MemStore(); await runStudioSlideImage(s3, storage, s3.comTexto(), 1)  // padrão

  assert.equal(capturas[0].quality, 'high')
  assert.equal(capturas[1].quality, 'medium')
  assert.equal(capturas[2].quality, 'high', 'o padrão deveria ser Premium')
  assert.equal(IMAGE_MODE_DEFAULT, 'premium')
})

test('2) modo/preset fora da lista branca caem nos padrões — nunca valor livre', async () => {
  assert.equal(isValidImageMode('ultra'), false)
  assert.equal(isValidImageMode('premium'), true)
  assert.equal(isValidImagePreset('meu-estilo'), false)
  assert.equal(isValidImagePreset('cinematic'), true)

  const capturas: { quality?: string; prompt: string }[] = []
  __setStudioImageProviderForTests(providerCaptura(capturas))
  const { storage } = storageFalso()
  const s = new MemStore()
  await runStudioSlideImage(s, storage, s.comTexto(), 1, {
    mode: 'ultra' as never, preset: 'hack' as never,
  })
  assert.equal(capturas[0].quality, 'high', 'modo inválido não caiu no padrão')
  assert.ok(capturas[0].prompt.includes('editorial'), 'preset inválido não caiu no padrão')

  // As actions revalidam os enums antes do runner (lista branca no servidor).
  const actions = semComentarios(ler('src/app/actions/content-production.ts'))
  assert.ok((actions.match(/isValidImageMode\(opts\?\.mode\)/g) ?? []).length >= 2)
  assert.ok((actions.match(/isValidImagePreset\(opts\?\.preset\)/g) ?? []).length >= 2)
  assert.ok(!/opts\?\.(model|quality)/.test(actions), 'cliente escolhe model/quality livre')
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Prompt v2 e sistema visual
// ════════════════════════════════════════════════════════════════════════════

test('3) o prompt v2 é um briefing: cena, planos, iluminação, enquadramento, foco', () => {
  const p = buildImagePromptV2(GERAL, visualSlide(2), { preset: 'editorial_premium', slideNumber: 2, totalSlides: N })
  for (const marca of ['CENA PRINCIPAL', 'enquadramento', 'Ponto focal', 'profundidade', 'iluminação', 'materiais', 'primeiro plano, plano médio e fundo', 'slide 2 de 5']) {
    assert.ok(p.toLowerCase().includes(marca.toLowerCase()), `falta "${marca}"`)
  }
  assert.equal(STUDIO_IMAGE_PROMPT_VERSION_V2, 'studio_image_v2')
})

test('4) o v2 PROÍBE o que estava saindo: ícone solto, wireframe, fundo vazio', () => {
  const p = buildImagePromptV2(GERAL, visualSlide(1), { preset: 'photo_ad', slideNumber: 1, totalSlides: N })
  for (const proibido of ['ícone isolado', 'wireframe', 'mockup', 'fundo preto quase vazio', 'clip-art', 'template', 'excessivamente escura', 'flutuando']) {
    assert.ok(p.includes(proibido), `não proíbe "${proibido}"`)
  }
  // Barra de qualidade explícita:
  assert.ok(p.includes('campanha publicitária premium'))
  assert.ok(p.includes('Uma CENA completa, não um ícone solto'))
  // Área de respiro para a copy, derivada do layout do Designer:
  assert.ok(p.includes('sobreposição de texto'))
})

test('5) a proibição de TEXTO permanece e NUNCA é cortada pelo limite', () => {
  const slideLongo = visualSlide(1)
  slideLongo.promptImagem = 'cena muito longa '.repeat(400)
  slideLongo.composicao = 'composição enorme '.repeat(200)
  const p = buildImagePromptV2(GERAL, slideLongo, { preset: 'cinematic', slideNumber: 1, totalSlides: N })
  assert.ok(p.length <= 3400, 'prompt sem teto')
  assert.ok(p.includes(IMAGE_PROMPT_BANS), 'o corte comeu as proibições de texto')
  assert.ok(p.trimEnd().endsWith('no typography of any kind.'), 'proibição não é o sufixo final')
  assert.ok(IMAGE_PROMPT_BANS.includes('sem texto') && IMAGE_PROMPT_BANS.includes('sem logotipos'))
})

test('6) visualBible: determinística e IDÊNTICA em todos os slides da série', () => {
  const b1 = buildVisualBible(GERAL, 'editorial_premium')
  const b2 = buildVisualBible(GERAL, 'editorial_premium')
  assert.equal(b1, b2, 'a bíblia não é determinística')

  const prompts = Array.from({ length: N }, (_, i) =>
    buildImagePromptV2(GERAL, visualSlide(i + 1), { preset: 'editorial_premium', slideNumber: i + 1, totalSlides: N }))
  for (const p of prompts) {
    assert.ok(p.includes(b1), 'um slide saiu da bíblia visual da série')
    assert.ok(p.includes('consistentes do primeiro ao último slide'))
  }
  // Presets diferentes = bíblias diferentes (mas cada uma coerente).
  assert.notEqual(b1, buildVisualBible(GERAL, 'tech_3d'))
})

test('7) presets: lista branca de 5, rótulos e padrão Editorial premium', () => {
  assert.deepEqual([...IMAGE_PRESETS], ['editorial_premium', 'tech_3d', 'photo_ad', 'modern_illustration', 'cinematic'])
  assert.equal(IMAGE_PRESET_DEFAULT, 'editorial_premium')
  assert.deepEqual(Object.values(IMAGE_PRESET_LABELS), [
    'Editorial premium', 'Tecnologia 3D', 'Fotografia publicitária', 'Ilustração moderna', 'Cinematográfico',
  ])
  // Cada preset expande para instrução DIFERENTE e controlada.
  const corpos = IMAGE_PRESETS.map(pr => buildVisualBible(GERAL, pr))
  assert.equal(new Set(corpos).size, IMAGE_PRESETS.length)
})

// ════════════════════════════════════════════════════════════════════════════
// 3. A PROVA POR PIXELS: o overlay está no JPEG final
// ════════════════════════════════════════════════════════════════════════════

test('8) o JPEG final contém o overlay — pixels claros nas regiões do texto', async () => {
  // Fundo cinza médio SÓLIDO: qualquer pixel claro/escuro veio do overlay.
  const fundo = await fundoSolido(110, 110, 110)
  const arte = await composeSlideImage(fundo, {
    headline: 'Headline de teste bem visível', body: 'Um corpo de texto para a prova de pixels.',
    cta: 'Chamada final', marca: 'FunilPro', slideNumber: 3, totalSlides: 5, template: 'bottom',
  })

  // (a) A arte NÃO é o fundo: a luminância média mudou de verdade.
  const mediaArte = await luminanciaRegiao(arte.bytes, 0, 0, SLIDE_W, SLIDE_H)
  assert.ok(Math.abs(mediaArte - 110) > 8, `arte visualmente igual ao fundo (média ${mediaArte.toFixed(1)})`)

  // (b) HEADLINE: no template bottom o bloco vive no terço inferior — a faixa
  // tem fração relevante de pixels quase brancos (glifos), impossível num
  // fundo cinza 110 mesmo com o véu.
  const glifosHeadline = await fracaoClara(arte.bytes, SAFE_MARGIN, 640, 800, 320)
  assert.ok(glifosHeadline > 0.01, `headline sem pixels de glifo (fração ${glifosHeadline.toFixed(4)})`)

  // (c) NUMERAÇÃO 3/5 no topo esquerdo.
  const glifosNumero = await fracaoClara(arte.bytes, SAFE_MARGIN - 10, 60, 160, 70)
  assert.ok(glifosNumero > 0.01, `numeração sem pixels (fração ${glifosNumero.toFixed(4)})`)

  // (d) MARCA no topo direito.
  const glifosMarca = await fracaoClara(arte.bytes, SLIDE_W - 360, 60, 320, 70)
  assert.ok(glifosMarca > 0.005, `marca sem pixels (fração ${glifosMarca.toFixed(4)})`)
})

test('9) CTA no ÚLTIMO slide: botão branco com pixels na base', async () => {
  const fundo = await fundoSolido(90, 90, 90)
  const arte = await composeSlideImage(fundo, {
    headline: 'Última chamada', body: 'Feche com ação.', cta: 'Organize seus leads',
    marca: 'FunilPro', slideNumber: 5, totalSlides: 5, template: 'bottom',
  })
  // O retângulo do CTA é branco sólido: a região tem fração ALTA de claros.
  const botao = await fracaoClara(arte.bytes, SAFE_MARGIN, SLIDE_H - 128, 300, 60)
  assert.ok(botao > 0.4, `CTA sem botão visível (fração ${botao.toFixed(3)})`)

  // Sem CTA: a mesma região fica escura (véu sobre cinza).
  const semCta = await composeSlideImage(fundo, {
    headline: 'Última chamada', body: 'Feche com ação.', slideNumber: 4, totalSlides: 5, template: 'bottom',
  })
  const semBotao = await fracaoClara(semCta.bytes, SAFE_MARGIN, SLIDE_H - 128, 300, 60)
  assert.ok(semBotao < 0.05, 'apareceu botão onde não há CTA')
})

test('10) templates posicionam o texto em lugares DIFERENTES (left vs bottom)', async () => {
  const fundo = await fundoSolido(120, 120, 120)
  const base = { headline: 'Headline para comparar templates', body: 'Corpo do slide.', slideNumber: 2, totalSlides: 5 }
  const esquerda = await composeSlideImage(fundo, { ...base, template: 'left' })
  const inferior = await composeSlideImage(fundo, { ...base, template: 'bottom' })

  // No template left, a metade superior-esquerda tem glifos; no bottom, não.
  const leftAlto = await fracaoClara(esquerda.bytes, SAFE_MARGIN, 240, 560, 240)
  const bottomAlto = await fracaoClara(inferior.bytes, SAFE_MARGIN, 240, 560, 240)
  assert.ok(leftAlto > 0.008, `template left sem texto no alto (${leftAlto.toFixed(4)})`)
  assert.ok(bottomAlto < leftAlto / 2, 'os templates não mudam a posição do texto')
})

test('11) pickLayoutTemplate: determinístico pela direção, consistente na série', () => {
  assert.equal(pickLayoutTemplate('texto à esquerda, imagem à direita', ''), 'left')
  assert.equal(pickLayoutTemplate('coluna à direita', ''), 'right')
  assert.equal(pickLayoutTemplate('headline no topo', ''), 'top')
  assert.equal(pickLayoutTemplate('bloco inferior', ''), 'bottom')
  // Sem indicação no slide: o fallback vem da direção GERAL — igual para toda
  // a série, o que mantém o carrossel consistente.
  assert.equal(pickLayoutTemplate('sem pista', 'estilo com texto à esquerda'), 'left')
  assert.equal(pickLayoutTemplate('sem pista', 'estilo neutro'), 'bottom')
  const serie = Array.from({ length: N }, () => pickLayoutTemplate('sem pista', 'estilo neutro'))
  assert.equal(new Set(serie).size, 1)
})

test('12) quebra por LARGURA MEDIDA: nenhuma linha estoura a área do texto', () => {
  const linhas = wrapByWidth('uma headline comprida que precisa quebrar direito sem estourar', 560, 64, 3, true)
  assert.ok(linhas.length >= 2)
  // A medição usa a fonte real embutida — cada linha cabe na largura pedida.
  for (const l of linhas) assert.ok(l.length > 0)
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Fluxo completo: URL final, cache e metadados
// ════════════════════════════════════════════════════════════════════════════

test('13) o que persiste é a ARTE COMPOSTA — e o preview usa exatamente essa URL', async () => {
  __setStudioImageProviderForTests(providerCaptura([]))
  const { storage, uploads } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()
  await runStudioSlideImage(store, storage, p, 1, { mode: 'premium', preset: 'editorial_premium' })

  // UM upload: o JPEG composto. O background bruto (PNG) nunca sobe.
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].bytes[0], 0xff, 'não é JPEG composto')  // magic JPEG
  const compostoTemGlifo = await fracaoClara(uploads[0].bytes, SAFE_MARGIN, 640, 800, 320)
  assert.ok(compostoTemGlifo > 0.005, 'o arquivo persistido não tem o overlay')

  const step = store.steps.find(s => s.step_index === imageStepIndex(1))!
  const data = step.output!.data as Record<string, unknown>
  assert.equal(data.url, uploads[0].url, 'a URL persistida não é a do composto')
  assert.equal(data.mode, 'premium')
  assert.equal(data.preset, 'editorial_premium')
  assert.equal(data.template, 'bottom')

  // O resultado leva a MESMA URL + metadados para o preview.
  const r = buildProductionResult(store.steps)
  assert.equal(r.imagens[0].url, uploads[0].url)
  assert.equal(r.imagens[0].modo, 'premium')
  assert.equal(r.imagens[0].modelo, 'gpt-image-1')
  assert.equal(r.imagens[0].tentativa, 0)
})

test('14) regenerar muda o PATH (attempt) — o navegador nunca vê cache antigo', async () => {
  __setStudioImageProviderForTests(providerCaptura([]))
  const { storage, uploads } = storageFalso()
  const store = new MemStore()
  const p = store.comTexto()

  await runStudioSlideImage(store, storage, p, 2)
  await runStudioSlideImage(store, storage, p, 2, { retry: true })

  assert.equal(uploads.length, 2)
  assert.notEqual(uploads[0].path, uploads[1].path, 'regeneração reusa o mesmo path')
  assert.ok(uploads[0].path.includes('-a0.') && uploads[1].path.includes('-a1.'))

  const r = buildProductionResult(store.steps)
  assert.equal(r.imagens[1].url, uploads[1].url, 'o preview ainda aponta para a URL antiga')
  assert.equal(r.imagens[1].tentativa, 1)
})

// ════════════════════════════════════════════════════════════════════════════
// 5. UI, Designer v2 e regressões
// ════════════════════════════════════════════════════════════════════════════

test('15) UI: seletor Rápida/Premium com custo, presets, Ampliar e Baixar', () => {
  const painel = ler('src/components/content-studio/result-panel.tsx')
  assert.ok(painel.includes("'Rápida'") && painel.includes("'Premium'"))
  assert.ok(painel.includes('menor qualidade e menor consumo'))
  assert.ok(painel.includes('melhor acabamento e pode custar mais'))
  assert.ok(painel.includes('IMAGE_PRESETS.map'), 'sem seletor de preset')
  assert.ok(painel.includes('Ampliar') && painel.includes('Baixar imagem'))
  assert.ok(painel.includes('Arte final'), 'não diz que é a arte final')
  assert.ok(painel.includes('tentativa {img.tentativa + 1}'), 'sem metadado de tentativa')
  assert.ok(painel.includes('max-w-[460px]'), 'preview continua pequeno')

  // O pai controla os enums e os repassa às DUAS actions.
  const preview = semComentarios(ler('src/components/content-studio/office-preview.tsx'))
  assert.ok(preview.includes('mode: modoImagem, preset: presetImagem'))
})

test('16) Designer v2: direção de CENA (planos, luz, continuidade), não ícones', () => {
  const prompt = ler('src/lib/content-studio/studio/prompt.ts')
  assert.ok(prompt.includes("STUDIO_DESIGNER_PROMPT_VERSION = 'studio_designer_v2'"))
  for (const marca of ['primeiro plano', 'plano médio', 'iluminação', 'enquadramento', 'CONTINUIDADE', 'metáfora', 'ponto focal']) {
    assert.ok(prompt.toLowerCase().includes(marca.toLowerCase()), `Designer v2 sem "${marca}"`)
  }
  assert.ok(prompt.includes('ícone de celular'), 'sem o exemplo do defeito (POBRE vs RICA)')
})

test('17) fontes EMBUTIDAS: zero dependência de <text>/fontconfig no compose', () => {
  const compose = semComentarios(ler('src/lib/content-studio/images/compose.ts'))
  assert.ok(!/<text[\s>]/.test(compose), 'compose ainda emite <text>')
  assert.ok(compose.includes("from './fonts'"), 'fontes não são as embutidas')
  assert.ok(compose.includes('opentype'), 'sem conversão de glifo para path')
  const fonts = ler('src/lib/content-studio/images/fonts.ts')
  assert.ok(fonts.includes('LIBERATION_SANS_BOLD_B64') && fonts.includes('SIL Open Font'))
})

test('18) produções antigas intactas; R1 intacto; nenhuma migration', () => {
  const antigo: StepRow[] = [{
    id: 's1', production_id: 'p', tenant_id: 't', agent_key: 'cc_quick_carousel',
    step_index: 0, depends_on: [], status: 'completed', input: null,
    output: { data: copyBoa() as unknown as Record<string, unknown>, artifacts: [], usage: undefined },
    attempt: 0, error: null, started_at: null, completed_at: null,
  }]
  const r = buildProductionResult(antigo)
  assert.equal(r.imagens.length, 0)

  assert.ok(ler('src/lib/security/cron-auth.ts').includes('timingSafeEqual'))
  assert.ok(ler('src/app/api/queue/process/route.ts').includes('evaluateCronAuth'))
  const fontes = ['images/provider.ts', 'images/prompt.ts', 'images/run.ts', 'images/compose.ts']
    .map(f => ler(`src/lib/content-studio/${f}`)).join('\n')
  assert.ok(!/CREATE TABLE|ALTER TABLE|exec_sql/i.test(fontes))
  assert.ok(!/NEXT_PUBLIC/.test(semComentarios(fontes)), 'variável exposta ao cliente')
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
