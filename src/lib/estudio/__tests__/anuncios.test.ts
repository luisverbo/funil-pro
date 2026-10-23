// ============================================================================
// Estúdio IA — rastreio de vendas por anúncio (Click-to-WhatsApp) + eventos
// para a Meta (CAPI para mensagens). Referral de anúncio / sem referral / 2
// referrals; Purchase enviado 1× só; orgânico não envia; erro de permissão
// aparece no painel. Banco e rede falsos.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { anuncioDoReferral, atualizacaoDeOrigem, corpoDoEvento, deveEnviar, eventIdDe, explicarErroMeta, idDoDataset, agruparPorAnuncio } from '@/lib/estudio/anuncios'
import { enviarEventoPedido, buscarAnuncio, GRAPH_CAPI } from '@/lib/estudio/anuncios-servidor'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const WABA = '2250778325757289'
const REF_A = { source_type: 'ad', source_id: '120210000000001', source_url: 'https://fb.me/x', headline: 'Ensaio com IA em 60 min', body: 'Fotos de estúdio sem sair de casa', media_type: 'image', image_url: 'https://scontent/x.jpg', ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a' }
const REF_B = { ...REF_A, source_id: '120210000000002', headline: 'Ensaio de aniversário', ctwa_clid: 'ARBbOutroClique' }

// ── banco falso mínimo ──────────────────────────────────────────────────────
type Linha = Record<string, unknown>
function bancoFalso(tabelas: Record<string, Linha[]>) {
  return {
    tabelas,
    from(nome: string) {
      tabelas[nome] ??= []
      const filtros: ((r: Linha) => boolean)[] = []
      let modo: 'select' | 'insert' | 'update' | 'upsert' = 'select'; let dados: Linha | null = null; let contar = false
      const exec = async () => {
        const t = tabelas[nome]
        if (modo === 'insert') { t.push({ id: `id-${t.length + 1}`, criado_em: new Date().toISOString(), ...dados }); return { data: null, error: null } }
        if (modo === 'upsert') {
          const ex = t.find(r => r.tenant_id === dados!.tenant_id && r.ad_id === dados!.ad_id)
          if (ex) Object.assign(ex, dados); else t.push({ ...dados }); return { data: null, error: null }
        }
        const alvo = t.filter(r => filtros.every(f => f(r)))
        if (modo === 'update') { for (const r of alvo) Object.assign(r, dados); return { data: null, error: null } }
        return contar ? { data: null, count: alvo.length, error: null } : { data: alvo, error: null }
      }
      const b: Record<string, unknown> = {
        select: (_c?: string, o?: { count?: string }) => { if (o?.count) contar = true; return b },
        insert: (d: Linha) => { modo = 'insert'; dados = d; return b },
        update: (d: Linha) => { modo = 'update'; dados = d; return b },
        upsert: (d: Linha) => { modo = 'upsert'; dados = d; return b },
        eq: (c: string, v: unknown) => { filtros.push(r => String(r[c]) === String(v)); return b },
        not: (c: string) => { filtros.push(r => r[c] !== null && r[c] !== undefined); return b },
        lt: (c: string, v: number) => { filtros.push(r => Number(r[c] ?? 0) < v); return b },
        limit: () => b,
        maybeSingle: async () => { const r = await exec(); return { data: (r.data as Linha[] | null)?.[0] ?? null, error: null } },
        then: (ok: (v: unknown) => unknown, ruim?: (e: unknown) => unknown) => exec().then(ok, ruim),
      }
      return b
    },
  }
}
type Banco = ReturnType<typeof bancoFalso>
const A = (db: Banco) => db as unknown as Parameters<typeof enviarEventoPedido>[0]

function cenario(pedido: Partial<Linha> = {}, cfg: Partial<Linha> = {}) {
  return bancoFalso({
    estudio_config: [{ tenant_id: 't1', waba_id: WABA, access_token: 'tok', meta_dataset_id: null, meta_test_event_code: null, ...cfg }],
    estudio_pedidos: [{ id: 'p1', tenant_id: 't1', ctwa_clid: REF_A.ctwa_clid, valor_cents: 1890, valor_pago_cents: 1890, moeda: 'BRL', tema_slug: 'aniversario', pacote_qtd: 2, tipo: 'pacote', criado_em: '2026-11-01T14:00:00Z', pago_em: '2026-11-01T14:20:00Z', meta_lead_enviado_em: null, meta_purchase_enviado_em: null, meta_tentativas: 0, meta_erro: null, ...pedido }],
    estudio_eventos: [], estudio_anuncios: [],
  })
}

/** Meta falsa: dataset no GET, eventos aceitos (ou erro de permissão). */
function metaFalsa(o: { negar?: boolean } = {}) {
  const chamadas: { url: string; metodo: string; corpo: Record<string, unknown> | null }[] = []
  const f = (async (url: string, i: RequestInit) => {
    chamadas.push({ url, metodo: i.method ?? 'GET', corpo: i.body ? JSON.parse(String(i.body)) : null })
    if (url.endsWith(`/${WABA}/dataset`)) return new Response(JSON.stringify({ data: [{ id: '987654321' }] }))
    if (url.includes('/events')) return o.negar
      ? new Response(JSON.stringify({ error: { message: '(#200) Requires whatsapp_business_manage_events permission', code: 200 } }), { status: 403 })
      : new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'x' }))
    if (url.includes('fields=name')) return o.negar
      ? new Response(JSON.stringify({ error: { message: 'Missing ads_read', code: 10 } }), { status: 403 })
      : new Response(JSON.stringify({ name: 'AD-01 Aniversário', adset: { name: 'Mulheres 30-50' }, campaign: { name: 'Ensaio IA — Vendas' } }))
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return { f, chamadas }
}

