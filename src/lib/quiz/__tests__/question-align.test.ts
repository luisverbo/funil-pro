// ============================================================================
// Quiz Builder — alinhamento do título dos blocos de PERGUNTA
// ----------------------------------------------------------------------------
// O defeito relatado: o bloco "Escolha única" tinha `text-center` FIXO no
// código. Todos os outros blocos com texto (heading, imagem, botão, hero)
// oferecem alinhamento; o de pergunta, não — então o título ficava centralizado
// no meio de um formulário alinhado à esquerda, sem como corrigir.
//
// O que se trava aqui:
//   • existe `question_align` no tipo de configuração;
//   • renderer e PREVIEW do editor usam o MESMO valor (a tela não pode mentir
//     sobre o resultado publicado);
//   • o padrão continua 'center' — nenhum quiz já publicado muda de aparência;
//   • o painel oferece as três opções, no mesmo padrão dos outros blocos.
//
// Testes de fonte: sem DOM, sem rede, sem banco.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const RENDERER = 'src/app/pg/[slug]/quiz-renderer-v2.tsx'
const EDITOR = 'src/components/quiz/quiz-editor-v2.tsx'
const TIPOS = 'src/app/actions/quiz-v2.ts'

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ════════════════════════════════════════════════════════════════════════════

test('1) o tipo de configuração aceita o alinhamento da pergunta', () => {
  const tipos = ler(TIPOS)
  assert.ok(tipos.includes("question_align?: 'left' | 'center' | 'right'"),
    'sem question_align no BlockConfig')
})

test('2) REPRODUÇÃO: o título da escolha não tem mais alinhamento fixo', () => {
  const r = ler(RENDERER)
  // O container do título dos blocos de escolha não pode mais forçar centro.
  assert.ok(!r.includes('<div className="text-center mb-6">'),
    'o título do bloco de escolha continua com text-center fixo')
  assert.ok(r.includes("style={{ textAlign: config.question_align ?? 'center' }}"),
    'o renderer não aplica o alinhamento configurado')
})

test('3) escala e vídeo-resposta seguem a MESMA regra', () => {
  const r = ler(RENDERER)
  const ocorrencias = (r.match(/config\.question_align \?\? 'center'/g) ?? []).length
  assert.ok(ocorrencias >= 3,
    `apenas ${ocorrencias} blocos de pergunta respeitam o alinhamento (esperado 3+)`)
  // Nenhum título de pergunta pode ter text-center fixo junto com a pergunta.
  assert.ok(!/text-2xl font-bold text-center mb-4[^]{0,80}config\.question\b/.test(r),
    'sobrou um título de pergunta com alinhamento fixo')
})

test('4) o PADRÃO continua centro — quiz publicado não muda de aparência', () => {
  const r = ler(RENDERER)
  const e = ler(EDITOR)
  // Toda leitura do campo usa 'center' como ausência de escolha.
  for (const fonte of [r, e]) {
    const usos = fonte.match(/config\.question_align[^\n]*/g) ?? []
    for (const uso of usos) {
      assert.ok(/\?\? 'center'/.test(uso), `leitura sem padrão 'center': ${uso.trim()}`)
    }
  }
})

test('5) o preview do editor mostra o mesmo alinhamento da página', () => {
  const e = ler(EDITOR)
  assert.ok(e.includes("const alinhamento = config.question_align ?? 'center'"),
    'o preview do canvas não lê o alinhamento')
  assert.ok(e.includes('style={{ textAlign: alinhamento }}'),
    'o preview do canvas não aplica o alinhamento')
})

test('6) o painel oferece as três opções, como nos outros blocos', () => {
  const e = ler(EDITOR)
  assert.ok(e.includes("setConfigKey('question_align', a)"), 'sem controle de alinhamento')
  assert.ok(e.includes("{a === 'left' ? 'Esquerda' : a === 'center' ? 'Centro' : 'Direita'}"),
    'os rótulos do controle não seguem o padrão dos outros blocos')
  // Aparece para os blocos de escolha E para a escala.
  const controles = (e.match(/setConfigKey\('question_align'/g) ?? []).length
  assert.ok(controles >= 2, `controle presente em apenas ${controles} bloco(s)`)
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
