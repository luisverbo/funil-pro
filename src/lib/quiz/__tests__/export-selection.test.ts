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
// O miolo da exportação mudou de endereço quando o painel compartilhado
// (/ql/[token]) nasceu: as regras foram para src/lib/quiz/leads-core.ts e a
// geração de arquivo para export-files.ts, AMBOS usados pelos dois painéis.
// As leituras abaixo concatenam action+core (e view+arquivos) para que cada
// teste continue conferindo o comportamento onde quer que ele more.
const ACTION = 'src/app/actions/quiz-leads.ts'
const CORE = 'src/lib/quiz/leads-core.ts'
const VIEW = 'src/components/quiz/quiz-leads-view.tsx'
const ARQUIVOS = 'src/components/quiz/export-files.ts'

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
  const a = ler(ACTION) + '\n' + ler(CORE)
  assert.ok(a.includes('export async function exportLeadsTable'), 'sem action de exportação seletiva')
  const corpo = corpoDe(a, 'export async function montarTabelaLeads')
  // Só páginas que EXISTEM no quiz entram, na ordem do quiz.
  assert.ok(corpo.includes("todas.filter(p => opts!.pageIds!.includes(p.id))"),
    'a seleção não é filtrada contra as páginas reais do quiz')
  // Sem seleção = tudo (comportamento anterior preservado).
  assert.ok(corpo.includes(': todas'), 'sem seleção deveria exportar tudo')
})

test('2) cada PERGUNTA vira uma coluna (antes a página inteira virava uma só)', () => {
  const a = ler(ACTION) + '\n' + ler(CORE)
  assert.ok(a.includes('const BLOCOS_DE_RESPOSTA'), 'sem lista de blocos que geram coluna')
  const estrutura = corpoDe(a, 'function estruturaDePaginas')
  assert.ok(estrutura.includes('BLOCOS_DE_RESPOSTA.has(b.type)'), 'blocos sem resposta virariam coluna')
  assert.ok(estrutura.includes('b.config?.label || b.config?.question'),
    'a coluna não usa o rótulo que o construtor mostra')

  // As respostas são indexadas por BLOCO, não por página.
  const corpo = corpoDe(a, 'export async function montarTabelaLeads')
  assert.ok(corpo.includes('porLead[lid][blockId] = valor'), 'resposta ainda indexada por página')
  // A consulta mora num helper ÚNICO (lerEventosDeResposta), usado pela
  // estrutura e pela tabela — as duas leituras nunca divergem.
  assert.ok(a.includes("select('lead_id, block_id, event_type, value, created_at')"),
    'a consulta não traz o bloco de origem')
  assert.ok(a.includes("order('created_at', { ascending: true })"),
    'sem ordem, a resposta que vence é imprevisível')
  assert.ok(corpo.includes('lerEventosDeResposta('), 'a tabela não usa o helper único')
})

test('3) tenant conferido antes de qualquer leitura', () => {
  const a = ler(ACTION) + '\n' + ler(CORE)
  for (const fn of ['export async function exportLeadsTable', 'export async function getExportStructure']) {
    const corpo = corpoDe(a, fn)
    assert.ok(corpo.includes('verifyTenantOwnsQuiz(quizId, tenantId)'), `${fn} sem checagem de dono`)
    assert.ok(corpo.indexOf('verifyTenantOwnsQuiz') < corpo.indexOf('createAdminClient'),
      `${fn} cria o cliente admin antes de conferir o dono`)
  }
})

test('4) seleção vazia não gera arquivo mudo', () => {
  const a = ler(ACTION) + '\n' + ler(CORE)
  const corpo = corpoDe(a, 'export async function montarTabelaLeads')
  assert.ok(corpo.includes("if (colunas.length === 0) return { error:"),
    'exportaria um arquivo sem nenhuma coluna')
  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
  // A mensagem depende do filtro escolhido, mas o aviso de "nada a exportar"
  // precisa existir nos dois casos.
  assert.ok(v.includes("'Nenhuma resposta para exportar.'"), 'não avisa quando não há linhas')
  assert.ok(v.includes('if (t.linhas.length === 0)'), 'baixaria um arquivo sem nenhuma linha')
})

