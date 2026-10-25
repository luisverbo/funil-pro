// ============================================================================
// Estúdio IA — a Ana conhece cada foto do catálogo: pose que mostra a IDADE
// (bolo/velas/balões/número gigante) pede a idade na prévia (ou faz sem
// número, só velas); no pacote a pergunta da idade explica por quê; a IA
// recebe a cena de cada pose do tema para descrever e orientar.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { poseLevaIdade } from '@/lib/estudio/catalogo'
import { proximoPasso, preferenciasVencidas, MIN_PREFERENCIAS_PAGO, type Contexto, type Acao, type Entrada } from '@/lib/estudio/ana/maquina'
import { faltaParaFila } from '@/lib/estudio/producao'
import { promptDaAna } from '@/lib/estudio/ana/ia'
import { TEXTOS, IDIOMAS } from '@/lib/estudio/ana/textos'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const CATALOGO = JSON.parse(ler('src/lib/estudio/dados/poses.json')) as { temas: { slug: string; poses: { numero: string; cena: string }[] }[] }
const cena = (slug: string, n: string) => CATALOGO.temas.find(t => t.slug === slug)!.poses.find(p => p.numero === n)!.cena
const PRECOS = [[2, 1890], [3, 2990]].map(([q, v]) => ({ pacote_qtd: q, valor_cents: v, moeda: 'BRL' }))
const ctx: Contexto = {
  idioma: 'pt-BR', precos: PRECOS, temasAtivos: ['aniversario', 'corporativo', 'casual', 'sensual'], pix: true,
  posesDoTema: slug => CATALOGO.temas.find(t => t.slug === slug)!.poses.map(p => p.numero),
  poseLevaIdade: (slug, n) => poseLevaIdade(cena(slug, n)),
  fotos: { tem_rosto: true, tem_corpo: true, rosto_recortado: false, unica: false },
}
const txt = (t: string): Entrada => ({ tipo: 'texto', texto: t })
const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)
const PREVIA = { tema: 'aniversario', tem_rosto: true, tem_corpo: true, poses: [], etapa_antes_previa: 'pacote' as const }

