// ============================================================================
// Painel compartilhado de leads — link com senha + métricas
// ----------------------------------------------------------------------------
// O que está em jogo: esta é a primeira porta do sistema que entrega DADOS DE
// LEAD para alguém sem conta. Cada teste trava uma forma de essa porta abrir
// mais do que deve:
//
//   • senha em claro no banco;
//   • comparação de senha que vaza tempo;
//   • recusa que diz qual das três coisas falhou (link, ativação, senha);
//   • senha na URL (log de servidor, histórico, Referer);
//   • rota pública fora da lista do proxy (cairia no login e "não funciona").
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  gerarTokenShare, hashSenhaShare, verificarSenhaShare,
  validarSenhaShare, tokenShareValido,
} from '../share'
import { funilPorPagina, type ExportPageInfo, type ExportLeadResumo } from '../leads-core'
import {
  linkWhatsApp, linkWhatsAppComMensagem, nomeDoLead, statusPortalValido,
  temContato, publicoPortalValido, distribuirRodizio, leadParado,
  vocabulario, modoPortalValido, chaveTelefone, identificarMembro,
} from '../portal'
import { contatoDasRespostas, contatoPorFormato, preencheuPaginas } from '../leads-core'
import {
  criarSessaoPortal, sessaoPortalValida, lerSessaoPortal, PORTAL_SESSAO_MS,
} from '../portal-session'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void }[] = []
function test(name: string, fn: () => void) { suite.push({ name, fn }) }

// ════════════════════════════════════════════════════════════════════════════

test('1) a senha NUNCA é guardada em claro', () => {
  const guardado = hashSenhaShare('minha-senha-123')
  assert.ok(!guardado.includes('minha-senha-123'), 'a senha aparece no que vai para o banco')
  assert.match(guardado, /^[0-9a-f]{32}:[0-9a-f]{64}$/, 'formato salt:hash esperado')
  // Sal aleatório: a MESMA senha gera hashes diferentes — tabela vazada não
  // permite agrupar quem usa a mesma senha.
  assert.notEqual(hashSenhaShare('abc123'), hashSenhaShare('abc123'))
})

test('2) verificação: certa passa, errada não, lixo não explode', () => {
  const guardado = hashSenhaShare('Cliente@2026')
  assert.equal(verificarSenhaShare('Cliente@2026', guardado), true)
  assert.equal(verificarSenhaShare('cliente@2026', guardado), false, 'maiúscula importa')
  assert.equal(verificarSenhaShare('', guardado), false)
  assert.equal(verificarSenhaShare('x', 'formato-quebrado'), false)
  assert.equal(verificarSenhaShare('x', ''), false)
})