test('5) CSV: escape correto e BOM para o Excel em português', () => {
  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
  const corpo = corpoDe(v, 'function montarCsv')
  assert.ok(/\[",\\n\]/.test(corpo), 'escape do CSV não cobre vírgula, aspas e quebra de linha')
  assert.ok(corpo.includes('v.replace(/"/g, \'""\')'), 'aspas internas não são duplicadas')
  assert.ok(v.includes("'\\uFEFF' + montarCsv(t)"), 'sem BOM, o Excel pt-BR quebra a acentuação')
})

test('6) PDF: sem dependência nova e com TODO valor escapado', () => {
  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
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
  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
  assert.ok(v.includes("handleExport('csv')") && v.includes("handleExport('pdf')"),
    'faltou um dos formatos')
  assert.ok(v.includes('Baixar CSV') && v.includes('Gerar PDF'), 'rótulos dos botões ausentes')
  assert.ok(v.includes('Marcar/desmarcar todas') && v.includes('Desmarcar vazias'),
    'sem atalho de seleção em massa')
  // O botão da barra abre a seleção — não baixa direto, como fazia antes.
  assert.ok(v.includes('onClick={abrirExport}'), 'o botão ainda baixaria sem perguntar')
  assert.ok(!v.includes('exportLeadsCSV'), 'a exportação antiga (tudo de uma vez) continua ligada')
})

test('8) seleção por COLUNA: cada pergunta pode entrar ou sair sozinha', () => {
  const a = ler(ACTION) + '\n' + ler(CORE)
  const corpo = corpoDe(a, 'export async function montarTabelaLeads')
  assert.ok(corpo.includes('const filtroColunas'), 'sem filtro por coluna')
  assert.ok(corpo.includes('const querColuna = (chave: string) => !filtroColunas || filtroColunas.has(chave)'),
    'o filtro de coluna não é lista branca')
  // Sem filtro = tudo (nada quebra para quem não escolhe).
  assert.ok(corpo.includes('!filtroColunas ||'), 'ausência de filtro deveria manter todas as colunas')
  // Página que perdeu todas as colunas some do cabeçalho composto.
  assert.ok(corpo.includes('const paginasComColuna = escolhidas.filter'),
    'página sem coluna escolhida ainda contaria para o rótulo')

  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
  assert.ok(v.includes('columnKeys: [...colunasSel]'), 'a tela não envia a seleção por coluna')
})

test('9) colunas VAZIAS são visíveis e desmarcáveis em um clique', () => {
  const a = ler(ACTION) + '\n' + ler(CORE)
  const estrutura = corpoDe(a, 'export async function estruturaComContagens')
  assert.ok(estrutura.includes('respondentes[coluna.chave]?.size ?? 0'),
    'a contagem por coluna não é calculada')
  // Conta LEADS distintos, não eventos: quem corrigiu a resposta conta uma vez.
  assert.ok(estrutura.includes('.add(ev.lead_id)'), 'contaria eventos em vez de leads')

  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
  assert.ok(v.includes("{c.respostas === 0 ? 'sem respostas' : `${c.respostas} resp.`}"),
    'a tela não mostra quais colunas estão vazias')
  assert.ok(v.includes('Desmarcar vazias'), 'sem atalho para tirar as colunas vazias')
  // O padrão já vem sem as vazias — mas elas continuam LISTADAS para marcar.
  assert.ok(v.includes('const comResposta = r.paginas.flatMap'), 'a seleção inicial ignora a contagem')
})

test('10) ocultar coluna é reversível, visível e não apaga dado', () => {
  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
  assert.ok(v.includes('function useColunasOcultas'), 'sem controle de colunas ocultas')
  const hook = corpoDe(v, 'function useColunasOcultas')
  // Preferência de leitura: navegador, por quiz — nunca o banco.
  assert.ok(hook.includes('`quiz-colunas-ocultas:${quizId}`'), 'a preferência não é por quiz')
  assert.ok(!/supabase|fetch\(/i.test(hook), 'ocultar coluna não pode tocar o servidor')
  // Fonte externa lida do jeito certo (a regra de lint do projeto reprova
  // setState dentro de efeito).
  assert.ok(v.includes('useSyncExternalStore(subscribe, getSnapshot'), 'leitura do storage em efeito')
  assert.ok(hook.includes('cache.current = { bruto, valor: new Set(lista) }'),
    'snapshot sem cache causaria renderização infinita')

  // O estado é VISÍVEL e desfazível.
  assert.ok(v.includes("{ocultas.size === 1 ? 'coluna oculta' : 'colunas ocultas'}"),
    'nada avisa que existem colunas ocultas')
  assert.ok(v.includes('onClick={mostrarTodas}'), 'sem como trazer as colunas de volta')
  // A tabela respeita a preferência no cabeçalho E nas linhas.
  assert.ok((v.match(/pages\.filter\(p => !ocultas\.has\(p\.id\)\)/g) ?? []).length >= 2,
    'cabeçalho e linhas precisam esconder a mesma coluna')
})

test('11) filtro de QUEM entra: quem só visitou pode ficar de fora', () => {
  const a = ler(ACTION) + '\n' + ler(CORE)
  assert.ok(a.includes("export type ExportPublico = 'todos' | 'com_resposta' | 'completos' | 'concluidos'"),
    'sem os quatro públicos de exportação')
  const corpo = corpoDe(a, 'export async function montarTabelaLeads')

  // O padrão continua 'todos': quem já usava não vê o comportamento mudar.
  assert.ok(corpo.includes("const publico: ExportPublico = opts?.publico ?? 'todos'"),
    'o padrão deixou de ser todos')
  assert.ok(corpo.includes("if (publico === 'todos') return true"), 'sem caminho para exportar tudo')

  // "Respondeu" é medido nas PERGUNTAS, nunca nas colunas de lead — senão
  // quem só abriu o formulário contaria como respondente (tem nome e data).
  assert.ok(corpo.includes("filter(c => !c.startsWith('lead:'))"),
    'colunas de lead entrariam na conta de quem respondeu')
  assert.ok(corpo.includes("const respondidas = chavesPergunta.filter(c => (respostas[c] ?? '').trim().length > 0).length"),
    'resposta em branco contaria como preenchida')

  // Cada público tem regra própria e verificável.
  assert.ok(corpo.includes("if (publico === 'concluidos') return lead.status === 'completed'"),
    'concluidos não usa o status do lead')
  assert.ok(corpo.includes("if (publico === 'com_resposta') return respondidas > 0"),
    'com_resposta sem regra')
  assert.ok(corpo.includes('return chavesPergunta.length > 0 && respondidas === chavesPergunta.length'),
    'completos aceitaria lead sem responder tudo')

  // O filtro roda ANTES de montar as linhas — nada de gerar e descartar.
  assert.ok(corpo.includes('const selecionados = (leads ?? []).filter(entra)'),
    'o filtro não é aplicado antes de montar as linhas')
  assert.ok(corpo.includes('ids: selecionados.map(l => String(l.id))'),
    'os ids exportados precisam sair na mesma seleção das linhas')
})

test('12) a tela oferece as quatro opções e explica cada uma', () => {
  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
  assert.ok(v.includes('Quem entra'), 'sem seção de público')
  for (const rotulo of ['Todos os leads', 'Só quem respondeu algo', 'Só quem preencheu tudo', 'Só quem concluiu o quiz']) {
    assert.ok(v.includes(rotulo), `faltou a opção "${rotulo}"`)
  }
  assert.ok(v.includes('inclusive quem só visitou'), 'a opção padrão não explica o que inclui')
  assert.ok(v.includes('publico: publicoExport'), 'a escolha não é enviada ao servidor')
  // Filtro que zera o resultado avisa o motivo, em vez de baixar arquivo vazio.
  assert.ok(v.includes('Nenhum lead se encaixa nesse filtro'), 'sem aviso de filtro restritivo demais')
})

test('13) CAUSA RAIZ: quiz sem página de Resultado também registra conclusão', () => {
  const r = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')
  // Antes, `trackComplete` só existia em submitResult — que roda apenas quando
  // há bloco de Resultado. Num formulário, ninguém era marcado como concluído.
  const fins = (r.match(/if \(next === 'end'\) \{/g) ?? []).length
  assert.ok(fins >= 1, 'caminho de fim não encontrado')
  const marcacoes = (r.match(/tracker\.trackComplete\(/g) ?? []).length
  assert.ok(marcacoes >= 3,
    `só ${marcacoes} pontos marcam conclusão — os caminhos de fim sem Resultado ficaram de fora`)
  // O caminho de fim marca ANTES de mudar a fase.
  const trecho = r.slice(r.indexOf("if (next === 'end') {"))
  assert.ok(trecho.indexOf('trackComplete') < trecho.indexOf("setPhase('done')"),
    'a fase muda antes de registrar a conclusão')
})

test('14) a tela mostra QUANTOS leads cada filtro pega, antes de baixar', () => {
  const a = ler(ACTION) + '\n' + ler(CORE)
  assert.ok(a.includes('export interface ExportLeadResumo'), 'servidor não devolve resumo por lead')
  const estrutura = corpoDe(a, 'export async function estruturaComContagens')
  assert.ok(estrutura.includes('const leads: ExportLeadResumo[]'), 'sem resumo de leads')
  assert.ok(estrutura.includes("concluido: l.status === 'completed'"), 'resumo sem a marca de concluído')
  // Só id e status saem do banco para esta contagem — nada de dado pessoal.
  assert.ok(estrutura.includes(".select('id, status')"), 'o resumo carrega mais dado do que precisa')

  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
  const fn = corpoDe(v, 'function contarPublico')
  assert.ok(fn.includes("if (alvo === 'todos') return base.length"), 'sem contagem de todos')
  // A base da contagem respeita o "pular exportados" — o número mostrado é o
  // número real do arquivo.
  assert.ok(fn.includes('pularExportados'), 'a contagem ignora quem já foi exportado')
  assert.ok(fn.includes('base.filter(l => l.chaves.some(k => perguntas.includes(k)))'), 'com_resposta sem contagem')
  assert.ok(fn.includes('base.filter(l => perguntas.every(k => l.chaves.includes(k)))'), 'completos sem contagem')
  // A conta usa só as PERGUNTAS marcadas — coluna de lead não vale como resposta.
  assert.ok(fn.includes("filter(c => !c.startsWith('lead:'))"), 'colunas de lead entrariam na conta')
  // E a contagem aparece em cada opção, com destaque quando é zero.
  assert.ok(v.includes("contarPublico(valor) === 0 ? 'text-amber-600'"), 'zero não é destacado')
})

test('15) CAUSA RAIZ: eventos são lidos em PÁGINAS (o corte de 1000 sumia com leads)', () => {
  const a = ler(ACTION) + '\n' + ler(CORE)
  assert.ok(a.includes('async function buscarEventos'), 'sem leitura paginada de eventos')
  const fn = corpoDe(a, 'async function buscarEventos')
  assert.ok(fn.includes('const TAMANHO = 1000'), 'a página não bate com o teto do PostgREST')
  assert.ok(fn.includes('if (data.length < TAMANHO) break'), 'não para na última página')
  assert.ok(/pagina < 200/.test(fn), 'sem teto de segurança para o laço')

  // Nenhuma consulta de evento pode mais buscar sem paginar/limitar: era isso
  // que fazia a exportação trazer 8 leads quando havia dezenas.
  const consultas = a.split("from('quiz_lead_events')").slice(1)
  assert.ok(consultas.length >= 4, 'consultas de evento não encontradas')
  for (const trecho of consultas) {
    const cabeca = trecho.slice(0, 400)
    assert.ok(/\.range\(/.test(cabeca),
      `consulta de eventos sem paginação: ${cabeca.split('\n')[1]?.trim()}`)
  }
})

test('16) não repetir quem já foi exportado', () => {
  const a = ler(ACTION) + '\n' + ler(CORE)
  const corpo = corpoDe(a, 'export async function montarTabelaLeads')
  assert.ok(corpo.includes('const jaExportados = new Set'), 'sem lista de exclusão')
  assert.ok(corpo.includes('if (jaExportados.has(lead.id)) return false'),
    'lead já exportado continuaria entrando')
  // A exclusão vem ANTES de qualquer regra de público.
  assert.ok(corpo.indexOf('jaExportados.has(lead.id)') < corpo.indexOf("if (publico === 'todos')"),
    'a exclusão precisa valer inclusive para "todos"')
  // A tabela devolve os ids para a tela poder marcar quem saiu.
  assert.ok(a.includes('/** IDs dos leads, NA MESMA ORDEM das linhas'), 'ExportTable sem ids')

  const v = ler(VIEW) + '\n' + ler(ARQUIVOS)
  assert.ok(v.includes('function useJaExportados'), 'sem histórico de exportados')
  const hook = corpoDe(v, 'function useJaExportados')
  assert.ok(hook.includes('`quiz-leads-exportados:${quizId}`'), 'histórico não é por quiz')
  assert.ok(!/supabase|createAdminClient/i.test(hook), 'o histórico não deve tocar o banco')
  // Marca só DEPOIS do arquivo sair, e dá para limpar.
  assert.ok(v.includes('registrarExportados(t.ids)'), 'não registra quem foi exportado')
  const handler = corpoDe(v, "async function handleExport(formato: 'csv' | 'pdf')")
  assert.ok(handler.indexOf('abrirPdf(t)') < handler.indexOf('registrarExportados(t.ids)'),
    'marcaria como exportado antes de gerar o arquivo')
  assert.ok(v.includes('Pular quem já exportei antes') && v.includes('Limpar histórico'),
    'a tela não oferece pular nem limpar')
  // Filtro que zera POR CAUSA do histórico explica isso.
  assert.ok(v.includes('já foram exportados antes'), 'sem aviso específico do histórico')
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
