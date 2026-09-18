// ============================================================================
// Renomear o quiz — e a cópia que abria no editor errado
// ----------------------------------------------------------------------------
// Relato do dono: "não estou conseguindo mudar o nome do quiz quando duplico".
// Duas causas, as duas trancadas aqui:
//   1. DUPLICAR levava SEMPRE para /page-editor — a cópia de um quiz abria no
//      editor de Craft.js, onde o quiz não existe e não há nome para trocar
//   2. no editor do quiz o nome era TEXTO puro — nem chegando lá dava para
//      renomear sem voltar à lista
// E o nome da cópia não pode empilhar "Cópia de Cópia de Cópia de…".
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { caminhoDoEditor, nomeDaCopia } from '@/lib/pages/editor-path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const tests: Record<string, () => void> = {
  // ── A regra ───────────────────────────────────────────────────────────────
  'cada tipo abre no seu editor; tipo desconhecido cai no editor de páginas': () => {
    assert.equal(caminhoDoEditor('interactive', 'abc'), '/quiz-editor/abc')
    assert.equal(caminhoDoEditor('biolink', 'abc'), '/bio-editor/abc')
    assert.equal(caminhoDoEditor('capture', 'abc'), '/page-editor/abc')
    assert.equal(caminhoDoEditor(null, 'abc'), '/page-editor/abc')
    assert.equal(caminhoDoEditor(undefined, 'abc'), '/page-editor/abc')
  },
  'nome da cópia é diferente do original e não empilha "Cópia de"': () => {
    assert.equal(nomeDaCopia('Quiz de vagas'), 'Cópia de Quiz de vagas')
    assert.equal(nomeDaCopia('Cópia de Quiz de vagas'), 'Cópia de Quiz de vagas')
    assert.equal(nomeDaCopia('Cópia de Cópia de Quiz'), 'Cópia de Quiz')
    assert.equal(nomeDaCopia('   '), 'Cópia de Página')
  },

  // ── Costuras ──────────────────────────────────────────────────────────────
  'duplicar abre o editor CERTO — nunca /page-editor fixo': () => {
    const pc = ler('src/app/(dashboard)/pages/pages-client.tsx')
    assert.ok(pc.includes('caminhoDoEditor(copy.page_type'), 'o destino da cópia sai do tipo da página')
    assert.ok(!/router\.push\(`\/page-editor\/\$\{copy\.id\}`\)/.test(pc), 'o destino fixo não pode ter sobrado')
    assert.ok(pc.includes('return caminhoDoEditor(page.page_type, page.id)'), 'Editar e Duplicar usam a MESMA regra')
  },
  'a cópia nasce com o nome derivado da autoridade única': () => {
    const act = ler('src/app/actions/pages.ts')
    assert.ok(act.includes('nomeDaCopia(original.title'))
    assert.ok(!act.includes('title: `Cópia de ${original.title}`'), 'o nome cru não pode ter sobrado')
  },
  'editor do quiz: nome é campo editável, não texto morto': () => {
    const ed = ler('src/components/quiz/quiz-editor-v2.tsx')
    assert.ok(!/<h1 className="hidden sm:block text-sm font-semibold text-gray-900 truncate max-w-\[180px\]">\{page\.title\}<\/h1>/.test(ed),
      'o título como texto puro era o motivo de não dar para renomear')
    assert.ok(ed.includes('setRenomeando(true)'), 'clicar no nome abre a edição')
    assert.ok(ed.includes('confirmarNome()'), 'Enter e sair do campo salvam')
    assert.ok(ed.includes("if (e.key === 'Escape') { setRascunhoNome(titulo); setRenomeando(false)"), 'Escape desiste sem salvar')
    assert.ok(ed.includes('renomearQuiz(page.id, nome)'))
    assert.ok(/max-w-\[110px\] sm:max-w-\[200px\]/.test(ed), 'o nome também aparece no celular')
  },
  'renomear NÃO mexe no endereço publicado (slug) e valida o vazio': () => {
    const act = ler('src/app/actions/quiz-v2.ts')
    const fn = act.slice(act.indexOf('export async function renomearQuiz'))
    assert.ok(fn.includes("update({ title: nome })"), 'só o título muda')
    assert.ok(!fn.includes('slug'), 'link já divulgado não pode morrer por causa de um título')
    assert.ok(fn.includes("if (!nome) return { success: false, error: 'O nome não pode ficar vazio' }"))
    assert.ok(fn.includes(".eq('tenant_id', tenantId)"), 'ninguém renomeia página de outro tenant')
  },
  'renomear viaja por HTTP (despachante), não por server action': () => {
    const rota = ler('src/app/api/painel-quiz/route.ts')
    assert.ok(rota.includes('renomearQuiz'), 'a operação precisa estar na lista fechada')
    const cli = ler('src/lib/quiz/painel-client.ts')
    assert.ok(cli.includes("export const renomearQuiz = op('renomearQuiz')"))
    const ed = ler('src/components/quiz/quiz-editor-v2.tsx')
    assert.ok(ed.includes("renomearQuiz } from '@/lib/quiz/painel-client'"), 'o editor chama o cliente HTTP, como salvar e publicar')
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