test('3) a comparação é em tempo constante (timingSafeEqual)', () => {
  const s = ler('src/lib/quiz/share.ts')
  assert.ok(s.includes('timingSafeEqual'), 'comparação comum vaza a senha pelo tempo de resposta')
  assert.ok(s.includes('scryptSync'), 'hash rápido demais barateia o chute em massa')
  assert.ok(!/sha256\(/.test(s), 'sha256 puro não serve para senha curta de pessoa')
})

test('4) token do link: 128 bits, formato validado na borda', () => {
  const t1 = gerarTokenShare()
  assert.ok(tokenShareValido(t1), `token gerado não passa na própria validação: ${t1}`)
  assert.ok(t1.length >= 20, 'token curto demais é adivinhável')
  assert.notEqual(gerarTokenShare(), gerarTokenShare())
  // O que não geramos, não passa.
  assert.equal(tokenShareValido('abc'), false)
  assert.equal(tokenShareValido('../../etc/passwd'), false)
  assert.equal(tokenShareValido("' OR 1=1--0000000000000"), false)
})

test('5) senha fraca é recusada ANTES de criar o link', () => {
  assert.ok(validarSenhaShare('abc') !== null, '3 caracteres passou')
  assert.equal(validarSenhaShare('abcd'), null)
  assert.ok(validarSenhaShare('x'.repeat(100)) !== null)
})

test('6) a rota pública não dá pista e não recebe senha pela URL', () => {
  const r = ler('src/app/api/portal/[token]/route.ts')
  const recusas = r.match(/RECUSADO/g) ?? []
  assert.ok(recusas.length >= 4, 'link inexistente, desativado e senha errada precisam da MESMA resposta')
  assert.ok(!r.includes('export async function GET'), 'GET receberia a senha pela URL')
  assert.ok(r.includes('request.json()'), 'a senha precisa vir no corpo do POST')
  assert.ok(r.includes('espera(1000)'), 'sem espera, chutar senha em massa sai de graça')
  assert.ok(r.includes('verificarSenhaShare'), 'a rota não confere a senha')
  // O tenant sai da LINHA DO PORTAL — nunca do chamador.
  assert.ok(r.includes('portal.tenant_id'), 'tenant vindo de fora seria escrita cross-tenant')
})

test('7) as rotas públicas estão na lista do proxy', () => {
  const p = ler('src/proxy.ts')
  assert.ok(p.includes("'/api/portal'"), 'a API cairia no redirect de login')
  assert.ok(p.includes("'/ql/'"), 'a página pediria sessão a quem não tem conta')
})

test('8) renovar o portal INVALIDA o link anterior e valida a seleção', () => {
  const a = ler('src/app/actions/quiz-leads.ts')
  const trecho = a.slice(a.indexOf('export async function ativarPortal'))
  assert.ok(trecho.includes('gerarTokenShare()'), 'ativar sem token novo deixaria o link velho vivo')
  assert.ok(a.includes('hashSenhaShare'), 'a action gravaria a senha em claro')
  // Lista branca: só quizzes DO TENANT entram — id de fora é descartado.
  assert.ok(trecho.includes("permitidos.has(q.pageId)"), 'quiz de outro tenant entraria no portal')
  // A senha não volta para a tela em nenhuma consulta.
  const consulta = a.slice(a.indexOf('export async function getPortalDoQuiz'), a.indexOf('export interface AtivarPortalInput'))
  assert.ok(!consulta.includes('password_hash'), 'até o hash deve ficar no servidor')
})

test('9) a migration do portal: sem senha em claro, RLS, e o link antigo sobrevive', () => {
  const m = ler('supabase/migrations/20260823000000_client_portals.sql')
  assert.ok(m.includes('password_hash'), 'coluna de senha ausente')
  assert.ok(!/\bpassword\s+text\b/.test(m), 'coluna "password" sugeriria senha em claro')
  assert.ok(m.includes('ENABLE ROW LEVEL SECURITY'))
  assert.ok(m.includes('UNIQUE (portal_id, page_id)'), 'o mesmo funil entraria duas vezes no portal')
  assert.ok(m.includes('UNIQUE (portal_id, lead_id)'), 'o status do lead duplicaria por clique')
  // Status é lista FECHADA no banco também — a rota valida, o banco garante.
  assert.ok(m.includes("CHECK (status IN ('novo', 'contactado', 'agendado', 'fechado', 'perdido'))"),
    'texto livre viraria status')
  // Link já enviado a cliente não pode morrer numa atualização.
  assert.ok(m.includes("to_regclass('public.quiz_share_links')"),
    'a migração ignoraria links antigos que o cliente já tem no WhatsApp')
})

test('10) o portal não persiste a senha no navegador', () => {
  const c = ler('src/app/ql/[token]/share-panel-client.tsx')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  // O navegador guarda só o TELEFONE (identificação, para não redigitar).
  // Senha em armazenamento sobreviveria à aba — isso continua proibido.
  for (const uso of c.match(/localStorage\.[a-zA-Z]+\([^)]*\)/g) ?? []) {
    assert.ok(uso.includes('fp_tel_'), `localStorage guardando outra coisa: ${uso}`)
    assert.ok(!/senha/i.test(uso), 'senha em localStorage sobrevive à aba')
  }
  assert.ok(!c.includes('document.cookie'), 'senha em cookie viaja em toda requisição')
  assert.ok(c.includes("type=\"password\""), 'o campo mostraria a senha digitada')
})

test('10b) status do lead: só o que o dono permitiu, só lead do portal', () => {
  const r = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(r.includes('portal.permitir_status'), 'cliente marcaria status com a opção desligada')
  assert.ok(r.includes('statusPortalValido(corpo.status)'), 'texto livre entraria como status')
  assert.ok(r.includes("quizzes.find(q => q.id === String(lead.quiz_id))"),
    'lead de funil FORA do portal aceitaria status — ids adivinhados vazariam existência')
  // Público 'concluidos': lead não-quente é invisível também para escrita.
  assert.ok(r.includes("quiz.publico === 'concluidos' && lead.status !== 'completed'"),
    'o cliente escreveria em lead que nem pode ver')
  assert.ok(r.includes("onConflict: 'portal_id,lead_id'"), 'cada clique criaria uma linha nova')
})

test('10c) WhatsApp: número brasileiro vira link certo; lixo vira null', () => {
  assert.equal(linkWhatsApp('(88) 99999-8888'), 'https://wa.me/5588999998888')
  assert.equal(linkWhatsApp('088 99999 8888'), 'https://wa.me/5588999998888', 'zero à esquerda')
  assert.equal(linkWhatsApp('5588999998888'), 'https://wa.me/5588999998888', 'já com DDI')
  assert.equal(linkWhatsApp('8899998888'), 'https://wa.me/558899998888', 'fixo com DDD')
  assert.equal(linkWhatsApp('999'), null, 'link quebrado é pior que sem link')
  assert.equal(linkWhatsApp(''), null)
  assert.equal(linkWhatsApp(null), null)

  assert.equal(nomeDoLead({ name: '  ', email: 'ana@x.com' }), 'ana', 'sem nome, o e-mail apresenta')
  assert.equal(nomeDoLead({}), 'Lead sem nome')

  assert.equal(statusPortalValido('fechado'), true)
  assert.equal(statusPortalValido('DROP TABLE'), false)
  assert.equal(statusPortalValido(''), false)
})

