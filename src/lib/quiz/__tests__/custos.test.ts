// ============================================================================
// Custos por período — a conta que o dono e o cliente veem (a MESMA)
// ----------------------------------------------------------------------------
// O defeito corrigido: o investido era o total de TODOS os tempos, dividido
// por leads já filtrados por período. Lançar R$ 100 na terça e olhar "hoje"
// mostrava os R$ 100 divididos pelos leads de hoje — número inventado.
//
// Agora gasto e leads são recortados pelo MESMO filtro. E a conta vive num
// módulo só: painel do dono e portal do cliente nunca podem discordar.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { calcularCustos, diaLocal, diaNoPeriodo, rotuloPeriodo } from '../custos'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void }[] = []
function test(name: string, fn: () => void) { suite.push({ name, fn }) }

/** 12h local evita que fuso jogue a data para o dia anterior/seguinte. */
const emDia = (dia: string) => `${dia}T12:00:00`
const AGORA = new Date('2026-08-23T15:00:00')

const lead = (dia: string | null, temContato = true, fechado = false) =>
  ({ data: dia ? emDia(dia) : null, temContato, fechado })

// ════════════════════════════════════════════════════════════════════════════

test('1) REPRODUÇÃO: o gasto é recortado pelo MESMO período dos leads', () => {
  const lancamentos = [
    { date: '2026-08-18', amountCents: 10_000 },   // terça
    { date: '2026-08-23', amountCents: 5_000 },    // hoje
  ]
  const leads = [lead('2026-08-18'), lead('2026-08-18'), lead('2026-08-23')]

  const dia18 = calcularCustos(lancamentos, leads, { modo: 'tudo', dia: '2026-08-18' }, AGORA)
  assert.equal(dia18.investidoCents, 10_000, 'o gasto de outro dia entrou na conta')
  assert.equal(dia18.leads, 2)
  assert.equal(dia18.cplCents, 5_000, 'R$ 100 ÷ 2 leads = R$ 50')

  const hoje = calcularCustos(lancamentos, leads, { modo: 'hoje' }, AGORA)
  assert.equal(hoje.investidoCents, 5_000)
  assert.equal(hoje.leads, 1)
  assert.equal(hoje.cplCents, 5_000)

  const tudo = calcularCustos(lancamentos, leads, { modo: 'tudo' }, AGORA)
  assert.equal(tudo.investidoCents, 15_000)
  assert.equal(tudo.leads, 3)
  assert.equal(tudo.cplCents, 5_000)
})

test('2) CPL quente e custo por venda usam o mesmo recorte', () => {
  const c = calcularCustos(
    [{ date: '2026-08-20', amountCents: 30_000 }],
    [
      lead('2026-08-20', true, true),    // com contato e fechado
      lead('2026-08-20', true, false),
      lead('2026-08-20', false, false),  // sem contato
      lead('2026-08-01', true, true),    // fora do dia: não conta
    ],
    { modo: 'tudo', dia: '2026-08-20' }, AGORA,
  )
  assert.equal(c.leads, 3)
  assert.equal(c.comContato, 2)
  assert.equal(c.fechados, 1)
  assert.equal(c.cplCents, 10_000)
  assert.equal(c.cplQuenteCents, 15_000)
  assert.equal(c.custoPorVendaCents, 30_000, 'custo por venda = investido ÷ fechados')
})

test('3) sem gasto ou sem lead: "—", nunca Infinity nem zero falso', () => {
  const semGasto = calcularCustos([], [lead('2026-08-23')], { modo: 'tudo' }, AGORA)
  assert.equal(semGasto.cplCents, null)
  assert.equal(semGasto.custoPorVendaCents, null)

  const semLead = calcularCustos([{ date: '2026-08-23', amountCents: 5_000 }], [], { modo: 'hoje' }, AGORA)
  assert.equal(semLead.investidoCents, 5_000)
  assert.equal(semLead.cplCents, null, 'dividir por zero lead viraria Infinity')

  const semVenda = calcularCustos(
    [{ date: '2026-08-23', amountCents: 5_000 }], [lead('2026-08-23')], { modo: 'hoje' }, AGORA)
  assert.equal(semVenda.custoPorVendaCents, null)
  for (const v of [semGasto, semLead, semVenda]) {
    assert.ok(Number.isFinite(v.investidoCents))
  }
})

