// ============================================================================
// Estúdio IA — Fase 5: fila de produção, contrato com o producao.py do PC,
// motor por API (Gemini), conferência do rosto, ENTREGA AUTOMÁTICA, ajuste
// grátis, "+5 fotos", prévia com marca d'água e prazo. Sem rede de verdade.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import {
  faltaParaFila, mensagemNovoPedido, atrasado, lerNota, melhorTentativa, precisaRefazer, posesPendentes,
  valorComDesconto, podeAjustar, svgMarcaDagua, MARCA_PREVIA,
} from '@/lib/estudio/producao'
import { gerarFotoGemini, testarGemini, notaDoRosto, imagemDaResposta, MODELO_IMAGEM, MODELO_NOTA, PERGUNTA_NOTA } from '@/lib/estudio/gemini'
import { prepararEnvio } from '@/lib/estudio/producao-servidor'
import { proximoPasso, cobrancaDevida, type Contexto, type Dados, type Acao } from '@/lib/estudio/ana/maquina'
import { TEXTOS, IDIOMAS } from '@/lib/estudio/ana/textos'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PRECOS = [[2, 1890], [3, 2990], [5, 4990], [10, 6990], [15, 9890]].map(([q, v]) => ({ pacote_qtd: q, valor_cents: v, moeda: 'BRL' }))
const POSES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'))
const ENTREGA = { pode_ajustar: true, poses: ['03', '07', '12'], upsell_qtd: 5, upsell_valor_cents: 3992, moeda: 'BRL' }
const ctx: Contexto = { idioma: 'pt-BR', precos: PRECOS, posesDoTema: () => POSES, temasAtivos: ['aniversario', 'corporativo', 'casual', 'sensual'], pix: true, entrega: ENTREGA }
const txt = (t: string) => ({ tipo: 'texto', texto: t })
const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)
const PED = { id: 'a1b2c3d4-0000-4000-8000-000000000001', tipo: 'pacote', status: 'pago', cliente_nome: 'Maryana', wa_id: '5521999990000', tema_slug: 'aniversario', pacote_qtd: 3, poses: ['03', '07', '12'], idade: 42, foto_rosto_path: 'x/rosto.jpg', foto_corpo_path: 'x/corpo.jpg' }
const DADOS_ENTREGUE: Dados = { nome: 'Maryana', tema: 'aniversario', pacote_qtd: 3, valor_cents: 2990, moeda: 'BRL', poses: ['03', '07', '12'], tem_rosto: true, tem_corpo: true, idade: 42, cabelo: 'castanho', upsell_oferecido: true, maquiagem: true, decote: false, cores: 'rosa' }