test('11) funil por página: mede onde as pessoas param', () => {
  const paginas: ExportPageInfo[] = [
    { id: 'p1', titulo: 'Boas-vindas', colunas: [] },                       // sem pergunta: fora
    { id: 'p2', titulo: 'Perfil', colunas: [{ chave: 'b1', rotulo: 'Nome', respostas: 0 }] },
    { id: 'p3', titulo: 'Contato', colunas: [{ chave: 'b2', rotulo: 'Email', respostas: 0 }] },
  ]
  const leads: ExportLeadResumo[] = [
    { id: 'l1', chaves: ['b1', 'b2'], concluido: true },
    { id: 'l2', chaves: ['b1'], concluido: false },
    { id: 'l3', chaves: ['b1'], concluido: false },
    { id: 'l4', chaves: [], concluido: false },
  ]
  const funil = funilPorPagina(paginas, leads)
  assert.equal(funil.length, 2, 'página sem pergunta não tem como ser medida')
  assert.equal(funil[0].leads, 3)
  assert.equal(funil[0].pct, 100, 'a primeira etapa com gente é a base')
  assert.equal(funil[1].leads, 1)
  assert.equal(funil[1].pct, 33, '2 em cada 3 pararam entre Perfil e Contato')
})

test('12) funil vazio não divide por zero', () => {
  const funil = funilPorPagina(
    [{ id: 'p1', titulo: 'X', colunas: [{ chave: 'b1', rotulo: 'Y', respostas: 0 }] }],
    [],
  )
  assert.equal(funil[0].leads, 0)
  assert.equal(funil[0].pct, 0)
  assert.ok(Number.isFinite(funil[0].pct))
})

test('13) CSV/PDF são UMA implementação para os dois painéis', () => {
  const view = ler('src/components/quiz/quiz-leads-view.tsx')
  const publico = ler('src/app/ql/[token]/share-panel-client.tsx')
  assert.ok(view.includes("from '@/components/quiz/export-files'"), 'o painel logado tem cópia própria')
  assert.ok(publico.includes("from '@/components/quiz/export-files'"), 'o painel público tem cópia própria')
  assert.ok(!view.includes('function montarCsv'), 'a duplicata antiga voltou ao componente')
})

test('13b) editar o acesso NÃO troca o link nem a senha', () => {
  const a = ler('src/app/actions/quiz-leads.ts')
  const trecho = a.slice(a.indexOf('export async function atualizarPortalConfig'),
    a.indexOf('export async function desativarPortal'))
  assert.ok(trecho.length > 100, 'sem como editar um acesso já criado')
  assert.ok(!trecho.includes('gerarTokenShare'), 'editar mataria o link que o cliente já tem')
  assert.ok(!trecho.includes('password_hash'), 'editar mexeria na senha')
  assert.ok(trecho.includes('permitidos.has(q.pageId)'), 'quiz de outro tenant entraria na edição')
  // A tela oferece salvar sem senha — era o que fazia a escolha se perder.
  const v = ler('src/components/quiz/quiz-leads-view.tsx')
  assert.ok(v.includes('Salvar alterações (mesmo link e senha)'), 'sem salvar sem trocar a senha')
  assert.ok(v.includes('atualizarPortalConfig'), 'o botão não chama a edição')
})

test('13c) público "deixou contato": o lead que dá para ATENDER', () => {
  // O funil real: contato pedido na penúltima página, botão na última. Quem
  // deixa telefone e não clica no botão "não concluiu" — mas é o melhor lead
  // que existe. As três opções antigas escondiam justamente essa pessoa.
  assert.equal(publicoPortalValido('com_contato'), true, 'a opção não existe')
  assert.equal(temContato({ phone: '88999998888' }), true)
  assert.equal(temContato({ email: 'a@b.com' }), true)
  assert.equal(temContato({ phone: '   ', email: '' }), false, 'espaço em branco não é contato')
  assert.equal(temContato({}), false)

  const core = ler('src/lib/quiz/leads-core.ts')
  assert.ok(core.includes("if (publico === 'com_contato')"), 'o filtro novo não é aplicado')
  // 🔥 passa a significar "dá para atender", e "concluiu" vira informação à parte.
  assert.ok(core.includes('quente: temContato('), '🔥 continuaria preso a "concluiu"')
  assert.ok(core.includes("concluiu: l.status === 'completed'"), 'perdeu a informação de conclusão')

  // O arquivo baixado tem EXATAMENTE os leads da tela — sem filtrar de novo.
  const rota = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(rota.includes('apenasIds: leads.map(l => l.id)'), 'CSV e tela podem divergir')
  // Escrita de status respeita o público novo.
  assert.ok(rota.includes("quiz.publico === 'com_contato' && !temContato("),
    'lead sem contato aceitaria status num portal que só mostra quem tem contato')

  const m = ler('supabase/migrations/20260825000000_portal_publico_contato.sql')
  assert.ok(m.includes("'com_contato'"), 'o banco recusaria o público novo')
  assert.ok(m.includes('to_regclass'), 'a migration quebraria antes da do portal')
})

