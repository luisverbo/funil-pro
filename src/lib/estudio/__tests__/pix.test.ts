// ============================================================================
// Estúdio IA — Fase 4: Pix por comprovante, cérebro da Ana (Haiku/Sonnet,
// resposta estruturada, base, trava de preço/prazo/promessa, custo por
// chamada) e dados de venda no pedido pago. Nenhuma chamada real de IA/rede.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decidirComprovante, nomeConfere, chaveConfere, normalizarE2E, dadosDeVenda, linhasDoPix, type LeituraComprovante } from '@/lib/estudio/pix'
import { proximoPasso, cobrancaDevida, type Contexto, type Dados, type Entrada, type Etapa, type Acao } from '@/lib/estudio/ana/maquina'
import {
  MODELO_RAPIDO, MODELO_FORTE, custoDoUso, modeloParaMensagem, bloqueioDaResposta, decidirResposta,
  lerEstruturada, responderDuvida, lerComprovante, type RespostaEstruturada,
} from '@/lib/estudio/ana/ia'
import { TEXTOS, IDIOMAS } from '@/lib/estudio/ana/textos'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PRECOS = [[2, 1890], [3, 2990], [5, 4990], [10, 6990], [15, 9890]].map(([q, v]) => ({ pacote_qtd: q, valor_cents: v, moeda: 'BRL' }))
const POSES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'))
const ctx: Contexto = { idioma: 'pt-BR', precos: PRECOS, posesDoTema: () => POSES, temasAtivos: ['aniversario', 'corporativo', 'casual', 'sensual'], pix: true }
const txt = (t: string): Entrada => ({ tipo: 'texto', texto: t })
const img = (): Entrada => ({ tipo: 'imagem', texto: '', foto: 'ok' })
const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)
const PIX = { chave: '+55 21 99077-3595', tipo: 'celular', recebedor: 'Luís Carlos da Silva' }
const AGORA = new Date('2026-10-28T15:00:00-03:00')
const BOA: LeituraComprovante = {
  e_comprovante: true, legivel: true, valor_cents: 4990, data_hora: '2026-10-28T14:52:00-03:00',
  recebedor_nome: 'LUIS C DA SILVA', recebedor_chave: '+55 (21) 9****-3595', pagador_nome: 'Maryana Souza', e2e_id: 'E18236120202610281752s0123456789',
}
const PERMITIDO = { tabelaPrecos: '1️⃣ 2 fotos — R$ 18,90; 2️⃣ 3 fotos — R$ 29,90; 3️⃣ 5 fotos — R$ 49,90', prazoMin: 60 }
const est = (o: Partial<RespostaEstruturada>): RespostaEstruturada => ({
  intencao: 'duvida', dados: { nome: null, tema: null, pacote_qtd: null, poses: null, idade: null }, resposta: 'Claro! 💖', precisa_humano: false, na_base: true, ...o,
})
function respostaApi(obj: unknown, usage = { input_tokens: 1000, output_tokens: 200 }) {
  return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage, stop_reason: 'end_turn' }), { status: 200 })
}

