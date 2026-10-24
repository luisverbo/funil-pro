// ============================================================================
// Estúdio IA — Supervisor da Ana: quando revisa, como lê a conversa, o que
// aceita da IA, o que o "Aplicar" grava, a lista para o Claude Code, SQL e
// rotas. Nenhuma chamada real à Anthropic.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { precisaRevisar, transcricao, lerAnalise, linhaDaBase, textoParaClaude, promptSupervisor, SCHEMA_SUPERVISOR } from '@/lib/estudio/supervisor'
import { revisarConversas } from '@/lib/estudio/supervisor-servidor'
import { bloqueioDaResposta, promptDaAna } from '@/lib/estudio/ana/ia'
import { proximoPasso, consultaAlguem, mensagensDaRetomada, cobrancaDevida, nomeDoPerfil, type Contexto, type Acao } from '@/lib/estudio/ana/maquina'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const AGORA = new Date('2026-11-08T15:00:00Z')
const min = (m: number) => new Date(AGORA.getTime() - m * 60e3).toISOString()

const ANALISE = {
  nota: 6, resumo: 'Cliente perguntou de onde somos; a Ana respondeu seco.', parou_em: 'pacote', venda: 'em_andamento',
  achados: [
    { gravidade: 'media', tipo: 'faltou_info', trecho: 'Somos online.', problema: 'Resposta seca sobre de onde somos', deveria: 'Somos un estudio 100% online 😊 Atendemos a clientes de toda Argentina por acá.', correcao: { destino: 'faq', pergunta: '¿De dónde son?', texto: 'Somos um estúdio 100% on-line e atendemos clientes de vários países pelo WhatsApp.' } },
    { gravidade: 'alta', tipo: 'fluxo', trecho: 'Elige tu paquete', problema: 'Tabela repetida depois da foto', deveria: '¡Recibí tu foto!', correcao: { destino: 'codigo', pergunta: null, texto: 'Não reenviar a tabela depois de foto.' } },
    { gravidade: 'xxx', tipo: 'errada', trecho: '', problema: 'inválido', deveria: '', correcao: { destino: 'regra', pergunta: null, texto: 'x' } },
  ],
}

