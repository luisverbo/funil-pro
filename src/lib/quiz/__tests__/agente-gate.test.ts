// ============================================================================
// Agente: contato só depois de qualificar
// ----------------------------------------------------------------------------
// Dois defeitos relatados com print:
//
//   1. O formulário de contato e os botões de faixa apareceram JUNTOS — duas
//      perguntas ao mesmo tempo, e o lead não sabe qual responder.
//   2. O contato era pedido por CONTAGEM de mensagens, antes de saber se o
//      lead se qualifica. Quem responde "menos de R$ 250 por dia" não vai ser
//      atendido — pedir o contato dele desperdiça o melhor momento da conversa.
//
// A leitura do gate é determinística: compara o que o lead digitou com os
// rótulos configurados. Não depende de o modelo lembrar de avisar.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { statusDoGate, podePedirContato, type OpcaoGate } from '@/lib/agents/gate'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void }[] = []
function test(name: string, fn: () => void) { suite.push({ name, fn }) }

const FAIXAS: OpcaoGate[] = [
  { label: 'Menos de R$ 250 por dia', qualifies: false },
  { label: 'De R$ 250 a R$ 299 por dia', qualifies: false },
  { label: 'De R$ 500 a R$ 999 por dia', qualifies: true },
  { label: 'R$ 1.000 por dia ou mais', qualifies: true },
  { label: 'Ainda não sei / preciso entender melhor', qualifies: false },
]

// ════════════════════════════════════════════════════════════════════════════

test('1) quem não passa na faixa NÃO é qualificado', () => {
  assert.equal(statusDoGate(FAIXAS, ['Menos de R$ 250 por dia']), 'desqualificado')
  assert.equal(statusDoGate(FAIXAS, ['Ainda não sei / preciso entender melhor']), 'desqualificado')
  assert.equal(statusDoGate(FAIXAS, ['De R$ 500 a R$ 999 por dia']), 'qualificado')
  assert.equal(statusDoGate(FAIXAS, ['R$ 1.000 por dia ou mais']), 'qualificado')
})

test('2) antes de responder, o lead não é nem qualificado nem descartado', () => {
  assert.equal(statusDoGate(FAIXAS, []), 'nao_respondido')
  assert.equal(statusDoGate(FAIXAS, ['nós vendemos sofá', 'Maria']), 'nao_respondido')
  // Sem gate configurado, não há filtro nenhum.
  assert.equal(statusDoGate([], ['qualquer coisa']), 'sem_gate')
  assert.equal(statusDoGate(FAIXAS, ['De R$ 500 a R$ 999 por dia'], false), 'sem_gate')
})

test('3) a resposta mais recente vence — o lead pode se corrigir', () => {
  assert.equal(
    statusDoGate(FAIXAS, ['Menos de R$ 250 por dia', 'na verdade R$ 1.000 por dia ou mais']),
    'qualificado')
  assert.equal(
    statusDoGate(FAIXAS, ['R$ 1.000 por dia ou mais', 'Menos de R$ 250 por dia']),
    'desqualificado')
})

test('4) digitado no meio da frase, com acento e caixa diferentes, conta', () => {
  assert.equal(statusDoGate(FAIXAS, ['acho que menos de r$ 250 POR DIA hoje']), 'desqualificado')
  assert.equal(statusDoGate(FAIXAS, ['hoje é de r$ 500 a r$ 999 por dia']), 'qualificado')
})

test('5) REPRODUÇÃO: o contato só é pedido depois de qualificar', () => {
  // Era o caso do print: 3 mensagens trocadas, formulário na tela, sem saber
  // se o lead serve.
  assert.equal(podePedirContato('qualified', 'nao_respondido', 10, 4), false,
    'pediria contato antes de o lead responder a faixa')
  assert.equal(podePedirContato('qualified', 'desqualificado', 10, 4), false,
    'lead que não serve não pode ser abordado por contato')
  assert.equal(podePedirContato('qualified', 'qualificado', 1, 4), true,
    'lead quente precisa ser abordado na hora, sem esperar contagem')

  // Sem filtro configurado, cai na contagem — senão nunca pediria contato.
  assert.equal(podePedirContato('qualified', 'sem_gate', 3, 4), false)
  assert.equal(podePedirContato('qualified', 'sem_gate', 4, 4), true)
})

test('6) os outros modos continuam como eram', () => {
  assert.equal(podePedirContato('none', 'qualificado', 99, 1), false, '"nunca pedir" é nunca')
  assert.equal(podePedirContato('gate', 'nao_respondido', 0, 4), true, '"no início" é no início')
  assert.equal(podePedirContato('inline', 'desqualificado', 4, 4), true, 'modo antigo intacto')
  assert.equal(podePedirContato('inline', 'qualificado', 2, 4), false)
  assert.equal(podePedirContato(undefined, 'sem_gate', 4, 4), true, 'sem modo = comportamento antigo')
})

test('7) formulário e botões NUNCA aparecem juntos', () => {
  const c = ler('src/components/agent-landing/chat-landing.tsx')
  assert.ok(c.includes('const temEscolhaPendente'), 'o formulário voltaria a abrir junto dos botões')
  assert.ok(c.includes('showCapture && !captured && choices.length === 0'),
    'com botões na tela, o formulário precisa sumir')
  assert.ok(c.includes('podePedirContato('), 'a tela não usa a regra de qualificação')
})

test('8) o servidor devolve a situação do gate, lida do que o lead disse', () => {
  const s = ler('src/lib/agents/chat.ts')
  assert.ok(s.includes('const gateStatus = statusDoGate('), 'o servidor não calcula a situação')
  assert.ok(s.includes('gateStatus,'), 'a situação não chega à tela')
  // A trava dos botões de faixa passa a usar a MESMA leitura.
  assert.ok(s.includes("gateStatus !== 'sem_gate' && gateStatus !== 'nao_respondido'"),
    'duas leituras diferentes do gate divergiriam com o tempo')

  const w = ler('src/components/agents/agent-wizard.tsx')
  assert.ok(w.includes('Só depois de qualificar'), 'a opção não aparece no wizard')
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