const tests: Record<string, () => void | Promise<void>> = {
  'referral de anúncio vira origem (ad_id, ctwa_clid, headline, mídia); sem referral = nada': () => {
    const a = anuncioDoReferral(REF_A)!
    assert.equal(a.ad_id, '120210000000001'); assert.equal(a.ctwa_clid, REF_A.ctwa_clid); assert.equal(a.headline, 'Ensaio com IA em 60 min'); assert.equal(a.media_url, 'https://scontent/x.jpg')
    assert.equal(anuncioDoReferral(null), null); assert.equal(anuncioDoReferral({}), null)
    assert.equal(anuncioDoReferral({ source_type: 'post', source_id: '1' }), null, 'post orgânico impulsionado não é anúncio CTWA')
  },
  'origem: 1º referral grava último E primeiro; mensagem orgânica depois não apaga; 2º anúncio vira o último clique': () => {
    const t0 = '2026-11-01T14:00:00Z', t1 = '2026-11-01T15:00:00Z', t2 = '2026-11-03T10:00:00Z'
    const p1 = atualizacaoDeOrigem(null, anuncioDoReferral(REF_A), t0)!
    assert.equal(p1.ad_id, REF_A.source_id); assert.equal(p1.ad_id_primeiro, REF_A.source_id); assert.equal(p1.ctwa_clid_primeiro, REF_A.ctwa_clid); assert.equal(p1.origem, 'anuncio')
    const contato = { ...p1 }
    assert.equal(atualizacaoDeOrigem(contato, anuncioDoReferral(undefined), t1), null, 'orgânico não sobrescreve')
    assert.equal(atualizacaoDeOrigem(contato, anuncioDoReferral(REF_A), t1), null, 'o mesmo clique repetido não muda nada')
    const p2 = atualizacaoDeOrigem(contato, anuncioDoReferral(REF_B), t2)!
    assert.equal(p2.ad_id, REF_B.source_id); assert.equal(p2.ctwa_clid, REF_B.ctwa_clid); assert.equal(p2.origem_em, t2)
    assert.equal(p2.ad_id_primeiro, undefined, 'o primeiro fica como estava')
    // a entrada aplica isso no contato
    const e = ler('src/lib/estudio/entrada.ts')
    assert.ok(e.includes('anuncioDoReferral(m.referral)') && e.includes('atualizacaoDeOrigem(existente ?? null, anuncio, agoraIso)'))
  },
  'evento Purchase no formato da CAPI para mensagens (business_messaging, whatsapp, ctwa_clid, event_id fixo)': () => {
    const ev = corpoDoEvento({ id: 'p1', ctwa_clid: 'CLID', valor_cents: 1890, valor_pago_cents: 1890, moeda: 'BRL', tema_nome: 'Aniversário', pacote_qtd: 2, pago_em: '2026-11-01T14:20:00Z' }, 'Purchase', WABA, new Date('2026-11-01T15:00:00Z'))
    assert.deepEqual(ev, {
      event_name: 'Purchase', event_time: Math.floor(Date.parse('2026-11-01T14:20:00Z') / 1000), action_source: 'business_messaging', messaging_channel: 'whatsapp',
      event_id: 'p1-purchase', user_data: { whatsapp_business_account_id: WABA, ctwa_clid: 'CLID' },
      custom_data: { currency: 'BRL', value: 18.9, content_name: 'Ensaio Aniversário 2 fotos' },
    })
    const lead = corpoDoEvento({ id: 'p1', ctwa_clid: 'CLID', valor_cents: 1190, moeda: 'USD', pacote_qtd: 5, criado_em: '2026-11-01T14:00:00Z' }, 'LeadSubmitted', WABA)
    assert.equal(lead.event_name, 'LeadSubmitted'); assert.equal(lead.event_id, 'p1-lead'); assert.equal(lead.custom_data.currency, 'USD'); assert.equal(lead.custom_data.value, 11.9)
    assert.equal(eventIdDe('x', 'Purchase'), 'x-purchase')
  },
  'quem envia: só com ctwa_clid; prévia e orgânico não; o que já foi não vai de novo': () => {
    assert.equal(deveEnviar({ id: 'a', ctwa_clid: null, valor_cents: 1 }, 'Purchase'), false)
    assert.equal(deveEnviar({ id: 'a', ctwa_clid: 'c', valor_cents: 0, tipo: 'previa' }, 'LeadSubmitted'), false)
    assert.equal(deveEnviar({ id: 'a', ctwa_clid: 'c', valor_cents: 1, meta_purchase_enviado_em: '2026-11-01' }, 'Purchase'), false)
    assert.equal(deveEnviar({ id: 'a', ctwa_clid: 'c', valor_cents: 1 }, 'Purchase'), true)
  },
  'Purchase enviado 1× só: obtém o dataset do WABA, manda, marca o pedido; 2ª chamada não chama a Meta': async () => {
    const db = cenario(); const { f, chamadas } = metaFalsa()
    assert.equal((await enviarEventoPedido(A(db), 'p1', 'Purchase', f)).resultado, 'enviado')
    assert.equal(chamadas[0].url, `${GRAPH_CAPI}/${WABA}/dataset`)
    const ev = chamadas.find(c => c.url === `${GRAPH_CAPI}/987654321/events`)!
    assert.equal(ev.metodo, 'POST'); assert.equal((ev.corpo!.data as { event_id: string }[])[0].event_id, 'p1-purchase')
    assert.equal(db.tabelas.estudio_config[0].meta_dataset_id, '987654321', 'dataset guardado')
    assert.ok(db.tabelas.estudio_pedidos[0].meta_purchase_enviado_em)
    const antes = chamadas.length
    assert.equal((await enviarEventoPedido(A(db), 'p1', 'Purchase', f)).resultado, 'pulado')
    assert.equal(chamadas.length, antes, 'não chamou a Meta de novo')
  },
  'código de teste do Gerenciador vai junto (test_event_code)': async () => {
    const db = cenario({}, { meta_dataset_id: '987654321', meta_test_event_code: 'TEST1234' }); const { f, chamadas } = metaFalsa()
    await enviarEventoPedido(A(db), 'p1', 'LeadSubmitted', f)
    assert.equal(chamadas[0].corpo!.test_event_code, 'TEST1234')
  },
  'pedido orgânico não envia nada': async () => {
    const db = cenario({ ctwa_clid: null }); const { f, chamadas } = metaFalsa()
    assert.equal((await enviarEventoPedido(A(db), 'p1', 'Purchase', f)).resultado, 'pulado')
    assert.equal(chamadas.length, 0)
  },
  'erro de permissão: fica no pedido (tentativa +1) e no painel, com o que fazer': async () => {
    const db = cenario({}, { meta_dataset_id: '987654321' }); const { f } = metaFalsa({ negar: true })
    const r = await enviarEventoPedido(A(db), 'p1', 'Purchase', f)
    assert.equal(r.resultado, 'erro')
    const p = db.tabelas.estudio_pedidos[0]
    assert.equal(p.meta_tentativas, 1); assert.match(String(p.meta_erro), /whatsapp_business_manage_events/)
    assert.match(String(db.tabelas.estudio_config[0].meta_capi_erro), /Gere um token novo/)
    assert.match(explicarErroMeta('Error validating access token: Session has expired'), /Token vencido/)
  },
  'nome do anúncio/conjunto/campanha em cache; sem permissão guarda o erro e não quebra': async () => {
    const db = cenario(); const { f } = metaFalsa()
    await buscarAnuncio(A(db), 't1', REF_A.source_id, REF_A.headline, f)
    assert.deepEqual([db.tabelas.estudio_anuncios[0].nome, db.tabelas.estudio_anuncios[0].conjunto, db.tabelas.estudio_anuncios[0].campanha], ['AD-01 Aniversário', 'Mulheres 30-50', 'Ensaio IA — Vendas'])
    const db2 = cenario(); const { f: f2 } = metaFalsa({ negar: true })
    await buscarAnuncio(A(db2), 't1', REF_A.source_id, REF_A.headline, f2)
    assert.match(String(db2.tabelas.estudio_anuncios[0].erro), /ads_read/); assert.equal(db2.tabelas.estudio_anuncios[0].headline, REF_A.headline)
  },
  'dataset: aceita {data:[{id}]} e {id}': () => {
    assert.equal(idDoDataset({ data: [{ id: '1' }] }), '1'); assert.equal(idDoDataset({ id: '2' }), '2'); assert.equal(idDoDataset({ data: [] }), null)
  },
  'painel "de onde vem a venda": por anúncio, Orgânico por último, faturamento por moeda, taxa': () => {
    const l = agruparPorAnuncio(
      [{ ad_id: 'A' }, { ad_id: 'A' }, { ad_id: 'A' }, { ad_id: 'A' }, { ad_id: 'B' }, { ad_id: null }, { ad_id: null }],
      [
        { ad_id: 'A', status: 'entregue', pago: true, valor_pago_cents: 1890, moeda: 'BRL' },
        { ad_id: 'A', status: 'pago', pago: true, valor_pago_cents: 1190, moeda: 'USD' },
        { ad_id: 'A', status: 'aguardando_pagamento', pago: false, valor_pago_cents: null, moeda: 'BRL' },
        { ad_id: 'B', status: 'reembolsado', pago: true, valor_pago_cents: 890, moeda: 'USD' },
        { ad_id: null, status: 'entregue', pago: true, valor_pago_cents: 4990, moeda: 'BRL' },
      ])
    assert.deepEqual(l.map(x => x.ad_id), ['A', 'B', null])
    assert.deepEqual(l[0], { ad_id: 'A', conversas: 4, pedidos: 3, vendas: 2, faturamento: { BRL: 1890, USD: 1190 }, taxa: 0.5 })
    assert.equal(l[1].vendas, 0, 'reembolsado não conta'); assert.deepEqual(l[2].faturamento, { BRL: 4990 })
  },
  'ligações: pedido copia ad_id/ctwa_clid; fechamento manda LeadSubmitted; pagamento manda Purchase; robô reenvia; SQL': () => {
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.ok(ex.includes("ad_id: c.ad_id ?? null, ctwa_clid: c.ctwa_clid ?? null") && ex.includes("enviarEventoPedido(admin, pid, 'LeadSubmitted')"))
    assert.ok(ex.includes('insert(basePedido)'), 'sem o SQL novo o pedido é criado mesmo assim')
    assert.ok(ler('src/lib/estudio/pix-servidor.ts').includes("enviarEventoPedido(admin, pedidoId, 'Purchase')"), 'Pix e Hotmart passam por marcarPago')
    assert.ok(ler('src/lib/estudio/producao-servidor.ts').includes('reenviarEventosPendentes(admin)'))
    const sql = ler('supabase/migrations/20261101000000_estudio_ia_anuncios.sql')
    assert.ok(!/RENAME|DROP COLUMN|DROP TABLE/i.test(sql))
    for (const c of ['ad_id', 'ctwa_clid', 'ad_headline', 'ad_body', 'ad_media_url', 'origem_em', 'ad_id_primeiro', 'ctwa_clid_primeiro', 'meta_purchase_enviado_em', 'meta_lead_enviado_em', 'meta_tentativas', 'meta_dataset_id']) assert.ok(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`).test(sql), c)
    assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS estudio_anuncios') && sql.includes('p.meta_tentativas < 3'))
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