test('4) janela de 7/30 dias inclui hoje e o começo do período', () => {
  assert.equal(diaNoPeriodo('2026-08-23', { modo: '7d' }, AGORA), true, 'hoje precisa entrar')
  assert.equal(diaNoPeriodo('2026-08-17', { modo: '7d' }, AGORA), true, '7º dia contando hoje')
  assert.equal(diaNoPeriodo('2026-08-16', { modo: '7d' }, AGORA), false)
  assert.equal(diaNoPeriodo('2026-07-25', { modo: '30d' }, AGORA), true)
  assert.equal(diaNoPeriodo('2026-07-24', { modo: '30d' }, AGORA), false)
  // Dia específico vence o modo.
  assert.equal(diaNoPeriodo('2026-01-01', { modo: 'hoje', dia: '2026-01-01' }, AGORA), true)
})

test('5) lead sem data não é chutado para dentro de um dia', () => {
  const lancamentos = [{ date: '2026-08-23', amountCents: 6_000 }]
  const semData = calcularCustos(lancamentos, [lead(null), lead('2026-08-23')], { modo: 'hoje' }, AGORA)
  assert.equal(semData.leads, 1, 'lead sem data entraria no dia errado')
  // Em "tudo" ele entra — ali não há recorte para violar.
  const tudo = calcularCustos(lancamentos, [lead(null), lead('2026-08-23')], { modo: 'tudo' }, AGORA)
  assert.equal(tudo.leads, 2)
})

test('6) o rótulo diz de qual período é o número', () => {
  assert.equal(rotuloPeriodo({ modo: 'tudo' }), 'no total')
  assert.equal(rotuloPeriodo({ modo: 'hoje' }), 'hoje')
  assert.equal(rotuloPeriodo({ modo: '7d' }), 'nos últimos 7 dias')
  assert.equal(rotuloPeriodo({ modo: 'tudo', dia: '2026-08-18' }), 'em 18/08/2026')
  assert.equal(diaLocal('2026-08-18T12:00:00'), '2026-08-18')
})

test('7) a MESMA conta serve o dono e o cliente', () => {
  const dono = ler('src/components/quiz/quiz-leads-view.tsx')
  const cliente = ler('src/app/ql/[token]/share-panel-client.tsx')
  assert.ok(dono.includes("from '@/lib/quiz/custos'"), 'o painel do dono tem conta própria')
  assert.ok(cliente.includes("from '@/lib/quiz/custos'"), 'o portal tem conta própria')
  assert.ok(dono.includes('getCustosDoQuiz'), 'o dono não busca os insumos de custo')
  // O portal recebe os lançamentos POR DIA, não um total fixo.
  const rota = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(rota.includes('investimentos: portal.mostrar_metricas ? investimentos : []'),
    'o portal voltaria a receber só o total de todos os tempos')
  assert.ok(!rota.includes('custoPorLead('), 'a conta antiga (total fixo) continua na rota')
})

test('8) o topo do portal responde ao filtro (era fixo do servidor)', () => {
  const c = ler('src/app/ql/[token]/share-panel-client.tsx')
  // Os números do topo vinham prontos do servidor, sobre TODO o histórico:
  // trocar o filtro não mexia em nada.
  assert.ok(c.includes('const resumo = useMemo'), 'o topo não é recalculado na tela')
  assert.ok(c.includes('baseMetricas'), 'a tela não recebe a base para recalcular')
  assert.ok(!/\{m\.total\}/.test(c), 'ainda usa o número fixo do servidor')
  assert.ok(!/\{m\.completionRate\}%/.test(c), 'a conversão continua fixa')
  // Um filtro só governa lista, métricas, custos e arquivo.
  assert.ok(c.includes('const filtro: FiltroPeriodo'), 'filtros separados divergem entre si')
  // O funil por página continua do histórico — e a tela DIZ isso.
  assert.ok(c.includes('todo o período'), 'o funil pareceria filtrado sem ser')

  const rota = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(rota.includes('baseMetricas'), 'o servidor não manda a base')
  // Metadados apenas: nada de nome/telefone nessa lista.
  const trecho = rota.slice(rota.indexOf('const baseMetricas'), rota.indexOf('const baseMetricas') + 400)
  assert.ok(!/nome|telefone|email/.test(trecho), 'a base de métricas vazaria contato')
})

test('9) renomear página: existe, e NÃO troca o endereço público', () => {
  const p = ler('src/app/(dashboard)/pages/pages-client.tsx')
  assert.ok(p.includes('confirmarRenome'), 'não há como renomear a página')
  assert.ok(p.includes('savePageSettings(id, { title: nome })'),
    'renomear precisa mexer SÓ no título')
  const corpo = p.slice(p.indexOf('async function confirmarRenome'), p.indexOf('function handleDuplicate'))
  assert.ok(!corpo.includes('slug'), 'trocar o endereço mataria link já divulgado')
  assert.ok(corpo.includes("nome === atual"), 'salvaria sem mudança nenhuma')
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
