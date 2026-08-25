// ============================================================================
// Portal do cliente — AGENTE como fonte de leads
// ----------------------------------------------------------------------------
// O pedido: o mesmo portal do quiz, adaptado ao agente, "de um jeito que a
// gente consiga medir os leads lá no final" — com o lead QUENTE = quem chegou
// ao OBJETIVO daquele agente.
//
// O que se tranca aqui:
//   1. a régua do quente é determinística e segue o objetivo do agente
//   2. os públicos filtram o que o cliente vê (quentes/agendados/contato/todos)
//   3. conversa de teste NUNCA vira lead; corte de data respeitado
//   4. transcrição só sai quando o dono liberou; tabela e ids andam casados
//   5. salvar o portal por um lado (quiz OU agente) não apaga o outro lado
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  atingiuObjetivo, canalRotulo, montarLeadsAgente, publicoAgenteValido,
  resumoDaConversa, situacaoConversaRotulo,
  type ConversaRow, type PublicoAgente,
} from '@/lib/agents/portal-core'

const RAIZ = process.cwd()

// ─── Massa de teste: o dia a dia real do agente do Luís ─────────────────────

const conversa = (over: Partial<ConversaRow>): ConversaRow => ({
  id: 'c1', status: 'active', channel: 'web', started_at: '2026-08-20T12:00:00Z',
  qualification_score: null, outcome_summary: null, lead: null, ...over,
})

const montar = (
  conversas: ConversaRow[],
  publico: PublicoAgente,
  extra?: Partial<Parameters<typeof montarLeadsAgente>[0]>,
) => montarLeadsAgente({
  tituloAgente: 'Clayton', objetivo: 'qualify', conversas, reunioes: [],
  mensagensPorConversa: new Map(), publico, desde: null, mostrarConversa: false,
  ...extra,
})

