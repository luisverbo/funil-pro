// ============================================================================
// Resetar dados do quiz — apagar o teste antes de medir de verdade
// ----------------------------------------------------------------------------
// Relato do dono: "quando eu resetar aqui quero a opção de também resetar
// esses dados de ENTRARAM, até pq eu vou testar primeiro antes de realmente
// medir, aí fica dados falsos".
//
// O que estava furado:
//   1. o reset apagava SÓ `quiz_leads`. Os eventos (`quiz_lead_events` é quem
//      sustenta "entraram", "onde as pessoas param" e "chegaram ao final") e
//      os contadores da página ficavam de pé
//   2. os cartões do painel só buscavam no `[quizId]` — depois do reset a tela
//      continuava mostrando "15 leads" com a lista vazia
//   3. o aviso era um confirm() do navegador: não dizia o que sumia nem
//      deixava escolher o que preservar
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const acoes = ler('src/app/actions/quiz-leads.ts')
const reset = acoes.slice(
  acoes.indexOf('export async function resetQuizLeads'),
  acoes.indexOf('export async function getQuizStats'),
)
const view = ler('src/components/quiz/quiz-leads-view.tsx')

const tests: Record<string, () => void> = {
  // ── O que o reset apaga ───────────────────────────────────────────────────
  'continua apagando os leads, só do quiz e só do tenant': () => {
    assert.ok(reset.includes("from('quiz_leads')"))
    assert.ok(reset.includes(".eq('quiz_id', quizId)"))
    assert.ok(reset.includes(".eq('tenant_id', tenantId)"))
    assert.ok(reset.includes('verifyTenantOwnsQuiz(quizId, tenantId)'), 'ninguém zera quiz alheio')
  },
  'apaga os EVENTOS — é deles que sai "entraram" e o funil do portal': () => {
    assert.ok(reset.includes("from('quiz_lead_events')"), 'o CASCADE não alcança evento órfão')
    const depoisDosEventos = reset.slice(reset.indexOf("from('quiz_lead_events')"))
    assert.ok(depoisDosEventos.includes('.delete()'))
    assert.ok(depoisDosEventos.includes(".eq('quiz_id', quizId)"))
  },
  'zera os contadores da própria página (visitas e conversões do teste)': () => {
    assert.ok(reset.includes('views_count: 0'))
    assert.ok(reset.includes('conversions_count: 0'))
  },
  'o investimento lançado é OPCIONAL — gasto real não some sem pedir': () => {
    assert.ok(reset.includes('opcoes?: { investimento?: boolean }'), 'a opção precisa existir na assinatura')
    assert.ok(reset.includes('if (opcoes?.investimento)'), 'só apaga quando o dono marca')
    const trecho = reset.slice(reset.indexOf('if (opcoes?.investimento)'))
    assert.ok(trecho.includes("from('quiz_spend_entries')"))
    assert.ok(trecho.includes(".eq('page_id', quizId)"))
    // sem a opção, a chamada antiga (um argumento só) continua válida
    assert.ok(/resetQuizLeads\(\n?\s*quizId: string,/.test(reset), 'quizId segue sendo o 1º argumento')
  },
  'erro de qualquer etapa volta para a tela — nada de "apagou" mentiroso': () => {
    assert.ok(reset.includes('if (evErr) return { success: false, error: evErr.message }'))
    assert.ok(reset.includes('if (spendErr) return { success: false, error: spendErr.message }'))
  },

  // ── A tela ────────────────────────────────────────────────────────────────
  'os cartões recarregam depois do reset (o "15" que ficava congelado)': () => {
    assert.ok(view.includes('function StatsBar({ quizId, refreshKey }'))
    assert.ok(view.includes('}, [quizId, refreshKey])'), 'sem a chave, o efeito nunca roda de novo')
    assert.ok(view.includes('<StatsBar quizId={quizId} refreshKey={resetKey} />'))
    assert.ok(view.includes('setResetKey(k => k + 1)'))
  },
  'modal explica o que some e deixa preservar o investimento': () => {
    assert.ok(!/confirm\('Tem certeza\? Todos os dados/.test(view), 'o confirm() do navegador não pode ter sobrado')
    assert.ok(view.includes('Resetar dados do quiz'))
    assert.ok(view.includes('entrou</b>, onde parou e quem chegou ao final'), 'o dono precisa ler que "entraram" zera')
    assert.ok(view.includes('O que o seu cliente marcou no portal'))
    assert.ok(view.includes('checked={resetInvestimento}'))
    assert.ok(view.includes('resetQuizLeads(quizId, { investimento: resetInvestimento })'))
    assert.ok(view.includes('O quiz, as páginas e o link continuam intactos'), 'o que NÃO some também precisa estar claro')
  },
  'falha do reset aparece no modal e a janela não fecha': () => {
    assert.ok(view.includes("setResetErro(r.error ?? 'Não consegui apagar'); return"))
    assert.ok(view.includes('{resetErro && <p'))
  },
  'a operação segue passando pelo despachante HTTP': () => {
    assert.ok(ler('src/app/api/painel-quiz/route.ts').includes('resetQuizLeads'))
    assert.ok(ler('src/lib/quiz/painel-client.ts').includes("export const resetQuizLeads = op('resetQuizLeads')"))
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
