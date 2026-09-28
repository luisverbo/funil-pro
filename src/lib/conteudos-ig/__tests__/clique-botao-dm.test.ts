// ============================================================================
// Clique no botão de resposta ("EU QUERO") dispara o fluxo certo
// ----------------------------------------------------------------------------
// Relato do dono (28/09): a 1ª DM com o botão EU QUERO chegou, ele tocou duas
// vezes e nada veio depois.
//
// CAUSA RAIZ: para saber de que automação é o clique, o webhook olhava só a
// ÚLTIMA automação registrada para a pessoa. Quem entrou pelo porteiro
// "segue o perfil?" (não seguia → JÁ SIGO) nunca era registrado, então o
// clique caía numa automação antiga e pausada do mesmo perfil e morria.
// Além disso, o Instagram corta o payload do postback em 20 caracteres, e a
// comparação não cortava — botão de título longo nunca casava.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { chaveDoBotao, temBotaoDeResposta } from '@/lib/instagram/sequence'

const hook = readFileSync(join(process.cwd(), 'src/app/api/webhooks/instagram/route.ts'), 'utf8')

const passosVoto = [{
  id: 's1', text: 'Quer o link?',
  buttons: [{ title: 'EU QUERO', branch: [{ id: 's2', text: 'Acesse', buttons: [{ title: 'ACESSAR', url: 'https://x' }] }] }],
}]

const tests: Record<string, () => void> = {
  'chave do botão: minúscula, sem espaço sobrando e cortada em 20 como o Instagram': () => {
    assert.equal(chaveDoBotao('  EU QUERO '), 'eu quero')
    assert.equal(chaveDoBotao('Quero participar da votação agora'), 'quero participar da')
    assert.equal(chaveDoBotao(null), '')
  },
  'acha botão de resposta no 1º passo e dentro de ramificações; ignora botão de link': () => {
    assert.ok(temBotaoDeResposta(passosVoto, 'EU QUERO'))
    assert.ok(temBotaoDeResposta(passosVoto, 'eu quero'), 'digitar conta igual clicar')
    assert.ok(!temBotaoDeResposta(passosVoto, 'ACESSAR'), 'botão de link não é resposta')
    assert.ok(!temBotaoDeResposta(passosVoto, 'Top mano'))
    assert.ok(!temBotaoDeResposta(null, 'EU QUERO'))
  },
  'título longo casa com o payload cortado': () => {
    const longo = [{ buttons: [{ title: 'Quero participar da votação agora' }] }]
    assert.ok(temBotaoDeResposta(longo, 'Quero participar da'))
  },
  'webhook percorre as automações ATIVAS da pessoa e fica com a que tem o botão': () => {
    assert.ok(hook.includes(".order('last_at', { ascending: false }).limit(10)"), 'antes era limit(1): só a última')
    assert.ok(hook.includes("filter((a): a is NonNullable<typeof a> => !!a && a.status === 'active')"))
    assert.ok(hook.includes('ativas.find(a => temBotaoDeResposta(a.dm_steps, text))'))
  },
  'último recurso: procura o botão entre todas as automações ativas': () => {
    assert.ok(hook.includes('if (!curAutoId || !(await automacaoTemBotao(admin, curAutoId, text))) {'))
    assert.ok(hook.includes('const achou = (todas ?? []).find(a => temBotaoDeResposta(a.dm_steps, text))'))
  },
  'porteiro registra a pessoa ao barrar e ao liberar': () => {
    assert.ok(hook.includes('await recordAutomationContact(admin, auto.tenant_id, auto.id, fromId)\n              continue'))
    assert.ok(hook.includes('await recordAutomationContact(admin, auto.tenant_id, gated[0].automation_id, senderId)'))
  },
  'comparação do clique usa a mesma chave cortada': () => {
    assert.ok(hook.includes('const norm = chaveDoBotao(text)'))
    assert.ok(hook.includes('chaveDoBotao(b.title) === norm'))
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
