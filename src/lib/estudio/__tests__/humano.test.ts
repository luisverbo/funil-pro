// ============================================================================
// Estúdio IA — Ana humanizada: atraso, voz nativa, "digitando…", confirmações
// sem resposta, pacotes por número/quantidade/preço, fotos classificadas
// (nunca pela ordem, nunca o mesmo arquivo), preferências uma por vez, fila
// por conversa, avisos registrados e tempos. Sem rede de verdade.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  atrasoDeTexto, atrasoDeAudio, atrasoDeMidia, esperaRestante, corpoAudioDeVoz, corpoLidoDigitando, corpoReacao,
  enviarVoz, ehSoConfirmacao, ATRASO_MIN_MS,
} from '@/lib/estudio/envio'
import { proximoPasso, escolhaDePacote, aplicarPreferencias, proximaPreferencia, ehConfirmacao, type Contexto, type Dados, type Acao, type Entrada } from '@/lib/estudio/ana/maquina'
import { escolherFotos, resumoDasFotos, caixaDoRecorte, type FotoRecebida } from '@/lib/estudio/ana/fotos'
import { lerClasse, classificarFoto, lerPreferencias, MODELO_RAPIDO } from '@/lib/estudio/ana/ia'
import { agrupar, esperaPorMidia, ehFoto, ESPERA_MIDIA_MS } from '@/lib/estudio/ana/fila'
import { variantesDoNumero, linhaDoModelo } from '@/lib/estudio/avisos'
import { Cronometro, textoDosTempos } from '@/lib/estudio/tempos'
import { TEXTOS, IDIOMAS } from '@/lib/estudio/ana/textos'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PRECOS = [[2, 1890], [3, 2990], [5, 4990], [10, 6990], [15, 9890]].map(([q, v]) => ({ pacote_qtd: q, valor_cents: v, moeda: 'BRL' }))
const POSES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'))
const ctx: Contexto = { idioma: 'pt-BR', precos: PRECOS, posesDoTema: () => POSES, temasAtivos: ['aniversario', 'corporativo', 'casual', 'sensual'], pix: true }
const txt = (t: string): Entrada => ({ tipo: 'texto', texto: t })
const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)
const foto = (path: string, tipo: FotoRecebida['tipo'], fracao: number, extra: Partial<FotoRecebida> = {}): FotoRecebida => ({ path, tipo, fracao_corpo: fracao, ...extra })