test('13d) sessão do portal: F5 não desloga, e a senha não vai no cookie', () => {
  const chave = 'salt:hash-do-portal'
  const cookie = criarSessaoPortal('tok123', chave)
  assert.equal(sessaoPortalValida(cookie, 'tok123', chave), true)

  // Cookie de OUTRO portal não vale.
  assert.equal(sessaoPortalValida(cookie, 'outro', chave), false)
  // Trocar a senha invalida tudo na hora (a chave é o próprio hash).
  assert.equal(sessaoPortalValida(cookie, 'tok123', 'salt:hash-NOVO'), false)
  // Assinatura adulterada não passa.
  assert.equal(sessaoPortalValida(`tok123.${Date.now() + 60_000}.forjado`, 'tok123', chave), false)
  // Expirado não passa.
  assert.equal(sessaoPortalValida(cookie, 'tok123', chave, Date.now() + PORTAL_SESSAO_MS + 1_000), false)
  // Lixo não explode.
  for (const v of ['', 'a.b', 'a.b.c.d', undefined, null]) {
    assert.equal(sessaoPortalValida(v as string | undefined, 'tok123', chave), false)
  }

  // O cookie NÃO carrega a senha, e o JS da página não consegue lê-lo.
  const rota = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(rota.includes('httpOnly: true'), 'cookie legível por JS seria roubável')
  assert.ok(rota.includes('secure: true'))
  assert.ok(rota.includes('sameSite:'), 'sem SameSite o cookie viaja em requisição de terceiro')
  // F5 não pode inflar o contador de acessos.
  assert.ok(rota.includes('if (porSenha) {'), 'cada F5 contaria como acesso novo')
})

test('13e) "Lead sem nome": o contato vem das RESPOSTAS quando o cadastro é vazio', () => {
  const paginas: ExportPageInfo[] = [{
    id: 'p2', titulo: 'Contato', colunas: [
      { chave: 'b_obs', rotulo: 'Observação', respostas: 0, tipo: 'field_text' },
      { chave: 'b_nome', rotulo: 'Qual seu nome?', respostas: 0, tipo: 'field_text' },
      { chave: 'b_fone', rotulo: 'WhatsApp', respostas: 0, tipo: 'field_phone' },
      { chave: 'b_mail', rotulo: 'E-mail', respostas: 0, tipo: 'field_email' },
    ],
  }]
  const c = contatoDasRespostas(paginas, {
    b_obs: 'quero emagrecer', b_nome: 'Maria Silva', b_fone: '88 99999-8888', b_mail: 'maria@x.com',
  })
  assert.equal(c.nome, 'Maria Silva', 'o campo com "nome" no rótulo é quem apresenta')
  assert.equal(c.telefone, '88 99999-8888')
  assert.equal(c.email, 'maria@x.com')

  // Sem campo rotulado "nome": o primeiro texto respondido apresenta.
  const c2 = contatoDasRespostas(paginas, { b_obs: 'Maria' })
  assert.equal(c2.nome, 'Maria')
  // Sem resposta nenhuma: nulos, nunca string vazia.
  assert.deepEqual(contatoDasRespostas(paginas, {}), { nome: null, email: null, telefone: null })

  const core = ler('src/lib/quiz/leads-core.ts')
  assert.ok(core.includes('contatoDasRespostas(paginas, respostas['), 'o portal não usa o derivado')
  assert.ok(core.includes("(l.name ?? '').trim() || derivado.nome"), 'o cadastro deve vencer quando existe')
})

test('13f) páginas de resposta escolhidas pelo dono chegam ao portal', () => {
  const m = ler('supabase/migrations/20260826000000_portal_paginas.sql')
  assert.ok(m.includes('ADD COLUMN IF NOT EXISTS paginas'), 'sem onde guardar a escolha')

  const rota = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(rota.includes('pageIds: quiz.paginas'), 'a escolha do dono não filtra as colunas')
  // Lista vazia = só contato — nada de vazar o quiz inteiro por padrão.
  assert.ok(rota.includes('COLUNAS_LEAD.map(c => c.chave)'), 'sem páginas marcadas vazaria tudo')

  const v = ler('src/components/quiz/quiz-leads-view.tsx')
  assert.ok(v.includes('Respostas que o cliente vê'), 'o modal não oferece a escolha')
  assert.ok(v.includes('paginas: [...(paginasSel.get(pageId)'), 'a escolha não é enviada')

  const c = ler('src/app/ql/[token]/share-panel-client.tsx')
  assert.ok(c.includes('Ver respostas ('), 'o cliente não vê as respostas organizadas')
  assert.ok(c.includes('respostasDoLead'), 'as respostas não vêm da mesma tabela do CSV')
  // Filtro por dia na página do cliente, valendo para o arquivo também.
  assert.ok(c.includes("['7d', '7 dias']"), 'sem filtro rápido por período')
  assert.ok(c.includes('diaEspecifico'), 'sem escolher um dia específico')
  assert.ok(c.includes('visiveis.has(x.id)'), 'o CSV ignoraria o filtro da tela')
})

