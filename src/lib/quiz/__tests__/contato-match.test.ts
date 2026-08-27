// ============================================================================
// Casar venda externa com o lead — a regra do TELEFONE
// ----------------------------------------------------------------------------
// O funil do dono pede só NOME e TELEFONE (sem e-mail). Então é o telefone
// que liga a venda faturada no Mercos ao lead do painel — e a regra precisa
// acertar nos dois sentidos:
//
//   • não pode PERDER a mesma pessoa por causa de formatação, DDI ou do
//     nono dígito. A base real tem "21 99629-9978" gravado com espaço e
//     traço — com a comparação antiga (LIKE no texto cru) esse lead nunca
//     casaria e a venda sumiria calada.
//   • não pode CASAR gente diferente: (11) 99999-1234 e (21) 99999-1234
//     terminam nos mesmos 8 dígitos. Marcar a venda no lead ERRADO é pior
//     do que não marcar.
//
// O banco filtra pelos 8 finais; estas funções dão a palavra final.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  ehOMesmoContato, foneChave, foneDigitos, mesmoEmail, mesmoTelefone,
} from '@/lib/webhooks/contato-match'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const tests: Record<string, () => void> = {
  // ── Normalização ──────────────────────────────────────────────────────────
  'dígitos: formatação e DDI saem fora': () => {
    assert.equal(foneDigitos('+55 (21) 99629-9978'), '21996299978')
    assert.equal(foneDigitos('21 99629-9978'), '21996299978')
    assert.equal(foneDigitos('5521996299978'), '21996299978')
    assert.equal(foneDigitos(null), '')
  },
  'chave: DDD + 8 finais quando dá para saber o DDD': () => {
    assert.equal(foneChave('+55 (21) 99629-9978'), '2196299978')
    assert.equal(foneChave('21996299978'), '2196299978')
    assert.equal(foneChave('96299978'), '96299978')     // sem DDD
    assert.equal(foneChave('123'), '')                  // inutilizável
  },

  // ── Não perder a mesma pessoa ─────────────────────────────────────────────
  'telefone formatado casa com o mesmo número limpo (caso real da base)': () => {
    assert.ok(mesmoTelefone('21 99629-9978', '+55 (21) 99629-9978'))
    assert.ok(mesmoTelefone('21 99629-9978', '21996299978'))
    assert.ok(mesmoTelefone('5521996299978', '(21) 99629-9978'))
  },
  'nono dígito não separa a mesma pessoa': () => {
    // cadastro antigo sem o 9 na frente vs. cadastro novo com o 9
    assert.ok(mesmoTelefone('2196299978', '21996299978'))
  },
  'número sem DDD casa pelo núcleo': () => {
    assert.ok(mesmoTelefone('996299978', '21996299978'))
  },

  // ── Não casar gente diferente ─────────────────────────────────────────────
  'DDDs diferentes NÃO podem casar (venda no lead errado)': () => {
    assert.ok(!mesmoTelefone('11999991234', '21999991234'))
    assert.ok(!mesmoTelefone('(11) 99999-1234', '+55 21 99999-1234'))
  },
  'números realmente diferentes não casam': () => {
    assert.ok(!mesmoTelefone('21996299978', '21987654321'))
  },
  'telefone vazio ou curto nunca casa': () => {
    assert.ok(!mesmoTelefone('', '21996299978'))
    assert.ok(!mesmoTelefone('21996299978', null))
    assert.ok(!mesmoTelefone('1234', '1234'))
  },

  // ── E-mail e a decisão final ──────────────────────────────────────────────
  'e-mail casa ignorando caixa e espaços; vazio nunca casa': () => {
    assert.ok(mesmoEmail(' Compras@MaxDist.com.br ', 'compras@maxdist.com.br'))
    assert.ok(!mesmoEmail('', ''))
    assert.ok(!mesmoEmail(null, 'a@b.com'))
  },
  'a venda é do lead quando bate e-mail OU telefone': () => {
    // Funil que só pede nome e telefone: e-mail ausente dos dois lados.
    assert.ok(ehOMesmoContato({ email: null, phone: '21 99629-9978' }, { email: null, telefone: '5521996299978' }))
    // E-mail bate, telefone nem existe.
    assert.ok(ehOMesmoContato({ email: 'a@b.com', phone: null }, { email: 'A@B.com', telefone: null }))
    // Nada bate.
    assert.ok(!ehOMesmoContato({ email: 'a@b.com', phone: '11999991234' }, { email: 'c@d.com', telefone: '21999991234' }))
  },

  // ── Invariantes de integração ─────────────────────────────────────────────
  'o fechamento decide pelo código, não pelo LIKE cru': () => {
    const src = ler('src/lib/sales/fechar-lead.ts')
    assert.ok(src.includes('ehOMesmoContato'), 'a decisão final precisa passar pela regra testada')
    assert.ok(src.includes('casar_quiz_leads_por_contato'), 'o filtro grosso é do banco')
    assert.ok(src.includes('casar_leads_por_contato'))
    assert.ok(!/phone\.like\.%/.test(src), 'LIKE no texto cru perde telefone formatado')
  },
  'a migração normaliza os dígitos dos dois lados': () => {
    const sql = ler('supabase/migrations/20260904000000_casar_lead_por_contato.sql')
    assert.ok(sql.includes('fone_digitos'), 'sem normalizar, telefone formatado não casa')
    assert.ok(/right\(fone_digitos\(p_fone\), 8\)/.test(sql), 'o filtro é pelos 8 finais')
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
