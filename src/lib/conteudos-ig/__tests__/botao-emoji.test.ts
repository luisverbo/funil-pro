// ============================================================================
// Clique em botão com emoji + sequência que espera o clique (14/10, PLUGUE EDITOR)
// ----------------------------------------------------------------------------
// 1) O Instagram devolveu o clique em "Quero o link 👉" como "Quero o link �"
//    — o emoji chegou quebrado e a comparação exata nunca casava.
// 2) A 2ª mensagem (o link) foi agendada junto com a 1ª. Sem a pessoa ter
//    respondido, a Meta recusou ("outside of allowed window") e o clique
//    não tinha mais nada para enviar.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chaveDoBotao, temBotaoDeResposta, esperaClique } from '@/lib/instagram/sequence'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const tests: Record<string, () => void> = {
  'emoji quebrado no clique casa com o título do botão': () => {
    assert.equal(chaveDoBotao('Quero o link 👉'), chaveDoBotao('Quero o link �'))
    assert.equal(chaveDoBotao('Quero o link 👉'), 'quero o link')
    assert.equal(chaveDoBotao('Quero o link \uD83D'), 'quero o link', 'meio emoji solto')
    const passos = [{ id: 'a', text: 'Quer?', buttons: [{ title: 'Quero o link 👉' }] }]
    assert.ok(temBotaoDeResposta(passos, 'Quero o link �'))
  },
  'regras antigas continuam: corte em 20, maiúsculas, botão só de emoji': () => {
    assert.equal(chaveDoBotao('Quero participar da votação agora'), 'quero participar da')
    assert.equal(chaveDoBotao('  EU QUERO '), 'eu quero')
    assert.equal(chaveDoBotao('JÁ SIGO ✅'), 'já sigo')
    assert.equal(chaveDoBotao('👍'), '👍', 'só emoji mantém o próprio emoji')
    assert.equal(chaveDoBotao(null), '')
  },
  'passo com botão de resposta faz a sequência esperar o clique; botão de link não': () => {
    assert.ok(esperaClique({ buttons: [{ title: 'Quero o link 👉' }] }))
    assert.ok(!esperaClique({ buttons: [{ title: 'Acessar', url: 'https://x' }] }))
    assert.ok(!esperaClique({ text: 'oi' }))
  },
  'startSequence para no botão de resposta e respeita o offset da continuação': () => {
    const s = ler('src/lib/instagram/sequence.ts')
    assert.ok(s.includes('if (esperaClique(steps[i])) break'))
    assert.ok(s.includes('step_index: offset + i'))
  },
  'clique sem passo pendente continua do passo seguinte ao do botão': () => {
    const w = ler('src/app/api/webhooks/instagram/route.ts')
    assert.ok(w.includes('const k = passos.findIndex(p => p.id && p.id === found?.ownerId)'))
    assert.ok(w.includes('steps: passos.slice(k + 1), offset: k + 1, admin,'))
  },
}

let passed = 0
const nomes = Object.keys(tests)
for (const nome of nomes) {
  try { tests[nome](); passed++; console.log(`  ok   ${nome}`) }
  catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
}
console.log(`\n${passed}/${nomes.length} testes passaram`)
if (passed !== nomes.length) process.exit(1)
