// ============================================================================
// Estúdio IA — a Ana RESOLVE (não trava, não chama o Luís em coisa simples):
// pacote que não existe, mais poses que o pacote, pagamento logo na escolha,
// comprovante no meio das fotos, pagou antes → fila sozinha, IA sem
// "vou confirmar com a equipe", humano só para reclamação/reembolso/pessoa.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { proximoPasso, nomeDoPerfil, nomeDoTexto, cobrancaDevida, mensagensDaRetomada, escolhaDePacote, pacoteInexistente, opcoesProximas, querPagar, type Contexto, type Dados, type Acao, type Entrada } from '@/lib/estudio/ana/maquina'
import { decidirResposta, bloqueioDaResposta, promptDaAna, type RespostaEstruturada } from '@/lib/estudio/ana/ia'
import { TEXTOS, IDIOMAS } from '@/lib/estudio/ana/textos'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PRECOS = [[2, 1890], [3, 2990], [5, 4990], [10, 6990], [15, 9890]].map(([q, v]) => ({ pacote_qtd: q, valor_cents: v, moeda: 'BRL' }))
const POSES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'))
const ctx: Contexto = { idioma: 'pt-BR', precos: PRECOS, posesDoTema: () => POSES, temasAtivos: ['aniversario', 'corporativo', 'casual', 'sensual'], pix: true }
const txt = (t: string): Entrada => ({ tipo: 'texto', texto: t })
const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)
const coleta = (extra: Partial<Dados> = {}): Dados => ({ tema: 'casual', pacote_qtd: 10, valor_cents: 6990, moeda: 'BRL', poses: [], tem_rosto: true, tem_corpo: true, pagamento_enviado: true, ...extra })
const FOTOS = { tem_rosto: true, tem_corpo: true, rosto_recortado: false, unica: false }
const PERMITIDO = { tabelaPrecos: '2 fotos R$ 18,90; 3 fotos R$ 29,90; 5 fotos R$ 49,90; 10 fotos R$ 69,90; 15 fotos R$ 98,90', prazoMin: 60 }
const est = (o: Partial<RespostaEstruturada>): RespostaEstruturada => ({ intencao: 'duvida', dados: { nome: null, tema: null, pacote_qtd: null, poses: null, idade: null }, resposta: 'ok 💖', precisa_humano: false, na_base: true, ...o })

