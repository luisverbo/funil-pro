// ============================================================================
// Duplicar página / quiz — o defeito e o que impede a volta dele
// ----------------------------------------------------------------------------
// SINTOMA RELATADO: duplicar um quiz produzia uma página vazia.
//
// CAUSA: `duplicatePage` copiava uma LISTA FIXA de cinco colunas — title,
// page_type, funnel_id, slug, craft_json. O conteúdo do quiz mora em
// `pages.quiz_data`, que nunca esteve nessa lista. Pelo mesmo motivo se
// perdiam o SEO e o pixel.
//
// CORREÇÃO: a regra virou o contrário — lista-se o que NÃO copiar. Coluna nova
// já nasce sendo duplicada, e o defeito não pode voltar por esquecimento.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  COLUNAS_NAO_COPIADAS, camposHerdados, remapearPerguntasV1, type PerguntaV1,
} from '../duplicate'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void }[] = []
function test(name: string, fn: () => void) { suite.push({ name, fn }) }

/** Uma página de quiz como o banco devolve. */
const paginaOriginal = () => ({
  id: 'pg1',
  tenant_id: 't1',
  title: 'Quiz da Costureira',
  slug: 'quiz-costureira-ab12',
  page_type: 'quiz',
  funnel_id: 'f1',
  craft_json: { nodes: [] },
  quiz_data: { version: 2, pages: [{ id: 'p1', blocks: [{ id: 'b1', type: 'text' }] }], settings: { theme: 'dark' } },
  meta_title: 'Descubra seu perfil',
  meta_description: 'Responda em 1 minuto',
  og_image_url: 'https://x/y.png',
  published: true,
  published_at: '2026-08-01T00:00:00Z',
  views_count: 4213,
  clicks_count: 900,
  conversions_count: 87,
  created_at: '2026-07-01T00:00:00Z',
})

// ════════════════════════════════════════════════════════════════════════════

test('1) REPRODUÇÃO: o conteúdo do quiz vai junto na cópia', () => {
  const h = camposHerdados(paginaOriginal())
  assert.ok(h.quiz_data, 'quiz_data ficou de fora — é este o bug relatado')
  assert.deepEqual(h.quiz_data, paginaOriginal().quiz_data, 'o quiz precisa vir inteiro')
})

test('2) SEO, pixel e demais configurações também vêm', () => {
  const h = camposHerdados(paginaOriginal())
  assert.equal(h.meta_title, 'Descubra seu perfil')
  assert.equal(h.meta_description, 'Responda em 1 minuto')
  assert.equal(h.og_image_url, 'https://x/y.png')
  assert.equal(h.page_type, 'quiz')
  assert.equal(h.funnel_id, 'f1')
  assert.deepEqual(h.craft_json, { nodes: [] })
})

test('3) o que precisa nascer novo NÃO é herdado', () => {
  const h = camposHerdados(paginaOriginal())
  for (const proibido of ['id', 'slug', 'title', 'tenant_id', 'published', 'published_at', 'created_at']) {
    assert.equal(h[proibido], undefined, `${proibido} não pode ser copiado`)
  }
})

test('4) contador herdado seria mentira — a cópia começa em zero', () => {
  const h = camposHerdados(paginaOriginal())
  assert.equal(h.views_count, undefined, 'a cópia diria ter 4.213 visitas que nunca teve')
  assert.equal(h.clicks_count, undefined)
  assert.equal(h.conversions_count, undefined)
})

test('5) coluna NOVA é copiada sozinha — o defeito não volta por esquecimento', () => {
  // Simula uma coluna criada depois desta correção.
  const comColunaNova = { ...paginaOriginal(), pixel_id: '999', tema_json: { cor: '#000' } }
  const h = camposHerdados(comColunaNova)
  assert.equal(h.pixel_id, '999', 'lista fixa de colunas faria isto sumir de novo')
  assert.deepEqual(h.tema_json, { cor: '#000' })
})

test('6) quiz v1: as perguntas da cópia apontam para a PRÓPRIA cópia', () => {
  const perguntas: PerguntaV1[] = [
    { id: 'q1', page_id: 'pg1', next_question_id: 'q2', options: [], order_index: 0 },
    { id: 'q2', page_id: 'pg1', next_question_id: null, order_index: 1,
      options: [
        { id: 'o1', label: 'Sim', next_question_id: 'q1' },
        { id: 'o2', label: 'Não', next_question_id: null },
      ] },
  ]
  let n = 0
  const linhas = remapearPerguntasV1(perguntas, 'pg2', 't1', () => `novo${++n}`)

  assert.equal(linhas.length, 2)
  assert.equal(linhas[0].id, 'novo1')
  assert.equal(linhas[0].page_id, 'pg2')
  assert.equal(linhas[0].tenant_id, 't1')
  // Este é o ponto delicado: sem reapontar, editar a cópia mexeria no fluxo
  // do quiz ORIGINAL.
  assert.equal(linhas[0].next_question_id, 'novo2', 'a cópia continuaria ligada ao original')
  const opcoes = linhas[1].options as Record<string, unknown>[]
  assert.equal(opcoes[0].next_question_id, 'novo1', 'a opção continuaria apontando para o original')
  assert.equal(opcoes[0].label, 'Sim', 'o resto da opção precisa ser preservado')
  assert.equal(opcoes[1].next_question_id, null)
})

test('7) vínculo para fora da página vira nulo, não vaza para outro quiz', () => {
  const linhas = remapearPerguntasV1(
    [{ id: 'q1', next_question_id: 'de-outra-pagina', options: [{ id: 'o', next_question_id: 'sumida' }] }],
    'pg2', 't1', () => 'novo1',
  )
  assert.equal(linhas[0].next_question_id, null, 'caminho que termina é melhor que caminho que atravessa')
  assert.equal((linhas[0].options as Record<string, unknown>[])[0].next_question_id, null)
})

test('8) created_at não é copiado — a cópia nasce agora', () => {
  const linhas = remapearPerguntasV1(
    [{ id: 'q1', created_at: '2020-01-01', options: [] }], 'pg2', 't1', () => 'novo1',
  )
  assert.equal(linhas[0].created_at, undefined)
})

test('9) a action usa a regra pura, e não uma lista fixa de colunas', () => {
  const a = ler('src/app/actions/pages.ts')
  assert.ok(a.includes('camposHerdados(original)'), 'a action voltou a montar a cópia à mão')
  assert.ok(a.includes('remapearPerguntasV1'), 'quiz v1 ficaria sem as perguntas')
  // A assinatura do defeito antigo: montar o insert campo a campo.
  const trecho = a.slice(a.indexOf('export async function duplicatePage'))
  assert.ok(!/craft_json: original\.craft_json/.test(trecho), 'a lista fixa de colunas voltou')
  assert.ok(COLUNAS_NAO_COPIADAS.has('id') && COLUNAS_NAO_COPIADAS.has('slug'))
})

// ─── Execução ───────────────────────────────────────────────────────────────

for (const { name, fn } of suite) {
  try { fn(); results.push({ name, ok: true }) }
  catch (e) { results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) }) }
}
let passed = 0
for (const r of results) {
  if (r.ok) { passed++; console.log(`  ok   ${r.name}`) }
  else console.log(` FALHA ${r.name}\n        → ${r.error}`)
}
console.log(`\n${passed}/${results.length} testes passaram`)
if (passed !== results.length) process.exit(1)
