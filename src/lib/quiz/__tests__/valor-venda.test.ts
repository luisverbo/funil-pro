// ============================================================================
// Valor da venda digitado à mão no portal
// ----------------------------------------------------------------------------
// Nem todo cliente tem ERP integrado. Sem Mercos, quem sabe quanto a venda
// valeu é o próprio cliente — ele digita no cartão do lead fechado, e o
// portal fecha as mesmas contas (faturado, ticket médio, custo por venda).
//
// O risco aqui é silencioso: aceitar "1.500" como R$ 15,00 (ou R$ 1,50)
// estraga o faturamento e ninguém percebe. Por isso a regra do separador
// brasileiro está trancada abaixo, caso a caso.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  formatarCents, lerValorDigitado, valorVendaValido, VALOR_VENDA_MAX_CENTS,
} from '@/lib/quiz/valor-venda'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const cents = (t: string) => {
  const r = lerValorDigitado(t)
  assert.ok(r.ok, `esperava aceitar "${t}"`)
  return r.ok ? r.cents : null
}

const tests: Record<string, () => void> = {
  'número seco é reais, não centavos': () => {
    assert.equal(cents('1500'), 150000)
    assert.equal(cents('50'), 5000)
  },
  'ponto de MILHAR não vira decimal (o erro que estragaria o faturamento)': () => {
    assert.equal(cents('1.500'), 150000)
    assert.equal(cents('12.500'), 1250000)
  },
  'ponto com 1 ou 2 casas é decimal': () => {
    assert.equal(cents('1500.50'), 150050)
    assert.equal(cents('1500.5'), 150050)
  },
  'formato brasileiro completo': () => {
    assert.equal(cents('1.500,00'), 150000)
    assert.equal(cents('1.500,50'), 150050)
    assert.equal(cents('R$ 1.234,56'), 123456)
    assert.equal(cents('R$ 1500'), 150000)
  },
  'espaços e cifrão não atrapalham': () => {
    assert.equal(cents('  R$  2.000,00 '), 200000)
  },

  'vazio limpa o valor (não é erro)': () => {
    assert.equal(cents(''), null)
    assert.equal(cents('   '), null)
    assert.equal(cents('0'), null)
  },

  'lixo é recusado com recado, não gravado calado': () => {
    for (const t of ['abc', '1500reais', '--', '1,5,0']) {
      const r = lerValorDigitado(t)
      assert.ok(!r.ok, `"${t}" não podia ser aceito`)
      assert.ok(!r.ok && r.erro.length > 0, 'o erro precisa ter recado')
    }
  },
  'valor absurdo é barrado (dedo escorregado no zero)': () => {
    const r = lerValorDigitado('99999999999')
    assert.ok(!r.ok)
    assert.ok(!r.ok && /alto demais/i.test(r.erro))
  },

  'centavos vindos pela rede: só inteiro positivo dentro do teto': () => {
    assert.ok(valorVendaValido(150000))
    assert.ok(!valorVendaValido(0))
    assert.ok(!valorVendaValido(-1))
    assert.ok(!valorVendaValido(1.5))
    assert.ok(!valorVendaValido('150000'))
    assert.ok(!valorVendaValido(VALOR_VENDA_MAX_CENTS + 1))
  },

  'formatação de volta é a brasileira': () => {
    assert.equal(formatarCents(150050), 'R$ 1.500,50')
  },

  // ── Integração ────────────────────────────────────────────────────────────
  'rota aceita a ação valor com as MESMAS travas do status': () => {
    const src = ler('src/app/api/portal/[token]/route.ts')
    assert.ok(/acao === 'status' \|\| acao === 'valor'/.test(src), 'quiz: valor precisa passar pelas checagens do status')
    assert.ok(/acao === 'status' \|\| acao === 'atribuir' \|\| acao === 'valor'/.test(src), 'agente: idem')
    assert.ok(src.includes('valorVendaValido(corpo.valorCents)'), 'valor da rede precisa ser validado')
    assert.ok(/acao !== 'atribuir' && !portal\.permitir_status/.test(src),
      'gravar valor exige a mesma permissão de marcar desfecho')
    assert.ok(/acao !== 'atribuir' && !ehGestor/.test(src),
      'vendedor só pode mexer no valor do lead dele')
  },
  'painel deixa digitar o valor no lead fechado': () => {
    const src = ler('src/app/ql/[token]/share-panel-client.tsx')
    assert.ok(src.includes('+ valor da venda'), 'falta o botão de digitar o valor')
    assert.ok(src.includes('salvarValor'), 'falta a gravação do valor')
    assert.ok(src.includes("acao: 'valor'"), 'a tela precisa chamar a ação valor')
    assert.ok(src.includes('draggable={compacto && editandoValor !== l.id}'),
      'arrastar o cartão enquanto digita rouba o foco do campo')
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
