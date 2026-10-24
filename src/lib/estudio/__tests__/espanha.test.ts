// ============================================================================
// Estúdio IA — Espanha: +34 → ES/es-ES, "tú" (nunca voseo), euro com IVA
// incluido, link da Hotmart do produto 8801266, webhook aceita o produto e o
// valor pago com IVA, sem prévia oferecida pela Ana (só se a cliente pedir).
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { paisDoWaId } from '@/lib/estudio/chat'
import { TEXTOS, texto, idiomaDaAna, dinheiro } from '@/lib/estudio/ana/textos'
import { tabelaDePrecos } from '@/lib/estudio/ana/executor'
import { proximoPasso, mensagensDaRetomada, pedePrevia, type Contexto, type Acao, type Entrada } from '@/lib/estudio/ana/maquina'
import { conferirCompra, lerCompraHotmart, linkComPedido, ofertaDoLink, produtosAceitos, valorPagoNaMoeda, PRODUTO_HOTMART_ES } from '@/lib/estudio/hotmart'
import { linkDoCatalogo, textosDoCatalogo, tituloDoTema } from '@/lib/estudio/catalogo-idiomas'
import { promptDaAna } from '@/lib/estudio/ana/ia'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const LINK = (off: string) => `https://pay.hotmart.com/M108178486V?off=${off}`
const PRECOS_ES = [[2, 822, 'h4m9qqsz'], [3, 1030, '0i4gjuy7'], [5, 1550, 'knnonr26'], [10, 2278, 'j4zpkkr9'], [15, 3110, 'vaszuwyv']]
  .map(([q, v, o]) => ({ pacote_qtd: q as number, valor_cents: v as number, moeda: 'EUR', link_pagamento: LINK(o as string) }))
const POSES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'))
const ctx: Contexto = { idioma: 'es-ES', precos: PRECOS_ES, posesDoTema: () => POSES, temasAtivos: ['aniversario', 'corporativo', 'casual', 'sensual'], pix: true }
const txt = (t: string): Entrada => ({ tipo: 'texto', texto: t })
const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)
const VOSEO = /(?<![A-Za-zÀ-ÿ])(podés|pagás|tenés|elegí|escribime|enviame|mandame|acá|querés|decime|contame|avisame|vos|recibís|fijate|sabés|tranqui)(?![A-Za-zÀ-ÿ])/i

const payload = (o: { produto?: number; oferta?: string; valor?: number; moeda?: string; oferta_valor?: number } = {}) => ({
  event: 'PURCHASE_APPROVED', version: '2.0.0',
  data: {
    product: { id: o.produto ?? 8801266, name: 'Sesión de Fotos con IA - España' },
    buyer: { email: 'lucia@ejemplo.es', checkout_phone: '34600111222', name: 'Lucía' },
    purchase: {
      transaction: 'HP-ES-1', status: 'APPROVED', approved_date: Date.parse('2026-10-24T12:00:00Z'),
      price: { value: o.valor ?? 8.22, currency_value: o.moeda ?? 'EUR' },
      original_offer_price: { value: o.oferta_valor ?? 7.9, currency_value: 'EUR' },
      offer: { code: o.oferta ?? 'h4m9qqsz' }, origin: { sck: '11111111-2222-3333-4444-555555555555' },
    },
  },
})

