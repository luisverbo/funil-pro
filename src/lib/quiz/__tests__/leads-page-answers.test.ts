// ============================================================================
// Quiz — a coluna de cada página mostra o que AQUELA página coletou
// ----------------------------------------------------------------------------
// O defeito relatado: a página 2 pedia nome/telefone/e-mail e a página 3 pedia
// outra coisa — mas a tela repetia o CONTATO do lead nas duas, escondendo a
// resposta real da página 3. Causa: a célula era decidida por "a página tem
// algum campo de formulário?" e, em caso positivo, imprimia `lead.name`,
// `lead.phone` e `lead.email` (dados do LEAD, não da página).
//
// A fonte correta é o EVENTO, que carrega `block_id`: cada valor pertence ao
// bloco onde foi digitado e só pode aparecer na página daquele bloco.
//
// Testes de fonte: sem DOM, sem rede, sem banco.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const VIEW = 'src/components/quiz/quiz-leads-view.tsx'

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

// ════════════════════════════════════════════════════════════════════════════

test('1) REPRODUÇÃO: o contato do lead não é mais impresso em toda página com campo', () => {
  const v = ler(VIEW)
  // A regra antiga — "página tem campo de formulário ⇒ mostra o contato" — não
  // pode existir mais: era ela que duplicava a página 2 na página 3.
  assert.ok(!v.includes('capturePages'), 'a regra antiga (capturePages) continua no arquivo')
  assert.ok(!/\['final_capture', 'field_text', 'field_email', 'field_phone'\]/.test(v),
    'a lista que marcava qualquer página de formulário como captura continua ali')
})

test('2) a célula é montada a partir dos EVENTOS daquela página', () => {
  const v = ler(VIEW)
  assert.ok(v.includes('function pageAnswers'), 'sem leitor de respostas por página')
  const fn = v.slice(v.indexOf('function pageAnswers'))
  const corpo = fn.slice(0, fn.indexOf('\n}\n'))

  // Filtra pelo par (página, bloco): é o que impede o vazamento entre páginas.
  assert.ok(corpo.includes('e.page_id !== page.id'), 'não filtra pela página')
  assert.ok(corpo.includes('!e.block_id'), 'não exige o bloco de origem')
  assert.ok(corpo.includes('blocos.get(e.block_id)'), 'não liga o evento ao bloco da página')
  // Só eventos que representam RESPOSTA entram.
  assert.ok(corpo.includes("['choice_selected', 'text_entered']"), 'aceita evento que não é resposta')
})

test('3) correção do lead vale: o evento mais recente do bloco vence', () => {
  const v = ler(VIEW)
  const fn = v.slice(v.indexOf('function pageAnswers'))
  const corpo = fn.slice(0, fn.indexOf('\n}\n'))
  // Um Map por block_id sobrescrito na ordem dos eventos = último vence.
  assert.ok(corpo.includes('porBloco.set(e.block_id'), 'não guarda por bloco')
  // A ordem exibida é a dos BLOCOS da página, não a de chegada dos eventos.
  assert.ok(corpo.includes('(page.blocks ?? []).map(b => porBloco.get(b.id))'),
    'a ordem exibida não segue a ordem dos blocos')
})

test('4) valor vazio não vira resposta', () => {
  const v = ler(VIEW)
  const fn = v.slice(v.indexOf('function pageAnswers'))
  const corpo = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(corpo.includes('if (!valor) continue'), 'campo em branco apareceria como resposta')
  // Múltipla escolha (array) vira lista legível.
  assert.ok(corpo.includes('Array.isArray(cru) ? cru.join'), 'múltipla escolha não é formatada')
})

test('5) a captura final continua mostrando o contato — ali ele É a resposta', () => {
  const v = ler(VIEW)
  assert.ok(v.includes("(p.blocks ?? []).some(b => b.type === 'final_capture')"),
    'a captura final perdeu a exibição do contato')
  // E esse caminho só roda DEPOIS de tentar as respostas próprias da página.
  assert.ok(v.indexOf('const respostas = pageAnswers(lead, p)') < v.indexOf("b.type === 'final_capture'"),
    'o contato voltaria a ter prioridade sobre as respostas da página')
})

test('6) telefone continua clicável no WhatsApp, com o valor da própria página', () => {
  const v = ler(VIEW)
  assert.ok(v.includes("const ehTelefone = r.tipo === 'field_phone'"), 'sem tratamento de telefone')
  assert.ok(v.includes('href={`https://wa.me/${r.valor.replace(/\\D/g, \'\')}`}'),
    'o link do WhatsApp não usa o valor daquela página')
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
