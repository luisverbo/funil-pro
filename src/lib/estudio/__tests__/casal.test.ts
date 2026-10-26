// ============================================================================
// Estúdio IA — tema CASAL (duas pessoas na mesma cena): menu montado dos
// temas ativos, nomes do casal, 4 fotos (rosto + corpo de cada um) com
// "essa é de quem?", foto dos dois juntos como referência, poses 01–30,
// preferências do casal, fila só com as 4 fotos. Os temas 1–4 não mudam.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { proximoPasso, temaDoTexto, ordemDosTemas, preferenciasVencidas, proximaPreferencia, type Etapa, type Dados, type Entrada, type Contexto, type Acao } from '@/lib/estudio/ana/maquina'
import { nomesDoCasal, donoDoTexto, donoAutomatico, idadesDoCasal, faltaDoCasal, juntar, PEDE_CASAL } from '@/lib/estudio/ana/casal'
import { escolherFotosCasal, resumoDasFotosCasal, type FotoRecebida, type ResumoCasal } from '@/lib/estudio/ana/fotos'
import { TEXTOS, IDIOMAS, texto, opcoesDoMenu, CHAVES_AUDIO, nomeDoTema } from '@/lib/estudio/ana/textos'
import { promptDaAna } from '@/lib/estudio/ana/ia'
import { faltaParaFila, mensagemNovoPedido } from '@/lib/estudio/producao'
import { caminhosDaCliente, ehTemaCasal, preencherPrompt } from '@/lib/estudio/catalogo'
import { tituloDoTema } from '@/lib/estudio/catalogo-idiomas'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const PRECOS = [[2, 1890], [3, 2990], [5, 4990], [10, 6990], [15, 9890]].map(([q, v]) => ({ pacote_qtd: q, valor_cents: v, moeda: 'BRL' }))
const P20 = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'))
const P30 = Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, '0'))
const ATIVOS = ['aniversario', 'corporativo', 'casual', 'sensual', 'casal']
const ctx: Contexto = {
  idioma: 'pt-BR', precos: PRECOS, temasAtivos: ATIVOS, pix: true,
  posesDoTema: slug => (slug === 'casal' ? P30 : P20),
  sujeitoDoTema: slug => (slug === 'casal' ? 'casal' : 'mulher'),
}
const txt = (t: string): Entrada => ({ tipo: 'texto', texto: t })
const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)
const vazio = (): ResumoCasal => ({ p1: { rosto: false, corpo: false }, p2: { rosto: false, corpo: false }, sem_dono: 0, extras: 0, rosto_recortado: false })
const comCasal = (casal: ResumoCasal): Contexto => ({ ...ctx, fotos: { tem_rosto: casal.p1.rosto, tem_corpo: casal.p1.corpo, rosto_recortado: false, unica: false, casal } })
const foto = (extra: Partial<FotoRecebida> = {}): FotoRecebida => ({ path: `f${Math.random()}`, tipo: 'rosto', fracao_corpo: 0.1, ...extra })

/** Até o pacote escolhido (casal, 2 fotos): etapa casal_nomes. */
function ateOPacote() {
  let etapa: Etapa = 'inicio'; let d: Dados = {}
  for (const m of ['oi', 'Bia', '5', '1']) { const r = proximoPasso(etapa, d, txt(m), ctx); etapa = r.etapa; d = r.dados }
  return { etapa, d }
}