const tests: Record<string, () => void | Promise<void>> = {
  '+34 → Espanha (ES, es-ES); Argentina continua es': () => {
    assert.deepEqual(paisDoWaId('34600111222'), { pais: 'ES', idioma: 'es-ES' })
    assert.equal(idiomaDaAna('es-ES'), 'es-ES'); assert.equal(idiomaDaAna('es-AR'), 'es')
  },
  'TODO texto da Ana em es-ES usa "tú" (nenhum voseo) e fala de "retoque", não "ajuste"': () => {
    const vars = { nome: 'Lucía', qtd: 5, valor: '15,50 €', tema: 'Cumpleaños', link: 'https://x', pagar: 'https://pay', prazo: 60, tabela: 'T', poses: '03', faltam: 2, recebedor: 'X', motivo: 'm', pedido: 11, opcoes: 'o', n: 1, primeiras: '01', prox_qtd: 10, desconto: 20, valor_cheio: 'v' }
    for (const k of Object.keys(TEXTOS)) {
      const t = texto(k, 'es-ES', vars)
      assert.doesNotMatch(t, VOSEO, `${k}: "${t.slice(0, 80)}"`)
      if (/ajust|retoc/i.test(t)) assert.doesNotMatch(t, /\bajuste\b/i, `${k} deve dizer "retoque"`)
    }
    // Argentina segue com o texto dela
    assert.match(texto('hotmart_link', 'es', { pagar: 'x' }), /Podés pagar acá/)
    assert.match(texto('hotmart_link', 'es-ES', { pagar: 'x' }), /Puedes pagar aquí .*IVA incluido/)
  },
  'prazo: "en menos de 1 hora" (nunca 30 min) e tabela em euro com IVA incluido': () => {
    assert.match(texto('tabela_precos', 'es-ES', { tabela: 'T' }), /en menos de 1 hora[\s\S]*1 retoque gratis/)
    assert.match(texto('pago_ok', 'es-ES'), /en menos de 1 hora/i)
    assert.equal(dinheiro(822, 'EUR', 'es-ES').replace(/ /g, ' '), '8,22 €')
    const tab = tabelaDePrecos(PRECOS_ES, 'es-ES').replace(/ /g, ' ')
    assert.equal(tab.split('\n')[0], '1️⃣ 2 fotos — 8,22 € (IVA incluido)')
    assert.equal(tab.split('\n')[4], '5️⃣ 15 fotos — 31,10 € (IVA incluido)')
    assert.match(tab, /22,78 € \(IVA incluido\)/)
  },
  'escolheu o pacote → link da Hotmart da Espanha (sem Pix), explicando para que é': () => {
    const r = proximoPasso('pacote', { tema: 'aniversario' }, txt('3'), ctx)
    assert.equal(r.dados.moeda, 'EUR'); assert.equal(r.dados.valor_cents, 1550); assert.equal(r.dados.pagar_link, LINK('knnonr26'))
    assert.ok(!r.acoes.some(a => a.t === 'pix'))
    assert.equal((r.acoes.find(a => a.t === 'hotmart') as { chave?: string }).chave, 'hotmart_link_coleta')
    assert.equal(linkComPedido(LINK('knnonr26'), 'p-1'), 'https://pay.hotmart.com/M108178486V?off=knnonr26&sck=p-1')
    assert.equal(ofertaDoLink(LINK('vaszuwyv')), 'vaszuwyv')
  },
  'webhook: aceita o produto da Espanha, confere pelo valor PAGO com IVA e grava em euro': () => {
    const esp = { produto_id: produtosAceitos('8794754'), oferta: 'h4m9qqsz', valor_cents: 822, moeda: 'EUR' }
    const c = lerCompraHotmart(payload())
    assert.deepEqual(conferirCompra(c, esp), [], 'oferta 7,90 sem IVA, pago 8,22 com IVA = bate')
    assert.equal(valorPagoNaMoeda(c, 'EUR'), 822)
    assert.ok(produtosAceitos(null).includes(PRODUTO_HOTMART_ES) && produtosAceitos(null).includes('8794754'))
    assert.match(conferirCompra(lerCompraHotmart(payload({ produto: 123 })), esp).join(), /produto 123/)
    assert.match(conferirCompra(lerCompraHotmart(payload({ valor: 5, oferta_valor: 5 })), esp).join(), /valor 5\.00 EUR menor/)
    assert.match(conferirCompra(lerCompraHotmart(payload({ oferta: 'j4zpkkr9' })), esp).join(), /oferta j4zpkkr9 não é a do pacote/)
  },
  'Espanha: a Ana NÃO oferece prévia nas retomadas — só se a cliente pedir': () => {
    assert.deepEqual(mensagensDaRetomada('cobranca_2', 'pacote', { tema: 'casual' }, { semPrevia: true }), { chaves: ['rmk_duvida'], oferecePrevia: false })
    assert.deepEqual(mensagensDaRetomada('cobranca_3', 'pacote', { tema: 'casual' }, { semPrevia: true }).chaves, ['cobranca_3'])
    assert.equal(mensagensDaRetomada('cobranca_2', 'pacote', { tema: 'casual' }).oferecePrevia, true, 'Brasil/Argentina seguem com a prévia')
    assert.ok(pedePrevia('¿Puedo ver una muestra antes?') && pedePrevia('tem prévia grátis?') && !pedePrevia('quiero 3 fotos'))
    const r = proximoPasso('pacote', { tema: 'casual' }, txt('¿Me haces una vista previa gratis?'), { ...ctx, fotos: { tem_rosto: true, tem_corpo: true, rosto_recortado: false, unica: false } })
    assert.equal(r.etapa, 'previa_fotos')
    assert.match(ler('src/lib/estudio/ana/executor.ts'), /semPrevia: c\.pais === 'ES'/)
  },
  'catálogo e PDF: Espanha usa o espanhol (?l=es); IA com instrução de España': () => {
    assert.equal(linkDoCatalogo('https://a', 'aniversario', 'es-ES'), 'https://a/estudio/catalogo/aniversario?l=es')
    assert.equal(textosDoCatalogo('es-ES').titulo, textosDoCatalogo('es').titulo)
    assert.equal(tituloDoTema('aniversario', 'Ensaio de Aniversário', 'es-ES'), 'Sesión de cumpleaños')
    const p = promptDaAna({ idioma: 'es-ES', objetivo: 'x', tabelaPrecos: 'y', prazoMin: 60, temas: 'z', historico: [] })
    assert.match(p, /espanhol DE ESPANHA \(sempre "tú"/); assert.match(p, /NUNCA voseo/); assert.match(p, /en menos de 1 hora/)
  },
  'idioma: "en español" ou 1ª mensagem em espanhol não trocam es-ES por es; áudio do es serve': () => {
    const r = proximoPasso('pacote', { tema: 'casual' }, txt('en español por favor'), ctx)
    assert.ok(!r.acoes.some(a => a.t === 'idioma'))
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.match(ex, /!\(detectado === 'es' && idioma === 'es-ES'\)/)
    assert.match(ex, /idioma === 'es-ES' \? sob\.audios\.get\(`\$\{a\.chave\}\|es`\)/)
  },
  'SQL: 5 preços ES em EUR (valor final com IVA) com o link de cada oferta; produto 8801266 aceito': () => {
    const sql = ler('supabase/migrations/20261110000000_estudio_ia_espanha.sql')
    for (const [q, v, o] of [[2, 822, 'h4m9qqsz'], [3, 1030, '0i4gjuy7'], [5, 1550, 'knnonr26'], [10, 2278, 'j4zpkkr9'], [15, 3110, 'vaszuwyv']]) {
      assert.match(sql, new RegExp(`\\(${q},\\s+${v},\\s+'https://pay\\.hotmart\\.com/M108178486V\\?off=${o}'\\)`), `pacote ${q}`)
    }
    assert.match(sql, /'ES', 'EUR'/); assert.match(sql, /'8794754,8801266'/)
    assert.match(ler('src/app/actions/estudio-pix.ts'), /split\(\/\[\^\\d\]\+\/\)/, 'salvar o cartão Hotmart não junta os produtos')
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