test('13g) quiz EDITADO depois dos leads: o formato reconhece o contato', () => {
  // Ids de bloco mudam quando o quiz é reeditado — a estrutura atual não casa
  // com os eventos antigos e a derivação por estrutura volta vazia. O formato
  // do que foi digitado não depende de id nenhum.
  const c = contatoPorFormato(['Maria Silva', '(88) 99999-8888', 'maria@x.com'])
  assert.equal(c.nome, 'Maria Silva')
  assert.equal(c.telefone, '(88) 99999-8888')
  assert.equal(c.email, 'maria@x.com')

  // Ordem não importa; o primeiro de cada formato vence.
  const c2 = contatoPorFormato(['88999998888', 'João'])
  assert.equal(c2.telefone, '88999998888')
  assert.equal(c2.nome, 'João')

  // Texto de resposta comum não vira telefone nem some com o nome.
  const c3 = contatoPorFormato(['Quero emagrecer 10kg'])
  assert.equal(c3.telefone, null)
  assert.equal(c3.nome, 'Quero emagrecer 10kg')
  assert.deepEqual(contatoPorFormato([]), { nome: null, email: null, telefone: null })

  const core = ler('src/lib/quiz/leads-core.ts')
  assert.ok(core.includes('|| porFormato.nome'), 'a rede de segurança não é usada')
  assert.ok(core.includes("ev.event_type === 'text_entered'"),
    'opção de múltipla escolha viraria "nome"')
})

test('13h) escolha de páginas nunca é descartada em silêncio', () => {
  const a = ler('src/app/actions/quiz-leads.ts')
  assert.ok(a.includes("quizzes.some(q => q.paginas.length > 0 || q.modo !== 'vendas' || q.desde)"),
    'salvar sem a coluna descartaria a escolha sem avisar')
  assert.ok(a.includes('20260826000000_portal_paginas.sql'),
    'o erro não diz qual migration falta')
  // Páginas escolhidas que já não existem não podem derrubar o portal.
  const rota = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(rota.includes("'error' in tabela\n        ? await montarTabelaLeads") ||
    rota.includes("tabelaFinal"), 'tabela com páginas velhas viraria portal vazio')
})

test('13i) título do cartão usa o dado do PORTAL (nome/telefone, não name/phone)', () => {
  // O defeito: nomeDoLead lia lead.name/lead.phone (formato do banco), mas o
  // portal fala nome/telefone — o cartão dizia "Lead sem nome" com o nome
  // logo abaixo, dentro de "Ver respostas".
  const c = ler('src/app/ql/[token]/share-panel-client.tsx')
  assert.ok(c.includes('nomeDoLead({ name: l.nome, email: l.email, phone: l.telefone })'),
    'o descasamento de campos voltou')
  assert.ok(!/\{nomeDoLead\(l\)\}/.test(c), 'nomeDoLead(l) lê os campos errados')
})

test('13j) público "preencheu as páginas marcadas": só entra quem cumpriu', () => {
  const paginas: ExportPageInfo[] = [
    { id: 'p4', titulo: 'Página 4', colunas: [{ chave: 'b4', rotulo: 'Pergunta', respostas: 0, tipo: 'single_choice' }] },
    { id: 'p6', titulo: 'Página 6', colunas: [{ chave: 'b6', rotulo: 'Nome', respostas: 0, tipo: 'field_text' }] },
    { id: 'p7', titulo: 'Obrigado', colunas: [] },   // sem pergunta: não barra
  ]
  const exigidas = ['p4', 'p6', 'p7']
  assert.equal(preencheuPaginas(paginas, exigidas, { b4: 'Serviços', b6: 'Ana' }), true)
  assert.equal(preencheuPaginas(paginas, exigidas, { b4: 'Serviços' }), false,
    'respondeu a 4 mas não a 6 — não cumpriu')
  assert.equal(preencheuPaginas(paginas, exigidas, {}), false)
  assert.equal(preencheuPaginas(paginas, [], { }), true, 'sem exigência, todo mundo passa')

  const rota = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(rota.includes('quiz.publico, quiz.paginas'), 'as páginas exigidas não chegam ao filtro')
  // Escrita de status também respeita: lead fora do cumprimento é invisível.
  assert.ok(rota.includes("quiz.publico === 'paginas'"), 'status aceitaria lead que não cumpriu')

  const m = ler('supabase/migrations/20260827000000_portal_publico_paginas.sql')
  assert.ok(m.includes("'paginas'"), 'o banco recusaria o público novo')

  // Kanban + custo por venda no portal.
  const c = ler('src/app/ql/[token]/share-panel-client.tsx')
  assert.ok(c.includes("'kanban'"), 'sem visão kanban')
  assert.ok(c.includes('STATUS_PORTAL.map(coluna =>'), 'kanban sem uma coluna por situação')
  // Largura total + arrastar e soltar (com o seletor mantido para o celular).
  assert.ok(c.includes('w-screen'), 'o quadro voltaria a ficar cortado na coluna central')
  assert.ok(c.includes('draggable={compacto}'), 'cartão do kanban não arrasta')
  assert.ok(c.includes("e.dataTransfer.getData('text/plain')"), 'a coluna não recebe o solto')
  assert.ok(c.includes('void marcarStatus(id, coluna)'), 'soltar não grava o status')
  assert.ok(c.includes("statusCliente === 'fechado'"), 'custo por venda sem contar os fechados')
  assert.ok(c.includes('custoPorVendaCents'), 'sem custo por venda')
})