const tests: Record<string, () => void> = {
  // ── A régua do lead quente ────────────────────────────────────────────────
  'reunião marcada é quente em QUALQUER objetivo': () => {
    for (const obj of ['qualify', 'sell_direct', 'route_to_funnel', null]) {
      assert.ok(atingiuObjetivo(obj, 'active', true), `objetivo ${obj}: reunião tem que contar`)
      assert.ok(atingiuObjetivo(obj, 'scheduled', false), `objetivo ${obj}: status scheduled tem que contar`)
    }
  },
  'objetivo vender: só venda esquenta': () => {
    assert.ok(atingiuObjetivo('sell_direct', 'sold', false))
    assert.ok(!atingiuObjetivo('sell_direct', 'qualified', false), 'qualificado sem venda não é o objetivo de quem quer vender')
    assert.ok(!atingiuObjetivo('sell_direct', 'active', false))
  },
  'objetivo qualificar: qualificado, vendido ou roteado': () => {
    for (const st of ['qualified', 'sold', 'routed_to_funnel']) {
      assert.ok(atingiuObjetivo('qualify', st, false), st)
    }
    for (const st of ['active', 'disqualified', 'abandoned', 'handed_to_human']) {
      assert.ok(!atingiuObjetivo('qualify', st, false), `${st} não pode ser quente`)
    }
  },
  'objetivo rotear: roteado ou vendido': () => {
    assert.ok(atingiuObjetivo('route_to_funnel', 'routed_to_funnel', false))
    assert.ok(atingiuObjetivo('route_to_funnel', 'sold', false))
    assert.ok(!atingiuObjetivo('route_to_funnel', 'qualified', false))
  },

  // ── Públicos ──────────────────────────────────────────────────────────────
  'público quentes: desqualificado e curioso ficam de fora': () => {
    const m = montar([
      conversa({ id: 'a', status: 'qualified', lead: { name: 'Lucas', email: null, phone: '21999990000' } }),
      conversa({ id: 'b', status: 'disqualified', lead: { name: 'Frio', email: null, phone: '21988880000' } }),
      conversa({ id: 'c', status: 'active' }),
    ], 'quentes')
    assert.deepEqual(m.leads.map(l => l.id), ['a'])
    // …mas TODOS contam na base de métricas — zero nunca é resposta.
    assert.equal(m.base.length, 3)
  },
  'público agendados: só reunião confirmada (cancelada não vale)': () => {
    const m = montarLeadsAgente({
      tituloAgente: 'Clayton', objetivo: 'qualify',
      conversas: [conversa({ id: 'a', status: 'active' }), conversa({ id: 'b', status: 'active' })],
      reunioes: [
        { conversation_id: 'a', scheduled_at: '2026-08-26T12:00:00Z', status: 'confirmed' },
        { conversation_id: 'b', scheduled_at: '2026-08-26T13:00:00Z', status: 'cancelled' },
      ],
      mensagensPorConversa: new Map(), publico: 'agendados', desde: null, mostrarConversa: false,
    })
    assert.deepEqual(m.leads.map(l => l.id), ['a'])
    assert.ok(m.leads[0].quente, 'quem agendou é quente')
  },
  'público com_contato pega telefone digitado no transcript': () => {
    const msgs = new Map([['a', [
      { role: 'agent', content: 'me passa seu WhatsApp?' },
      { role: 'lead', content: '21 98012-0036' },
    ]]])
    const m = montar([conversa({ id: 'a', status: 'active' })], 'com_contato', { mensagensPorConversa: msgs })
    assert.equal(m.leads.length, 1)
    assert.equal(m.leads[0].telefone, '21980120036')
  },
  'públicos válidos são a lista fechada': () => {
    for (const p of ['quentes', 'agendados', 'com_contato', 'todos']) assert.ok(publicoAgenteValido(p))
    assert.ok(!publicoAgenteValido('paginas'), 'público do quiz não vale para agente')
  },

  // ── Higiene dos dados ─────────────────────────────────────────────────────
  'conversa de test drive nunca vira lead': () => {
    const m = montar([conversa({ id: 'a', channel: 'test', status: 'qualified' })], 'todos')
    assert.equal(m.leads.length, 0)
    assert.equal(m.base.length, 0, 'teste não infla métricas')
  },
  'corte de data: o cliente só vê a partir do dia marcado': () => {
    const m = montar([
      conversa({ id: 'velha', started_at: '2026-08-01T10:00:00Z', status: 'qualified' }),
      conversa({ id: 'nova', started_at: '2026-08-20T10:00:00Z', status: 'qualified' }),
    ], 'todos', { desde: '2026-08-15' })
    assert.deepEqual(m.leads.map(l => l.id), ['nova'])
  },
  'nome sai do cadastro e, sem cadastro, do transcript': () => {
    const msgs = new Map([['b', [
      { role: 'agent', content: 'Com quem eu falo?' },
      { role: 'lead', content: 'Rodrigo' },
    ]]])
    const m = montar([
      conversa({ id: 'a', lead: { name: 'Lucas Lima', email: null, phone: null } }),
      conversa({ id: 'b' }),
    ], 'todos', { mensagensPorConversa: msgs })
    assert.equal(m.leads.find(l => l.id === 'a')?.nome, 'Lucas Lima')
    assert.equal(m.leads.find(l => l.id === 'b')?.nome, 'Rodrigo')
  },

  // ── Medição — o que o dono prometeu entregar ──────────────────────────────
  'funil mede conversas → contato → objetivo → reunião': () => {
    const m = montarLeadsAgente({
      tituloAgente: 'Clayton', objetivo: 'qualify',
      conversas: [
        conversa({ id: 'a', status: 'qualified', lead: { name: null, email: null, phone: '21999990000' } }),
        conversa({ id: 'b', status: 'active', lead: { name: null, email: 'x@y.com', phone: null } }),
        conversa({ id: 'c', status: 'abandoned' }),
        conversa({ id: 'd', status: 'active' }),
      ],
      reunioes: [{ conversation_id: 'a', scheduled_at: '2026-08-26T12:00:00Z', status: 'confirmed' }],
      mensagensPorConversa: new Map(), publico: 'todos', desde: null, mostrarConversa: false,
    })
    const por = Object.fromEntries(m.funil.map(f => [f.pageId, f.leads]))
    assert.equal(por['ag:conversas'], 4)
    assert.equal(por['ag:contato'], 2)
    assert.equal(por['ag:quentes'], 1)
    assert.equal(por['ag:reuniao'], 1)
    // concluiu === quente: a barra de conversão do portal mede o objetivo.
    assert.equal(m.base.filter(b => b.concluiu).length, 1)
  },

  // ── Transcrição e tabela ──────────────────────────────────────────────────
  'transcrição só aparece quando o dono liberou': () => {
    const msgs = new Map([['a', [
      { role: 'lead', content: 'quero saber do serviço' },
      { role: 'agent', content: 'te conto tudo' },
    ]]])
    const sem = montar([conversa({ id: 'a', status: 'qualified' })], 'todos', { mensagensPorConversa: msgs })
    assert.ok(!sem.tabela.colunas.some(c => c.chave === 'ag:conversa'), 'coluna de conversa sem liberação é vazamento')
    const com = montar([conversa({ id: 'a', status: 'qualified' })], 'todos', { mensagensPorConversa: msgs, mostrarConversa: true })
    const idx = com.tabela.colunas.findIndex(c => c.chave === 'ag:conversa')
    assert.ok(idx >= 0)
    assert.ok(com.tabela.linhas[0][idx].includes('quero saber do serviço'))
  },
  'tabela e ids andam casados e no recorte do público': () => {
    const m = montar([
      conversa({ id: 'a', status: 'qualified', lead: { name: 'Ana', email: null, phone: null } }),
      conversa({ id: 'b', status: 'active' }),
    ], 'quentes')
    assert.deepEqual(m.tabela.ids, ['a'])
    assert.equal(m.tabela.linhas.length, 1)
    assert.equal(m.tabela.linhas[0][0], 'Ana')
  },
  'resumo prioriza o desfecho gravado e cai para a 1ª fala do lead': () => {
    assert.equal(resumoDaConversa('Lead quer tráfego para clínica', []), 'Lead quer tráfego para clínica')
    assert.equal(
      resumoDaConversa(null, [{ role: 'agent', content: 'oi!' }, { role: 'lead', content: 'quero anunciar minha loja' }]),
      'quero anunciar minha loja',
    )
    assert.equal(resumoDaConversa(null, []), null)
  },
  'rótulos traduzem canal e situação para gente normal': () => {
    assert.equal(canalRotulo('whatsapp'), 'WhatsApp')
    assert.equal(canalRotulo('web'), 'Site')
    assert.equal(canalRotulo('instagram'), 'Instagram')
    assert.equal(situacaoConversaRotulo('disqualified'), 'Fora do perfil')
    assert.equal(situacaoConversaRotulo('scheduled'), 'Reunião marcada')
  },

  // ── Invariantes de código ─────────────────────────────────────────────────
  'migration das tabelas do portal de agente existe': () => {
    const dir = join(RAIZ, 'supabase/migrations')
    const sql = readdirSync(dir).filter(f => f.endsWith('.sql'))
      .map(f => readFileSync(join(dir, f), 'utf8')).join('\n').toLowerCase()
    assert.ok(sql.includes('client_portal_agents'), 'falta a tabela de vínculo portal↔agente')
    assert.ok(sql.includes('portal_agent_status'), 'falta a tabela de desfecho por conversa')
  },
  'salvar por um lado não apaga o outro (quiz ⇄ agente)': () => {
    const src = readFileSync(join(RAIZ, 'src/app/actions/quiz-leads.ts'), 'utf8')
    // A recriação de vínculos precisa ser CONDICIONAL à lista ter vindo —
    // sem isso, o modal do quiz apagaria os agentes do portal ao salvar.
    assert.ok(/quizzes !== null\W[\s\S]{0,200}client_portal_quizzes'\)\.delete\(/.test(src),
      'vínculos de quiz devem ser recriados só quando a lista veio')
    assert.ok(/entrada\.agentes !== undefined/.test(src),
      'vínculos de agente devem ser tocados só quando a lista veio')
  },
  'rota do portal atende a fonte agente e valida o público na escrita': () => {
    const src = readFileSync(join(RAIZ, 'src/app/api/portal/[token]/route.ts'), 'utf8')
    assert.ok(src.includes("acao === 'agente'"), 'falta a ação agente na rota pública')
    assert.ok(src.includes("corpo.origem === 'agente'"), 'status/atribuir do agente precisam da origem')
    assert.ok(src.includes('portal_agent_status'), 'desfecho do agente tem tabela própria')
    assert.ok(/origem === 'agente'[\s\S]{0,2400}conversasParaPortal[\s\S]{0,600}leads\.some/.test(src),
      'a escrita precisa checar se a conversa está no público liberado')
  },
  'painel do dono expõe as operações do portal de agente por HTTP': () => {
    const rota = readFileSync(join(RAIZ, 'src/app/api/painel-quiz/route.ts'), 'utf8')
    const cli = readFileSync(join(RAIZ, 'src/lib/quiz/painel-client.ts'), 'utf8')
    for (const op of ['getPortalDoAgente', 'listarAgentesDoTenant']) {
      assert.ok(rota.includes(op), `${op} fora da lista fechada da rota`)
      assert.ok(cli.includes(`op('${op}')`), `${op} sem cliente HTTP`)
    }
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
