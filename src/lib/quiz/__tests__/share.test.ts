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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  gerarTokenShare, hashSenhaShare, verificarSenhaShare,
  validarSenhaShare, tokenShareValido,
} from '../share'
import { funilPorPagina, type ExportPageInfo, type ExportLeadResumo } from '../leads-core'
import { linkWhatsApp, nomeDoLead, statusPortalValido } from '../portal'

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
  assert.ok(!c.includes('localStorage'), 'senha em localStorage sobrevive à aba')
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
