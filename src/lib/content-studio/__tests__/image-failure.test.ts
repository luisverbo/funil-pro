// ============================================================================
// Content Studio — a falha de imagem precisa CHEGAR na tela
// ----------------------------------------------------------------------------
// Dois defeitos reais de produção provados e travados aqui:
//
//   1. `runStudioSlideImage`/`runViralCover` capturam o erro e devolvem
//      `{ok:false}` — a action seguia para o readState e respondia SUCESSO.
//      O usuário via "falhou" sem motivo nenhum e o clique parecia inerte.
//      Agora o motivo persistido em cs_steps.error vira frase acionável.
//
//   2. A falha de uma IMAGEM marcava a produção inteira como falhada: a tela
//      mostrava "✓ Produção concluída" e "A produção falhou" ao mesmo tempo.
//      Arte é artefato sob demanda — não derruba o pipeline de texto.
//
// Nenhum teste chama API real.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describeImageFailure } from '../images/failure'
import { buildProductionResult } from '../result-view'
import { buildOfficeView } from '../view-model'
import { STUDIO_COPYWRITER_KEY, STUDIO_DESIGNER_KEY, STUDIO_STRATEGIST_KEY } from '../studio/schema'
import type { StepRow } from '../types'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ─── Fixtures ───────────────────────────────────────────────────────────────

const N = 5

function copyBoa() {
  return {
    title: 'Título da peça',
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, headline: `Headline do slide ${i + 1}`, body: `Corpo do slide ${i + 1}.`,
    })),
    caption: 'Legenda.', cta: 'Fale comigo', hashtags: ['#x'],
    review: { approved: true, notes: [] },
  }
}
function arteBoa() {
  return {
    direction: { style: 'editorial', palette: 'preto', typography: 'alta', mood: 'urgência' },
    slides: Array.from({ length: N }, (_, i) => ({
      number: i + 1, style: 'texto', composition: '-', elements: [],
      colors: 'preto', layout: 'x', imagePrompt: '-',
    })),
  }
}

function step(over: Partial<StepRow>): StepRow {
  return {
    id: 'st', production_id: 'p1', tenant_id: 't1', agent_key: 'cst_image_designer',
    step_index: 101, depends_on: [], status: 'completed', input: null, output: null,
    attempt: 0, error: null, started_at: 'x', completed_at: 'x', ...over,
  } as StepRow
}

function stepsTexto(): StepRow[] {
  return [
    step({ id: 's0', agent_key: STUDIO_STRATEGIST_KEY, step_index: 0, status: 'completed',
      output: { data: { bigIdea: 'ideia', angle: 'a', promise: 'p', audience: 'x', tone: 't', beats: [] }, artifacts: [], usage: undefined } }),
    step({ id: 's1', agent_key: STUDIO_COPYWRITER_KEY, step_index: 1, status: 'completed',
      output: { data: copyBoa(), artifacts: [], usage: undefined } }),
    step({ id: 's2', agent_key: STUDIO_DESIGNER_KEY, step_index: 2, status: 'completed',
      output: { data: arteBoa(), artifacts: [], usage: undefined } }),
  ]
}

function evento(seq: number, type: string, agentKey: string | null) {
  return {
    seq, type, agent_key: agentKey, payload: {}, occurred_at: `2026-01-01T00:00:0${seq}Z`,
  } as unknown as Parameters<typeof buildOfficeView>[0][number]
}

// ════════════════════════════════════════════════════════════════════════════
// 1. O motivo da falha chega à tela
// ════════════════════════════════════════════════════════════════════════════