const tests: Record<string, () => void | Promise<void>> = {
  'pacote que não existe ("quero 11 fotos") → diz na hora os mais próximos, sem IA e sem humano': () => {
    assert.equal(pacoteInexistente('quero 11 fotos', PRECOS), 11)
    assert.equal(pacoteInexistente('tem pacote de 8?', PRECOS), 8)
    assert.equal(pacoteInexistente('quero 10 fotos', PRECOS), null)
    assert.deepEqual(opcoesProximas(11, PRECOS).map(o => [o.opcao, o.preco.pacote_qtd]), [[4, 10], [5, 15]])
    const r = proximoPasso('pacote', { tema: 'casual' }, txt('queria 11 fotos'), ctx)
    assert.equal(r.etapa, 'pacote')
    assert.deepEqual(chaves(r.acoes), ['texto:pacote_inexistente'])
    assert.equal((r.acoes[0] as { vars: Record<string, string> }).vars.opcoes, '4️⃣ 10 · 5️⃣ 15')
  },
  '"o mais completo" / "o mais barato" escolhem o pacote': () => {
    assert.equal(escolhaDePacote('quero o mais completo', PRECOS)?.preco.pacote_qtd, 15)
    assert.equal(escolhaDePacote('vou de o mais barato', PRECOS)?.preco.pacote_qtd, 2)
  },
  'escolheu o pacote → Pix sai NA HORA junto do pedido das fotos': () => {
    const r = proximoPasso('pacote', { tema: 'casual' }, txt('4'), ctx)
    assert.equal(r.etapa, 'fotos_poses'); assert.equal(r.dados.pagamento_enviado, true)
    assert.deepEqual(chaves(r.acoes), ['criar_pedido', 'texto:pede_fotos_poses', 'texto:catalogo_de_novo', 'fechar_pedido', 'texto:pagar_ja', 'pix', 'audio:a5'])
    // sem Pix cadastrado: não promete pagamento
    const sem = proximoPasso('pacote', { tema: 'casual' }, txt('4'), { ...ctx, pix: false })
    assert.ok(!sem.acoes.some(a => a.t === 'pix')); assert.ok(!sem.dados.pagamento_enviado)
  },
  '"manda o pix" no meio da coleta (conversa antiga, sem pagamento enviado) → manda já': () => {
    const r = proximoPasso('fotos_poses', coleta({ pagamento_enviado: false }), txt('manda o pix que eu já pago'), { ...ctx, fotos: FOTOS })
    assert.deepEqual(chaves(r.acoes).slice(0, 4), ['fechar_pedido', 'texto:pagar_ja', 'pix', 'audio:a5'])
    assert.ok(r.acoes.some(a => a.t === 'texto' && a.chave === 'pede_poses'), 'e repete o que falta')
    assert.ok(querPagar('como pago?') && querPagar('how do I pay') && querPagar('cómo puedo pagar') && !querPagar('quero a pose 3'))
  },
  'mais poses que o pacote → fica com as primeiras e oferece o pacote maior (2 = troca, 1 = fica)': () => {
    const nums = '01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 11'
    const r = proximoPasso('fotos_poses', coleta(), txt(nums), { ...ctx, fotos: FOTOS })
    assert.deepEqual(chaves(r.acoes), ['texto:poses_demais_maior'])
    assert.equal(r.dados.poses?.length, 10); assert.equal(r.dados.troca_pacote?.qtd, 15)
    const troca = proximoPasso('fotos_poses', r.dados, txt('2'), { ...ctx, fotos: FOTOS })
    assert.equal(troca.dados.pacote_qtd, 15); assert.equal(troca.dados.valor_cents, 9890); assert.equal(troca.dados.poses?.length, 11)
    assert.deepEqual(chaves(troca.acoes).slice(0, 4), ['trocar_pacote', 'texto:pacote_trocado', 'fechar_pedido', 'texto:pagar_ja'])
    assert.ok(troca.acoes.some(a => a.t === 'pix'), 'Pix de novo com o valor novo')
    assert.ok(troca.acoes.some(a => a.t === 'texto' && a.chave === 'poses_faltam'), 'e pede as 4 que faltam')
    const fica = proximoPasso('fotos_poses', r.dados, txt('1'), { ...ctx, fotos: FOTOS })
    assert.equal(fica.dados.pacote_qtd, 10); assert.equal(fica.dados.troca_pacote, undefined)
    assert.equal(fica.etapa, 'idade_prefs', 'as 10 bastam: segue para as preferências')
  },
  'mais poses que o MAIOR pacote → fica com as primeiras e segue (sem travar)': () => {
    const muitas = Array.from({ length: 18 }, (_, i) => String(i + 1).padStart(2, '0')).join(', ')
    const r = proximoPasso('fotos_poses', coleta({ pacote_qtd: 15, valor_cents: 9890 }), txt(muitas), { ...ctx, fotos: FOTOS })
    assert.equal(r.dados.poses?.length, 15)
    assert.deepEqual(chaves(r.acoes), ['texto:poses_demais_corte', 'fotos_escolher', 'atualizar_pedido', 'texto:pref_maquiagem'])
  },
  'comprovante no meio das fotos (imagem que não é pessoa / PDF) → confere o Pix': () => {
    const img = proximoPasso('fotos_poses', coleta(), { tipo: 'imagem', texto: '', fotos: { novas: 1, invalida: 'não é uma pessoa' } }, { ...ctx, fotos: FOTOS })
    assert.deepEqual(chaves(img.acoes), ['comprovante'])
    const pdf = proximoPasso('idade_prefs', coleta({ poses: POSES.slice(0, 10) }), { tipo: 'documento', texto: 'comprovante.pdf' }, { ...ctx, fotos: FOTOS })
    assert.deepEqual(chaves(pdf.acoes), ['comprovante'])
    // sem pagamento enviado, PDF continua sendo "preciso de foto"
    assert.deepEqual(chaves(proximoPasso('fotos_poses', coleta({ pagamento_enviado: false }), { tipo: 'documento', texto: 'x.pdf' }, ctx).acoes), ['texto:documento_nao'])
  },
  'pagou antes de mandar tudo → ao completar vai DIRETO para a fila (sem pedir pagamento de novo)': () => {
    const d = coleta({ poses: POSES.slice(0, 10), maquiagem: true, decote: false, cores: 'azul' })
    const r = proximoPasso('idade_prefs', d, txt('35'), { ...ctx, fotos: FOTOS, pago: true })
    assert.equal(r.etapa, 'pago')
    assert.deepEqual(chaves(r.acoes), ['atualizar_pedido', 'fila', 'texto:tudo_certo_producao'])
    const naoPago = proximoPasso('idade_prefs', d, txt('35'), { ...ctx, fotos: FOTOS })
    assert.deepEqual(chaves(naoPago.acoes), ['atualizar_pedido', 'fechar_pedido', 'texto:resumo_pedido', 'texto:pede_comprovante'])
  },
  'IA: fora da base e objeção RESPONDEM; "vou confirmar com a equipe" é bloqueado; humano só reclamação/reembolso/pessoa': () => {
    assert.equal(decidirResposta(est({ intencao: 'fora_da_base', na_base: false, resposta: 'Ensaio de casal ainda não temos 😊 Temos Casual, que fica lindo!' }), PERMITIDO).tipo, 'texto')
    assert.equal(decidirResposta(est({ intencao: 'objecao', precisa_humano: true }), PERMITIDO).tipo, 'texto')
    assert.equal(decidirResposta(est({ intencao: 'reclamacao' }), PERMITIDO).tipo, 'humano')
    assert.match(bloqueioDaResposta('Deixa eu verificar com a equipe e já te respondo!', PERMITIDO) ?? '', /adia/)
    assert.match(bloqueioDaResposta("I'll check with the team and get back to you", PERMITIDO) ?? '', /adia/)
    const p = promptDaAna({ idioma: 'pt-BR', objetivo: 'x', tabelaPrecos: 'y', prazoMin: 60, temas: 'Casual', historico: [] })
    assert.match(p, /PROIBIDO dizer que vai "confirmar com a equipe"/)
    assert.match(p, /não temos e ofereça a opção mais próxima/)
  },
  'executor: não-entendi nunca passa para humano; pausa não é fixa; fila calada durante a coleta': () => {
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.doesNotMatch(ex, /naoEntendeu >= 2/)
    assert.doesNotMatch(ex, /renderTexto\('confirmar_equipe'/)
    assert.match(ex, /humano_fixo: fixo/)
    assert.match(ex, /case 'trocar_pacote'/); assert.match(ex, /case 'fila'/)
    assert.match(ex, /chave = 'pago_ok_coleta'/)
    assert.match(ler('src/lib/estudio/producao-servidor.ts'), /\['fotos_poses', 'idade_prefs'\]\.includes\(String\(ct\.etapa\)\)\) return \{ ok: false, falta \}/)
  },
  'retomada fala do ponto da conversa: catálogo, pagamento, dúvida e prévia no fim': () => {
    assert.deepEqual(mensagensDaRetomada('cobranca_1', 'pacote', { tema: 'casual' }), { chaves: ['rmk_pacote'], oferecePrevia: false })
    assert.deepEqual(mensagensDaRetomada('cobranca_1', 'fotos_poses', { tema: 'casual' }).chaves, ['rmk_coleta'])
    assert.deepEqual(mensagensDaRetomada('cobranca_1', 'aguardando_pagamento', { tema: 'casual' }).chaves, ['rmk_pagamento'])
    assert.deepEqual(mensagensDaRetomada('cobranca_1', 'aguardando_pagamento', { tema: 'casual', moeda: 'USD', hotmart_link: 'https://pay' }).chaves, ['rmk_duvida', 'hotmart_lembrete'])
    assert.deepEqual(mensagensDaRetomada('cobranca_2', 'pacote', { tema: 'casual' }), { chaves: ['cobranca_2'], oferecePrevia: true })
    assert.deepEqual(mensagensDaRetomada('cobranca_2', 'aguardando_pagamento', { tema: 'casual' }), { chaves: ['rmk_duvida'], oferecePrevia: false })
    assert.deepEqual(mensagensDaRetomada('cobranca_3', 'aguardando_pagamento', { tema: 'casual' }), { chaves: ['rmk_previa_final'], oferecePrevia: true })
    assert.deepEqual(mensagensDaRetomada('cobranca_3', 'aguardando_pagamento', { tema: 'casual', previa_feita: true }).chaves, ['cobranca_3'])
    // quem recebeu o Pix e sumiu: 10 min → 30 min (dúvida) → 3 h (prévia)
    const h = (min: number) => new Date(Date.parse('2026-11-04T12:00:00Z') - min * 60e3).toISOString()
    const base = { etapa: 'aguardando_pagamento' as const, modo: 'ana', janela_ate: '2099-01-01T00:00:00Z', ultima_cliente_em: null, tema: 'casual' }
    const agora = new Date('2026-11-04T12:00:00Z')
    assert.equal(cobrancaDevida({ ...base, cobrancas: 1, aguardando_desde: h(31) }, agora), 'cobranca_2')
    assert.equal(cobrancaDevida({ ...base, cobrancas: 2, aguardando_desde: h(181) }, agora), 'cobranca_3')
  },
  'prévia aceita DEPOIS do Pix: com as fotos já enviadas pede só 1 pose e volta ao pagamento sem perder as poses': () => {
    const d = coleta({ poses: POSES.slice(0, 10), previa_oferecida: true })
    const r = proximoPasso('aguardando_pagamento', d, txt('sim'), { ...ctx, fotos: FOTOS })
    assert.equal(r.etapa, 'previa_fotos')
    assert.deepEqual(chaves(r.acoes), ['criar_pedido', 'fotos_escolher', 'texto:previa_pede_pose'])
    const p = proximoPasso('previa_fotos', { ...r.dados, poses: [] }, txt('07'), { ...ctx, fotos: FOTOS })
    assert.equal(p.etapa, 'aguardando_pagamento')
    assert.equal(p.dados.poses?.length, 10, 'as 10 poses do pacote voltam')
    assert.ok(chaves(p.acoes).includes('fechar_pedido') && chaves(p.acoes).includes('texto:previa_na_fila'))
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.match(ex, /dados\.pedido_antes_previa = pedidoId/)
    assert.match(ex, /pedidoId = dados\.pedido_antes_previa \?\? null/)
  },
  'escolheu o pacote → o catálogo vai de novo (o link ficou lá em cima)': () => {
    const r = proximoPasso('pacote', { tema: 'casual' }, txt('3'), ctx)
    assert.ok(chaves(r.acoes).includes('texto:catalogo_de_novo'))
    assert.match(TEXTOS.catalogo_de_novo['pt-BR'], /\{link\}/)
  },
  'conversas reais: "¡Hola! Quiero más información" não é nome; nome do perfil pula a pergunta': () => {
    assert.equal(nomeDoTexto('¡Hola! Quiero más información'), null)
    assert.equal(nomeDoTexto('¡Hola! Quiero Más'), null)
    assert.equal(nomeDoTexto('Olá! Posso ter mais informações sobre isso?'), null)
    assert.equal(nomeDoTexto('me llamo Guadalupe'), 'Guadalupe')
    assert.equal(nomeDoPerfil('Dulce Encanto'), 'Dulce')
    assert.equal(nomeDoPerfil('Andrea Nuňez'), 'Andrea')
    for (const ruim of ['🍀💫', 'Mi Quitito 🥰', 'Academia Azul', 'andreaadelmavelazquez', 'selmasolange2026@gmail.co', null]) assert.equal(nomeDoPerfil(ruim), null, String(ruim))
    const r = proximoPasso('inicio', {}, txt('¡Hola! Quiero más información'), { ...ctx, idioma: 'es', nomePerfil: 'Guadalupe' })
    assert.equal(r.etapa, 'tema'); assert.equal(r.dados.nome, 'Guadalupe')
    assert.deepEqual(chaves(r.acoes), ['texto:boas_vindas', 'audio:a1', 'menu_imagem', 'texto:menu'])
    assert.equal(proximoPasso('inicio', {}, txt('hola'), { ...ctx, nomePerfil: '🍀💫' }).etapa, 'nome')
  },
  'conversa real: "22" (pose) na etapa do pacote → anota a pose e pede o pacote; depois vale no pedido': () => {
    const r = proximoPasso('pacote', { tema: 'casual' }, txt('22'), { ...ctx, posesDoTema: () => Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0')) })
    assert.deepEqual(chaves(r.acoes), ['texto:poses_antes_pacote', 'texto:tabela_precos'])
    assert.deepEqual(r.dados.poses_cedo, ['22'])
    const p = proximoPasso('pacote', r.dados, txt('3'), ctx)
    assert.equal(p.dados.pacote_qtd, 5); assert.deepEqual(p.dados.poses, ['22'])
    // "2" continua sendo a opção 2 do pacote
    assert.equal(proximoPasso('pacote', { tema: 'casual' }, txt('2'), ctx).dados.pacote_qtd, 3)
  },
  'conversa da Margarita: foto antes da prévia vai para o pedido; "Bueno" aceita; falta foto → Ana pede à CLIENTE': () => {
    // "Bueno" é sim
    const ok = proximoPasso('pacote', { tema: 'aniversario', previa_oferecida: true }, txt('Bueno'), { ...ctx, idioma: 'es', fotos: FOTOS })
    assert.equal(ok.etapa, 'previa_fotos')
    assert.deepEqual(chaves(ok.acoes), ['criar_pedido', 'fotos_escolher', 'texto:previa_pede_pose'])
    // ao fechar a prévia, as fotos são copiadas de novo antes de entrar na fila
    const fecha = proximoPasso('previa_fotos', { ...ok.dados, poses: [] }, txt('07'), { ...ctx, fotos: FOTOS })
    const c = chaves(fecha.acoes)
    assert.ok(c.indexOf('fotos_escolher') > -1 && c.indexOf('fotos_escolher') < c.indexOf('fechar_pedido'))
    // foto mandada antes da hora: confirma o que recebeu e pede o rosto se só veio corpo
    const so = proximoPasso('pacote', { tema: 'aniversario' }, { tipo: 'imagem', texto: '', fotos: { novas: 1 } }, { ...ctx, fotos: { tem_rosto: true, tem_corpo: true, rosto_recortado: true, unica: true } })
    assert.deepEqual(chaves(so.acoes), ['texto:foto_cedo_corpo', 'texto:tabela_precos'])
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.match(ex, /export async function pedirFotoQueFalta/)
    assert.match(ex, /'falta_foto_cliente'/)
    assert.match(ler('src/lib/estudio/producao-servidor.ts'), /if \(await pedirFotoQueFalta\(admin, pedidoId, falta\)\) return \{ ok: false, falta \}/)
  },
  'IA sabe como ESTA cliente paga (Hotmart fora do Brasil, nunca "Pix" para a Argentina)': () => {
    const p = promptDaAna({ idioma: 'es', objetivo: 'x', tabelaPrecos: 'y', prazoMin: 60, temas: 'Cumpleaños', historico: [], pagamento: 'cartão pela Hotmart, em USD' })
    assert.match(p, /Pagamento DESTA cliente: cartão pela Hotmart, em USD/)
    assert.match(p, /Nunca fale de Pix com quem paga com cartão pela Hotmart/)
    assert.match(ler('src/lib/estudio/ana/executor.ts'), /pagamento: \(c\.pais && c\.pais !== 'BR'\)/)
  },
  'conversa da Andrea: prévia oferecida e ela MANDA A FOTO → começa a prévia (não manda a tabela)': () => {
    const foto: Entrada = { tipo: 'imagem', texto: '', fotos: { novas: 1 } }
    const r = proximoPasso('pacote', { tema: 'corporativo', previa_oferecida: true }, foto, { ...ctx, idioma: 'es', fotos: FOTOS })
    assert.equal(r.etapa, 'previa_fotos')
    assert.deepEqual(chaves(r.acoes), ['criar_pedido', 'fotos_escolher', 'texto:previa_pede_pose'])
    // só o rosto: confirma e pede a de corpo (a pose vem depois)
    const so = proximoPasso('pacote', { tema: 'corporativo', previa_oferecida: true }, foto, { ...ctx, fotos: { tem_rosto: true, tem_corpo: false, rosto_recortado: false, unica: false } })
    assert.deepEqual(chaves(so.acoes), ['criar_pedido', 'fotos_escolher', 'texto:foto_rosto_ok'])
    // sem oferta de prévia: segue como antes (guarda e repete o passo)
    assert.equal(proximoPasso('pacote', { tema: 'corporativo' }, foto, { ...ctx, fotos: FOTOS }).etapa, 'pacote')
  },
  'respostas de venda sempre no Sonnet 5.5': () => {
    assert.match(ler('src/lib/estudio/ana/ia.ts'), /return MODELO_FORTE\n\}/)
  },
  'textos novos nos 4 idiomas': () => {
    for (const k of ['foto_cedo_ambas', 'foto_cedo_rosto', 'foto_cedo_corpo', 'falta_foto_cliente', 'poses_antes_pacote', 'catalogo_de_novo', 'rmk_tema', 'rmk_pacote', 'rmk_coleta', 'rmk_pagamento', 'rmk_duvida', 'rmk_previa_final', 'previa_pede_pose', 'pacote_inexistente', 'poses_demais_maior', 'poses_demais_corte', 'pacote_trocado', 'pagar_ja', 'pago_ok_coleta', 'tudo_certo_producao', 'resposta_segura'])
      for (const i of IDIOMAS) assert.ok(TEXTOS[k]?.[i]?.trim(), `${k}/${i}`)
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