test('13k) "chegou ao final" = viu a última página (não só clicou em Próximo)', () => {
  // O defeito: status 'completed' só nasce do clique em "Próximo" na última
  // página. Funil que termina em obrigado com botão externo contava 0
  // conclusões com gente chegando lá todo dia.
  const core = ler('src/lib/quiz/leads-core.ts')
  assert.ok(core.includes('export async function idsQueConcluiram'), 'sem a régua nova')
  assert.ok(core.includes("['quiz_completed', 'page_viewed']"),
    'a régua não olha a visualização da última página')
  assert.ok(core.includes("l.status === 'completed' || concluiram.has(String(l.id))"),
    'o caminho antigo deixaria de contar')
  // As DUAS contagens (portal e painel do dono) usam a mesma régua.
  assert.ok((core.match(/idsQueConcluiram\(/g) ?? []).length >= 3,
    'painel e portal contariam conclusão de jeitos diferentes')
})

test('13l) equipe: rodízio justo, WhatsApp com mensagem, lead parado', () => {
  // Rodízio: quem tem MENOS leads recebe primeiro.
  const r = distribuirRodizio(['l1', 'l2', 'l3'], ['a', 'b'], { a: 5, b: 0 })
  assert.deepEqual(r.map(x => x.memberId), ['b', 'b', 'b'],
    'b tem 0 contra 5 de a — os três vão para b até empatar')
  const equilibrado = distribuirRodizio(['l1', 'l2', 'l3', 'l4'], ['a', 'b'], {})
  assert.deepEqual(equilibrado.map(x => x.memberId), ['a', 'b', 'a', 'b'], 'um para cada, na ordem')
  assert.deepEqual(distribuirRodizio(['l1'], [], {}), [], 'sem vendedor, ninguém recebe')

  // Mensagem: {nome} vira o primeiro nome; sem template, link puro.
  assert.equal(
    linkWhatsAppComMensagem('88999998888', 'Oi {nome}!', 'Maria Silva'),
    `https://wa.me/5588999998888?text=${encodeURIComponent('Oi Maria!')}`)
  assert.equal(linkWhatsAppComMensagem('88999998888', '', 'Maria'), 'https://wa.me/5588999998888')
  assert.equal(linkWhatsAppComMensagem(null, 'Oi', 'M'), null)

  // ⏰: quente + sem atendimento + >24h.
  const ontem = new Date(Date.now() - 25 * 3600_000).toISOString()
  assert.equal(leadParado(ontem, 'novo', true), true)
  assert.equal(leadParado(ontem, 'contactado', true), false, 'atendido não é parado')
  assert.equal(leadParado(ontem, 'novo', false), false, 'sem contato não há quem atender')
  assert.equal(leadParado(new Date().toISOString(), 'novo', true), false, 'recente não é parado')
})

test('13m) equipe: migração, ações gateadas e vendedor nunca apagado', () => {
  const m = ler('supabase/migrations/20260828000000_portal_equipe.sql')
  assert.ok(m.includes('portal_members'), 'sem tabela de vendedores')
  assert.ok(m.includes('ON DELETE SET NULL'), 'remover vendedor apagaria a atribuição em cascata')
  assert.ok(m.includes('ENABLE ROW LEVEL SECURITY'))

  const rota = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(rota.includes("['equipe_salvar', 'equipe_remover', 'atribuir', 'equipe_config']"),
    'ações de equipe fora do gate de permissão')
  assert.ok(rota.includes(".update({ ativo: false })"), 'remover apaga o histórico do vendedor')
  assert.ok(rota.includes('distribuirRodizio'), 'sem rodízio automático no servidor')
  // Atribuição só em lead DO portal, e só para vendedor que existe.
  assert.ok(rota.includes('quizzes.some(q => q.id === String(lead.quiz_id))'),
    'lead de fora aceitaria responsável')
  assert.ok(rota.includes('membros.some(m => m.id === memberId)'),
    'id inventado viraria responsável')

  const c = ler('src/app/ql/[token]/share-panel-client.tsx')
  assert.ok(c.includes('Equipe de vendedores'), 'sem tela de equipe')
  assert.ok(c.includes("'portal:resp'"), 'CSV sem a coluna Responsável')
})

test('13n) modo do funil: vagas fala "candidato", vendas fala "lead"', () => {
  const vagas = vocabulario('vagas')
  assert.equal(vagas.varios, 'Candidatos')
  assert.equal(vagas.status.fechado, 'Contratado ✓', 'RH não fecha lead, contrata gente')
  assert.equal(vagas.status.agendado, 'Entrevista marcada')
  assert.equal(vagas.status.perdido, 'Descartado')

  const vendas = vocabulario('vendas')
  assert.equal(vendas.varios, 'Leads')
  assert.equal(vendas.status.fechado, 'Fechado ✓')

  assert.equal(modoPortalValido('vagas'), true)
  assert.equal(modoPortalValido('rh'), false)

  const m = ler('supabase/migrations/20260829000000_portal_modo.sql')
  assert.ok(m.includes("CHECK (modo IN ('vendas', 'vagas'))"), 'o banco aceitaria modo inventado')

  // O portal usa o vocabulário nos status (select, kanban e CSV).
  const c = ler('src/app/ql/[token]/share-panel-client.tsx')
  assert.ok(c.includes('voc.status[opt]'), 'o select mostraria "Fechado" para RH')
  assert.ok(c.includes('voc.status[coluna]'), 'o kanban ignoraria o modo')
  assert.ok(c.includes('voc.status[(l.statusCliente'), 'o CSV sairia com o rótulo errado')
})

test('13o) telefone identifica o vendedor — e ele só enxerga a fila dele', () => {
  // Mesma senha para todos; o TELEFONE diz quem é. Números anotados de jeitos
  // diferentes precisam bater: com DDI, sem DDI, com máscara.
  assert.equal(chaveTelefone('(88) 99999-8888'), '99998888')
  assert.equal(chaveTelefone('5588999998888'), '99998888')
  assert.equal(chaveTelefone('88999998888'), '99998888')
  assert.equal(chaveTelefone('123'), null, 'número curto demais não identifica ninguém')
  assert.equal(chaveTelefone(''), null)

  const equipe = [
    { id: 'm1', whatsapp: '(88) 99999-8888' },
    { id: 'm2', whatsapp: '5588988887777' },
  ]
  assert.equal(identificarMembro(equipe, '88999998888')?.id, 'm1')
  assert.equal(identificarMembro(equipe, '(88) 98888-7777')?.id, 'm2')
  assert.equal(identificarMembro(equipe, '11912345678'), null, 'desconhecido = gestor')
  assert.equal(identificarMembro(equipe, ''), null)

  // O id do vendedor viaja ASSINADO: trocar à mão invalida a sessão.
  const chave = 'salt:hash'
  const cookie = criarSessaoPortal('tok123', chave, 'm1')
  assert.deepEqual(lerSessaoPortal(cookie, 'tok123', chave), { valida: true, membroId: 'm1' })
  const forjado = cookie.replace('.m1.', '.m2.')
  assert.equal(lerSessaoPortal(forjado, 'tok123', chave).valida, false,
    'trocar o vendedor no cookie daria acesso à fila do colega')
  // Gestor continua valendo (sem membro).
  assert.deepEqual(lerSessaoPortal(criarSessaoPortal('t', chave), 't', chave),
    { valida: true, membroId: null })
  assert.equal(sessaoPortalValida(cookie, 'tok123', chave), true)

  const rota = ler('src/app/api/portal/[token]/route.ts')
  // A FILA é filtrada no SERVIDOR: a lista dos outros nem viaja pela rede.
  assert.ok(rota.includes("filter(l => ehGestor || l.responsavelId === membroAtual!.id)"),
    'o vendedor receberia os leads de todo mundo e filtraria na tela')
  // Vendedor não gerencia equipe nem redistribui lead.
  assert.ok(rota.includes("Apenas o gestor pode gerenciar a equipe"),
    'vendedor poderia reatribuir lead chamando a rota na mão')
  // E só marca status do que é dele.
  assert.ok(rota.includes("String(dono?.assigned_member_id ?? '') !== membroAtual!.id"),
    'vendedor marcaria lead de colega')
})

test('14) o painel NÃO chama server action — transporte é HTTP', () => {
  // A regressão que isto trava: server action embute um id de build na
  // página; aba aberta durante um deploy chama um id que já não existe e
  // recebe o erro mascarado do Next. Foi o editor mudo e o modal em branco.
  const view = ler('src/components/quiz/quiz-leads-view.tsx')
  assert.ok(view.includes("from '@/lib/quiz/painel-client'"), 'o painel voltou às actions')
  const importaAcao = /import\s*\{[^}]*\}\s*from '@\/app\/actions\/quiz-leads'/.exec(view)
  if (importaAcao) {
    assert.ok(/import type/.test(importaAcao[0]), 'função de action importada direto no painel')
  }

  const editor = ler('src/components/quiz/quiz-editor-v2.tsx')
  assert.ok(editor.includes("from '@/lib/quiz/painel-client'"), 'salvar/publicar voltaram às actions')

  const rota = ler('src/app/api/painel-quiz/route.ts')
  assert.ok(rota.includes('const OPERACOES'), 'sem lista fechada de operações')
  assert.ok(!rota.includes("OPERACOES[corpo.op ?? '']?.call"), 'chamada dinâmica sem whitelist')
  // O despachante não duplica lógica: importa as MESMAS funções das actions.
  assert.ok(rota.includes("from '@/app/actions/quiz-leads'"), 'lógica duplicada no despachante')
  // Sessão caída vira 401 explícito, não erro sem sentido.
  assert.ok(rota.includes("digest.startsWith('NEXT_REDIRECT')"), 'redirect viraria 500 mascarado')

  const wrapper = ler('src/components/quiz/quiz-editor-wrapper.tsx')
  assert.ok(wrapper.includes('/api/quiz-editor-load/'), 'a carga do editor voltou à action')
})