test('1) cada código do provider vira uma frase acionável — e o código aparece', () => {
  const casos: [string, RegExp][] = [
    ['studio_images:missing_key', /chave da OpenAI/i],
    ['studio_images:timeout', /tempo limite/i],
    ['studio_images:empty_response', /sem imagem/i],
    ['studio_images:too_large', /tamanho máximo/i],
    ['studio_images:invalid_content', /não era uma imagem/i],
    ['studio_images:provider_error: status=401 type=invalid_api_key', /recusada[\s\S]*401/i],
    ['studio_images:provider_error: status=403 type=unsupported', /verificação da organização[\s\S]*403/i],
    ['studio_images:provider_error: status=429 type=rate_limit', /limite de uso ou saldo[\s\S]*429/i],
    ['studio_images:provider_error: status=400 type=moderation_blocked', /política de conteúdo[\s\S]*400/i],
    ['studio_images:provider_error: status=500 type=server_error', /instável[\s\S]*500/i],
  ]
  for (const [bruto, esperado] of casos) {
    const frase = describeImageFailure(bruto)
    assert.ok(frase, `sem frase para ${bruto}`)
    assert.match(frase!, esperado)
  }

  // Erro DESCONHECIDO nunca some — é o que permite diagnosticar o inédito.
  const novo = describeImageFailure('boom: algo que ninguém previu')
  assert.ok(novo && novo.includes('algo que ninguém previu'), 'erro novo foi engolido')

  // Sem erro, sem frase.
  assert.equal(describeImageFailure(null), null)
  assert.equal(describeImageFailure('   '), null)

  // NUNCA vaza chave, prompt ou URL interna.
  const vazamento = describeImageFailure('studio_images:provider_error: status=401 type=x sk-abc123')
  assert.ok(!/sk-[A-Za-z0-9]/.test(vazamento ?? ''), 'a frase pode vazar chave')
})

test('2) o resultado carrega o motivo do step de imagem que falhou', () => {
  const steps = [
    ...stepsTexto(),
    step({
      id: 'img1', step_index: 101, status: 'failed',
      error: 'studio_images:provider_error: status=403 type=organization_verification',
      attempt: 1,
    }),
  ]
  const r = buildProductionResult(steps)
  const img = r.imagens.find(i => i.numero === 1)!
  assert.equal(img.status, 'falhou')
  assert.ok(img.erro && /verificação da organização/i.test(img.erro), 'motivo ausente no resultado')
  assert.equal(img.tentativa, 1)

  // Slide que não falhou não carrega motivo nenhum.
  assert.equal(r.imagens.find(i => i.numero === 2)!.erro, null)

  // Imagem PRONTA também não.
  const ok = buildProductionResult([
    ...stepsTexto(),
    step({ id: 'img2', step_index: 102, status: 'completed',
      output: { data: { slide: 2, url: 'https://x/a.jpg', model: 'gpt-image-1', mode: 'premium' }, artifacts: [], usage: undefined } }),
  ])
  assert.equal(ok.imagens.find(i => i.numero === 2)!.erro, null)
})

