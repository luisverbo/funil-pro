// ============================================================================
// Excluir leads ESCOLHIDOS — apagar o teste sem perder o dado do cliente
// ----------------------------------------------------------------------------
// Relato do dono: "fiz dois testes e preenchi de qualquer maneira, só que
// apareceu lá no painel do meu cliente. Só que eu não posso deletar tudo
// porque o meu cliente já tem dados lá".
//
// Só existia o reset (apaga tudo). Aqui se tranca a exclusão por escolha:
//   1. a ação: ids validados, teto, filtro por quiz + tenant, eventos junto
//   2. a tela: caixa por linha, "selecionar todos" respeitando o filtro,
//      barra de ação, lixeira no drawer, modal que avisa do portal do cliente
//   3. os cartões recontam depois de excluir
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const acoes = ler('src/app/actions/quiz-leads.ts')
const fn = acoes.slice(
  acoes.indexOf('export async function excluirLeadsDoQuiz'),
  acoes.indexOf('export async function resetQuizLeads'),
)
const view = ler('src/components/quiz/quiz-leads-view.tsx')

const tests: Record<string, () => void> = {
  // ── A ação ────────────────────────────────────────────────────────────────
  'a ação existe e recebe a lista de ids escolhidos': () => {
    assert.ok(fn.includes('excluirLeadsDoQuiz('))
    assert.ok(fn.includes('leadIds: string[]'))
    assert.ok(fn.includes('removidos?: number'), 'a tela precisa saber quantos saíram de verdade')
  },
  'id inválido não chega ao banco; lista vazia é recusada; há teto': () => {
    assert.ok(acoes.includes('function ehUuid('), 'sem validação de formato')
    assert.ok(fn.includes('.filter(ehUuid)'))
    assert.ok(fn.includes('new Set('), 'id repetido não conta duas vezes')
    assert.ok(fn.includes('.slice(0, 500)'), 'uma lista gigante não pode virar delete sem teto')
    assert.ok(fn.includes("if (ids.length === 0) return { success: false, error: 'Nenhum lead válido selecionado' }"))
  },
  'o id sozinho NÃO manda: sempre filtrado por quiz e por tenant': () => {
    assert.ok(fn.includes('verifyTenantOwnsQuiz(quizId, tenantId)'))
    assert.ok(fn.indexOf('verifyTenantOwnsQuiz') < fn.indexOf('createAdminClient'), 'confere o dono antes do cliente admin')
    const del = fn.slice(fn.indexOf("from('quiz_leads')"))
    assert.ok(del.includes(".in('id', ids)"))
    assert.ok(del.includes(".eq('quiz_id', quizId)"), 'sem isto, um id de outro quiz seria apagado')
    assert.ok(del.includes(".eq('tenant_id', tenantId)"), 'sem isto, um id de outro cliente seria apagado')
  },
  'eventos do lead saem junto — não fica "entraram" fantasma': () => {
    assert.ok(fn.includes("from('quiz_lead_events')"))
    assert.ok(fn.includes(".in('lead_id', removidos)"), 'varre pelos que saíram DE VERDADE, não pelos pedidos')
  },
  'erro do banco volta para a tela': () => {
    assert.ok(fn.includes('if (error) return { success: false, error: error.message }'))
  },
  'a operação passa pelo despachante HTTP, como o resto do painel': () => {
    assert.ok(ler('src/app/api/painel-quiz/route.ts').includes('excluirLeadsDoQuiz'))
    assert.ok(ler('src/lib/quiz/painel-client.ts').includes("export const excluirLeadsDoQuiz = op('excluirLeadsDoQuiz')"))
  },

  // ── A tela ────────────────────────────────────────────────────────────────
  'cada linha tem caixa de seleção, e marcar não abre o lead': () => {
    assert.ok(view.includes('checked={selecionados.has(lead.id)}'))
    assert.ok(view.includes('onChange={() => alternarSelecao(lead.id)}'))
    assert.ok(view.includes('onClick={e => e.stopPropagation()}'), 'clicar na caixa abriria o drawer por cima')
  },
  '"selecionar todos" pega a lista FILTRADA — é o "excluir por dia"': () => {
    assert.ok(view.includes('function alternarTodosVisiveis'))
    const corpo = view.slice(view.indexOf('function alternarTodosVisiveis'), view.indexOf('async function confirmarExclusao'))
    assert.ok(corpo.includes('leads.map(l => l.id)'), 'usa a lista que está na tela (busca + período)')
    assert.ok(corpo.includes('todosMarcados'), 'clicar de novo desmarca')
  },
  'barra de ação aparece com seleção e some quando limpa': () => {
    assert.ok(view.includes('{selecionados.size > 0 && ('))
    assert.ok(view.includes('Excluir selecionados'))
    assert.ok(view.includes('Limpar seleção'))
  },
  'drawer do lead tem a lixeira que leva ao mesmo caminho': () => {
    assert.ok(view.includes('onExcluir: () => void'))
    assert.ok(view.includes('title="Excluir este lead"'))
    assert.ok(view.includes('setSelecionados(new Set([selectedLead.id]))'), 'reaproveita a mesma confirmação')
  },
  'a confirmação avisa que some do portal do cliente e que é só a seleção': () => {
    assert.ok(view.includes('Somem também do <b>portal do seu cliente</b>'))
    assert.ok(view.includes('O resto dos leads deste quiz fica como está'))
    assert.ok(view.includes('Não dá para desfazer'))
    assert.ok(view.includes('excluirLeadsDoQuiz(quizId, [...selecionados])'))
  },
  'depois de excluir: seleção limpa, cartões recontam e a lista recarrega': () => {
    const corpo = view.slice(view.indexOf('async function confirmarExclusao'), view.indexOf('async function confirmarReset'))
    assert.ok(corpo.includes('setSelecionados(new Set())'))
    assert.ok(corpo.includes('setResetKey(k => k + 1)'), 'sem isto os cartões ficariam no número velho')
    assert.ok(corpo.includes('load()'))
    assert.ok(corpo.includes("setExcluirErro(r.error ?? 'Não consegui excluir'); return"), 'falha não pode fechar o modal como se tivesse dado certo')
  },
}

// ─── Execução ───────────────────────────────────────────────────────────────

let passed = 0
const nomes = Object.keys(tests)
for (const nome of nomes) {
  try { tests[nome](); passed++; console.log(`  ok   ${nome}`) }
  catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
}
console.log(`\n${passed}/${nomes.length} testes passaram`)
if (passed !== nomes.length) process.exit(1)