const tests: Record<string, () => void | Promise<void>> = {
  'Luís no comando: cria pedido/prévia pela conversa e, ao devolver, a Ana continua o fluxo': () => {
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.match(ex, /export async function criarPedidoPeloLuis/)
    assert.match(ex, /Esta cliente já recebeu a prévia \(é uma só\)/)
    assert.match(ex, /poses: previa \? poses\.slice\(0, 1\) : poses/)
    assert.match(ex, /entrarNaFila\(admin, p\.id, \{ forcar: true \}\)/)
    assert.match(ex, /etapa: 'aguardando_pagamento', pedido_atual_id: p\.id/)
    assert.match(ex, /export async function retomarConversa/)
    assert.match(ex, /m\.direcao === 'entrada' && m\.tipo === 'texto'/)
    const ch = ler('src/app/actions/estudio-chat.ts')
    assert.match(ch, /if \(quem === 'ana'\) \{[\s\S]*retomarConversa\(admin, tenantId, contatoId\)/)
    const rota = ler('src/app/api/estudio/route.ts')
    assert.equal((rota.match(/criarPedidoManualChat/g) ?? []).length, 2); assert.equal((rota.match(/opcoesPedidoManualChat/g) ?? []).length, 2)
    assert.match(ler('src/app/(dashboard)/estudio-ia/aba-conversas.tsx'), /<CriarPedido contatoId=/)
  },
  'regra do estúdio: UM ajuste só e UMA foto de prévia (IA não oferece 2º ajuste)': () => {
    const ia = ler('src/lib/estudio/ana/ia.ts')
    assert.match(ia, /UM SÓ, em até 24 h/); assert.match(ia, /prévia grátis é de UMA foto só/); assert.match(ia, /JÁ USOU o ajuste grátis/)
    assert.match(ler('src/lib/estudio/ana/executor.ts'), /ajusteUsado: await/)
    assert.match(ler('src/app/actions/estudio-pedidos.ts'), /ajustes_gratis: n\(v\.ajustes_gratis, 0, 1, 1\)/)
    assert.match(ler('src/lib/estudio/producao-servidor.ts'), /Math\.min\(1, Number\(c\.ajustes_gratis/)
    assert.match(ler('src/lib/estudio/ana/maquina.ts'), /poses: previa \? \(d\.poses \?\? \[\]\)\.slice\(0, 1\)/)
  },
  'Gemini: botão de teste gera 1 imagem; modelo "preview" como reserva se o nome principal não existir; sem chave não deixa ligar a API': async () => {
    const urls: string[] = []
    const png = Buffer.from('ok').toString('base64')
    const f = (async (url: string) => {
      urls.push(String(url))
      if (String(url).includes(`/${MODELO_IMAGEM}:`)) return new Response(JSON.stringify({ error: { message: `models/${MODELO_IMAGEM} is not found for API version v1beta` } }), { status: 404 })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png } }] } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const img = await testarGemini('chave-falsa', f)
    assert.equal(img.mime, 'image/png'); assert.equal(urls.length, 2); assert.ok(urls[1].includes(`/${MODELO_IMAGEM}-preview:`))
    // chave inválida NÃO tenta o outro modelo (erro real aparece na tela)
    const ruim = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })) as unknown as typeof fetch
    await assert.rejects(testarGemini('x', ruim), /API key not valid/)
    const act = ler('src/app/actions/estudio-pedidos.ts')
    assert.match(act, /v\.motor === 'api_gemini' && !chave && !process\.env\.GEMINI_API_KEY/)
    assert.match(act, /export async function testarGeminiEstudio/)
    assert.match(ler('src/app/api/estudio/route.ts'), /testarGeminiEstudio/)
  },
  'fila: pago + 2 fotos + poses + idade entra; o que faltar é dito (prévia não pede idade)': () => {
    assert.deepEqual(faltaParaFila(PED), [])
    assert.deepEqual(faltaParaFila({ ...PED, foto_corpo_path: null, poses: ['03'], idade: null }), ['foto de corpo inteiro', 'poses', 'idade'])
    assert.deepEqual(faltaParaFila({ ...PED, tipo: 'previa', pacote_qtd: 1, poses: ['05'], idade: null }), [])
  },
  'aviso "💰 Novo pedido para produzir": nome, tema, nº de fotos, ID e "Abra o Claude Code e peça: gera o pedido <id>"': () => {
    const m = mensagemNovoPedido(PED, 'Aniversário', 'chatgpt_site')
    assert.ok(m.startsWith('💰 Novo pedido para produzir'))
    for (const t of ['Maryana', 'Aniversário', '3 fotos', PED.id, `Abra o Claude Code e peça: gera o pedido ${PED.id}`]) assert.ok(m.includes(t), t)
    const api = mensagemNovoPedido(PED, 'Aniversário', 'api_gemini')
    assert.ok(api.includes('API automática') && !api.includes('Abra o Claude Code'))
    assert.ok(mensagemNovoPedido({ ...PED, tipo: 'previa', poses: ['05'] }, 'Casual', 'chatgpt_site').includes('PRÉVIA'))
  },
  'prazo: passou de 60 min na fila/gerando e ainda não avisou → atrasado (uma vez só)': () => {
    const agora = new Date('2026-10-29T15:00:00Z')
    assert.equal(atrasado({ status: 'aguardando_producao', fila_em: '2026-10-29T13:59:00Z' }, 60, agora), true)
    assert.equal(atrasado({ status: 'gerando', fila_em: '2026-10-29T14:30:00Z' }, 60, agora), false)
    assert.equal(atrasado({ status: 'gerando', fila_em: '2026-10-29T13:00:00Z', atraso_avisado_em: '2026-10-29T14:01:00Z' }, 60, agora), false)
    assert.equal(atrasado({ status: 'entregue', fila_em: '2026-10-29T10:00:00Z' }, 60, agora), false)
    assert.equal(atrasado({ status: 'aguardando_producao', fila_em: null, pago_em: '2026-10-29T13:00:00Z' }, 60, agora), true)
  },
  'conferência do rosto: nota 0–10, < 7 gera de novo, fica a melhor': () => {
    assert.equal(lerNota('8'), 8); assert.equal(lerNota('Nota: 6,5/10'), 6.5); assert.equal(lerNota('sem número'), null); assert.equal(lerNota('42'), null)
    assert.equal(precisaRefazer(6.9), true); assert.equal(precisaRefazer(7), false); assert.equal(precisaRefazer(null), false)
    assert.equal(melhorTentativa([{ nota: 5, id: 'a' }, { nota: 8, id: 'b' }]).id, 'b')
    assert.equal(melhorTentativa([{ nota: null, id: 'a' }, { nota: 3, id: 'b' }]).id, 'b')
  },
  'poses pendentes: pacote gera as que faltam; ajuste só as pedidas, depois do pedido de ajuste': () => {
    const ents = [{ pose_numero: '03', status: 'aprovada', criado_em: '2026-10-29T10:00:00Z' }]
    assert.deepEqual(posesPendentes({ poses: ['03', '07', '12'], status: 'aguardando_producao' }, ents), ['07', '12'])
    const ajuste = { poses: ['03', '07', '12'], status: 'ajuste', ajuste_poses: ['03'] }
    assert.deepEqual(posesPendentes(ajuste, ents, '2026-10-29T12:00:00Z'), ['03'])
    assert.deepEqual(posesPendentes(ajuste, [...ents, { pose_numero: '03', status: 'aprovada', criado_em: '2026-10-29T12:05:00Z' }], '2026-10-29T12:00:00Z'), [])
    assert.deepEqual(posesPendentes({ poses: ['03'], status: 'aguardando_producao' }, [{ pose_numero: '03', status: 'refazer' }]), ['03'])
  },
  'ajuste grátis vale 24 h e o limite configurado; oferta +5 com 20% off': () => {
    const agora = new Date('2026-10-29T15:00:00Z')
    assert.equal(podeAjustar({ entregue_em: '2026-10-29T10:00:00Z', ajustes_usados: 0 }, 1, agora), true)
    assert.equal(podeAjustar({ entregue_em: '2026-10-28T10:00:00Z', ajustes_usados: 0 }, 1, agora), false)
    assert.equal(podeAjustar({ entregue_em: '2026-10-29T10:00:00Z', ajustes_usados: 1 }, 1, agora), false)
    assert.equal(podeAjustar({ entregue_em: null }, 1, agora), false)
    assert.equal(valorComDesconto(4990, 20), 3992); assert.equal(valorComDesconto(1890, 0), 1890)
  },
  'Ana pós-entrega: "foto 03, cabelo mais claro" vira ajuste e volta para a fila': () => {
    const r = proximoPasso('entregue', DADOS_ENTREGUE, txt('quero ajustar a foto 03, deixa o cabelo mais claro'), ctx)
    assert.equal(r.etapa, 'pago')
    const a = r.acoes[0] as Extract<Acao, { t: 'ajuste' }>
    assert.equal(a.t, 'ajuste'); assert.deepEqual(a.poses, ['03']); assert.match(a.obs, /cabelo mais claro/)
    assert.deepEqual(chaves(r.acoes), ['ajuste', 'texto:ajuste_registrado'])
  },
  'Ana pós-entrega: pede o número, depois o que mudar; foto que não é do pedido não conta': () => {
    const s1 = proximoPasso('entregue', DADOS_ENTREGUE, txt('não gostei de uma'), ctx)
    assert.equal(s1.etapa, 'ajuste_detalhe'); assert.deepEqual(chaves(s1.acoes), ['texto:ajuste_pede_numero'])
    const s2 = proximoPasso('ajuste_detalhe', s1.dados, txt('a 07'), ctx)
    assert.equal(s2.etapa, 'ajuste_detalhe'); assert.deepEqual(chaves(s2.acoes), ['texto:ajuste_pede_o_que']); assert.deepEqual(s2.dados.ajuste_poses, ['07'])
    const s3 = proximoPasso('ajuste_detalhe', s2.dados, txt('quero o vestido vermelho'), ctx)
    assert.equal(s3.etapa, 'pago'); assert.deepEqual((s3.acoes[0] as Extract<Acao, { t: 'ajuste' }>).poses, ['07'])
    const fora = proximoPasso('ajuste_detalhe', {}, txt('a 19'), ctx)
    assert.deepEqual(chaves(fora.acoes), ['texto:ajuste_pede_numero'])
  },
  'Ana pós-entrega: ajuste vencido → avisa e chama a equipe; dúvida comum → IA': () => {
    const v = proximoPasso('entregue', DADOS_ENTREGUE, txt('refaz a foto 03 por favor, ficou estranha'), { ...ctx, entrega: { ...ENTREGA, pode_ajustar: false } })
    assert.deepEqual(chaves(v.acoes), ['texto:ajuste_expirado', 'humano'])
    assert.deepEqual(chaves(proximoPasso('entregue', DADOS_ENTREGUE, txt('posso postar no instagram?'), ctx).acoes), ['ia'])
  },
  '"+5 fotos com 20% off": aceita, usa as mesmas fotos, escolhe poses e fecha com Pix do valor com desconto': () => {
    const u = proximoPasso('entregue', DADOS_ENTREGUE, txt('quero mais!'), ctx)
    assert.equal(u.etapa, 'fotos_poses'); assert.deepEqual(chaves(u.acoes), ['upsell', 'texto:upsell_poses'])
    assert.equal(u.dados.pacote_qtd, 5); assert.equal(u.dados.valor_cents, 3992); assert.equal(u.dados.tem_rosto, true)
    const f = proximoPasso('fotos_poses', u.dados, txt('01, 02, 04, 05 e 06'), ctx)
    assert.equal(f.etapa, 'aguardando_pagamento'); assert.ok(f.acoes.some(a => a.t === 'pix'))
    assert.deepEqual(chaves(proximoPasso('entregue', DADOS_ENTREGUE, txt('sim'), ctx).acoes), ['upsell', 'texto:upsell_poses'])
  },
  'pós-entrega sem cobranças automáticas': () => {
    const base = { modo: 'ana', cobrancas: 0, janela_ate: '2099-01-01T00:00:00Z', aguardando_desde: '2026-10-29T10:00:00Z', ultima_cliente_em: null }
    assert.equal(cobrancaDevida({ ...base, etapa: 'entregue' }, new Date('2026-10-29T15:00:00Z')), null)
    assert.equal(cobrancaDevida({ ...base, etapa: 'ajuste_detalhe' }, new Date('2026-10-29T15:00:00Z')), null)
  },
  'Gemini (seção 8b): gemini-3-pro-image, [prompt, rosto, corpo], 4:5 2K, imagem em inlineData': async () => {
    let req: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null
    const png = await sharp({ create: { width: 8, height: 10, channels: 3, background: '#f00' } }).png().toBuffer()
    const f = (async (url: string, i: RequestInit) => {
      req = { url, headers: i.headers as Record<string, string>, body: JSON.parse(String(i.body)) }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }))
    }) as unknown as typeof fetch
    const img = await gerarFotoGemini('PROMPT', { bytes: new Uint8Array([1]), mime: 'image/jpeg' }, { bytes: new Uint8Array([2]), mime: 'image/jpeg' }, 'chave-falsa', f)
    assert.equal(req!.url, `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IMAGEM}:generateContent`)
    assert.equal(MODELO_IMAGEM, 'gemini-3-pro-image'); assert.equal(req!.headers['x-goog-api-key'], 'chave-falsa')
    const parts = (req!.body.contents as { parts: Record<string, { data?: string }>[] }[])[0].parts
    assert.equal((parts[0] as unknown as { text: string }).text, 'PROMPT')
    assert.equal(parts[1].inline_data.data, Buffer.from([1]).toString('base64')); assert.equal(parts[2].inline_data.data, Buffer.from([2]).toString('base64'))
    assert.deepEqual(req!.body.generationConfig, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5', imageSize: '2K' } })
    assert.equal(img.mime, 'image/png'); assert.equal(Buffer.from(img.bytes).length, png.length)
    assert.equal(imagemDaResposta({ candidates: [{ content: { parts: [{ text: 'sem imagem' }] } }] }), null)
  },
  'nota do rosto: gemini-2.5-flash com a pergunta da seção 8b; erro não trava a entrega': async () => {
    let corpo: Record<string, unknown> = {}
    const ok = (async (url: string, i: RequestInit) => { assert.ok(url.includes(MODELO_NOTA)); corpo = JSON.parse(String(i.body)); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '8' }] } }] })) }) as unknown as typeof fetch
    const img = { bytes: new Uint8Array([1]), mime: 'image/png' }
    assert.equal(await notaDoRosto(img, img, 'k', ok), 8)
    assert.ok(JSON.stringify(corpo).includes(PERGUNTA_NOTA)); assert.equal(MODELO_NOTA, 'gemini-2.5-flash')
    const quebra = (async () => new Response('{"error":{"message":"quota"}}', { status: 429 })) as unknown as typeof fetch
    assert.equal(await notaDoRosto(img, img, 'k', quebra), null)
  },
  'entrega: JPEG ≤ 1600×2000 para o WhatsApp; prévia sai com a marca "PRÉVIA · Studio Fotografico"': async () => {
    const png = await sharp({ create: { width: 2048, height: 2560, channels: 3, background: '#336699' } }).png().toBuffer()
    const normal = await prepararEnvio(png, false); const previa = await prepararEnvio(png, true)
    const mn = await sharp(normal).metadata(); const mp = await sharp(previa).metadata()
    assert.equal(mn.format, 'jpeg'); assert.ok((mn.width ?? 0) <= 1600 && (mn.height ?? 0) <= 2000)
    assert.equal(mp.width, mn.width)
    const [a, b] = await Promise.all([sharp(normal).raw().toBuffer(), sharp(previa).raw().toBuffer()])
    let dif = 0; for (let i = 0; i < a.length; i += 97) if (Math.abs(a[i] - b[i]) > 20) dif++
    assert.ok(dif > 50, 'a marca d\'água precisa aparecer')
    assert.equal(MARCA_PREVIA, 'PRÉVIA · Studio Fotografico'); assert.ok(svgMarcaDagua(100, 120).includes('PRÉVIA · Studio Fotografico')); assert.ok(!/<text/.test(svgMarcaDagua(800, 1000)), 'sem <text>: o servidor não tem fontes'); assert.match(svgMarcaDagua(800, 1000), /<path d="M/)
  },
  'contrato com o producao.py: caminhos, status e entrega automática por trava': () => {
    const sv = ler('src/lib/estudio/producao-servidor.ts')
    assert.ok(sv.includes('const caminho = `${pedidoId}/${numero}.png`') && sv.includes('BUCKET_ENTREGAS'))
    assert.ok(sv.includes(".eq('status', 'pronto').is('entrega_iniciada_em', null)"), 'trava contra entrega dupla')
    assert.ok(sv.includes(".eq('status', 'aprovada').is('enviada_em', null)"), 'só envia o que o PC subiu como aprovada')
    assert.ok(sv.includes("status: 'entregue', entregue_em"))
    assert.ok(sv.includes("status: 'aguardando_producao', fila_em"))
    assert.ok(sv.includes("status: 'ajuste', ajustes_usados") && sv.includes('observacoes_ajuste'))
    assert.ok(sv.includes("'a6|") || sv.includes('`a6|${idioma}`'))
    assert.ok(ler('src/lib/estudio/catalogo.ts').includes('rosto: `${pedidoId}/rosto.jpg`, corpo: `${pedidoId}/corpo.jpg`'))
    assert.ok(ler('src/lib/estudio/pix-servidor.ts').includes('entrarNaFila(admin, pedidoId)'))
    assert.ok(ler('src/proxy.ts').includes("'/api/cron/estudio-producao'"))
    assert.match(ler('src/app/api/cron/estudio-producao/route.ts'), /maxDuration = 300/)
  },
  'chave do Gemini nunca volta para a tela; despachante conhece as ações de Pedidos': () => {
    const a = ler('src/app/actions/estudio-pedidos.ts')
    assert.ok(!/^\s*export type \{/m.test(a))
    assert.ok(a.includes('gemini_api_key: _x') && a.includes('tem_chave_gemini'))
    assert.ok(!/return \{[^}]*gemini_api_key:/.test(a.split('export async function lerProducaoConfig')[1].split('export async function salvarProducaoConfig')[0]))
    const r = ler('src/app/api/estudio/route.ts').split('OPERACOES')[1]
    for (const op of ['listarPedidosEstudio', 'abrirPedidoEstudio', 'gerarPorApiAgora', 'aprovarEntregaEstudio', 'refazerPedidoEstudio', 'reenviarEntregaEstudio', 'lerProducaoConfig', 'salvarProducaoConfig']) assert.ok(r.includes(op), op)
  },
  'textos da entrega/ajuste/oferta/atraso nos 4 idiomas': () => {
    for (const k of ['entrega_ajuste', 'upsell_oferta', 'upsell_poses', 'previa_entregue', 'ajuste_pede_numero', 'ajuste_pede_o_que', 'ajuste_registrado', 'ajuste_expirado', 'atraso']) {
      for (const i of IDIOMAS) assert.ok(TEXTOS[k]?.[i]?.trim(), `${k}/${i}`)
    }
    assert.ok(TEXTOS.upsell_oferta['pt-BR'].includes('{desconto}') && TEXTOS.upsell_oferta['pt-BR'].includes('{valor}'))
  },
  'SQL da Fase 5: só colunas novas, motor com CHECK, robô por minuto só com trabalho': () => {
    const sql = ler('supabase/migrations/20261029000000_estudio_ia_producao.sql')
    assert.ok(!/RENAME|DROP COLUMN|DROP TABLE/i.test(sql))
    for (const c of ['motor', 'aprovacao_manual', 'gemini_api_key', 'prazo_min', 'ajustes_gratis', 'fila_em', 'atraso_avisado_em', 'entrega_iniciada_em', 'ajuste_poses', 'envio_path', 'enviada_em']) {
      assert.ok(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`).test(sql), c)
    }
    assert.match(sql, /CHECK \(motor IN \('chatgpt_site', 'api_gemini'\)\)/)
    assert.match(sql, /cron\.schedule\('estudio-producao', '\* \* \* \* \*'/)
    assert.match(sql, /REVOKE ALL ON estudio_config FROM anon, authenticated/)
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