test('3) a CAPA viral que falhou também explica o porquê', () => {
  const steps = [
    ...stepsTexto(),
    step({
      id: 'capa', step_index: 101, status: 'failed',
      input: { kind: 'viral_cover' } as unknown as StepRow['input'],
      error: 'studio_images:timeout',
    }),
  ]
  const r = buildProductionResult(steps)
  assert.ok(r.viral, 'capa viral não reconhecida')
  assert.equal(r.viral!.cover.status, 'falhou')
  assert.ok(/tempo limite/i.test(r.viral!.cover.erro ?? ''), 'capa sem motivo')
  // A frase de timeout ENSINA a saída (qualidade Rápida).
  assert.match(r.viral!.cover.erro!, /Rápida/)
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Banners contraditórios
// ════════════════════════════════════════════════════════════════════════════

test('4) REPRODUÇÃO: imagem falhada NÃO marca a produção como falhada', () => {
  const view = buildOfficeView([
    evento(1, 'production_created', null),
    evento(2, 'agent_completed', STUDIO_STRATEGIST_KEY),
    evento(3, 'agent_completed', STUDIO_COPYWRITER_KEY),
    evento(4, 'agent_completed', STUDIO_DESIGNER_KEY),
    evento(5, 'content_waiting_approval', null),
    // A arte do slide 1 falhou DEPOIS da aprovação estar liberada.
    evento(6, 'agent_failed', 'cst_image_designer'),
  ])
  assert.equal(view.finished, true, 'a produção precisa continuar concluída')
  assert.equal(view.failed, false, 'imagem falhada derrubou a produção inteira')
})

test('5) falha de AGENTE DE TEXTO continua marcando — e a retomada limpa', () => {
  const comFalha = buildOfficeView([
    evento(1, 'production_created', null),
    evento(2, 'agent_failed', STUDIO_COPYWRITER_KEY),
  ])
  assert.equal(comFalha.failed, true, 'falha real do pipeline precisa aparecer')

  // Retomada em curso: a falha anterior deixa de valer.
  const emRetomada = buildOfficeView([
    evento(1, 'production_created', null),
    evento(2, 'agent_failed', STUDIO_COPYWRITER_KEY),
    evento(3, 'agent_retrying', STUDIO_COPYWRITER_KEY),
  ])
  assert.equal(emRetomada.failed, false, 'o banner vermelho sobreviveu à retomada')

  // E o fim do pipeline sempre limpa.
  const concluida = buildOfficeView([
    evento(1, 'production_created', null),
    evento(2, 'agent_failed', STUDIO_DESIGNER_KEY),
    evento(3, 'agent_retrying', STUDIO_DESIGNER_KEY),
    evento(4, 'agent_completed', STUDIO_DESIGNER_KEY),
    evento(5, 'content_waiting_approval', null),
  ])
  assert.equal(concluida.failed, false)
  assert.equal(concluida.finished, true)

  // A timeline PRESERVA o histórico: a falha aconteceu e continua registrada.
  assert.ok(concluida.timeline.some(t => t.type === 'agent_failed'), 'histórico apagado')
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Interface e escolha explícita de qualidade
// ════════════════════════════════════════════════════════════════════════════

test('6) o painel mostra o motivo do slide e da capa', () => {
  const ui = ler('src/components/content-studio/result-panel.tsx')
  assert.ok(ui.includes("img.status === 'falhou' && img.erro"), 'slide sem motivo na tela')
  assert.ok(ui.includes("result.viral?.cover.status === 'falhou' && result.viral.cover.erro"),
    'capa sem motivo na tela')

  const preview = ler('src/components/content-studio/office-preview.tsx')
  assert.ok(preview.includes('setErroImagem(img.erro ??'), 'banner sem o motivo do slide')
  assert.ok(preview.includes('setErroImagem(r.data.result.viral.cover.erro ??'), 'banner sem o motivo da capa')
})

test('7) a capa aceita qualidade EXPLÍCITA — servidor decide o valor real', () => {
  const run = ler('src/lib/content-studio/images/viral-run.ts')
  assert.ok(run.includes("const quality = options.mode === 'quick' ? 'medium' : 'high'"),
    'capa sem escolha de qualidade')
  // Sem fallback silencioso: o servidor nunca troca a qualidade sozinho.
  assert.ok(!/catch[\s\S]{0,400}quality:\s*'medium'/.test(run), 'há fallback silencioso de qualidade')

  const acoes = ler('src/app/actions/content-production.ts')
  assert.ok(acoes.includes('mode: isValidImageMode(opts?.mode) ? opts.mode : undefined'),
    'action não valida o modo da capa por lista branca')

  const ui = ler('src/components/content-studio/result-panel.tsx')
  assert.ok(ui.includes("{m === 'premium' ? 'Premium' : 'Rápida'}"), 'sem seletor de qualidade na capa')
})

test('8) R1 intacto; nenhuma migration; nenhum segredo exposto', () => {
  assert.ok(ler('src/lib/security/cron-auth.ts').includes('timingSafeEqual'))
  assert.ok(ler('src/app/api/queue/process/route.ts').includes('evaluateCronAuth'))
  const fontes = [
    ler('src/lib/content-studio/images/failure.ts'),
    ler('src/lib/content-studio/view-model.ts'),
    ler('src/lib/content-studio/images/viral-run.ts'),
  ].join('\n')
  assert.ok(!/CREATE TABLE|ALTER TABLE|exec_sql|NEXT_PUBLIC_[A-Z_]*(KEY|SECRET)|OPENAI_API_KEY\s*\)/.test(fontes))
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try {
      await fn()
      results.push({ name, ok: true })
    } catch (e) {
      results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  let passed = 0
  for (const r of results) {
    if (r.ok) { passed++; console.log(`  ok   ${r.name}`) }
    else console.log(` FALHA ${r.name}\n        → ${r.error}`)
  }
  console.log(`\n${passed}/${results.length} testes passaram`)
  if (passed !== results.length) process.exit(1)
}

void main()