const tests: Record<string, () => void | Promise<void>> = {
  'conversa até o PAGO: fechamento manda chave Pix + valor + A5 + pede comprovante; comprovante → ação de conferir': () => {
    let etapa: Etapa = 'inicio'; let d: Dados = {}; const log: string[][] = []
    let n = 0
    for (const e of [txt('Olá'), txt('Maria'), txt('1'), txt('3'), img(), img(), txt('03, 07, 12, 15 e 19'), txt('não'), txt('com decote'), txt('vestido azul'), txt('35'), { tipo: 'imagem', texto: '' }]) {
      if (e.tipo === 'imagem' && etapa !== 'aguardando_pagamento') n++
      const r = proximoPasso(etapa, d, e, { ...ctx, fotos: { tem_rosto: n >= 1, tem_corpo: n >= 2, rosto_recortado: false, unica: false } }); etapa = r.etapa; d = r.dados; log.push(chaves(r.acoes))
    }
    // Escolheu o pacote → Pix + A5 já saem, junto do pedido das fotos/poses.
    assert.deepEqual(log[3], ['criar_pedido', 'texto:pede_fotos_poses', 'fechar_pedido', 'texto:pagar_ja', 'pix', 'audio:a5'])
    // No fim: resumo e lembrete do comprovante (sem repetir a chave).
    assert.deepEqual(log[10], ['atualizar_pedido', 'fechar_pedido', 'texto:resumo_pedido', 'texto:pede_comprovante'])
    assert.deepEqual(log[11], ['comprovante'])
    assert.equal(d.maquiagem, false); assert.equal(d.decote, true); assert.equal(d.cores, 'vestido azul')
    assert.equal(etapa, 'aguardando_pagamento'); assert.equal(d.valor_cents, 4990)
  },
  'sem Pix cadastrado (ou fora do Brasil) não manda chave; "paguei" pede o comprovante; PDF também é comprovante': () => {
    const prefs = { maquiagem: true, decote: false, cores: 'a critério do estúdio' }
    const semPix = proximoPasso('idade_prefs', { tema: 'casual', pacote_qtd: 2, valor_cents: 1890, moeda: 'BRL', poses: ['01', '02'], tem_rosto: true, tem_corpo: true, ...prefs }, txt('30'), { ...ctx, pix: false })
    assert.ok(!semPix.acoes.some(a => a.t === 'pix'))
    const usd = proximoPasso('idade_prefs', { tema: 'casual', pacote_qtd: 2, valor_cents: 900, moeda: 'USD', poses: ['01', '02'], tem_rosto: true, tem_corpo: true, ...prefs }, txt('30'), ctx)
    assert.ok(!usd.acoes.some(a => a.t === 'pix'))
    assert.deepEqual(chaves(proximoPasso('aguardando_pagamento', {}, txt('já paguei!'), ctx).acoes), ['texto:pede_comprovante'])
    assert.deepEqual(chaves(proximoPasso('aguardando_pagamento', {}, { tipo: 'documento', texto: 'comprovante.pdf' }, ctx).acoes), ['comprovante'])
    // dúvida: a IA responde e o sistema repete o que a etapa espera
    assert.deepEqual(chaves(proximoPasso('aguardando_pagamento', {}, txt('é seguro?'), ctx).acoes), ['ia', 'texto:pede_comprovante'])
  },
  'conferindo e pago: a Ana não cobra e não pede pagamento de novo; prévia não reabre': () => {
    assert.deepEqual(chaves(proximoPasso('conferindo', {}, txt('e aí?'), ctx).acoes), ['texto:conferindo'])
    assert.deepEqual(chaves(proximoPasso('conferindo', {}, img(), ctx).acoes), ['comprovante'])
    const pago = proximoPasso('pago', { tema: 'casual', previa_oferecida: true }, txt('sim'), ctx)
    assert.equal(pago.etapa, 'pago'); assert.deepEqual(chaves(pago.acoes), ['ia'])
    const base = { modo: 'ana', cobrancas: 0, janela_ate: '2099-01-01T00:00:00Z', aguardando_desde: '2026-10-28T10:00:00Z', ultima_cliente_em: null }
    assert.equal(cobrancaDevida({ ...base, etapa: 'conferindo' }, AGORA), null)
    assert.equal(cobrancaDevida({ ...base, etapa: 'pago' }, AGORA), null)
    assert.equal(cobrancaDevida({ ...base, etapa: 'aguardando_pagamento' }, AGORA), 'cobranca_1')
  },
  'régua do comprovante: tudo bate → aprova sozinho': () => {
    assert.deepEqual(decidirComprovante(BOA, { valor_cents: 4990, pix: PIX }, AGORA, false), { aprovar: true })
  },
  'régua: valor diferente, recebedor errado, >24 h, futuro, sem E2E, E2E repetido, ilegível, não é comprovante': () => {
    const motivos = (l: Partial<LeituraComprovante>, usado = false) => {
      const d = decidirComprovante({ ...BOA, ...l }, { valor_cents: 4990, pix: PIX }, AGORA, usado)
      assert.equal(d.aprovar, false); return d.aprovar ? '' : d.motivos.join(' | ')
    }
    assert.match(motivos({ valor_cents: 2990 }), /valor/)
    assert.match(motivos({ recebedor_nome: 'Fulano de Tal', recebedor_chave: 'fulano@x.com' }), /recebedor/)
    assert.match(motivos({ data_hora: '2026-10-27T10:00:00-03:00' }), /24 h/)
    assert.match(motivos({ data_hora: '2026-10-28T18:00:00-03:00' }), /futuro/)
    assert.match(motivos({ e2e_id: null }), /E2E/)
    assert.match(motivos({}, true), /já foi usado/)
    assert.match(motivos({ legivel: false }), /ilegível/)
    assert.match(motivos({ e_comprovante: false }), /não parece/)
    assert.match(motivos({ data_hora: null, valor_cents: null }), /valor.*data|data.*valor/)
  },
  'recebedor: nome abreviado pelo banco confere; chave mascarada confere; outra pessoa não': () => {
    assert.ok(nomeConfere('LUIS C DA SILVA', 'Luís Carlos da Silva'))
    assert.ok(nomeConfere('Luis Carlos', 'Luís Carlos da Silva'))
    assert.ok(!nomeConfere('Luiza Carla Silva', 'Luís Carlos da Silva'))
    assert.ok(!nomeConfere('LUIS P SANTOS', 'Luís Carlos da Silva'))
    assert.ok(chaveConfere('(21) 99077-3595', '+55 21 99077-3595'))
    assert.ok(chaveConfere('+55 21 9****-3595', '+55 21 99077-3595'))
    assert.ok(!chaveConfere('+55 21 98888-3595', '+55 21 99077-3595'))
    assert.ok(chaveConfere('Luis@Email.com', 'luis@email.com')); assert.ok(!chaveConfere('outra@email.com', 'luis@email.com'))
    assert.ok(!chaveConfere('***.***.***-**', '123.456.789-00'))   // mascarado demais não vale
    assert.equal(normalizarE2E(' e1823 6120 2026 '), 'E182361202026'); assert.equal(normalizarE2E('123'), null)
    assert.deepEqual(linhasDoPix({ chave: ' +55 21 99077-3595 ', tipo: 'celular', recebedor: 'Luís' }), { chave: '+55 21 99077-3595', recebedor: 'Luís' })
    assert.equal(linhasDoPix({ chave: '', tipo: null, recebedor: null }), null)
  },
  'dados de venda: origem + id do anúncio do referral, país, idioma, prévia': () => {
    assert.deepEqual(dadosDeVenda({ origem: 'anuncio', referral: { source_id: '120210000', source_type: 'ad', ctwa_clid: 'x' }, pais: 'BR', idioma: 'pt-BR' }, true),
      { origem: 'anuncio', ad_id: '120210000', pais: 'BR', idioma: 'pt-BR', veio_de_previa: true })
    assert.deepEqual(dadosDeVenda({ origem: 'organico', referral: null, pais: 'PT', idioma: 'pt-PT' }, false),
      { origem: 'organico', ad_id: null, pais: 'PT', idioma: 'pt-PT', veio_de_previa: false })
  },
  'modelo: Haiku 5.5 no dia a dia, Sonnet 5.5 em objeção/reclamação/mensagem longa': () => {
    assert.equal(MODELO_RAPIDO, 'claude-haiku-5-5'); assert.equal(MODELO_FORTE, 'claude-sonnet-5-5')
    assert.equal(modeloParaMensagem('qual o prazo?'), MODELO_RAPIDO)
    assert.equal(modeloParaMensagem('achei caro'), MODELO_FORTE)
    assert.equal(modeloParaMensagem('isso é golpe?'), MODELO_FORTE)
    assert.equal(modeloParaMensagem('quero reembolso'), MODELO_FORTE)
    assert.equal(modeloParaMensagem('a'.repeat(300)), MODELO_FORTE)
  },
  'custo por chamada em US$ (Haiku 0,10/0,50 · Sonnet 2/10 por milhão; cache 0,1× e 1,25×)': () => {
    assert.equal(custoDoUso(MODELO_RAPIDO, { input_tokens: 1_000_000, output_tokens: 1_000_000 }).custo_usd, 0.6)
    assert.equal(custoDoUso(MODELO_FORTE, { input_tokens: 1000, output_tokens: 200 }).custo_usd, 0.004)
    assert.equal(custoDoUso(MODELO_FORTE, { cache_read_input_tokens: 1_000_000 }).custo_usd, 0.2)
    assert.equal(custoDoUso(MODELO_FORTE, { cache_creation_input_tokens: 1_000_000 }).custo_usd, 2.5)
  },
  'trava: a IA nunca inventa preço, desconto/brinde ou prazo — vira resposta segura com a tabela': () => {
    assert.equal(bloqueioDaResposta('O pacote de 5 sai por R$ 49,90 💖', PERMITIDO), null)
    assert.match(bloqueioDaResposta('Faço por R$ 39,90 pra você!', PERMITIDO) ?? '', /valor/)
    assert.match(bloqueioDaResposta('Hoje tem desconto especial!', PERMITIDO) ?? '', /promessa/)
    assert.match(bloqueioDaResposta('Fica pronto em 20 minutos', PERMITIDO) ?? '', /prazo/)
    assert.equal(bloqueioDaResposta('Fica pronto em até 60 minutos', PERMITIDO), null)
    assert.equal(bloqueioDaResposta('Tem desconto para 10 fotos sim', { ...PERMITIDO, base: [{ tipo: 'regra', resposta: 'Desconto de 10% para quem indicar uma amiga' }] }), null)
    assert.deepEqual(decidirResposta(est({ resposta: 'Por R$ 10 eu faço' }), PERMITIDO).tipo, 'confirmar_equipe')
  },
  'resposta estruturada → sistema decide: texto, humano, fora da base, não entendi': () => {
    assert.deepEqual(decidirResposta(est({}), PERMITIDO), { tipo: 'texto', texto: 'Claro! 💖' })
    assert.equal(decidirResposta(est({ intencao: 'reembolso' }), PERMITIDO).tipo, 'humano')
    assert.equal(decidirResposta(est({ intencao: 'quer_humano' }), PERMITIDO).tipo, 'humano')
    // Ana resolve: "precisa_humano" solto, fora da base e objeção NÃO chamam o Luís — a resposta sai.
    assert.equal(decidirResposta(est({ precisa_humano: true }), PERMITIDO).tipo, 'texto')
    assert.equal(decidirResposta(est({ na_base: false }), PERMITIDO).tipo, 'texto')
    assert.equal(decidirResposta(est({ intencao: 'fora_da_base' }), PERMITIDO).tipo, 'texto')
    assert.equal(decidirResposta(est({ intencao: 'objecao', resposta: 'O de 15 sai bem mais em conta por foto 💖' }), PERMITIDO).tipo, 'texto')
    // "Vou confirmar com a equipe" nunca sai.
    assert.equal(decidirResposta(est({ resposta: 'Vou confirmar com a equipe e já te respondo!' }), PERMITIDO).tipo, 'confirmar_equipe')
    assert.equal(decidirResposta(null, PERMITIDO).tipo, 'nao_entendi')
    assert.equal(lerEstruturada('lixo'), null)
    assert.equal(lerEstruturada(JSON.stringify(est({ intencao: 'compra' })))?.intencao, 'compra')
  },
  'responderDuvida: Haiku primeiro, caso ambíguo sobe para o Sonnet; JSON schema; base e custo de cada chamada': async () => {
    const antes = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'teste-falso'
    const corpos: Record<string, unknown>[] = []
    const f = (async (url: string, i: RequestInit) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages')
      const b = JSON.parse(String(i.body)); corpos.push(b)
      return b.model === MODELO_RAPIDO ? respostaApi(est({ intencao: 'nao_entendi', resposta: '' })) : respostaApi(est({ resposta: 'É 100% on-line! 💖' }))
    }) as unknown as typeof fetch
    const r = await responderDuvida({ idioma: 'pt-BR', objetivo: 'escolher pacote', tabelaPrecos: PERMITIDO.tabelaPrecos, prazoMin: 60, temas: 'Casual', historico: [{ de: 'ana', texto: 'oi' }],
      base: [{ tipo: 'faq', pergunta: 'Posso usar no LinkedIn?', resposta: 'Pode sim!' }, { tipo: 'nao_dizer', resposta: 'que somos fotógrafos' }] }, 'hmm sei lá', f)
    if (antes === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = antes
    assert.deepEqual(corpos.map(c => c.model), [MODELO_RAPIDO, MODELO_FORTE])
    const oc = corpos[0].output_config as { format: { type: string } }
    assert.equal(oc.format.type, 'json_schema')
    const sys = JSON.stringify(corpos[0].system)
    assert.ok(sys.includes('Posso usar no LinkedIn?') && sys.includes('NUNCA DIGA') && sys.includes('PROIBIDO: inventar preço'))
    assert.deepEqual(r.resposta, { tipo: 'texto', texto: 'É 100% on-line! 💖' })
    assert.equal(r.usos.length, 2); assert.equal(r.usos[0].custo_usd, 0.0002); assert.equal(r.usos[1].custo_usd, 0.004)
  },
  'lerComprovante: Sonnet 5.5 com visão; PDF vai como document; sem chave não chama a rede': async () => {
    const antes = process.env.ANTHROPIC_API_KEY
    let chamou = 0
    const f = (async (_u: string, i: RequestInit) => {
      chamou++; const b = JSON.parse(String(i.body))
      assert.equal(b.model, MODELO_FORTE)
      assert.equal(b.messages[0].content[0].type, 'document')
      return respostaApi(BOA)
    }) as unknown as typeof fetch
    delete process.env.ANTHROPIC_API_KEY
    assert.equal((await lerComprovante(new Uint8Array([1]), 'application/pdf', f)).leitura.e_comprovante, false)
    assert.equal(chamou, 0)
    process.env.ANTHROPIC_API_KEY = 'teste-falso'
    const r = await lerComprovante(new Uint8Array([1]), 'application/pdf', f)
    if (antes === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = antes
    assert.equal(chamou, 1); assert.equal(r.leitura.valor_cents, 4990); assert.ok(r.uso && r.uso.custo_usd > 0)
  },
  'textos novos nos 4 idiomas (Pix, comprovante, confirmar com a equipe)': () => {
    for (const k of ['pix_dados', 'pede_comprovante', 'conferindo', 'pago_ok', 'comprovante_recusado', 'confirmar_equipe', 'pedido_pago_duvida']) {
      for (const i of IDIOMAS) assert.ok(TEXTOS[k]?.[i]?.trim(), `${k}/${i}`)
    }
    assert.ok(TEXTOS.pix_dados['pt-BR'].includes('{valor}') && TEXTOS.pix_dados['pt-BR'].includes('{recebedor}'))
  },
  'servidor: comprovante guardado no bucket privado, régua decide, conferência avisa o Luís; aprovar/recusar/cancelar no despachante': () => {
    const sv = ler('src/lib/estudio/pix-servidor.ts')
    assert.ok(sv.includes('`${pedidoId}/comprovante.${extensaoDoMime(media.mime)}`') && sv.includes('BUCKET_CLIENTES'))
    assert.ok(sv.includes("status: 'aguardando_conferencia'") && sv.includes("pago_por: 'comprovante'"))
    assert.ok(sv.includes('custo_ia_usd') && sv.includes('dadosDeVenda('))
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.ok(ex.includes("case 'comprovante'") && ex.includes("case 'pix'") && ex.includes("renderTexto('resposta_segura'"))
    assert.ok(ex.includes("usou('resposta'") && ex.includes("usou('foto'"))
    const r = ler('src/app/api/estudio/route.ts').split('OPERACOES')[1]
    for (const op of ['aprovarPagamentoPix', 'recusarPagamentoPix', 'cancelarPedidoEstudio', 'listarPixDoDia', 'listarConferenciasPix', 'salvarPixConfig', 'salvarConhecimento', 'custoIaDaConversa']) assert.ok(r.includes(op), op)
    assert.ok(!/^\s*export type \{/m.test(ler('src/app/actions/estudio-pix.ts')))
    assert.ok(!ler('src/lib/estudio/ana/ia.ts').includes('ESTUDIO_MODEL'))
  },
  'SQL da Fase 4: E2E único, colunas de venda, base e custo — nada da seção 4 renomeado': () => {
    const sql = ler('supabase/migrations/20261028000000_estudio_ia_pix.sql')
    assert.ok(!/RENAME|DROP COLUMN|DROP TABLE/i.test(sql))
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON estudio_pedidos \(pix_e2e_id\)/)
    for (const c of ['pix_chave', 'pix_recebedor', 'pago_por', 'forma_pagamento', 'valor_pago_cents', 'comprovante_path', 'origem', 'ad_id', 'veio_de_previa', 'custo_ia_usd']) {
      assert.ok(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`).test(sql), c)
    }
    for (const t of ['estudio_conhecimento', 'estudio_ia_uso']) { assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t); assert.match(sql, new RegExp(`REVOKE ALL ON ${t} FROM anon`)) }
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
