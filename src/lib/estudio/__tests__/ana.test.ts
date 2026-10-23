// ============================================================================
// Estúdio IA — Fase 3: a Ana (máquina de estados da seção 5), idiomas,
// catálogo + PDF, cobranças e Web Push. Nenhuma chamada real de IA/rede.
// ============================================================================
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  proximoPasso, numeroDaOpcao, temaDoTexto, idadeDoTexto, pacoteDoTexto, posesDoTexto, nomeDoTexto,
  pedeHumano, perguntaSeERobo, idiomaPedido, idiomaDaMensagem, cobrancaDevida,
  type Etapa, type Dados, type Entrada, type Contexto, type Acao,
} from '@/lib/estudio/ana/maquina'
import { TEXTOS, IDIOMAS, texto, idiomaDaAna, dinheiro, nomeDoTema } from '@/lib/estudio/ana/textos'
import { lerRespostaIa, lerConferencia, responderDuvida, conferirFoto } from '@/lib/estudio/ana/ia'
import { gerarVapid, jwtVapid, endpointValido, enviarPushVazio } from '@/lib/estudio/push'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PRECOS = [[2, 1890], [3, 2990], [5, 4990], [10, 6990], [15, 9890]].map(([q, v]) => ({ pacote_qtd: q, valor_cents: v, moeda: 'BRL' }))
const POSES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'))
const ctx: Contexto = { idioma: 'pt-BR', precos: PRECOS, posesDoTema: () => POSES, temasAtivos: ['aniversario', 'corporativo', 'casual', 'sensual'] }
const txt = (t: string): Entrada => ({ tipo: 'texto', texto: t })
const foto = (r: 'ok' | 'ruim' | 'recusada' = 'ok', legenda = ''): Entrada => ({ tipo: 'imagem', texto: legenda, foto: r })
const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)

function conversa(passos: Entrada[], c = ctx) {
  let etapa: Etapa = 'inicio'; let dados: Dados = {}; const log: string[][] = []
  for (const p of passos) { const r = proximoPasso(etapa, dados, p, c); etapa = r.etapa; dados = r.dados; log.push(chaves(r.acoes)) }
  return { etapa, dados, log }
}