const tests: Record<string, () => void | Promise<void>> = {
  'catálogo real: as poses que mostram a idade são as de Aniversário 01, 02, 04, 05, 06, 07 ("cidade" não conta)': () => {
    const comIdade = CATALOGO.temas.flatMap(t => t.poses.filter(p => poseLevaIdade(p.cena)).map(p => `${t.slug} ${p.numero}`))
    assert.deepEqual(comIdade, ['aniversario 01', 'aniversario 02', 'aniversario 04', 'aniversario 05', 'aniversario 06', 'aniversario 07'])
  },
  'prévia da pose 01 sem idade → a Ana pergunta (não vai para a fila só com vela)': () => {
    const r = proximoPasso('previa_fotos', PREVIA, txt('01'), ctx)
    assert.equal(r.etapa, 'previa_fotos'); assert.equal(r.dados.perguntou_idade_pose, true)
    assert.deepEqual(chaves(r.acoes), ['texto:previa_pede_idade'])
    assert.ok(!r.acoes.some(a => a.t === 'fechar_pedido'))
    // responde "35" → grava a idade e fecha a prévia (35 NÃO vira pose)
    const ok = proximoPasso('previa_fotos', r.dados, txt('35'), ctx)
    assert.equal(ok.dados.idade, 35); assert.deepEqual((ok.acoes.find(a => a.t === 'atualizar_pedido') as { poses?: string[] }).poses, ['01'])
    assert.ok(chaves(ok.acoes).includes('fechar_pedido'))
    // responde "sem" → faz só com velas (anotado nas preferências) e fecha
    const sem = proximoPasso('previa_fotos', r.dados, txt('sem número, só a vela'), ctx)
    assert.equal(sem.dados.sem_numero, true); assert.match(sem.dados.preferencias ?? '', /SEM número da idade/)
    assert.ok(chaves(sem.acoes).includes('fechar_pedido'))
    // resposta que não é idade nem "sem" → repete a pergunta
    assert.deepEqual(chaves(proximoPasso('previa_fotos', r.dados, txt('hmm'), ctx).acoes), ['texto:previa_pede_idade'])
    // menor de idade → recusa
    assert.equal(proximoPasso('previa_fotos', r.dados, txt('15'), ctx).etapa, 'humano')
  },
  'prévia de pose sem idade na cena (ou idade já conhecida) → segue direto': () => {
    assert.ok(chaves(proximoPasso('previa_fotos', PREVIA, txt('03'), ctx).acoes).includes('fechar_pedido'), 'pose 03 não mostra idade')
    assert.ok(chaves(proximoPasso('previa_fotos', { ...PREVIA, idade: 40 }, txt('01'), ctx).acoes).includes('fechar_pedido'))
    assert.ok(chaves(proximoPasso('previa_fotos', { ...PREVIA, tema: 'corporativo' }, txt('17'), ctx).acoes).includes('fechar_pedido'), 'corporativo 17 ("cidade") não pede idade')
  },
  'pacote: a pergunta da idade diz que a pose leva o número; a IA conhece o que tem em cada foto': () => {
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.match(ex, /a\.chave === 'pref_idade' && dados\.tema && \(dados\.poses \?\? \[\]\)\.some\(n => poseLevaIdade\(dados\.tema!, n\)\)/)
    assert.match(ex, /select\('tema_slug, numero, cena'\)/)
    assert.match(ex, /\[leva o NÚMERO da idade\]/)
    const p = promptDaAna({ idioma: 'pt-BR', objetivo: 'x', tabelaPrecos: 'y', prazoMin: 60, temas: 'z', historico: [], poses: `06: ${cena('aniversario', '06')} [leva o NÚMERO da idade]` })
    assert.match(p, /CATÁLOGO DO TEMA ESCOLHIDO/); assert.match(p, /06: .*vestido vermelho de cetim/)
  },
  'pagou no meio das perguntas: a fila espera a Ana terminar; 10 min sem resposta → padrão e produção': () => {
    const srv = ler('src/lib/estudio/producao-servidor.ts')
    assert.match(srv, /if \(!opts\.forcar && cid && ped\.tipo !== 'previa'\)/, 'pagamento com conversa em andamento não entra na fila')
    assert.match(ler('src/lib/estudio/ana/executor.ts'), /entrarNaFila\(admin, pedidoId, \{ forcar: true \}\)   \/\/ a conversa terminou agora/)
    assert.match(ler('src/app/api/cron/estudio-cobrancas/route.ts'), /fecharPreferenciasVencidas\(createAdminClient\(\)\)/)
    const agora = Date.parse('2026-11-11T12:00:00Z')
    const d = { maquiagem: true, aguardando_desde: new Date(agora - (MIN_PREFERENCIAS_PAGO + 1) * 60e3).toISOString() }
    assert.equal(preferenciasVencidas(d, 'idade_prefs', true, agora - 5 * 60e3), null, 'ainda no prazo')
    assert.equal(preferenciasVencidas(d, 'idade_prefs', false, agora), null, 'sem pagamento não fecha')
    const r = preferenciasVencidas(d, 'idade_prefs', true, agora)!
    assert.deepEqual(r.padrao, ['decote discreto', 'cores e acessórios a critério do estúdio'], 'só completa o que faltou')
    assert.match(r.dados.preferencias ?? '', /padrão: cliente não respondeu/)
    assert.deepEqual(faltaParaFila({ tipo: 'pacote', pacote_qtd: 1, poses: ['01'], foto_rosto_path: 'a', foto_corpo_path: 'b', idade: null } as never, { semIdade: true }), [])
    for (const i of IDIOMAS) assert.ok(TEXTOS.prefs_padrao?.[i]?.trim(), `prefs_padrao/${i}`)
  },
  'textos novos nos 4 idiomas': () => {
    for (const k of ['previa_pede_idade', 'pref_idade_numero']) for (const i of IDIOMAS) assert.ok(TEXTOS[k]?.[i]?.includes('{poses}'), `${k}/${i}`)
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