const tests: Record<string, () => void | Promise<void>> = {
  'revisa só conversa com mensagem nova, parada há 20 min, dos últimos 3 dias': () => {
    assert.equal(precisaRevisar({ ultima_msg_em: min(30), revisado_ate: null }, AGORA), true)
    assert.equal(precisaRevisar({ ultima_msg_em: min(10), revisado_ate: null }, AGORA), false, 'ainda conversando')
    assert.equal(precisaRevisar({ ultima_msg_em: min(30), revisado_ate: min(30) }, AGORA), false, 'já revisada até aqui')
    assert.equal(precisaRevisar({ ultima_msg_em: min(30), revisado_ate: min(90) }, AGORA), true, 'mensagem nova desde a revisão')
    assert.equal(precisaRevisar({ ultima_msg_em: min(5 * 1440), revisado_ate: null }, AGORA), false, 'velha demais')
  },
  'transcrição: quem falou, mídias rotuladas, corta o começo se for enorme': () => {
    const t = transcricao([
      { direcao: 'entrada', tipo: 'texto', texto: '¿De dónde son?', criado_em: min(40) },
      { direcao: 'saida', tipo: 'texto', texto: 'Somos online.', criado_em: min(39), autor: 'ana' },
      { direcao: 'entrada', tipo: 'imagem', texto: '[📷 imagem]', criado_em: min(38) },
      { direcao: 'saida', tipo: 'texto', texto: 'Oi, aqui é o Luís', criado_em: min(37), autor: 'humano' },
    ])
    assert.match(t, /CLIENTE: ¿De dónde son\?/); assert.match(t, /ANA: Somos online\./)
    assert.match(t, /CLIENTE: \[foto\]$/m); assert.match(t, /LUÍS: Oi, aqui é o Luís/)
    const grande = transcricao(Array.from({ length: 400 }, (_, i) => ({ direcao: 'entrada' as const, tipo: 'texto', texto: `mensagem ${i} ${'x'.repeat(40)}`, criado_em: min(400 - i) })))
    assert.ok(grande.length < 12100 && grande.startsWith('(…início cortado…)') && grande.includes('mensagem 399'))
  },
  'análise: aceita só o que vem certo (gravidade/tipo/destino válidos), nota de 0 a 10': () => {
    const a = lerAnalise(JSON.stringify({ ...ANALISE, nota: 14 }))!
    assert.equal(a.nota, 10)
    assert.equal(a.achados.length, 2, 'o inválido sai')
    assert.equal(lerAnalise('lixo'), null)
    assert.deepEqual(SCHEMA_SUPERVISOR.required, ['nota', 'resumo', 'parou_em', 'venda', 'achados'])
  },
  'Aplicar: FAQ/regra/nunca dizer viram linha da Base; código nunca vai para a Base': () => {
    assert.deepEqual(linhaDaBase(ANALISE.achados[0].correcao as never), { tipo: 'faq', pergunta: '¿De dónde son?', resposta: 'Somos um estúdio 100% on-line e atendemos clientes de vários países pelo WhatsApp.' })
    assert.equal(linhaDaBase(ANALISE.achados[1].correcao as never), null)
    assert.deepEqual(linhaDaBase({ destino: 'faq', pergunta: null, texto: 'Sempre cumprimente pelo nome' }), { tipo: 'regra', pergunta: null, resposta: 'Sempre cumprimente pelo nome' })
    assert.equal(linhaDaBase({ destino: 'regra', pergunta: null, texto: '  ' }), null)
  },
  'lista para o Claude Code junta os problemas de código': () => {
    const t = textoParaClaude([{ tipo: 'fluxo', gravidade: 'alta', problema: 'Tabela repetida', trecho: 'Elige tu paquete', correcao: { texto: 'Não reenviar' } }])
    assert.match(t, /^Supervisor da Ana — problemas de fluxo/); assert.match(t, /1\. \[alta\/fluxo\] Tabela repetida/)
    assert.equal(textoParaClaude([]), '')
  },
  'Supervisor e Ana nunca mentem sobre de onde somos': () => {
    const p = promptSupervisor({ pais: 'AR', idioma: 'es', tabelaPrecos: 'x', base: [] })
    assert.match(p, /NUNCA sugira mentir \(ex\.: dizer que o estúdio fica no país da cliente/)
    assert.match(promptDaAna({ idioma: 'es', objetivo: 'x', tabelaPrecos: 'y', prazoMin: 60, temas: 'z', historico: [] }), /NUNCA diga que o estúdio fica no país ou na cidade da cliente/)
    assert.equal(bloqueioDaResposta('Somos 100% online y atendemos toda Argentina 😊', { tabelaPrecos: 'x', prazoMin: 60 }), null)
  },
  'sem chave da Anthropic não chama a rede (nem o banco)': async () => {
    const antes = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY
    const r = await revisarConversas({} as never)
    if (antes !== undefined) process.env.ANTHROPIC_API_KEY = antes
    assert.deepEqual(r, { revisadas: 0, achados: 0, erros: ['ANTHROPIC_API_KEY ausente'] })
  },
  'estrutura: SQL novo, cron de hora em hora, rota liberada no proxy, despachante e aba': () => {
    const sql = ler('supabase/migrations/20261108000000_estudio_ia_supervisor.sql')
    for (const x of ['ADD COLUMN IF NOT EXISTS revisado_ate', 'CREATE TABLE IF NOT EXISTS estudio_revisoes', 'CREATE TABLE IF NOT EXISTS estudio_achados', "cron.schedule('estudio-supervisor', '17 * * * *'", 'REVOKE ALL ON estudio_achados  FROM anon']) assert.ok(sql.includes(x), x)
    assert.ok(!/ALTER TABLE estudio_(pedidos|entregas|temas|poses|eventos) RENAME/.test(sql), 'nada da seção 4 renomeado')
    assert.ok(ler('src/proxy.ts').includes("'/api/cron/estudio-supervisor'"))
    assert.match(ler('src/app/api/cron/estudio-supervisor/route.ts'), /revisarConversas\(createAdminClient\(\)\)/)
    const r = ler('src/app/api/estudio/route.ts')
    for (const op of ['painelSupervisor', 'aplicarAchado', 'ignorarAchado', 'revisarAgoraSupervisor']) assert.ok(r.includes(op), op)
    assert.match(ler('src/app/(dashboard)/estudio-ia/estudio-client.tsx'), /aba === 'supervisor' \? <AbaSupervisor \/>/)
    assert.match(ler('src/lib/estudio/supervisor-servidor.ts'), /finalidade: 'supervisor'/)
  },
  'achados do Supervisor (1ª rodada) viraram regra do sistema': () => {
    const PRECOS = [[2, 690], [3, 890]].map(([q, v]) => ({ pacote_qtd: q, valor_cents: v, moeda: 'USD', link_pagamento: 'https://pay' }))
    const POSES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, '0'))
    const ctx: Contexto = { idioma: 'es', precos: PRECOS, posesDoTema: () => POSES, temasAtivos: ['aniversario', 'corporativo', 'casual', 'sensual'], pix: false, fotos: { tem_rosto: true, tem_corpo: true, rosto_recortado: false, unica: false } }
    const chaves = (a: Acao[]) => a.map(x => x.t === 'texto' || x.t === 'audio' ? `${x.t}:${x.chave}` : x.t)
    // nº 4/8: depois do tema, só 1 áudio + catálogo + tabela
    assert.deepEqual(chaves(proximoPasso('tema', { nome: 'Ana' }, { tipo: 'texto', texto: '1' }, ctx).acoes), ['audio:a2', 'catalogo', 'texto:tabela_precos'])
    // nº 6: prévia na fila → sem tabela logo depois, e as retomadas esperam
    const pv = proximoPasso('previa_fotos', { tema: 'aniversario', tem_rosto: true, tem_corpo: true, etapa_antes_previa: 'pacote' }, { tipo: 'texto', texto: '07' }, ctx)
    assert.ok(!chaves(pv.acoes).includes('texto:tabela_precos')); assert.equal(pv.dados.aguardando_previa, true)
    const base = { etapa: 'pacote' as const, modo: 'ana', cobrancas: 0, janela_ate: '2099-01-01T00:00:00Z', aguardando_desde: min(60), ultima_cliente_em: null }
    assert.equal(cobrancaDevida({ ...base, aguardando_previa: true }, AGORA), null)
    assert.deepEqual(mensagensDaRetomada('cobranca_1', 'pacote', { aguardando_previa: true }).chaves, [])
    // nº 5: a mesma retomada nunca 2× (vira "alguma dúvida?", e essa só 1×)
    assert.deepEqual(mensagensDaRetomada('cobranca_1', 'pacote', { tema: 'casual', retomadas: ['rmk_pacote'] }).chaves, ['rmk_duvida'])
    assert.deepEqual(mensagensDaRetomada('cobranca_1', 'pacote', { tema: 'casual', retomadas: ['rmk_pacote', 'rmk_duvida'] }).chaves, [])
    // nº 9: "voy a hablar con mi hija" → 1 resposta, retomada só ~20 h depois, suave e sem prévia
    assert.ok(consultaAlguem('Lo voy a hablar con mi hija y te aviso') && consultaAlguem('vou falar com meu marido') && !consultaAlguem('quiero 3 fotos'))
    const c = proximoPasso('pacote', { tema: 'aniversario' }, { tipo: 'texto', texto: 'Voy a hablar con mi hija' }, { ...ctx, agoraMs: AGORA.getTime() })
    assert.deepEqual(chaves(c.acoes), ['texto:pausa_ok']); assert.equal(c.dados.adiar_retomada_min, 1200); assert.equal(c.dados.pausa_longa, true)
    assert.deepEqual(mensagensDaRetomada('cobranca_2', 'pacote', c.dados), { chaves: ['rmk_suave'], oferecePrevia: false, encerrar: true })
    // nº 10: nome de perfil que não é de pessoa
    assert.equal(nomeDoPerfil('Ramo de flores'), null); assert.equal(nomeDoPerfil('Tienda Sofi'), null)
    // nº 3: IA que já terminou perguntando não ganha o lembrete repetido
    const ex = ler('src/lib/estudio/ana/executor.ts')
    assert.match(ex, /if \(iaPerguntou && LEMBRETES_DA_IA\.has\(a\.chave\)\) break/)
    assert.match(ler('src/lib/estudio/producao-servidor.ts'), /aguardando_previa: false/)
  },
  'prévia mandada à mão pela aba Conversas sai com marca d\'água': () => {
    const c = ler('src/app/actions/estudio-chat.ts')
    assert.match(c, /if \(previas\.has\(e\.pedido_id\)\)/)
    assert.match(c, /prepararEnvio\(Buffer\.from\(await arq\.arrayBuffer\(\)\), true\)/)
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
