// ============================================================================
// Estúdio IA — Painel de resultado: lucro, custos, ROAS, por anúncio e país.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { calcularKpis, porAnuncio, porPais, periodoAnterior, emReais, variacao, type DadosPeriodo } from '@/lib/estudio/painel'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const COT = { BRL: 1, USD: 5 }
const DADOS: DadosPeriodo = {
  contatos: [
    { pais: 'BR', ad_id: 'A1' }, { pais: 'BR', ad_id: 'A1' }, { pais: 'BR', ad_id: null },
    { pais: 'US', ad_id: 'A2' }, { pais: 'PT', ad_id: 'A2' },
  ],
  vendas: [
    { pais: 'BR', ad_id: 'A1', contato_id: 'c1', valor_pago_cents: 3990, moeda: 'BRL', status: 'pago' },
    { pais: 'BR', ad_id: null, contato_id: 'c3', valor_pago_cents: 2990, moeda: 'BRL', status: 'entregue' },
    { pais: 'US', ad_id: 'A2', contato_id: 'c4', valor_pago_cents: 1190, moeda: 'USD', status: 'pago' },
    { pais: 'US', ad_id: 'A2', contato_id: 'c4', valor_pago_cents: 690, moeda: 'USD', status: 'reembolsado' },
  ],
  usos: [{ finalidade: 'resposta', custo_usd: 0.2 }, { finalidade: 'geracao', custo_usd: 1 }, { finalidade: 'nota_rosto', custo_usd: 0.04 }],
  gastos: [{ ad_id: 'A1', spend_cents: 2000, currency: 'BRL' }, { ad_id: 'A2', spend_cents: 1000, currency: 'BRL' }, { ad_id: 'A2', spend_cents: 500, currency: 'BRL' }],
}

const tests: Record<string, () => void | Promise<void>> = {
  'USD vira R$ pela cotação; BRL fica igual': () => {
    assert.equal(emReais(1190, 'USD', COT), 5950)
    assert.equal(emReais(1000, null, COT), 1000)
  },
  'KPIs: faturamento em R$, reembolso fora, lucro = fat − anúncio − IA': () => {
    const k = calcularKpis(DADOS, COT)
    assert.equal(k.vendas, 3)
    assert.equal(k.clientes, 3)
    assert.equal(k.faturamento_cents, 3990 + 2990 + 5950)
    assert.equal(k.gasto_anuncio_cents, 3500)
    assert.equal(k.custo_fotos_cents, 520) // (1 + 0,04) × 5 × 100
    assert.equal(k.custo_atendimento_cents, 100)
    assert.equal(k.lucro_cents, 12930 - 3500 - 620)
    assert.equal(k.custo_por_venda_cents, Math.round((3500 + 620) / 3))
    assert.equal(k.leads, 5); assert.equal(k.leads_anuncio, 4); assert.equal(k.vendas_anuncio, 2)
    assert.equal(k.cac_anuncio_cents, 1750)
    assert.equal(k.custo_por_lead_cents, 875)
    assert.ok(Math.abs(k.roas! - 12930 / 3500) < 1e-9)
  },
  'sem gasto: ROAS e custo por lead ficam vazios (nunca 0 enganoso)': () => {
    const k = calcularKpis({ ...DADOS, gastos: [] }, COT)
    assert.equal(k.roas, null); assert.equal(k.gasto_anuncio_cents, 0)
    const z = calcularKpis({ contatos: [], vendas: [], usos: [], gastos: [] }, COT)
    assert.equal(z.ticket_cents, null); assert.equal(z.conversao, null); assert.equal(z.custo_por_venda_cents, null)
  },
  'por anúncio: gasto somado, lucro e ROAS; Orgânico por último e sem gasto': () => {
    const l = porAnuncio(DADOS, COT)
    assert.equal(l[l.length - 1].ad_id, null)
    const a2 = l.find(x => x.ad_id === 'A2')!
    assert.equal(a2.gasto_cents, 1500); assert.equal(a2.vendas, 1); assert.equal(a2.lucro_cents, 5950 - 1500)
    assert.equal(l[0].ad_id, 'A2', 'maior faturamento primeiro')
    assert.equal(l.find(x => x.ad_id === null)!.gasto_cents, 0)
  },
  'por país: leads e vendas por DDI, ordenado por faturamento': () => {
    const p = porPais(DADOS, COT)
    assert.deepEqual(p.map(x => x.pais), ['BR', 'US', 'PT'])
    assert.equal(p[0].vendas, 2); assert.equal(p[0].leads, 3)
    assert.equal(p[2].vendas, 0); assert.equal(p[2].conversao, 0)
  },
  'período anterior de mesmo tamanho': () => {
    assert.deepEqual(periodoAnterior('2026-10-01', '2026-10-30'), { de: '2026-09-01', ate: '2026-09-30' })
    assert.deepEqual(periodoAnterior('2026-10-23', '2026-10-23'), { de: '2026-10-22', ate: '2026-10-22' })
  },
  'variação: sem base não inventa porcentagem': () => {
    assert.equal(variacao(10, 0), null); assert.equal(variacao(12, 10), 0.2)
  },
  'Painel usa o resultado novo e o gasto vem da sincronização do Tráfego': () => {
    assert.match(ler('src/app/(dashboard)/estudio-ia/pix-ui.tsx'), /<PainelResultado \/>/)
    const acao = ler('src/app/actions/estudio-pedidos.ts')
    assert.match(acao, /from\('ad_insights'\)[^\n]*eq\('level', 'ad'\)/)
    assert.match(ler('src/app/api/estudio/route.ts'), /painelEstudio/)
  },
}

;(async () => {
  let passed = 0
  const nomes = Object.keys(tests)
  for (const nome of nomes) {
    try { await tests[nome](); passed++; console.log(`  ok   ${nome}`) }
    catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
  }
  console.log(`\n${passed}/${nomes.length} testes passaram`)
  if (passed !== nomes.length) process.exit(1)
})()