test('15) CAUSA RAIZ: nenhum arquivo de actions re-exporta tipos', () => {
  // `export type { X }` num arquivo 'use server' NÃO é apagado pelo Turbopack:
  // vira re-exportação de runtime, o binding não existe, e o módulo INTEIRO
  // morre com ReferenceError na inicialização — todas as actions do grafo
  // passam a falhar com o erro mascarado do Next. Foi o editor mudo, o painel
  // de leads girando para sempre e o modal do portal em branco.
  for (const nome of readdirSync(join(RAIZ, 'src/app/actions'))) {
    if (!nome.endsWith('.ts')) continue
    const fonte = ler(`src/app/actions/${nome}`)
    if (!fonte.trimStart().startsWith("'use server'")) continue
    const semComentarios = fonte.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    assert.ok(!/^\s*export type \{/m.test(semComentarios),
      `${nome}: re-exportação de tipo em arquivo 'use server' derruba todas as actions`)
  }
})

test('13o) telefone que NÃO bate nunca vira gestor', () => {
  // O defeito relatado: vendedor logou e viu a lista inteira. O telefone não
  // casava com nenhum cadastro e o código caía em "gestor" em silêncio.
  const r = ler('src/app/api/portal/[token]/route.ts')
  assert.ok(r.includes('telefoneInformado.length > 0 && !membroAtual'),
    'telefone errado voltaria a virar gestor')
  assert.ok(r.includes('Este WhatsApp não está cadastrado na equipe'),
    'a recusa precisa dizer o que fazer')
  // Vendedor removido não pode ser promovido a gestor pelo cookie antigo.
  assert.ok(r.includes("!porSenha && sessao.membroId && !membroAtual"),
    'cookie de vendedor apagado viraria acesso total')
  // Sair: sessão de 12h presa era o outro caminho para "entrei e vi tudo".
  assert.ok(r.includes("acao === 'sair'"), 'sem como trocar de usuário')
  assert.ok(r.includes("maxAge: 0"), 'sair não apaga o cookie')

  const c = ler('src/app/ql/[token]/share-panel-client.tsx')
  assert.ok(c.includes('👑 Gestor · vendo todos'), 'o gestor não percebe que vê tudo')
  assert.ok(c.includes('void sair()'), 'sem botão de sair')
})

test('13p) data de corte: esconde do cliente, sem apagar nada', () => {
  const m = ler('supabase/migrations/20260830000000_portal_data_corte.sql')
  assert.ok(m.includes('ADD COLUMN IF NOT EXISTS desde date'), 'sem onde guardar o corte')
  assert.ok(!/DELETE|TRUNCATE/i.test(m), 'a data de corte NUNCA pode apagar lead')

  const core = ler('src/lib/quiz/leads-core.ts')
  assert.ok(core.includes('if (desde) {'), 'o corte não é aplicado')
  assert.ok(core.includes('return dia >= desde'), 'o dia do corte precisa ENTRAR na lista')

  const rota = ler('src/app/api/portal/[token]/route.ts')
  // O corte vale para a lista E para as métricas — senão "112 entraram"
  // voltaria a aparecer com 8 leads na tela.
  assert.ok((rota.match(/quiz\.desde/g) ?? []).length >= 3, 'métricas ignorariam o corte')

  const v = ler('src/components/quiz/quiz-leads-view.tsx')
  assert.ok(v.includes('Mostrar a partir de'), 'o dono não tem como escolher a data')
  assert.ok(v.includes('nada é apagado'), 'a tela precisa deixar claro que não apaga')
})

// ─── Execução ───────────────────────────────────────────────────────────────

for (const { name, fn } of suite) {
  try { fn(); results.push({ name, ok: true }) }
  catch (e) { results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) }) }
}
let passed = 0
for (const r of results) {
  if (r.ok) { passed++; console.log(`  ok   ${r.name}`) }
  else console.log(` FALHA ${r.name}\n        → ${r.error}`)
}
console.log(`\n${passed}/${results.length} testes passaram`)
if (passed !== results.length) process.exit(1)