const tests: Record<string, () => void | Promise<void>> = {
  'atraso do texto: 1,2 s + 35 ms/letra, ±20%, entre 1,5 s e o máximo (6 s)': () => {
    assert.equal(atrasoDeTexto('oi', 6000, 0.5), ATRASO_MIN_MS)                       // curta → piso 1,5 s
    assert.equal(atrasoDeTexto('a'.repeat(100), 6000, 0.5), 4700)                    // 1200 + 3500
    assert.equal(atrasoDeTexto('a'.repeat(100), 6000, 0), Math.round(4700 * 0.8))    // −20%
    assert.equal(atrasoDeTexto('a'.repeat(100), 6000, 0.999999), Math.round(4700 * 1.2 - 4700 * 0.4 * 0.000001))
    assert.equal(atrasoDeTexto('a'.repeat(400), 6000, 0.5), 6000)                    // longa → teto
    assert.equal(atrasoDeTexto('a'.repeat(400), 4000, 0.5), 4000)                    // teto configurável
    assert.equal(atrasoDeTexto('😍😍', 6000, 0.5), ATRASO_MIN_MS)                       // emoji conta como 1 caractere
    for (let i = 0; i < 50; i++) { const v = atrasoDeTexto('olá tudo bem com você', 6000); assert.ok(v >= 1500 && v <= 6000) }
  },
  'atraso de áudio 3–5 s, foto/PDF 1,5–2,5 s; o que já demorou desconta (nunca soma)': () => {
    assert.equal(atrasoDeAudio(0), 3000); assert.equal(atrasoDeAudio(0.999), 4998)
    assert.equal(atrasoDeMidia(0), 1500); assert.equal(atrasoDeMidia(0.5), 2000)
    assert.equal(esperaRestante(3000, 1000), 2000)
    assert.equal(esperaRestante(3000, 4500), 0)   // processamento passou do atraso → envia na hora
  },
  'áudio como MENSAGEM DE VOZ: {"type":"audio","audio":{"id":…,"voice":true}} (e voice:true no link)': () => {
    assert.deepEqual(corpoAudioDeVoz('5521999', { id: 'MID1' }), { messaging_product: 'whatsapp', to: '5521999', type: 'audio', audio: { id: 'MID1', voice: true } })
    assert.deepEqual(corpoAudioDeVoz('5521999', { link: 'https://x/a1.ogg' }).audio, { link: 'https://x/a1.ogg', voice: true })
    assert.deepEqual(corpoLidoDigitando('wamid.X'), { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.X', typing_indicator: { type: 'text' } })
    assert.deepEqual(corpoReacao('5521999', 'wamid.X', '❤️').reaction, { message_id: 'wamid.X', emoji: '❤️' })
  },
  'enviarVoz: sobe o OGG em /media uma vez, guarda o media_id (30 dias) e manda pelo id': async () => {
    const cache = new Map<string, { media_id: string; criado_em: string }>()
    const tabela = {
      select: () => tabela, eq: () => tabela, delete: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }) }),
      maybeSingle: async () => ({ data: cache.get('k') ?? null }),
      upsert: (r: { media_id: string; criado_em: string }) => { cache.set('k', r); return Promise.resolve({}) },
    }
    const admin = { from: () => tabela } as unknown as Parameters<typeof enviarVoz>[0]
    const chamadas: string[] = []; const corpos: unknown[] = []
    const f = (async (url: string, i: RequestInit) => {
      chamadas.push(url.replace(/^.*v\d+\.\d+/, ''))
      if (url.endsWith('/media')) return new Response(JSON.stringify({ id: 'MEDIA123' }))
      corpos.push(JSON.parse(String(i.body)))
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.OUT' }] }))
    }) as unknown as typeof fetch
    let baixou = 0
    const fonte = { chave: 'estudio-catalogo/midias/pt-BR/a1.ogg', link: 'https://x/a1.ogg', baixar: async () => { baixou++; return { bytes: new Uint8Array([1, 2]), mime: 'audio/ogg' } } }
    const r1 = await enviarVoz(admin, 't1', { phone_number_id: 'PN', access_token: 'tok' }, '5521999', fonte, f)
    assert.equal(r1.ok, true); assert.equal(r1.via, 'id')
    assert.deepEqual(chamadas, ['/PN/media', '/PN/messages'])
    assert.deepEqual((corpos[0] as { audio: unknown }).audio, { id: 'MEDIA123', voice: true })
    await enviarVoz(admin, 't1', { phone_number_id: 'PN', access_token: 'tok' }, '5521999', fonte, f)
    assert.equal(baixou, 1, 'segunda vez usa o media_id do cache (não sobe de novo)')
    assert.deepEqual(chamadas.slice(2), ['/PN/messages'])
  },
  'confirmação solta ("ok", 👍, "obrigada") sem pergunta pendente: nada de texto, no máximo uma ❤️ a cada 10 min': () => {
    for (const t of ['ok', 'Okay', 'blz', 'beleza', 'tá bom', 'show', 'obrigada!', 'valeu', '👍', '❤️', '🙏🙏']) assert.ok(ehConfirmacao(t) && ehSoConfirmacao(t), t)
    for (const t of ['ok, e quanto custa?', '35', 'quero o 3', '']) assert.ok(!ehConfirmacao(t), t)
    const agora = Date.parse('2026-10-30T15:00:00Z')
    const r1 = proximoPasso('pago', {}, txt('Ok'), { ...ctx, agoraMs: agora })
    assert.deepEqual(chaves(r1.acoes), ['reagir'])
    const r2 = proximoPasso('pago', r1.dados, txt('👍'), { ...ctx, agoraMs: agora + 5 * 60e3 })
    assert.deepEqual(r2.acoes, [], 'dentro de 10 min: nem reação')
    assert.deepEqual(chaves(proximoPasso('pago', r1.dados, txt('valeu'), { ...ctx, agoraMs: agora + 11 * 60e3 }).acoes), ['reagir'])
    assert.deepEqual(proximoPasso('fotos_poses', { pacote_qtd: 3 }, { tipo: 'reacao', texto: '👍' }, ctx).acoes, [], 'reação do WhatsApp nunca recebe resposta')
    assert.deepEqual(chaves(proximoPasso('aguardando_pagamento', {}, txt('ok'), { ...ctx, agoraMs: agora }).acoes), ['reagir'])
    // COM pergunta pendente, "ok" é resposta: segue o fluxo
    const pref = proximoPasso('idade_prefs', { pacote_qtd: 2, poses: ['01', '02'] }, txt('ok'), ctx)
    assert.equal(pref.dados.maquiagem, true); assert.deepEqual(chaves(pref.acoes), ['atualizar_pedido', 'texto:pref_decote'])
  },
  'pacote: "5" = opção 5; "5 fotos"/"o de 5" = pacote de 5; preço; ordinal; por extenso ambíguo confirma': () => {
    const q = (t: string) => { const e = escolhaDePacote(t, PRECOS); return e ? `${e.preco.pacote_qtd}${e.confirmar ? '?' : ''}` : null }
    assert.equal(q('3'), '5'); assert.equal(q('5'), '15'); assert.equal(q('3️⃣'), '5'); assert.equal(q('opção 2'), '3')
    assert.equal(q('5 fotos'), '5'); assert.equal(q('quero 10 fotos'), '10'); assert.equal(q('cinco fotos'), '5')
    assert.equal(q('o de 49,90'), '5'); assert.equal(q('R$ 18,90'), '2'); assert.equal(q('o de 19,90'), null)
    assert.equal(q('quero o de três'), '3'); assert.equal(q('o de 5'), '5'); assert.equal(q('pacote de 15'), '15')
    assert.equal(q('o terceiro'), '5'); assert.equal(q('o primeiro'), '2')
    assert.equal(q('três'), '5?'); assert.equal(q('quero 3'), '5?')
    assert.equal(q('ainda não sei'), null)
  },
  'pacote ambíguo: "Só pra confirmar: é o pacote de N fotos por R$ X?" → sim segue / não mostra a tabela': () => {
    const c = proximoPasso('pacote', { tema: 'casual' }, txt('três'), ctx)
    assert.equal(c.etapa, 'pacote'); assert.deepEqual(chaves(c.acoes), ['texto:pacote_confirmar']); assert.equal(c.dados.pacote_confirmar, 5)
    assert.match(TEXTOS.pacote_confirmar['pt-BR'], /Só pra confirmar: é o pacote de \{qtd\} fotos por \{valor\}\?/)
    const sim = proximoPasso('pacote', c.dados, txt('sim'), ctx)
    assert.equal(sim.etapa, 'fotos_poses'); assert.equal(sim.dados.pacote_qtd, 5); assert.deepEqual(chaves(sim.acoes), ['criar_pedido', 'texto:pede_fotos_poses', 'fechar_pedido', 'texto:pagar_ja', 'pix', 'audio:a5'])
    const nao = proximoPasso('pacote', c.dados, txt('não'), ctx)
    assert.equal(nao.etapa, 'pacote'); assert.deepEqual(chaves(nao.acoes), ['texto:tabela_precos'])
    // dúvida no meio: a IA responde e repete "me manda só o número do pacote"
    assert.deepEqual(chaves(proximoPasso('pacote', { tema: 'casual' }, txt('vocês fazem na hora?'), ctx).acoes), ['ia', 'texto:pacote_de_novo'])
    // fotos mandadas ANTES do pacote não são pedidas de novo
    const ja = proximoPasso('pacote', { tema: 'casual' }, txt('2'), { ...ctx, fotos: { tem_rosto: true, tem_corpo: true, rosto_recortado: false, unica: false } })
    assert.deepEqual(chaves(ja.acoes), ['criar_pedido', 'fotos_escolher', 'texto:pede_poses', 'fechar_pedido', 'texto:pagar_ja', 'pix', 'audio:a5'])
  },
  'tabela sempre termina com o menu numerado e "Responda só com o NÚMERO do pacote" (4 idiomas)': () => {
    for (const i of IDIOMAS) {
      const t = TEXTOS.tabela_precos[i]
      assert.ok(t.includes('{tabela}') && t.includes('{prazo}') && /NÚMERO|NUMBER/.test(t) && /\(ex\.: 3\)|\(ej\.: 3\)|\(e\.g\. 3\)/.test(t), i)
      assert.ok(t.indexOf('{tabela}') < t.search(/NÚMERO|NUMBER/), `${i}: o pedido vem DEPOIS do menu`)
    }
    assert.match(TEXTOS.pede_fotos_poses['pt-BR'], /Pacote de \{qtd\} fotos ✅ Agora me manda os \{qtd\} NÚMEROS das poses/)
    assert.match(TEXTOS.poses_faltam['pt-BR'], /Faltam \{faltam\} poses 😊/)
  },
  'fotos: rosto = a mais fechada, corpo = a que mostra mais corpo — em QUALQUER ordem; nunca o mesmo arquivo': () => {
    const rosto = foto('a.jpg', 'rosto', 0.15, { cabelo: 'loiro, longo' }); const corpo = foto('b.jpg', 'corpo_inteiro', 0.95)
    for (const lista of [[rosto, corpo], [corpo, rosto]]) {
      const e = escolherFotos(lista)
      assert.equal(e.rosto?.path, 'a.jpg'); assert.equal(e.corpo, 'b.jpg'); assert.equal(e.rosto_recortado, false); assert.equal(e.cabelo, 'loiro, longo')
    }
    // duas "rosto_e_corpo": a mais aberta é o corpo, a mais fechada é o rosto
    const e2 = escolherFotos([foto('x.jpg', 'rosto_e_corpo', 0.9), foto('y.jpg', 'rosto_e_corpo', 0.4)])
    assert.equal(e2.corpo, 'x.jpg'); assert.equal(e2.rosto?.path, 'y.jpg')
    // inválida/recusada não conta
    const e3 = escolherFotos([foto('i.jpg', 'invalida', 0.5), foto('r.jpg', 'rosto', 0.1, { recusada: true }), corpo])
    assert.equal(e3.corpo, 'b.jpg'); assert.notEqual(e3.rosto?.path, 'r.jpg')
  },
  'só a foto de corpo: rosto RECORTADO dela (marcado) — e a escolha manual do Luís vale': () => {
    const unica = foto('u.jpg', 'rosto_e_corpo', 0.9, { rosto_caixa: { x: 0.4, y: 0.05, w: 0.2, h: 0.12 } })
    const e = escolherFotos([unica])
    assert.equal(e.corpo, 'u.jpg'); assert.equal(e.rosto?.path, 'u.jpg'); assert.deepEqual(e.rosto?.recorte, unica.rosto_caixa); assert.equal(e.rosto_recortado, true)
    assert.deepEqual(resumoDasFotos([unica]), { tem_rosto: true, tem_corpo: true, rosto_recortado: true, unica: true })
    assert.deepEqual(resumoDasFotos([foto('c.jpg', 'corpo_inteiro', 0.95)]), { tem_rosto: false, tem_corpo: true, rosto_recortado: false, unica: false })
    const m = escolherFotos([foto('a.jpg', 'rosto', 0.1), foto('b.jpg', 'corpo_inteiro', 0.9), foto('c.jpg', 'rosto', 0.2)], { rosto: 'c.jpg' })
    assert.equal(m.rosto?.path, 'c.jpg'); assert.equal(m.corpo, 'b.jpg')
    const cx = caixaDoRecorte(1000, 1250, unica.rosto_caixa ?? null)
    assert.ok(cx.left >= 0 && cx.top >= 0 && cx.left + cx.width <= 1000 && cx.top + cx.height <= 1250 && cx.width > 200)
  },
  'Ana com as 2 fotos juntas: UMA resposta "Recebi as 2 fotos ✅" + já a próxima pergunta': () => {
    const d: Dados = { tema: 'aniversario', pacote_qtd: 3, valor_cents: 2990, poses: [] }
    const r = proximoPasso('fotos_poses', d, { tipo: 'imagem', texto: '', fotos: { novas: 2 } }, { ...ctx, fotos: { tem_rosto: true, tem_corpo: true, rosto_recortado: false, unica: false } })
    assert.deepEqual(chaves(r.acoes), ['fotos_escolher', 'texto:foto_corpo_ok', 'texto:pede_poses'])
    assert.match(TEXTOS.foto_corpo_ok['pt-BR'], /Recebi as 2 fotos ✅/)
    // com as poses já dadas, vai direto para a 1ª preferência (nunca para calada)
    const r2 = proximoPasso('fotos_poses', { ...d, poses: ['01', '02', '03'] }, { tipo: 'imagem', texto: '', fotos: { novas: 2 } }, { ...ctx, fotos: { tem_rosto: true, tem_corpo: true, rosto_recortado: false, unica: false } })
    assert.equal(r2.etapa, 'idade_prefs'); assert.deepEqual(chaves(r2.acoes), ['fotos_escolher', 'texto:foto_corpo_ok', 'atualizar_pedido', 'texto:pref_maquiagem'])
    // só o rosto: diz exatamente o que falta
    const r3 = proximoPasso('fotos_poses', d, { tipo: 'imagem', texto: '', fotos: { novas: 1 } }, { ...ctx, fotos: { tem_rosto: true, tem_corpo: false, rosto_recortado: false, unica: false } })
    assert.deepEqual(chaves(r3.acoes), ['fotos_escolher', 'texto:foto_rosto_ok'])
    assert.equal(TEXTOS.foto_rosto_ok['pt-BR'], 'Recebi a do rosto ✅ Falta só a de corpo inteiro 😊')
    // foto única com rosto e corpo: aceita e oferece o close (opcional)
    const r4 = proximoPasso('fotos_poses', d, { tipo: 'imagem', texto: '', fotos: { novas: 1 } }, { ...ctx, fotos: { tem_rosto: true, tem_corpo: true, rosto_recortado: true, unica: true } })
    assert.deepEqual(chaves(r4.acoes).slice(0, 2), ['fotos_escolher', 'texto:foto_unica_ok'])
    // foto fora da etapa (antes do pacote): guardada pelo executor, Ana segue a pergunta atual
    assert.deepEqual(chaves(proximoPasso('pacote', { tema: 'casual' }, { tipo: 'imagem', texto: '' }, ctx).acoes), ['texto:tabela_precos'])
  },
  'vídeo / figurinha / documento no lugar da foto: resposta certa (texto do concorrente para vídeo)': () => {
    const d: Dados = { tema: 'casual', pacote_qtd: 2 }
    assert.deepEqual(chaves(proximoPasso('fotos_poses', d, { tipo: 'video', texto: '' }, ctx).acoes), ['texto:video_nao'])
    assert.match(TEXTOS.video_nao['pt-BR'], /^Você me mandou um vídeo 😊 Para o ensaio eu preciso de FOTO/)
    assert.deepEqual(chaves(proximoPasso('fotos_poses', d, { tipo: 'figurinha', texto: '' }, ctx).acoes), ['texto:figurinha_nao'])
    assert.ok(ehFoto({ tipo: 'documento', media_mime: 'image/jpeg' }) && ehFoto({ tipo: 'documento', media_mime: 'image/heic' }) && !ehFoto({ tipo: 'documento', media_mime: 'application/pdf' }))
    assert.equal(TEXTOS.audio_nao_ouvi['pt-BR'], 'Não consegui ouvir seu áudio aqui 🙈 pode me mandar por escrito?')
  },
  'preferências uma por vez; "42 loiros sem decote" vira idade 42 · decote não (sem repetir a idade)': () => {
    assert.equal(proximaPreferencia({}), 'pref_maquiagem')
    const d: Dados = {}
    const capt = aplicarPreferencias(d, 'pref_maquiagem', '42 loiros sem decote', { maquiagem: null, decote: false, cores_acessorios: null, idade: 42, cabelo_mudar: null })
    assert.equal(capt, true); assert.equal(d.idade, 42); assert.equal(d.decote, false)
    assert.ok(!(d.preferencias ?? '').includes('42'), 'idade não vai para as preferências')
    assert.equal(proximaPreferencia(d), 'pref_maquiagem', 'pula o que já respondeu e pergunta o que falta')
    aplicarPreferencias(d, 'pref_maquiagem', 'não', null); assert.equal(d.maquiagem, false)
    assert.equal(proximaPreferencia(d), 'pref_cores')
    aplicarPreferencias(d, 'pref_cores', 'pode escolher', null); assert.equal(d.cores, 'a critério do estúdio')
    assert.equal(proximaPreferencia(d), null)
    assert.equal(d.preferencias, 'sem maquiagem · sem decote · cores/acessórios: a critério do estúdio')
    assert.deepEqual(lerPreferencias('{"maquiagem":true,"decote":null,"cores_acessorios":" ","idade":200,"cabelo_mudar":null}'), { maquiagem: true, decote: null, cores_acessorios: null, idade: null, cabelo_mudar: null })
    for (const k of ['pref_maquiagem', 'pref_decote', 'pref_cores', 'pref_idade']) for (const i of IDIOMAS) assert.ok(TEXTOS[k]?.[i]?.trim(), `${k}/${i}`)
    assert.ok(!/cabelo/i.test(TEXTOS.pref_maquiagem['pt-BR'] + TEXTOS.pref_idade['pt-BR']), 'não pergunta o cabelo (a IA vê na foto)')
  },
  'classificação da foto (Haiku 5.5): várias pessoas / borrada = inválida; menor/famosa = recusada': async () => {
    assert.equal(lerClasse('{"tipo":"rosto","pessoas":2,"nitida":true,"fracao_corpo":0.2}')?.tipo, 'invalida')
    assert.equal(lerClasse('{"tipo":"corpo_inteiro","pessoas":1,"nitida":false,"fracao_corpo":0.9}')?.motivo, 'ficou escura ou borrada')
    assert.equal(lerClasse('{"tipo":"rosto","pessoas":1,"nitida":true,"parece_menor":true,"fracao_corpo":0.1}')?.recusada, true)
    const antes = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'teste-falso'
    let modelo = ''
    const f = (async (_u: string, i: RequestInit) => { modelo = JSON.parse(String(i.body)).model; return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"tipo":"rosto_e_corpo","motivo":null,"pessoas":1,"nitida":true,"parece_menor":false,"famosa_ou_print":false,"fracao_corpo":0.9,"rosto_caixa":null,"cabelo":"loiro"}' }], usage: { input_tokens: 900, output_tokens: 60 } })) }) as unknown as typeof fetch
    const r = await classificarFoto(new Uint8Array([1]), 'image/jpeg', f)
    if (antes === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = antes
    assert.equal(modelo, MODELO_RAPIDO); assert.equal(r.classe.tipo, 'rosto_e_corpo'); assert.equal(r.classe.cabelo, 'loiro')
  },
  'fila da conversa: fotos seguidas viram UM lote; espera 8 s depois da última mídia': () => {
    const g = agrupar([{ tipo: 'imagem', media_mime: 'image/jpeg' }, { tipo: 'imagem', media_mime: 'image/jpeg' }, { tipo: 'texto', media_mime: null }, { tipo: 'documento', media_mime: 'image/png' }])
    assert.deepEqual(g.map(x => x.length), [2, 1, 1])
    const agora = Date.parse('2026-10-30T15:00:10Z')
    assert.equal(esperaPorMidia([{ tipo: 'imagem', media_mime: 'image/jpeg', criado_em: '2026-10-30T15:00:07Z' }], agora), ESPERA_MIDIA_MS - 3000)
    assert.equal(esperaPorMidia([{ tipo: 'texto', media_mime: null, criado_em: '2026-10-30T15:00:09Z' }], agora), 0)
    assert.equal(esperaPorMidia([{ tipo: 'imagem', media_mime: 'image/jpeg', criado_em: '2026-10-30T14:59:00Z' }], agora), 0)
  },
  'trava por conversa + after() + digitando antes de tudo (estrutura)': () => {
    const fila = ler('src/lib/estudio/ana/fila.ts')
    assert.ok(fila.includes("admin.rpc('estudio_travar_conversa'") && fila.includes(".is('processada_em', null)") && fila.includes("processando_ate: null"))
    const entrada = ler('src/lib/estudio/entrada.ts')
    assert.ok(entrada.indexOf('marcarLidaDigitando(') < entrada.indexOf("from('estudio_mensagens').select('id').eq('wamid'"), '"digitando…" antes do 1º acesso ao banco')
    assert.ok(entrada.includes('processarConversa(') && entrada.includes('processada_em: null'))
    const wh = ler('src/app/api/webhooks/meta-wa/route.ts')
    assert.ok(wh.includes("import { NextRequest, NextResponse, after } from 'next/server'") && wh.includes('after(() => Promise.all(doEstudioAgora)') && /maxDuration = 300/.test(wh))
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.ok(ex.includes("rpc('estudio_add_foto'") && ex.includes('repetido(t, chave)') && ex.includes('enviarVoz(admin, c.tenant_id, con, c.wa_id'))
    assert.ok(!ex.includes("case 'guardar_foto'"), 'não copia mais a foto pela ordem de chegada')
    assert.ok(ler('src/app/actions/estudio-chat.ts').includes('enviarVoz(admin, tenantId, conta, c.wa_id'), 'áudio do painel também vai como voz')
  },
  'avisos: número com/sem o 9º dígito, modelo numa linha, registro de cada tentativa': () => {
    assert.deepEqual(variantesDoNumero('5521980120036').sort(), ['552180120036', '5521980120036'].sort())
    assert.deepEqual(variantesDoNumero('(21) 98012-0036').sort(), ['552180120036', '5521980120036'].sort())
    assert.ok(!linhaDoModelo('💰 Novo pedido\n👤 Mary\n\n🆔 x').includes('\n'))
    const av = ler('src/lib/estudio/avisos.ts')
    assert.ok(av.includes("canal: 'whatsapp'") && av.includes("canal: 'modelo'") && av.includes("canal: 'push'") && av.includes("MODELO_AVISO = 'novo_pedido'"))
    assert.ok(!/if \([^)]*wa_id[^)]*===[^)]*whatsapp_avisos/.test(ler('src/lib/estudio/ana/executor.ts')), 'nunca pula o aviso por ser o número da cliente')
  },
  'tempos por mensagem: digitando, 1ª resposta, IA, mídia, banco, envio, atraso, cold start': () => {
    const c = new Cronometro(1000)
    c.somar('ia', 1100); c.somar('midia', 800); c.somar('envio', 600); c.somar('espera', 900)
    const t = c.resumo(5000)
    assert.equal(t.total_ms, 4000); assert.equal(t.banco_ms, 600); assert.equal(typeof t.frio, 'boolean')
    const s = textoDosTempos(t)
    assert.ok(s.startsWith('⏱ 4,0 s') && s.includes('IA 1,1 s') && s.includes('mídia 0,8 s') && s.includes('atraso humano 0,9 s'))
  },
  'SQL da rodada: trava, fotos atômicas, tempos, cache de mídia, avisos; nada da seção 4 renomeado': () => {
    const sql = ler('supabase/migrations/20261030000000_estudio_ia_humano.sql')
    assert.ok(!/RENAME|DROP COLUMN|DROP TABLE/i.test(sql))
    for (const x of ['FUNCTION estudio_travar_conversa', 'FUNCTION estudio_add_foto', 'TABLE IF NOT EXISTS estudio_midia_cache', 'TABLE IF NOT EXISTS estudio_avisos', 'ADD COLUMN IF NOT EXISTS processada_em', 'ADD COLUMN IF NOT EXISTS tempos', 'ADD COLUMN IF NOT EXISTS humanizar', 'ADD COLUMN IF NOT EXISTS atraso_max_s', 'ADD COLUMN IF NOT EXISTS rosto_recortado']) assert.ok(sql.includes(x), x)
    assert.match(sql, /UPDATE estudio_mensagens SET processada_em = criado_em WHERE processada_em IS NULL/)
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