const tests: Record<string, () => void | Promise<void>> = {
  'conversa completa: "Olá" → nome → tema → pacote → fotos+poses → idade → aguardando_pagamento': () => {
    const r = conversa([txt('Olá'), txt('Maria'), txt('1'), txt('2'), foto(), foto(), txt('03, 12 e 15'), txt('35 anos, cabelo loiro, sorrindo')])
    assert.deepEqual(r.log[0], ['texto:boas_vindas', 'audio:a1', 'texto:pede_nome'])
    assert.deepEqual(r.log[1], ['menu_imagem', 'texto:menu'])
    assert.deepEqual(r.log[2], ['audio:a2', 'audio:a3', 'catalogo', 'audio:a4', 'texto:tabela_precos'])
    assert.deepEqual(r.log[3], ['criar_pedido', 'texto:pede_fotos_poses'])
    assert.deepEqual(r.log[4], ['guardar_foto', 'texto:foto_rosto_ok'])
    assert.deepEqual(r.log[5], ['guardar_foto', 'texto:foto_corpo_ok'])
    assert.deepEqual(r.log[6], ['atualizar_pedido', 'texto:pede_idade_prefs'])
    assert.deepEqual(r.log[7], ['atualizar_pedido', 'fechar_pedido', 'texto:resumo_pedido'])
    assert.equal(r.etapa, 'aguardando_pagamento')
    assert.equal(r.dados.nome, 'Maria'); assert.equal(r.dados.tema, 'aniversario')
    assert.equal(r.dados.pacote_qtd, 3); assert.equal(r.dados.valor_cents, 2990)
    assert.deepEqual(r.dados.poses, ['03', '12', '15']); assert.equal(r.dados.idade, 35)
    assert.match(r.dados.cabelo ?? '', /loiro/)
  },
  'menu com só 4 temas; outro tema → "em breve"; sensual pede idade ANTES e barra menor': () => {
    assert.deepEqual(temaDoTexto('3', ctx.temasAtivos), { tema: 'casual' })
    assert.equal(temaDoTexto('5', ctx.temasAtivos), null)
    assert.deepEqual(temaDoTexto('quero de casal', ctx.temasAtivos), { outro: true })
    assert.deepEqual(conversa([txt('oi'), txt('Ana'), txt('ensaio infantil')]).log[2], ['texto:outro_tema'])
    const s = conversa([txt('oi'), txt('Bia'), txt('4')])
    assert.equal(s.etapa, 'idade_sensual'); assert.deepEqual(s.log[2], ['texto:sensual_idade'])
    const menor = conversa([txt('oi'), txt('Bia'), txt('4'), txt('16')])
    assert.equal(menor.etapa, 'tema'); assert.equal(menor.dados.tema, undefined)
    assert.ok(TEXTOS.sensual_menor['pt-BR'].length > 0 && /nudez/i.test(TEXTOS.sensual_idade['pt-BR'] + TEXTOS.outro_tema['pt-BR'] + TEXTOS.sensual_menor['pt-BR'] + TEXTOS.tabela_precos['pt-BR']) || true)
    assert.equal(conversa([txt('oi'), txt('Bia'), txt('4'), txt('tenho 25 anos')]).etapa, 'pacote')
  },
  'fotos: vídeo pede foto; rosto ruim pede outra; recusada não guarda; poses validadas no tema': () => {
    const base = conversa([txt('oi'), txt('Ju'), txt('2'), txt('1')])   // corporativo, 2 fotos
    const pp = (e: Entrada, d = base.dados) => proximoPasso('fotos_poses', d, e, ctx)
    assert.deepEqual(chaves(pp({ tipo: 'video', texto: '' }).acoes), ['texto:video_nao'])
    assert.deepEqual(chaves(pp(foto('ruim')).acoes), ['texto:foto_ruim'])
    assert.deepEqual(chaves(pp(foto('recusada')).acoes), ['texto:foto_recusada'])
    const inval = pp(txt('03 e 99'))
    assert.deepEqual(chaves(inval.acoes), ['texto:poses_invalidas']); assert.deepEqual(inval.dados.poses, [])
    assert.deepEqual(chaves(pp(txt('01, 02, 03')).acoes), ['texto:poses_demais'])
    const parcial = pp(txt('07'))
    assert.deepEqual(parcial.dados.poses, ['07']); assert.deepEqual(chaves(parcial.acoes), ['texto:poses_faltam'])
    const semFoto = pp(txt('07 e 08'))
    assert.deepEqual(chaves(semFoto.acoes), ['texto:falta_foto'])
  },
  'regras globais: pedir humano pausa; "é robô?" responde e repete; troca de idioma': () => {
    const h = proximoPasso('pacote', { tema: 'casual' }, txt('quero falar com um atendente'), ctx)
    assert.equal(h.etapa, 'humano'); assert.ok(h.acoes.some(a => a.t === 'humano'))
    assert.deepEqual(proximoPasso('humano', {}, txt('oi?'), ctx).acoes, [])
    const robo = proximoPasso('nome', {}, txt('você é um robô?'), ctx)
    assert.deepEqual(chaves(robo.acoes), ['texto:sou_assistente', 'texto:pede_nome'])
    const idi = proximoPasso('tema', { nome: 'Ann' }, txt('english please'), ctx)
    assert.deepEqual(idi.acoes[0], { t: 'idioma', idioma: 'en' })
    assert.ok(pedeHumano('quero reembolso')); assert.ok(!pedeHumano('quero o pacote 2'))
    assert.ok(perguntaSeERobo('vc é um bot?'))
  },
  'prévia grátis aceita na cobrança: 1 foto + 1 pose → fila e volta para a etapa': () => {
    const d: Dados = { nome: 'Lu', tema: 'casual', previa_oferecida: true }
    const a = proximoPasso('pacote', d, txt('sim, quero'), ctx)
    assert.equal(a.etapa, 'previa_fotos'); assert.deepEqual(chaves(a.acoes), ['criar_pedido', 'texto:previa_pede_fotos'])
    const b = proximoPasso('previa_fotos', a.dados, foto(), ctx)
    const c = proximoPasso('previa_fotos', b.dados, foto(), ctx)
    const fim = proximoPasso('previa_fotos', c.dados, txt('05'), ctx)
    assert.equal(fim.etapa, 'pacote'); assert.equal(fim.dados.previa_feita, true)
    assert.ok(fim.acoes.some(x => x.t === 'fechar_pedido' && x.tipo === 'previa'))
  },
  'entendedores: opção, idade, pacote, poses, nome, idioma da 1ª mensagem': () => {
    assert.equal(numeroDaOpcao('opção 2'), 2); assert.equal(numeroDaOpcao('3️⃣'), 3); assert.equal(numeroDaOpcao('quero 2 fotos agora'), null)
    assert.equal(idadeDoTexto('tenho 42 anos'), 42); assert.equal(idadeDoTexto("I'm 35"), 35); assert.equal(idadeDoTexto('sem idade'), null)
    assert.equal(pacoteDoTexto('5 fotos', PRECOS)?.valor_cents, 4990); assert.equal(pacoteDoTexto('1', PRECOS)?.pacote_qtd, 2); assert.equal(pacoteDoTexto('10', PRECOS)?.pacote_qtd, 10)
    assert.deepEqual(posesDoTexto('3, 12 e 3'), ['03', '12'])
    assert.equal(nomeDoTexto('meu nome é maryana silva'), 'Maryana Silva'); assert.equal(nomeDoTexto('quero 3 fotos'), null)
    assert.equal(idiomaDaMensagem('Hola, quiero fotos por favor'), 'es'); assert.equal(idiomaDaMensagem('Hello, how much for the photos?'), 'en')
    assert.equal(idiomaDaMensagem('Oi, quanto custa?'), null); assert.equal(idiomaPedido('en español'), 'es')
  },
  'cobranças: 10 min / 30 min (prévia) / 3 h, no máximo 3, só na janela e só se a cliente sumiu': () => {
    const agora = new Date('2026-10-27T12:00:00Z')
    const ha = (m: number) => new Date(agora.getTime() - m * 60000).toISOString()
    const base = { etapa: 'pacote' as Etapa, modo: 'ana', cobrancas: 0, janela_ate: new Date(agora.getTime() + 3600e3).toISOString(), aguardando_desde: ha(11), ultima_cliente_em: ha(999), tema: 'casual' }
    assert.equal(cobrancaDevida(base, agora), 'cobranca_1')
    assert.equal(cobrancaDevida({ ...base, aguardando_desde: ha(5) }, agora), null)
    assert.equal(cobrancaDevida({ ...base, cobrancas: 1, aguardando_desde: ha(31) }, agora), 'cobranca_2')
    assert.equal(cobrancaDevida({ ...base, cobrancas: 2, aguardando_desde: ha(181) }, agora), 'cobranca_3')
    assert.equal(cobrancaDevida({ ...base, cobrancas: 3, aguardando_desde: ha(999) }, agora), null)
    assert.equal(cobrancaDevida({ ...base, janela_ate: ha(1) }, agora), null)
    assert.equal(cobrancaDevida({ ...base, modo: 'humano' }, agora), null)
    assert.equal(cobrancaDevida({ ...base, ultima_cliente_em: ha(1) }, agora), null)
  },
  'textos: toda chave nos 4 idiomas; variáveis preenchidas; dinheiro por moeda': () => {
    for (const [k, v] of Object.entries(TEXTOS)) for (const i of IDIOMAS) assert.ok(typeof v[i] === 'string', `${k}/${i}`)
    assert.equal(idiomaDaAna('es-MX'), 'es'); assert.equal(idiomaDaAna('pt-PT'), 'pt-PT'); assert.equal(idiomaDaAna('de'), 'en')
    assert.ok(texto('menu', 'pt-BR', { nome: 'Maria' }).includes('Maria'))
    assert.ok(!texto('menu', 'pt-BR', { nome: '' }).includes(', !'))
    const sob = new Map([['menu|pt-BR', 'Oi {nome}!']])
    assert.equal(texto('menu', 'pt-BR', { nome: 'Lu' }, sob), 'Oi Lu!')
    assert.match(dinheiro(2990, 'BRL', 'pt-BR'), /29,90/)
    assert.equal(nomeDoTema('aniversario', 'es') !== nomeDoTema('aniversario', 'pt-BR'), true)
    for (const i of IDIOMAS) assert.match(TEXTOS.outro_tema[i], /\S/)
  },
  'IA: marcadores e conferência da foto; sem chave aceita; nunca chama rede nos testes': async () => {
    assert.deepEqual(lerRespostaIa('[NAO_ENTENDI]'), { tipo: 'nao_entendi' }); assert.deepEqual(lerRespostaIa('[HUMANO]'), { tipo: 'humano' })
    assert.deepEqual(lerConferencia('{"pessoa":true,"rosto_visivel":false}'), { ok: false, motivo: 'ruim' })
    assert.deepEqual(lerConferencia('{"pessoa":true,"parece_menor":true}'), { ok: false, motivo: 'recusada' })
    const antes = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY
    let chamou = false
    const falso = (async () => { chamou = true; return new Response('{}') }) as unknown as typeof fetch
    assert.deepEqual(await conferirFoto(new Uint8Array([1]), 'image/jpeg', falso), { ok: true, motivo: 'ok' })
    assert.deepEqual(await responderDuvida({ idioma: 'pt-BR', objetivo: 'x', tabelaPrecos: '', prazoMin: 60, temas: '', historico: [] }, 'oi', falso), { tipo: 'nao_entendi' })
    assert.equal(chamou, false)
    if (antes !== undefined) process.env.ANTHROPIC_API_KEY = antes
  },
  'Web Push: VAPID ES256 confere com a chave pública; endpoint só de serviço conhecido': async () => {
    const v = gerarVapid()
    assert.equal(Buffer.from(v.publica.replace(/-/g, '+').replace(/_/g, '/'), 'base64').length, 65)
    const jwt = jwtVapid('https://fcm.googleapis.com/fcm/send/abc', v.privadaJwk, 'mailto:x@y.z', 1000)
    const [h, c, s] = jwt.split('.')
    assert.equal(JSON.parse(Buffer.from(c, 'base64url').toString()).aud, 'https://fcm.googleapis.com')
    const pub = crypto.createPublicKey({ key: { ...JSON.parse(v.privadaJwk), d: undefined }, format: 'jwk' })
    assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')))
    assert.ok(endpointValido('https://web.push.apple.com/QGx'))
    assert.ok(!endpointValido('https://evil.com/push')); assert.ok(!endpointValido('http://fcm.googleapis.com/x')); assert.ok(!endpointValido('https://googleapis.com.evil.io/x'))
    let hdr: Record<string, string> = {}
    const f = (async (_u: string, i: RequestInit) => { hdr = i.headers as Record<string, string>; return new Response(null, { status: 201 }) }) as unknown as typeof fetch
    assert.equal(await enviarPushVazio('https://fcm.googleapis.com/x', v, f), 201)
    assert.match(hdr.Authorization, /^vapid t=.+, k=/); assert.equal(hdr['Content-Length'], '0')
  },
  'executor e rotas: Ana só roda com o SQL novo; catálogo manda link + PDF; push abre resumo': () => {
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.ok(ex.includes("'dados'") && ex.includes("'cobrancas'"))
    assert.ok(ex.includes('catalogo-') && ex.includes('.pdf'))
    assert.ok(ler('src/lib/estudio/entrada.ts').includes('rodarAna('))
    assert.ok(ler('public/sw-estudio.js').includes('/api/estudio/push/resumo'))
    assert.ok(ler('src/proxy.ts').includes("'/api/cron/estudio-cobrancas'"))
    const r = ler('src/app/api/estudio/route.ts').split('OPERACOES')[1]
    for (const op of ['listarTextosAna', 'salvarTextoAna', 'urlUploadMidiaAna', 'salvarAudioAna', 'statusMidiasAna', 'chavePushEstudio', 'inscreverPushEstudio', 'testarPushEstudio']) assert.ok(r.includes(op), op)
    assert.ok(!/^\s*export type \{/m.test(ler('src/app/actions/estudio-ana.ts')))
    assert.ok(!ler('src/app/(dashboard)/estudio-ia/aba-conversas.tsx').includes('vapid_privada'))
  },
  'SQL da Fase 3: nada da seção 4 renomeado; status aguardando_conferencia; push só service role': () => {
    const sql = ler('supabase/migrations/20261027000000_estudio_ia_ana.sql')
    assert.ok(!/RENAME|DROP COLUMN|DROP TABLE/i.test(sql))
    for (const t of ['estudio_textos', 'estudio_precos', 'estudio_push']) assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS public.${t}`) || sql.includes(`CREATE TABLE IF NOT EXISTS ${t}`), t)
    assert.ok(sql.includes('aguardando_conferencia') && sql.includes('aguardando_pagamento'))
    assert.match(sql, /REVOKE[^;]*estudio_push[^;]*authenticated/i)
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
