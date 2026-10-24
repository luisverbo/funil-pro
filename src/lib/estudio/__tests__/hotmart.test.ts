// ============================================================================
// Estúdio IA — Fase 7: Hotmart (pagamento internacional em USD)
// Puro (payload v2, evento → ação, link com sck, conferência), fluxo da Ana
// para cliente de fora e a ROTA inteira contra um banco falso em memória:
// aprovado, reembolso, evento repetido, token errado, sck ausente, oferta
// que não bate. Nenhuma rede de verdade.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acaoDoEvento, lerCompraHotmart, linkComPedido, ofertaDoLink, conferirCompra, mesmoTelefone, sckEhPedido, valorNaMoeda } from '@/lib/estudio/hotmart'
import { tratarWebhookHotmart } from '@/lib/estudio/hotmart-servidor'
import { proximoPasso, pagaPelaHotmart, type Contexto, type Dados, type Acao } from '@/lib/estudio/ana/maquina'
import { TEXTOS, IDIOMAS } from '@/lib/estudio/ana/textos'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)
const LINKS: Record<number, string> = {
  2: 'https://pay.hotmart.com/O108165649T?off=kyupvkhm', 3: 'https://pay.hotmart.com/O108165649T?off=ea8dk76w',
  5: 'https://pay.hotmart.com/O108165649T?off=c5bjv7m1', 10: 'https://pay.hotmart.com/O108165649T?off=fj0e1f7t',
  15: 'https://pay.hotmart.com/O108165649T?off=69k2yih6',
}
const INT = [[2, 690], [3, 890], [5, 1190], [10, 1690], [15, 2190]].map(([q, v]) => ({ pacote_qtd: q, valor_cents: v, moeda: 'USD', link_pagamento: LINKS[q] }))
const ctxEs: Contexto = { idioma: 'es', precos: INT, posesDoTema: () => Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0')), temasAtivos: ['aniversario', 'corporativo', 'casual', 'sensual'], pix: true }
const txt = (t: string) => ({ tipo: 'texto', texto: t })

const PEDIDO = 'a1b2c3d4-0000-4000-8000-00000000abcd'
const TENANT = '7fb20044-ef4e-407a-8d20-f83e8b7b1029'
function payload(o: { evento?: string; tx?: string; sck?: string | null; oferta?: string; produto?: number; valor?: number; moeda?: string; tel?: string | null; email?: string } = {}) {
  return {
    id: 'evt-1', creation_date: 1761836000000, event: o.evento ?? 'PURCHASE_APPROVED', version: '2.0.0',
    data: {
      product: { id: o.produto ?? 8794754, name: 'Sesión de Fotos con IA - Studio Fotográfico' },
      buyer: { email: o.email ?? 'ana@ejemplo.com', name: 'Ana Pérez', checkout_phone: o.tel === undefined ? '5491112345678' : o.tel },
      purchase: {
        transaction: o.tx ?? 'HP17617744271', status: 'APPROVED', approved_date: 1761836000000,
        offer: { code: o.oferta ?? 'c5bjv7m1' },
        price: { value: o.valor ?? 11.9, currency_value: o.moeda ?? 'USD' },
        original_offer_price: { value: 11.9, currency_value: 'USD' },
        origin: o.sck === null ? {} : { sck: o.sck ?? PEDIDO },
      },
    },
  }
}

// ── Banco falso (subconjunto do PostgREST que o webhook usa) ────────────────
type Linha = Record<string, unknown>
function bancoFalso(tabelas: Record<string, Linha[]>) {
  const val = (r: Linha, col: string) => col.includes('->>') ? (r[col.split('->>')[0]] as Linha | undefined)?.[col.split('->>')[1]] ?? null : r[col]
  return {
    tabelas,
    rpc: async () => ({ data: null, error: { message: 'rpc não simulada' } }),
    storage: { from: () => ({ download: async () => ({ data: null }) }) },
    from(nome: string) {
      tabelas[nome] ??= []
      const filtros: ((r: Linha) => boolean)[] = []
      let modo: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let dados: Linha | Linha[] | null = null
      let contar = false; let lim = Infinity; let desc = false
      const exec = async () => {
        const t = tabelas[nome]
        if (modo === 'insert') {
          for (const d of (Array.isArray(dados) ? dados : [dados!])) t.push({ id: `id-${t.length + 1}`, criado_em: new Date().toISOString(), ...d })
          return { data: null, error: null }
        }
        const alvo = t.filter(r => filtros.every(f => f(r)))
        if (modo === 'update') {
          const d = dados as Linha
          if (nome === 'estudio_pedidos' && d.hotmart_transacao && t.some(r => r.hotmart_transacao === d.hotmart_transacao && !alvo.includes(r))) {
            return { data: null, error: { message: 'duplicate key value violates unique constraint "estudio_pedidos_hotmart_tx_uk"' } }
          }
          for (const r of alvo) Object.assign(r, d)
          return { data: null, error: null }
        }
        if (modo === 'delete') { tabelas[nome] = t.filter(r => !alvo.includes(r)); return { data: null, error: null } }
        const lista = (desc ? [...alvo].reverse() : alvo).slice(0, lim)
        return contar ? { data: null, count: alvo.length, error: null } : { data: lista, error: null }
      }
      const b: Record<string, unknown> = {
        select: (_c?: string, o?: { count?: string; head?: boolean }) => { if (o?.count) contar = true; return b },
        insert: (d: Linha | Linha[]) => { modo = 'insert'; dados = d; return b },
        update: (d: Linha) => { modo = 'update'; dados = d; return b },
        upsert: (d: Linha) => { modo = 'insert'; dados = d; return b },
        delete: () => { modo = 'delete'; return b },
        eq: (c: string, v: unknown) => { filtros.push(r => String(val(r, c)) === String(v)); return b },
        neq: (c: string, v: unknown) => { filtros.push(r => String(val(r, c)) !== String(v)); return b },
        in: (c: string, vs: unknown[]) => { filtros.push(r => vs.map(String).includes(String(val(r, c)))); return b },
        like: (c: string, p: string) => { const re = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'); filtros.push(r => re.test(String(val(r, c) ?? ''))); return b },
        not: (c: string) => { filtros.push(r => val(r, c) !== null && val(r, c) !== undefined); return b },
        is: (c: string) => { filtros.push(r => val(r, c) === null || val(r, c) === undefined); return b },
        gte: () => b, lt: () => b,
        order: (_c: string, o?: { ascending?: boolean }) => { if (o?.ascending === false) desc = true; return b },
        limit: (n: number) => { lim = n; return b },
        maybeSingle: async () => { const r = await exec(); return { data: (r.data as Linha[] | null)?.[0] ?? null, error: r.error } },
        single: async () => { const r = await exec(); const d = (r.data as Linha[] | null)?.[0] ?? null; return { data: d, error: d ? r.error : { message: 'not found' } } },
        then: (ok: (v: unknown) => unknown, ruim?: (e: unknown) => unknown) => exec().then(ok, ruim),
      }
      return b
    },
  }
}

function cenario(o: { pedido?: Partial<Linha> } = {}) {
  return bancoFalso({
    estudio_config: [{ tenant_id: TENANT, hotmart_hottok: 'tok-secreto', hotmart_produto_id: '8794754', phone_number_id: null, access_token: null, whatsapp_avisos: null }],
    estudio_contatos: [{ id: 'c1', tenant_id: TENANT, wa_id: '5491112345678', nome: 'Ana', idioma: 'es', pais: 'AR', dados: {}, pedido_atual_id: PEDIDO, origem: 'organico', referral: null }],
    estudio_pedidos: [{ id: PEDIDO, tenant_id: TENANT, contato_id: 'c1', status: 'aguardando_pagamento', pacote_qtd: 5, valor_cents: 1190, moeda: 'USD', forma_pagamento: 'hotmart', hotmart_transacao: null, cliente_nome: 'Ana', pais: 'AR', tipo: 'pacote', poses: ['01', '02', '03', '04', '05'], idade: 30, foto_rosto_path: 'x/rosto.jpg', foto_corpo_path: 'x/corpo.jpg', ...o.pedido }],
    estudio_precos: INT.map(p => ({ tenant_id: TENANT, pais: 'INT', ...p })),
    estudio_eventos: [], estudio_ia_uso: [], estudio_avisos: [], estudio_mensagens: [],
  })
}
type Banco = ReturnType<typeof bancoFalso>
const chamar = (db: Banco, hottok: string | null, p: unknown) => tratarWebhookHotmart(db as unknown as Parameters<typeof tratarWebhookHotmart>[0], hottok, p)
const pedido = (db: Banco) => db.tabelas.estudio_pedidos[0]

const tests: Record<string, () => void | Promise<void>> = {
  'eventos v2: aprovado/completo → pago · reembolso/chargeback/cancelado → estorno · atrasado/protesto → registrar': () => {
    for (const e of ['PURCHASE_APPROVED', 'PURCHASE_COMPLETE']) assert.equal(acaoDoEvento(e), 'pago')
    for (const e of ['PURCHASE_REFUNDED', 'PURCHASE_CHARGEBACK', 'PURCHASE_CANCELED']) assert.equal(acaoDoEvento(e), 'estorno')
    for (const e of ['PURCHASE_DELAYED', 'PURCHASE_PROTEST']) assert.equal(acaoDoEvento(e), 'registrar')
    assert.equal(acaoDoEvento('PURCHASE_OUT_OF_SHOPPING_CART'), 'ignorar')
  },
  'payload: transação, produto, oferta, sck, telefone, e-mail, preço da oferta em USD mesmo pagando em moeda local': () => {
    const c = lerCompraHotmart(payload({ valor: 12500, moeda: 'ARS' }))
    assert.equal(c.transacao, 'HP17617744271'); assert.equal(c.produto_id, '8794754'); assert.equal(c.oferta, 'c5bjv7m1'); assert.equal(c.sck, PEDIDO)
    assert.equal(c.telefone, '5491112345678'); assert.equal(c.email, 'ana@ejemplo.com'); assert.equal(c.moeda, 'ARS')
    assert.equal(c.valor_oferta_cents, 1190); assert.equal(c.moeda_oferta, 'USD'); assert.equal(valorNaMoeda(c, 'USD'), 1190)
  },
  'link personalizado: <link_pagamento>&sck=<pedido_id> (sem duplicar sck)': () => {
    assert.equal(linkComPedido(LINKS[5], PEDIDO), `https://pay.hotmart.com/O108165649T?off=c5bjv7m1&sck=${PEDIDO}`)
    assert.equal(linkComPedido(`${LINKS[5]}&sck=velho`, PEDIDO), `https://pay.hotmart.com/O108165649T?off=c5bjv7m1&sck=${PEDIDO}`)
    assert.equal(linkComPedido('https://pay.hotmart.com/X', 'p1'), 'https://pay.hotmart.com/X?sck=p1')
    assert.equal(ofertaDoLink(LINKS[10]), 'fj0e1f7t'); assert.ok(sckEhPedido(PEDIDO)); assert.ok(!sckEhPedido('lixo'))
    assert.ok(mesmoTelefone('+54 9 11 1234-5678', '5491112345678')); assert.ok(!mesmoTelefone('5491199999999', '5491112345678'))
  },
  'conferência: produto, oferta do pacote, valor (na mesma moeda)': () => {
    const esp = { produto_id: '8794754', oferta: 'c5bjv7m1', valor_cents: 1190, moeda: 'USD' }
    assert.deepEqual(conferirCompra(lerCompraHotmart(payload()), esp), [])
    assert.match(conferirCompra(lerCompraHotmart(payload({ oferta: 'kyupvkhm' })), esp).join(), /oferta kyupvkhm não é a do pacote/)
    assert.match(conferirCompra(lerCompraHotmart(payload({ produto: 123 })), esp).join(), /produto 123/)
    const barato = lerCompraHotmart(payload({ valor: 6.9 })); barato.valor_oferta_cents = 690
    assert.match(conferirCompra(barato, esp).join(), /valor 6\.90 USD menor/)
  },
  'Ana (fora do Brasil): tabela em US$, link da Hotmart no lugar do Pix, sem pedir comprovante': () => {
    const pac = proximoPasso('pacote', { tema: 'casual' }, txt('3'), ctxEs)
    assert.equal(pac.dados.moeda, 'USD'); assert.equal(pac.dados.valor_cents, 1190); assert.equal(pac.dados.pagar_link, LINKS[5])
    // Escolheu o pacote → o link da Hotmart já sai (sem Pix)
    assert.deepEqual(chaves(pac.acoes), ['criar_pedido', 'texto:pede_fotos_poses', 'texto:catalogo_de_novo', 'fechar_pedido', 'hotmart'])
    const d: Dados = { ...pac.dados, tem_rosto: true, tem_corpo: true, poses: ['01', '02', '03', '04', '05'], maquiagem: true, decote: false, cores: 'x' }
    const fim = proximoPasso('idade_prefs', d, txt('30'), ctxEs)
    assert.equal(fim.etapa, 'aguardando_pagamento')
    assert.deepEqual(chaves(fim.acoes), ['atualizar_pedido', 'fechar_pedido', 'texto:resumo_pedido', 'texto:hotmart_lembrete'])
    // Quem não recebeu o link antes (conversa antiga) recebe no fechamento
    assert.deepEqual(chaves(proximoPasso('idade_prefs', { ...d, pagamento_enviado: false }, txt('30'), ctxEs).acoes), ['atualizar_pedido', 'fechar_pedido', 'texto:resumo_pedido', 'hotmart'])
    assert.ok(!fim.acoes.some(a => a.t === 'pix' || (a.t === 'texto' && a.chave === 'pede_comprovante')))
    assert.ok(pagaPelaHotmart(fim.dados))
    // print/“ya pagué”: a confirmação chega sozinha; dúvida → IA + o link de novo
    assert.deepEqual(chaves(proximoPasso('aguardando_pagamento', fim.dados, { tipo: 'imagem', texto: '' }, ctxEs).acoes), ['texto:hotmart_print'])
    assert.deepEqual(chaves(proximoPasso('aguardando_pagamento', fim.dados, txt('ya pagué'), ctxEs).acoes), ['texto:hotmart_print'])
    assert.deepEqual(chaves(proximoPasso('aguardando_pagamento', fim.dados, txt('¿es seguro?'), ctxEs).acoes), ['ia', 'texto:hotmart_lembrete'])
    // Brasil continua no Pix
    const br = proximoPasso('idade_prefs', { ...d, moeda: 'BRL', pagar_link: null, valor_cents: 4990, pagamento_enviado: false }, txt('30'), { ...ctxEs, idioma: 'pt-BR' })
    assert.ok(br.acoes.some(a => a.t === 'pix') && !br.acoes.some(a => a.t === 'hotmart'))
  },
  'textos da Hotmart nos 4 idiomas, com {pagar} (o link com o pedido)': () => {
    for (const k of ['hotmart_link', 'hotmart_print', 'hotmart_lembrete']) for (const i of IDIOMAS) assert.ok(TEXTOS[k]?.[i]?.trim(), `${k}/${i}`)
    assert.ok(TEXTOS.hotmart_link.es.startsWith('¡Perfecto! 💖 Podés pagar acá de forma segura (tarjeta, en tu moneda): {pagar}'))
    assert.ok(TEXTOS.hotmart_link.es.includes('Apenas se confirme el pago, seguimos por acá 😉'))
  },
  'rota: token errado / ausente → 401 e não toca em nada': async () => {
    const db = cenario()
    assert.equal((await chamar(db, 'errado', payload())).http, 401)
    assert.equal((await chamar(db, null, payload())).http, 401)
    assert.equal(pedido(db).status, 'aguardando_pagamento'); assert.equal(db.tabelas.estudio_eventos.length, 0)
  },
  'rota: aprovado → pago (hotmart, USD, transação) → fila de produção; payload bruto em estudio_eventos': async () => {
    const db = cenario()
    const r = await chamar(db, 'tok-secreto', payload())
    assert.equal(r.http, 200); assert.equal(r.corpo.status, 'pago')
    const p = pedido(db)
    assert.equal(p.pago_por, 'hotmart'); assert.equal(p.forma_pagamento, 'hotmart'); assert.equal(p.moeda, 'USD')
    assert.equal(p.valor_pago_cents, 1190); assert.equal(p.hotmart_transacao, 'HP17617744271')
    assert.equal(p.status, 'aguardando_producao', 'mesmo caminho do Pix: entra na fila')
    const ev = db.tabelas.estudio_eventos.find(e => e.tipo === 'hotmart_purchase_approved')
    assert.ok(ev && (ev.detalhe as Linha).transacao === 'HP17617744271' && (ev.detalhe as Linha).payload)
    assert.ok(db.tabelas.estudio_eventos.some(e => e.tipo === 'na_fila'))
  },
  'rota: o MESMO evento reenviado não conta 2×': async () => {
    const db = cenario()
    await chamar(db, 'tok-secreto', payload())
    const r2 = await chamar(db, 'tok-secreto', payload())
    assert.equal(r2.http, 200); assert.equal(r2.corpo.status, 'repetido')
    assert.equal(db.tabelas.estudio_eventos.filter(e => e.tipo === 'pago').length, 1)
  },
  'rota: sem sck → acha pelo telefone do comprador (wa_id)': async () => {
    const db = cenario()
    const r = await chamar(db, 'tok-secreto', payload({ sck: null }))
    assert.equal(r.corpo.status, 'pago'); assert.equal(pedido(db).hotmart_transacao, 'HP17617744271')
    assert.equal((db.tabelas.estudio_eventos.find(e => e.tipo === 'hotmart_purchase_approved')!.detalhe as Linha).achado_por, 'telefone')
  },
  'rota: sem sck e sem telefone que bata → "sem pedido" registrado (e aviso)': async () => {
    const db = cenario()
    const r = await chamar(db, 'tok-secreto', payload({ sck: null, tel: '5511999990000', email: 'outra@x.com' }))
    assert.equal(r.corpo.status, 'sem_pedido'); assert.equal(pedido(db).status, 'aguardando_pagamento')
    assert.equal(db.tabelas.estudio_eventos.find(e => e.tipo === 'hotmart_purchase_approved')!.pedido_id, null)
  },
  'rota: oferta que não bate com o pacote → conferência manual (não aprova sozinho)': async () => {
    const db = cenario()
    const r = await chamar(db, 'tok-secreto', payload({ oferta: 'kyupvkhm' }))
    assert.equal(r.corpo.status, 'conferencia'); assert.equal(pedido(db).status, 'aguardando_conferencia')
    assert.match(String(pedido(db).conferencia_motivo), /oferta kyupvkhm/)
    assert.equal(pedido(db).hotmart_transacao, null)
  },
  'rota: reembolso / chargeback → reembolsado; cancelado → cancelado': async () => {
    for (const [ev, st] of [['PURCHASE_REFUNDED', 'reembolsado'], ['PURCHASE_CHARGEBACK', 'reembolsado'], ['PURCHASE_CANCELED', 'cancelado']] as const) {
      const db = cenario({ pedido: { status: 'entregue', hotmart_transacao: 'HP17617744271' } })
      const r = await chamar(db, 'tok-secreto', payload({ evento: ev }))
      assert.equal(r.corpo.status, 'estorno', ev); assert.equal(pedido(db).status, st, ev); assert.match(String(pedido(db).cancelado_motivo), new RegExp(ev))
    }
  },
  'estrutura: rota sem tenant no caminho, convive com a dos funis; SQL da Fase 7': () => {
    assert.ok(ler('src/app/api/webhooks/hotmart/route.ts').includes("request.headers.get('x-hotmart-hottok')"))
    assert.ok(ler('src/app/api/webhooks/hotmart/[tenantId]/route.ts').length > 0, 'a rota dos funis continua')
    assert.ok(ler('src/proxy.ts').includes("'/api/webhooks'"), 'pública (sem sessão)')
    const sql = ler('supabase/migrations/20261031000000_estudio_ia_hotmart.sql')
    assert.ok(!/RENAME|DROP COLUMN|DROP TABLE/i.test(sql))
    assert.match(sql, /ADD COLUMN IF NOT EXISTS hotmart_hottok/); assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON estudio_pedidos \(hotmart_transacao\)/)
    assert.ok(sql.includes("'reembolsado'"))
    for (const [q, v, off] of [[2, 690, 'kyupvkhm'], [3, 890, 'ea8dk76w'], [5, 1190, 'c5bjv7m1'], [10, 1690, 'fj0e1f7t'], [15, 2190, '69k2yih6']] as const) {
      assert.ok(sql.includes(`(${q},`) && sql.includes(`${v},`) && sql.includes(`off=${off}`), `pacote ${q}`)
    }
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.ok(ex.includes("['BR', '*']") && ex.includes("'INT'"), 'fora do Brasil usa INT')
    assert.ok(!/hotmart_hottok/.test(ler('src/app/(dashboard)/estudio-ia/hotmart-ui.tsx').replace(/tem_hottok/g, '')), 'o hottok nunca vai para a tela')
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
