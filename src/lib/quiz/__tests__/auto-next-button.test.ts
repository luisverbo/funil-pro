// ============================================================================
// Quiz — o "Próximo →" automático não pode aparecer sem ser pedido
// ----------------------------------------------------------------------------
// O relato: numa página com imagem, texto e um botão "Acessar o site", o
// visitante via TAMBÉM um "Próximo →" que ninguém colocou.
//
// Causa: `button` não estava em LANDING_BLOCKS. Sem ele, a página deixava de
// ser reconhecida como "só conteúdo" (`isLandingOnly` virava falso) e o
// renderer acrescentava o botão como rede de segurança — proteção pensada
// para páginas COM campos de resposta, que ali não existiam.
//
// O que se trava aqui:
//   • `button` é bloco de landing;
//   • a rede de segurança continua valendo para página com campos;
//   • um botão que AVANÇA continua suprimindo o automático (nada de dois).
//
// Testes de fonte: sem DOM, sem rede, sem banco.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const RENDERER = 'src/app/pg/[slug]/quiz-renderer-v2.tsx'

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

/** Lê o conteúdo de um `new Set([...])` declarado na fonte. */
function conjunto(fonte: string, nome: string): string[] {
  const i = fonte.indexOf(`const ${nome} = new Set([`)
  assert.ok(i >= 0, `não encontrei ${nome}`)
  const corpo = fonte.slice(i, fonte.indexOf('])', i))
  return [...corpo.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
}

// ════════════════════════════════════════════════════════════════════════════

test('1) REPRODUÇÃO: página de conteúdo com botão é "só conteúdo"', () => {
  const r = ler(RENDERER)
  const landing = conjunto(r, 'LANDING_BLOCKS')
  assert.ok(landing.includes('button'),
    'sem `button` na lista, a página com botão próprio ganha um "Próximo" que ninguém pediu')

  // A página do relato: imagem + texto + botão. Todos precisam ser de landing.
  for (const tipo of ['image', 'text_block', 'button']) {
    assert.ok(landing.includes(tipo), `${tipo} deveria contar como conteúdo`)
  }
})

test('2) a rede de segurança continua: página COM campo ganha o botão', () => {
  const r = ler(RENDERER)
  const landing = conjunto(r, 'LANDING_BLOCKS')
  // Campos de resposta NUNCA podem ser tratados como conteúdo — senão a
  // página com pergunta ficaria sem como avançar.
  for (const campo of ['field_text', 'field_email', 'field_phone', 'single_choice', 'multi_choice', 'final_capture']) {
    assert.ok(!landing.includes(campo), `${campo} não pode contar como conteúdo`)
  }
  assert.ok(r.includes('const shouldShowNextButton = !hasResultBlock && !isLandingOnly'),
    'a decisão do botão automático mudou de forma')
  assert.ok(r.includes('hasInputNeedingSubmit'), 'sem rede de segurança para páginas com campo')
})

test('3) botão que AVANÇA suprime o automático — nunca dois na tela', () => {
  const r = ler(RENDERER)
  assert.ok(r.includes("b.type === 'button' && b.config.button_action !== 'external_url'"),
    'a detecção de botão próprio mudou')
  assert.ok(r.includes('{shouldShowNextButton && !hasExplicitButton && ('),
    'o automático não checa mais o botão explícito')
})

test('4) bloco de resultado nunca ganha "Próximo"', () => {
  const r = ler(RENDERER)
  assert.ok(r.includes('!hasResultBlock &&'), 'página de resultado voltaria a ter botão de avanço')
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