const tests: Record<string, () => void | Promise<void>> = {
  'menu: casal entra como 5 quando ATIVO; texto "eu e meu marido" escolhe casal; casal inativo → "em breve"': () => {
    assert.deepEqual(ordemDosTemas(['casal', 'sensual', 'aniversario', 'corporativo', 'casual']), ATIVOS)
    assert.deepEqual(temaDoTexto('5', ATIVOS), { tema: 'casal' })
    assert.deepEqual(temaDoTexto('quero ensaio de casal', ATIVOS), { tema: 'casal' })
    assert.deepEqual(temaDoTexto('eu e meu marido', ATIVOS), { tema: 'casal' })
    assert.deepEqual(temaDoTexto('pra mim e pro meu amor', ATIVOS), { tema: 'casal' })
    assert.deepEqual(temaDoTexto('nós dois', ATIVOS), { tema: 'casal' })
    assert.deepEqual(temaDoTexto('casual', ATIVOS), { tema: 'casual' }, '"casual" não vira casal')
    assert.deepEqual(temaDoTexto('casal', ATIVOS.slice(0, 4)), { outro: true }, 'inativo = em breve')
    assert.equal(temaDoTexto('5', ATIVOS.slice(0, 4)), null)
    assert.ok(PEDE_CASAL.test('couple') && PEDE_CASAL.test('en pareja') && !PEDE_CASAL.test('casual'))
    const menu = texto('menu', 'pt-BR', { nome: 'Bia', opcoes: opcoesDoMenu(ATIVOS, 'pt-BR'), n: 5 })
    assert.ok(menu.includes('🎂 1 - ANIVERSÁRIO') && menu.includes('💑 5 - CASAL'))
    assert.ok(opcoesDoMenu(ATIVOS, 'es').includes('5 - PAREJA') && opcoesDoMenu(ATIVOS, 'en').includes('5 - COUPLE'))
    // sem a lista (compatível): os 4 do lançamento
    assert.ok(texto('menu', 'pt-BR', { nome: 'Bia' }).includes('🌹 4 - SENSUAL') && !texto('menu', 'pt-BR', { nome: 'Bia' }).includes('CASAL'))
    assert.match(texto('outro_tema', 'pt-BR', { n: 5 }), /esses 5/); assert.match(texto('lembrete_tema', 'pt-BR'), /1 a 4/)
    assert.equal(nomeDoTema('casal', 'pt-BR'), 'Casal'); assert.equal(tituloDoTema('casal', 'Ensaio de Casal', 'es'), 'Sesión de pareja'); assert.equal(tituloDoTema('casal', 'Ensaio de Casal', 'en'), 'Couple Photoshoot')
    // Escolheu 5: explica o casal (áudio A2 do casal → texto enquanto não houver áudio), catálogo e tabela.
    const r = proximoPasso('tema', { nome: 'Bia' }, txt('5'), ctx)
    assert.equal(r.etapa, 'pacote'); assert.equal(r.dados.casal, true)
    assert.deepEqual(chaves(r.acoes), ['audio:a2_casal', 'catalogo', 'texto:tabela_precos'])
    const t = proximoPasso('tema', { nome: 'Bia' }, txt('eu e meu namorado'), ctx)
    assert.deepEqual(chaves(t.acoes).slice(0, 2), ['texto:casal_que_lindo', 'audio:a2_casal'])
    assert.ok((CHAVES_AUDIO as readonly string[]).includes('a2_casal'))
    // Temas 1–4: tudo igual (sem casal, sem pessoa 2)
    const c = proximoPasso('tema', { nome: 'Bia' }, txt('2'), ctx)
    assert.equal(c.dados.casal, false); assert.deepEqual(chaves(c.acoes), ['audio:a2', 'catalogo', 'texto:tabela_precos'])
  },
  'nomes do casal: "Maria e João", "eu sou a Maria e ele é o João", "meu marido João"; idades dos dois': () => {
    assert.deepEqual(nomesDoCasal('Maria e João'), { p1: 'Maria', p2: 'João' })
    assert.deepEqual(nomesDoCasal('eu sou a Maria e ele é o João'), { p1: 'Maria', p2: 'João' })
    assert.deepEqual(nomesDoCasal('meu marido se chama João'), { p1: null, p2: 'João' })
    assert.deepEqual(nomesDoCasal('João', 'Bia'), { p1: 'Bia', p2: 'João' })
    assert.deepEqual(nomesDoCasal('Bia e João', 'Bia'), { p1: 'Bia', p2: 'João' }, 'repetiu o próprio nome')
    assert.deepEqual(nomesDoCasal('meu esposo é o Carlos', 'Bia'), { p1: 'Bia', p2: 'Carlos' })
    assert.deepEqual(nomesDoCasal('ok', 'Bia'), { p1: 'Bia', p2: null })
    assert.deepEqual(idadesDoCasal('eu 32 e ele 35', { p1: 'Bia', p2: 'João' }), { idade1: 32, idade2: 35 })
    assert.deepEqual(idadesDoCasal('ele 35 e eu 32', { p1: 'Bia', p2: 'João' }), { idade1: 32, idade2: 35 })
    assert.deepEqual(idadesDoCasal('32 e 35', {}), { idade1: 32, idade2: 35 })
    assert.deepEqual(idadesDoCasal('João tem 40', { p1: 'Bia', p2: 'João' }), { idade1: null, idade2: 40 })
    assert.deepEqual(idadesDoCasal('tenho 29', {}), { idade1: 29, idade2: null })
  },
  '"essa foto é de quem?": minha / dele / do João / "a primeira é minha e a segunda dele"; automático só com a outra pessoa completa': () => {
    const n = { p1: 'Bia', p2: 'João' }
    assert.deepEqual(donoDoTexto('é minha', n, 1), [1]); assert.deepEqual(donoDoTexto('sou eu', n, 1), [1])
    assert.deepEqual(donoDoTexto('do João', n, 1), [2]); assert.deepEqual(donoDoTexto('dele', n, 1), [2]); assert.deepEqual(donoDoTexto('do meu marido', n, 1), [2])
    assert.deepEqual(donoDoTexto('as duas são minhas', n, 2), [1, 1]); assert.deepEqual(donoDoTexto('são do João', n, 2), [2, 2])
    assert.deepEqual(donoDoTexto('a primeira é minha e a segunda é dele', n, 2), [1, 2])
    assert.deepEqual(donoDoTexto('a primeira é do João e a segunda minha', n, 2), [2, 1])
    assert.deepEqual(donoDoTexto('uma de cada', n, 2), [1, 2])
    assert.equal(donoDoTexto('03, 07', n, 1), null); assert.equal(donoDoTexto('quanto custa?', n, 1), null)
    const lista = [foto({ pessoa: 1, tipo: 'rosto' }), foto({ pessoa: 1, tipo: 'corpo_inteiro', fracao_corpo: 1 })]
    assert.equal(donoAutomatico(lista), 2, 'pessoa 1 completa → a nova é da pessoa 2')
    assert.equal(donoAutomatico([foto({ pessoa: 1 })]), null, 'ninguém completo → pergunta')
    assert.equal(donoAutomatico([...lista, foto({ pessoa: 2, tipo: 'rosto' }), foto({ pessoa: 2, tipo: 'corpo_inteiro', fracao_corpo: 1 })]), null)
  },
  'escolha das 4 fotos: rosto/corpo de cada pessoa só entre as dela; juntos = extra; sem dono conta': () => {
    const lista = [
      foto({ path: 'r1', pessoa: 1, tipo: 'rosto', fracao_corpo: 0.1 }), foto({ path: 'c1', pessoa: 1, tipo: 'corpo_inteiro', fracao_corpo: 1 }),
      foto({ path: 'rc2', pessoa: 2, tipo: 'rosto_e_corpo', fracao_corpo: 0.9 }), foto({ path: 'juntos', tipo: 'invalida', extra: true, fracao_corpo: 0 }),
      foto({ path: 'x', tipo: 'rosto' }),
    ]
    const e = escolherFotosCasal(lista)
    assert.equal(e.p1.rosto?.path, 'r1'); assert.equal(e.p1.corpo, 'c1')
    assert.equal(e.p2.corpo, 'rc2'); assert.equal(e.p2.rosto?.path, 'rc2'); assert.equal(e.p2.rosto_recortado, true, 'só uma foto da pessoa 2 → rosto recortado')
    assert.deepEqual(e.extras, ['juntos']); assert.equal(e.sem_dono.length, 1)
    const r = resumoDasFotosCasal(lista)
    assert.deepEqual(r, { p1: { rosto: true, corpo: true }, p2: { rosto: true, corpo: true }, sem_dono: 1, extras: 1, rosto_recortado: true })
    assert.deepEqual(faltaDoCasal({ p1: { rosto: false, corpo: true }, p2: { rosto: true, corpo: false } }, { p1: 'Bia', p2: 'João' }, 'pt-BR'), ['o rosto de Bia', 'o corpo inteiro de João'])
    assert.equal(juntar(['a', 'b', 'c'], 'pt-BR'), 'a, b e c'); assert.equal(juntar(['a', 'b'], 'en'), 'a and b')
    assert.deepEqual(caminhosDaCliente('p'), { rosto: 'p/rosto.jpg', corpo: 'p/corpo.jpg', rosto2: 'p/rosto2.jpg', corpo2: 'p/corpo2.jpg' })
    assert.ok(ehTemaCasal('casal') && ehTemaCasal('x', 'casal') && !ehTemaCasal('casual', 'mulher'))
    assert.match(preencherPrompt('{pessoa1} e {pessoa2}, {preferencias}', { pessoa1: 'Bia', pessoa2: 'João' }), /^Bia e João, sem/)
  },
  'fluxo: pacote → nome do parceiro → 4 fotos dizendo o que falta → "de quem?" → poses 01–30 → roupas e idades → Pix': () => {
    const { etapa, d } = ateOPacote()
    assert.equal(etapa, 'casal_nomes'); assert.equal(d.pacote_qtd, 2); assert.equal(d.casal, true)
    // Nome do parceiro
    const n = proximoPasso('casal_nomes', d, txt('João'), ctx)
    assert.equal(n.etapa, 'fotos_poses'); assert.equal(n.dados.pessoa2_nome, 'João')
    assert.deepEqual(chaves(n.acoes), ['atualizar_pedido', 'texto:casal_nomes_ok', 'texto:casal_pede_fotos_poses', 'texto:catalogo_de_novo'])
    assert.equal((n.acoes[2] as { vars?: { pessoa2?: string } }).vars?.pessoa2, 'João')
    // 1ª foto sem dizer de quem é → pergunta
    let c = vazio(); c.sem_dono = 1
    const f1 = proximoPasso('fotos_poses', n.dados, { tipo: 'imagem', texto: '', fotos: { novas: 1 } }, comCasal(c))
    assert.deepEqual(chaves(f1.acoes), ['texto:casal_foto_de_quem'])
    // "é minha" (o executor atribuiu) → rosto da Bia ✅ e o que falta
    c = { ...vazio(), p1: { rosto: true, corpo: false } }
    const f2 = proximoPasso('fotos_poses', f1.dados, { tipo: 'texto', texto: 'é minha', fotos: { novas: 0, atribuidas: 1 } }, comCasal(c))
    assert.deepEqual(chaves(f2.acoes), ['fotos_escolher', 'texto:casal_falta_fotos'])
    assert.match(String((f2.acoes[1] as { vars?: { faltam?: string } }).vars?.faltam), /corpo inteiro de Bia, o rosto de João e o corpo inteiro de João/)
    // foto dos dois juntos: referência, não substitui
    const fj = proximoPasso('fotos_poses', f2.dados, { tipo: 'imagem', texto: '', fotos: { novas: 1, juntos: true } }, comCasal(c))
    assert.deepEqual(chaves(fj.acoes), ['texto:casal_foto_juntos', 'texto:casal_falta_fotos'])
    // foto com criança / print → recusa, sem travar
    const fr = proximoPasso('fotos_poses', f2.dados, { tipo: 'imagem', texto: '', fotos: { novas: 1, recusada: true } }, comCasal(c))
    assert.deepEqual(chaves(fr.acoes), ['texto:casal_foto_recusada'])
    // poses do catálogo de casal (30): 25 vale, 31 não
    const p = proximoPasso('fotos_poses', f2.dados, txt('25, 31'), comCasal(c))
    assert.deepEqual(chaves(p.acoes), ['texto:poses_invalidas'])
    const p2 = proximoPasso('fotos_poses', f2.dados, txt('07, 25'), comCasal(c))
    assert.deepEqual(p2.dados.poses, ['07', '25']); assert.deepEqual(chaves(p2.acoes), ['texto:casal_falta_fotos'])
    // as 4 fotos completas → preferências do casal (roupas numa pergunta só)
    c = { ...vazio(), p1: { rosto: true, corpo: true }, p2: { rosto: true, corpo: true } }
    const ok = proximoPasso('fotos_poses', p2.dados, { tipo: 'imagem', texto: '', fotos: { novas: 1 } }, comCasal(c))
    assert.equal(ok.etapa, 'idade_prefs'); assert.deepEqual(chaves(ok.acoes), ['fotos_escolher', 'texto:casal_fotos_ok', 'atualizar_pedido', 'texto:casal_pref_roupas'])
    assert.equal(proximaPreferencia(ok.dados), 'casal_pref_roupas')
    const r1 = proximoPasso('idade_prefs', ok.dados, txt('ela de vestido rosa, ele de camisa azul'), comCasal(c))
    assert.deepEqual(chaves(r1.acoes), ['atualizar_pedido', 'texto:casal_pref_idades']); assert.match(r1.dados.preferencias ?? '', /vestido rosa/)
    assert.ok(!chaves(r1.acoes).some(k => /maquiagem|decote/.test(k)), 'casal não pergunta maquiagem/decote')
    const r2 = proximoPasso('idade_prefs', r1.dados, txt('eu 32'), comCasal(c))
    assert.deepEqual(chaves(r2.acoes), ['atualizar_pedido', 'texto:casal_pref_idade2']); assert.equal(r2.dados.idade, 32)
    const r3 = proximoPasso('idade_prefs', r2.dados, txt('35'), comCasal(c))
    assert.equal(r3.etapa, 'aguardando_pagamento'); assert.equal(r3.dados.pessoa2_idade, 35)
    assert.ok(chaves(r3.acoes).includes('fechar_pedido') && chaves(r3.acoes).includes('texto:resumo_pedido'))
    // os dois de uma vez
    const r4 = proximoPasso('idade_prefs', r1.dados, txt('eu 32 e João 35'), comCasal(c))
    assert.equal(r4.etapa, 'aguardando_pagamento'); assert.equal(r4.dados.idade, 32); assert.equal(r4.dados.pessoa2_idade, 35)
    // menor de idade (qualquer um dos dois) → humano
    assert.equal(proximoPasso('idade_prefs', r1.dados, txt('eu 30 e ele 17'), comCasal(c)).etapa, 'humano')
    // já pagou e sumiu nas preferências: padrão do casal (roupas a critério), sem maquiagem/decote
    const v = preferenciasVencidas({ ...ok.dados, aguardando_desde: new Date(Date.now() - 11 * 60e3).toISOString() }, 'idade_prefs', true)!
    assert.deepEqual(v.padrao, ['roupas e cores do casal a critério do estúdio'])
  },
  'nomes: sem o nome dela pede os dois; "Maria e João" preenche; foto antes da hora é guardada; prévia do casal exige as 4 fotos': () => {
    let etapa: Etapa = 'inicio'; let d: Dados = {}
    for (const m of ['oi', 'ensaio de casal', '5', '2']) { const r = proximoPasso(etapa, d, txt(m), ctx); etapa = r.etapa; d = r.dados }
    assert.equal(etapa, 'nome')
    d = {}; etapa = 'tema'
    for (const m of ['5', '2']) { const r = proximoPasso(etapa, d, txt(m), ctx); etapa = r.etapa; d = r.dados }
    assert.equal(etapa, 'casal_nomes')
    const semNome = proximoPasso('pacote', { tema: 'casal', casal: true }, txt('2'), ctx)
    assert.ok(chaves(semNome.acoes).includes('texto:casal_pede_nomes'))
    const n = proximoPasso('casal_nomes', semNome.dados, txt('Maria e João'), ctx)
    assert.equal(n.dados.nome, 'Maria'); assert.equal(n.dados.pessoa2_nome, 'João')
    // foto antes da hora (etapa dos nomes): guarda e repete a pergunta
    const cedo = proximoPasso('casal_nomes', semNome.dados, { tipo: 'imagem', texto: '', fotos: { novas: 1 } }, ctx)
    assert.deepEqual(chaves(cedo.acoes), ['texto:casal_foto_guardada', 'texto:casal_pede_nomes'])
    // prévia aceita sem as 4 fotos → pede as 4
    const pv = proximoPasso('pacote', { nome: 'Bia', tema: 'casal', casal: true, previa_oferecida: true }, txt('sim'), comCasal({ ...vazio(), p1: { rosto: true, corpo: true } }))
    assert.equal(pv.etapa, 'previa_fotos'); assert.deepEqual(chaves(pv.acoes), ['criar_pedido', 'texto:casal_previa_pede_fotos'])
    // com as 4: só a pose
    const pv2 = proximoPasso('pacote', { nome: 'Bia', tema: 'casal', casal: true, previa_oferecida: true }, txt('sim'), comCasal({ ...vazio(), p1: { rosto: true, corpo: true }, p2: { rosto: true, corpo: true } }))
    assert.deepEqual(chaves(pv2.acoes), ['criar_pedido', 'fotos_escolher', 'texto:previa_pede_pose'])
  },
  'fila: casal só entra com as 4 fotos; aviso ao Luís diz que é casal; API recusa (produção pelo site)': () => {
    const base = { id: 'p1', tipo: 'pacote', status: 'pago', tema_slug: 'casal', cliente_nome: 'Bia', pessoa2_nome: 'João', pacote_qtd: 2, poses: ['07', '25'], idade: 32, foto_rosto_path: 'a', foto_corpo_path: 'b' }
    assert.deepEqual(faltaParaFila(base), ['foto do rosto (João)', 'foto de corpo inteiro (João)'])
    assert.deepEqual(faltaParaFila({ ...base, foto_rosto2_path: 'c', foto_corpo2_path: 'd' }), [])
    assert.deepEqual(faltaParaFila({ ...base, tema_slug: 'x' }, { casal: true }).length, 2, 'sujeito casal vale sem o slug')
    assert.deepEqual(faltaParaFila({ ...base, tema_slug: 'casual' }), [], 'individual não pede a pessoa 2')
    assert.match(mensagemNovoPedido({ ...base, foto_rosto2_path: 'c', foto_corpo2_path: 'd' }, 'Ensaio de Casal', 'chatgpt_site'), /💑 Casal: Bia \+ João \(4 fotos: rosto\/corpo \+ rosto2\/corpo2\)/)
    const srv = ler('src/lib/estudio/producao-servidor.ts')
    assert.match(srv, /ensaio de CASAL é produzido pelo site/); assert.match(srv, /faltaParaFila\(ped, \{ semIdade: opts\.semIdade, casal \}\)/)
    assert.match(srv, /\['foto_rosto2_path', 'rosto2\.jpg'\], \['foto_corpo2_path', 'corpo2\.jpg'\]/, 'upsell copia as 4 fotos')
  },
  'executor/IA/painel: atribuição do dono, 4 arquivos (rosto2/corpo2), prompt sabe o que é casal, painel mostra os dois; SQL': () => {
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.match(ex, /donoDoTexto\(legenda, nomesCasal\(\), validas\.length\)/); assert.match(ex, /donoAutomatico\(fotosLista\)/)
    assert.match(ex, /fotosEntrada = \{ novas: 0, atribuidas: pendentes\.length \}/)
    assert.match(ex, /foto\.extra = true; foto\.motivo = null/)
    assert.match(ex, /async function aplicarEscolhaCasal/); assert.match(ex, /destinos\.rosto2, e\.p2\.rosto\.recorte/); assert.match(ex, /fotos_extras_paths: e\.extras/)
    assert.match(ex, /casal: casal \? \{ pessoa2: dados\.pessoa2_nome \?\? null \} : undefined/)
    const p = promptDaAna({ idioma: 'pt-BR', objetivo: 'x', tabelaPrecos: 'y', prazoMin: 60, temas: 'Aniversário, Casal', historico: [], casal: { pessoa2: 'João' } })
    assert.match(p, /ENSAIO DE CASAL/); assert.match(p, /ESTA conversa é do ENSAIO DE CASAL \(a cliente e João\)/); assert.match(p, /mesmo sexo também/)
    assert.match(ler('src/lib/estudio/supervisor.ts'), /Tema CASAL/)
    const acts = ler('src/app/actions/estudio-pedidos.ts')
    assert.match(acts, /rosto2: await assinar\(BUCKET_CLIENTES, p\.foto_rosto2_path\)/); assert.match(acts, /'rosto' \| 'corpo' \| 'rosto2' \| 'corpo2'/)
    assert.match(ler('src/app/(dashboard)/estudio-ia/aba-pedidos.tsx'), /💑 Casal:/)
    const sql = ler('supabase/migrations/20261112000000_estudio_ia_casal.sql')
    for (const c of ['pessoa2_nome', 'pessoa2_idade', 'pessoa2_cabelo', 'foto_rosto2_path', 'foto_corpo2_path']) assert.match(sql, new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`), c)
    assert.ok(!/RENAME|DROP COLUMN|DROP TABLE/i.test(sql)); assert.match(sql, /Como funciona o ensaio de casal\?/); assert.match(sql, /Pode ser casal do mesmo sexo\?/)
    assert.match(sql, /pergunta ILIKE '%outra pessoa%'/); assert.match(sql, /5 temas: aniversário, corporativo, casual, sensual e casal/)
    // textos novos nos 4 idiomas
    for (const k of ['a2_casal', 'casal_que_lindo', 'casal_pede_nomes', 'casal_pede_nome_parceiro', 'casal_nomes_ok', 'casal_pede_fotos_poses', 'casal_foto_de_quem', 'casal_fotos_de_quem', 'casal_foto_juntos', 'casal_foto_recusada', 'casal_falta_fotos', 'casal_fotos_ok', 'casal_foto_guardada', 'casal_pref_roupas', 'casal_pref_idades', 'casal_pref_idade2', 'casal_previa_pede_fotos']) {
      for (const i of IDIOMAS) assert.ok(TEXTOS[k]?.[i]?.trim(), `${k}/${i}`)
    }
    assert.match(texto('casal_pede_fotos_poses', 'pt-BR', { qtd: 3, pessoa2: 'João' }), /de João/)
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
