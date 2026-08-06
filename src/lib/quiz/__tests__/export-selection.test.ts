// ============================================================================
// Quiz — exportação com SELEÇÃO de páginas (CSV e PDF)
// ----------------------------------------------------------------------------
// O pedido: "ele está baixando tudo; quero escolher as páginas, e poder sair
// em PDF". O defeito silencioso que apareceu no caminho: o CSV antigo tinha
// UMA coluna por PÁGINA e a última resposta sobrescrevia as outras — uma
// página com nome, telefone e e-mail exportava um valor só.
//
// O que se trava aqui:
//   • cada PERGUNTA vira uma coluna própria;
//   • só as páginas escolhidas entram, e por LISTA BRANCA (id que não é do
//     quiz não vira coluna);
//   • o tenant é sempre conferido antes de qualquer leitura;
//   • CSV com escape e BOM (Excel pt-BR);
//   • PDF sem dependência nova, com todo valor de lead ESCAPADO.
//
// Testes de fonte: sem DOM, sem rede, sem banco.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const ACTION = 'src/app/actions/quiz-leads.ts'
const VIEW = 'src/components/quiz/quiz-leads-view.tsx'

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

function corpoDe(fonte: string, assinatura: string): string {
  const i = fonte.indexOf(assinatura)
  assert.ok(i >= 0, `não encontrei ${assinatura}`)
  const resto = fonte.slice(i)
  const fim = resto.indexOf('\n}\n')
  return resto.slice(0, fim > 0 ? fim : resto.length)
}

// ════════════════════════════════════════════════════════════════════════════

test('1) a exportação aceita a escolha de páginas — e valida por lista branca', () => {
  const a = ler(ACTION)
  assert.ok(a.includes('export async function exportLeadsTable'), 'sem action de exportação seletiva')
  const corpo = corpoDe(a, 'export async function exportLeadsTable')
  // Só páginas que EXISTEM no quiz entram, na ordem do quiz.
  assert.ok(corpo.includes("todas.filter(p => opts!.pageIds!.includes(p.id))"),
    'a seleção não é filtrada contra as páginas reais do quiz')
  // Sem seleção = tudo (comportamento anterior preservado).
  assert.ok(corpo.includes(': todas'), 'sem seleção deveria exportar tudo')
})

test('2) cada PERGUNTA vira uma coluna (antes a página inteira virava uma só)', () => {
  const a = ler(ACTION)
  assert.ok(a.includes('const BLOCOS_DE_RESPOSTA'), 'sem lista de blocos que geram coluna')
  const estrutura = corpoDe(a, 'function estruturaDePaginas')
  assert.ok(estrutura.includes('BLOCOS_DE_RESPOSTA.has(b.type)'), 'blocos sem resposta virariam coluna')
  assert.ok(estrutura.includes('b.config?.label || b.config?.question'),
    'a coluna não usa o rótulo que o construtor mostra')

  // As respostas são indexadas por BLOCO, não por página.
  const corpo = corpoDe(a, 'export async function exportLeadsTable')
  assert.ok(corpo.includes('porLead[lid][blockId] = valor'), 'resposta ainda indexada por página')
  assert.ok(corpo.includes("select('lead_id, block_id, event_type, value, created_at')"),
    'a consulta não traz o bloco de origem')
  assert.ok(corpo.includes("order('created_at', { ascending: true })"),
    'sem ordem, a resposta que vence é imprevisível')
})

test('3) tenant conferido antes de qualquer leitura', () => {
  const a = ler(ACTION)
  for (const fn of ['export async function exportLeadsTable', 'export async function getExportStructure']) {
    const corpo = corpoDe(a, fn)
    assert.ok(corpo.includes('verifyTenantOwnsQuiz(quizId, tenantId)'), `${fn} sem checagem de dono`)
    assert.ok(corpo.indexOf('verifyTenantOwnsQuiz') < corpo.indexOf('createAdminClient'),
      `${fn} cria o cliente admin antes de conferir o dono`)
  }
})

test('4) seleção vazia não gera arquivo mudo', () => {
  const a = ler(ACTION)
  const corpo = corpoDe(a, 'export async function exportLeadsTable')
  assert.ok(corpo.includes("if (colunas.length === 0) return { error:"),
    'exportaria um arquivo sem nenhuma coluna')
  const v = ler(VIEW)
  assert.ok(v.includes("setErroExport('Nenhuma resposta para exportar.')"),
    'não avisa quando não há linhas')
})

test('5) CSV: escape correto e BOM para o Excel em português', () => {
  const v = ler(VIEW)
  const corpo = corpoDe(v, 'function montarCsv')
  assert.ok(/\[",\\n\]/.test(corpo), 'escape do CSV não cobre vírgula, aspas e quebra de linha')
  assert.ok(corpo.includes('v.replace(/"/g, \'""\')'), 'aspas internas não são duplicadas')
  assert.ok(v.includes("'\\uFEFF' + montarCsv(t)"), 'sem BOM, o Excel pt-BR quebra a acentuação')
})

test('6) PDF: sem dependência nova e com TODO valor escapado', () => {
  const v = ler(VIEW)
  const corpo = corpoDe(v, 'function abrirPdf')
  // Resposta de lead é dado de terceiro: nunca pode virar HTML.
  assert.ok(corpo.includes("replace(/&/g, '&amp;')") && corpo.includes("replace(/</g, '&lt;')"),
    'o PDF injetaria HTML vindo da resposta do lead')
  assert.ok(corpo.includes('l.map(v => `<td>${esc(v)}</td>`)'), 'células não escapadas')
  assert.ok(corpo.includes('thead { display: table-header-group; }'),
    'o cabeçalho não se repete nas páginas do PDF')
  // Pop-up bloqueado é avisado, não engolido.
  assert.ok(corpo.includes('O navegador bloqueou a janela'), 'falha silenciosa se o pop-up for bloqueado')

  // Nenhuma biblioteca de PDF entrou no projeto.
  const pkg = JSON.parse(ler('package.json')) as { dependencies?: Record<string, string> }
  const deps = Object.keys(pkg.dependencies ?? {})
  assert.ok(!deps.some(d => /jspdf|pdfkit|puppeteer|html2pdf/i.test(d)),
    `dependência de PDF adicionada: ${deps.join(', ')}`)
})

test('7) a tela oferece os dois formatos e a escolha de páginas', () => {
  const v = ler(VIEW)
  assert.ok(v.includes("handleExport('csv')") && v.includes("handleExport('pdf')"),
    'faltou um dos formatos')
  assert.ok(v.includes('Baixar CSV') && v.includes('Gerar PDF'), 'rótulos dos botões ausentes')
  assert.ok(v.includes('Marcar todas') && v.includes('Desmarcar todas'), 'sem atalho de seleção')
  // O botão da barra abre a seleção — não baixa direto, como fazia antes.
  assert.ok(v.includes('onClick={abrirExport}'), 'o botão ainda baixaria sem perguntar')
  assert.ok(!v.includes('exportLeadsCSV'), 'a exportação antiga (tudo de uma vez) continua ligada')
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
