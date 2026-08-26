// ============================================================================
// Mercos — venda no ERP fecha o lead no portal com o VALOR
// ----------------------------------------------------------------------------
// O cliente do dono fatura um pedido no Mercos → webhook → o lead vai para
// "Fechado" no kanban com o valor da venda (custo por venda e faturamento
// fecham sozinhos). A doc técnica do Mercos não é acessível daqui, então o
// parser é TOLERANTE: varre o JSON inteiro. Estes testes fixam o contrato.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  destinoDoEvento, extrairClienteId, extrairContato, extrairEvento,
  extrairValorCents, tokenConfere,
} from '@/lib/webhooks/mercos'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const headers = (mapa: Record<string, string>) => ({
  get: (nome: string) => mapa[nome.toLowerCase()] ?? null,
})

const tests: Record<string, () => void> = {
  'evento é achado em qualquer nível do payload': () => {
    assert.equal(extrairEvento({ evento: 'pedido.faturado', dados: {} }), 'pedido.faturado')
    assert.equal(extrairEvento({ webhook: { event: 'Cliente.Cadastrado' } }), 'cliente.cadastrado')
    assert.equal(extrairEvento({ dados: { id: 1 } }), null)
  },

  'destino: faturado/gerado fecham, cancelado perde, cliente.* cadastra': () => {
    assert.equal(destinoDoEvento('pedido.faturado'), 'fechar')
    assert.equal(destinoDoEvento('pedido.gerado'), 'fechar')
    assert.equal(destinoDoEvento('pagamento.atualizado'), 'fechar')
    assert.equal(destinoDoEvento('pedido.cancelado'), 'perder')
    assert.equal(destinoDoEvento('cliente.cadastrado'), 'cliente')
    assert.equal(destinoDoEvento('cliente.excluido'), 'ignorar')
    assert.equal(destinoDoEvento(null), 'ignorar')
  },

  'contato: e-mail por formato, telefone por chave, nome por chave': () => {
    const c = extrairContato({
      dados: {
        cliente: { razao_social: 'Max Distribuidora ME', email: 'compras@maxdist.com.br', telefone: '(87) 99911-2233' },
      },
    })
    assert.equal(c.email, 'compras@maxdist.com.br')
    assert.equal(c.telefone, '87999112233')
    assert.equal(c.nome, 'Max Distribuidora ME')
  },

  'valor: o TOTAL do pedido domina os subtotais dos itens': () => {
    const v = extrairValorCents({
      dados: {
        valor_total: 1893.4,
        itens: [{ valor: 900.0 }, { valor: 993.4 }],
      },
    })
    assert.equal(v, 189340)
  },
  'valor em texto brasileiro também conta': () => {
    assert.equal(extrairValorCents({ dados: { total: 'R$ 1.234,56' } }), 123456)
    assert.equal(extrairValorCents({ dados: { total: '1234.56' } }), 123456)
    assert.equal(extrairValorCents({ dados: { observacao: 'sem valor' } }), null)
  },

  'cliente_id é achado onde estiver': () => {
    assert.equal(extrairClienteId({ dados: { cliente_id: 348109 } }), '348109')
    assert.equal(extrairClienteId({ dados: {} }), null)
  },

  'chave de validação aceita em header, query ou corpo': () => {
    const chave = 'abc123'
    assert.ok(tokenConfere(chave, headers({ 'x-mercos-token': chave }), new URLSearchParams(), {}))
    assert.ok(tokenConfere(chave, headers({ authorization: `Bearer ${chave}` }), new URLSearchParams(), {}))
    assert.ok(tokenConfere(chave, headers({}), new URLSearchParams('chave=abc123'), {}))
    assert.ok(tokenConfere(chave, headers({}), new URLSearchParams(), { validacao: { chave: 'abc123' } }))
    assert.ok(!tokenConfere(chave, headers({}), new URLSearchParams(), { chave: 'errada' }))
  },

  'rota: pedido sem contato busca o cadastro guardado do cliente': () => {
    const src = ler('src/app/api/webhooks/mercos/[tenantId]/route.ts')
    assert.ok(src.includes("from('mercos_clientes')"), 'o pedido só traz cliente_id — o contato vem do cadastro')
    assert.ok(src.includes('cliente.cadastrado e cliente.atualizado'),
      'sem contato o log precisa ENSINAR a marcar os eventos de cliente')
    assert.ok(src.includes("from('mercos_events')"), 'todo evento precisa ficar auditável')
    assert.ok(/sale_value_cents: status === 'fechado' \? valorCents : null/.test(src),
      'perdido não pode carregar valor de venda')
  },
  'rota: fecha o lead no quiz E no agente, em todos os portais': () => {
    const src = ler('src/app/api/webhooks/mercos/[tenantId]/route.ts')
    assert.ok(src.includes("from('portal_lead_status')"))
    assert.ok(src.includes("from('portal_agent_status')"))
    assert.ok(src.includes("from('client_portal_quizzes')"))
    assert.ok(src.includes("from('client_portal_agents')"))
  },

  'portal: valor da venda viaja até o cartão e o faturamento': () => {
    const rota = ler('src/app/api/portal/[token]/route.ts')
    assert.ok(rota.includes('valorVendaCents'), 'a rota precisa entregar o valor ao painel')
    const painel = ler('src/app/ql/[token]/share-panel-client.tsx')
    assert.ok(painel.includes('Faturado no período'), 'o faturamento precisa aparecer no portal')
    assert.ok(painel.includes('ticket médio'), 'ticket médio é a conta que o dono pediu')
  },

  'migration do Mercos existe (valor + cadastro + auditoria)': () => {
    const sql = ler('supabase/migrations/20260903000000_mercos.sql').toLowerCase()
    assert.ok(sql.includes('sale_value_cents'))
    assert.ok(sql.includes('mercos_clientes'))
    assert.ok(sql.includes('mercos_events'))
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
