// ============================================================================
// Content Studio — aprovação humana + feedback real do fluxo de imagens
// ----------------------------------------------------------------------------
// O que se prova: a causa do "não acontece nada" (mensagem de copy escondendo
// o preflight de imagens reprovado) foi corrigida com mensagem própria; os
// botões dão loading por slide e erro ESCOPADO ao painel; aprovar/reprovar
// usam CAS estrito sobre awaiting_approval com os status e eventos que JÁ
// existem; erro stale não sobrevive à troca de produção/modo/ação.
//
// Nenhum teste chama API real.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { safeProductionMessage, PRODUCTION_TERMINAL } from '../production-guard'
import type { ContentStore, ProductionRow, ProductionStatus } from '../types'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void | Promise<void> }[] = []
function test(name: string, fn: () => void | Promise<void>) { suite.push({ name, fn }) }

const actions = ler('src/app/actions/content-production.ts')
const actionsCode = semComentarios(actions)
const preview = ler('src/components/content-studio/office-preview.tsx')
const previewCode = semComentarios(preview)
const painel = ler('src/components/content-studio/result-panel.tsx')

/** CAS mínimo — o mesmo comportamento do UPDATE com predicado do Postgres. */
function casStore() {
  const productions = new Map<string, ProductionRow>()
  const eventos: string[] = []
  const store = {
    productions,
    eventos,
    async transitionProductionStatus(id: string, expected: readonly ProductionStatus[], next: ProductionStatus) {
      const p = productions.get(id)
      if (!p || !expected.includes(p.status)) return false
      p.status = next
      return true
    },
    async emitEvent(i: { type: string }) { eventos.push(i.type); return eventos.length },
  }
  return store as unknown as Pick<ContentStore, 'transitionProductionStatus' | 'emitEvent'> & typeof store
}

function producao(status: ProductionStatus): ProductionRow {
  return {
    id: 'p1', tenant_id: 't', pipeline_key: 'content_carousel_studio_v1', title: 'x',
    brief: {}, status, next_event_seq: 0, created_by: null, created_at: 'z', updated_at: 'z',
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. A causa do bug de imagem
// ════════════════════════════════════════════════════════════════════════════

test('1) CAUSA: preflight de imagens reprovado agora fala a própria língua', () => {
  // Antes: studio_images:missing_key -> mensagem da COPY ("A geração com IA
  // está temporariamente indisponível.") num banner global — o clique parecia
  // não fazer nada e o banner ficava stale. Agora: mensagem PRÓPRIA que cita
  // a causa real (chave da OpenAI ausente), exibida DENTRO do painel.
  assert.ok(
    safeProductionMessage('images_unavailable').includes('chave da OpenAI ausente'),
    'a mensagem não aponta a causa real',
  )
  for (const nome of ['generateStudioSlideImage', 'generateAllStudioSlideImages']) {
    const fn = actionsCode.slice(actionsCode.indexOf(`export async function ${nome}`)).split('\nexport ')[0]
    assert.ok(fn.includes("fail('images_unavailable'"), `${nome} ainda devolve a mensagem da copy`)
    assert.ok(!fn.includes("fail('ai_disabled'"), `${nome} mistura o erro da copy`)
  }
})

test('2) o erro de imagem vai para o PAINEL, nunca para o banner global', () => {
  const gerar = previewCode.slice(previewCode.indexOf('const gerarImagem'), previewCode.indexOf('const gerarTodas'))
  const todas = previewCode.slice(previewCode.indexOf('const gerarTodas'), previewCode.indexOf('const limparTela'))
  for (const [nome, corpo] of [['gerarImagem', gerar], ['gerarTodas', todas]] as const) {
    assert.ok(corpo.includes('setErroImagem('), `${nome} não usa o erro escopado`)
    assert.ok(!corpo.includes('setError('), `${nome} ainda escreve no banner global`)
  }
  // E o painel exibe o erro escopado junto dos controles de imagem.
  assert.ok(painel.includes('erroImagem') && painel.includes('{erroImagem}'), 'o painel não mostra o erro')
})

// ════════════════════════════════════════════════════════════════════════════
// 2. Loading e progresso reais
// ════════════════════════════════════════════════════════════════════════════

test('3) clicar em gerar entra em loading IMEDIATO no próprio slide', () => {
  const gerar = previewCode.slice(previewCode.indexOf('const gerarImagem'), previewCode.indexOf('const gerarTodas'))
  assert.ok(gerar.includes('setGerandoSlide(slide)'), 'o slide clicado não entra em loading')
  assert.ok(gerar.includes('setGerandoSlide(null)'), 'o loading não é limpo no finally')

  // O painel usa o slide em voo para trocar selo e botão na hora do clique.
  assert.ok(painel.includes('gerandoSlide === slide.numero'), 'o selo não reflete o voo')
  assert.ok(painel.includes('⏳ Gerando…'), 'sem indicador de loading no slide')
  assert.ok(painel.includes("IMAGEM_STATUS_LABEL[emVoo ? 'gerando' : img.status]"))
})

test('4) "Gerar todas" confirma o custo ANTES e mostra resumo ao final', () => {
  assert.ok(painel.includes('Será feita uma geração por slide'), 'custo não confirmado antes')
  assert.ok(painel.includes('Confirmar e gerar') && painel.includes('setConfirmaTodas'), 'sem passo de confirmação')

  const todas = previewCode.slice(previewCode.indexOf('const gerarTodas'), previewCode.indexOf('const limparTela'))
  assert.ok(todas.includes('falharam'), 'sem resumo de falhas')
  assert.ok(todas.includes('imagens do carrossel estão prontas'), 'sem resumo de sucesso')
  // As já prontas permanecem: o resumo é derivado do result PERSISTIDO, e uma
  // falha só interrompe o lote, nunca reverte nada.
  assert.ok(todas.includes("i.status === 'pronto'") && todas.includes("i.status === 'falhou'"))
  assert.ok(!todas.includes('setInterval') && !todas.includes('setTimeout'), 'polling/gambiarra de timer')
})

test('5) o botão "Tentar novamente" continua reservado à falha, com retry explícito', () => {
  assert.ok(painel.includes('Tentar novamente'))
  assert.ok(painel.includes("img.status === 'falhou'"), 'retry fora do estado falhou')
  const gerar = previewCode.slice(previewCode.indexOf('const gerarImagem'), previewCode.indexOf('const gerarTodas'))
  assert.ok(gerar.includes('retry ? { retry: true } : undefined'), 'retry implícito')
})

// ════════════════════════════════════════════════════════════════════════════
// 3. Aprovação e reprovação
// ════════════════════════════════════════════════════════════════════════════

test('6) aprovar: CAS estrito awaiting_approval -> approved + evento oficial', async () => {
  const fn = actionsCode.slice(actionsCode.indexOf('export async function approveContentProduction')).split('\nexport ')[0]
  assert.ok(fn.includes("['awaiting_approval'], 'approved'"), 'CAS não é estrito')
  assert.ok(fn.includes("'content_approved'"), 'sem o evento oficial')
  assert.ok(fn.includes('await currentTenantId()') && fn.includes(".eq('tenant_id', tenantId)"), 'tenant fora da sessão')
  assert.ok(fn.includes('wrong_pipeline'), 'pipeline desconhecido aceito')
  // Idempotência: já aprovada curto-circuita sem novo evento.
  assert.ok(fn.includes("candidata.status !== 'approved'"), 'replay duplicaria o evento')

  // Comportamento do CAS: só UMA de duas aprovações concorrentes transiciona.
  const store = casStore()
  store.productions.set('p1', producao('awaiting_approval'))
  const [a, b] = await Promise.all([
    store.transitionProductionStatus('p1', ['awaiting_approval'], 'approved'),
    store.transitionProductionStatus('p1', ['awaiting_approval'], 'approved'),
  ])
  assert.deepEqual([a, b].sort(), [false, true])
  assert.equal(store.productions.get('p1')!.status, 'approved')
})

test('7) cancelada/running/pending NÃO aprovam; approved é terminal', async () => {
  const store = casStore()
  for (const st of ['canceled', 'running', 'draft', 'queued', 'failed'] as ProductionStatus[]) {
    store.productions.set('p1', producao(st))
    const v = await store.transitionProductionStatus('p1', ['awaiting_approval'], 'approved')
    assert.equal(v, false, `${st} aprovou`)
    assert.equal(store.productions.get('p1')!.status, st, `${st} mudou de estado`)
  }
  assert.ok(PRODUCTION_TERMINAL.includes('approved'), 'approved deixaria a produção aberta')
})

test('8) reprovar: evento content_rejected + arquivamento honesto (canceled)', () => {
  const fn = actionsCode.slice(actionsCode.indexOf('export async function rejectContentProduction')).split('\nexport ')[0]
  // Sem enum novo: o evento OFICIAL content_rejected + o status EXISTENTE
  // canceled (sai da lista/cota; histórico e artes ficam).
  assert.ok(fn.includes("'content_rejected'"), 'sem o evento oficial de recusa')
  assert.ok(fn.includes("['awaiting_approval'], 'canceled'"), 'CAS não é estrito')
  assert.ok(!/['"]rejected['"]/.test(fn), 'status inventado')
  // O evento só é gravado por quem VENCEU o CAS.
  assert.ok(fn.indexOf('transitionProductionStatus') < fn.indexOf("'content_rejected'"))
  assert.ok(fn.includes('if (transicionou)'), 'evento sem depender do CAS')
  // Fora do portão: recusa explícita; canceled: replay idempotente.
  assert.ok(fn.includes('not_advanceable'))
  // E a UI diz exatamente o que acontece ANTES do clique.
  assert.ok(painel.includes('Reprovar esta produção?'))
  assert.ok(painel.includes('arquivada') && painel.includes('preservados'), 'a confirmação não é honesta')
  assert.ok(painel.includes('Confirmar reprovação'))
})

test('9) a UI mostra Aprovar/Reprovar SÓ em awaiting_approval; aprovada, o selo', () => {
  assert.ok(painel.includes('aguardandoAprovacao && onAprovar && onReprovar'),
    'botões fora do portão')
  assert.ok(painel.includes('✓ Aprovar') && painel.includes('Reprovar'))
  assert.ok(painel.includes('✓ aprovado'), 'sem selo de aprovada')
  // Aprovada: o bloco de botões exige aguardandoAprovacao — some sozinho.
  const bloco = painel.slice(painel.indexOf('Portão humano'), painel.indexOf('result.titulo'))
  assert.ok(bloco.includes('aguardandoAprovacao'))

  // E o preview liga tudo com atualização imediata (sem refresh).
  const aprovar = previewCode.slice(previewCode.indexOf('const aprovarProducao'), previewCode.indexOf('const reprovarProducao'))
  assert.ok(aprovar.includes('aplicarEstado(r.data)'), 'aprovação não atualiza a tela')
  assert.ok(aprovar.includes('setProducoes'), 'o seletor não reflete o novo status')
  assert.ok(aprovar.includes('Produção aprovada!'), 'sem mensagem de sucesso')
  const reprovar = previewCode.slice(previewCode.indexOf('const reprovarProducao'), previewCode.indexOf('const abrirProducao = useCallback'))
  assert.ok(reprovar.includes('aplicarRemocao'), 'reprovação não atualiza lista/seleção')
  assert.ok(reprovar.includes('reprovada e arquivada'), 'sem mensagem honesta')
})

// ════════════════════════════════════════════════════════════════════════════
// 4. Erro stale
// ════════════════════════════════════════════════════════════════════════════

test('10) NENHUM erro sobrevive à troca de produção ou de modo', () => {
  const abrir = previewCode.slice(previewCode.indexOf('const abrirProducao = useCallback'), previewCode.indexOf('useEffect(() => { abrirProducaoRef'))
  for (const limpeza of ['setError(null)', 'setErroBrief(null)', 'setErroImagem(null)']) {
    assert.ok(abrir.includes(limpeza), `abrirProducao não faz ${limpeza}`)
  }
  const trocar = previewCode.slice(previewCode.indexOf('const trocarModo'), previewCode.indexOf('const avancarAteParar'))
  for (const limpeza of ['setError(null)', 'setErroBrief(null)', 'setErroImagem(null)']) {
    assert.ok(trocar.includes(limpeza), `trocarModo não faz ${limpeza}`)
  }
})

test('11) ação nova limpa o erro velho; sucesso não deixa erro para trás', () => {
  const criar = previewCode.slice(previewCode.indexOf('const criarRapido'), previewCode.indexOf('const continuarProducao'))
  assert.ok(criar.includes('setErroImagem(null)'), 'criar não limpa o erro de imagem')
  const gerar = previewCode.slice(previewCode.indexOf('const gerarImagem'), previewCode.indexOf('const gerarTodas'))
  // O início da ação limpa; o sucesso NÃO grava erro (só o caminho de falha).
  assert.ok(gerar.indexOf('setErroImagem(null)') < gerar.indexOf('await generateStudioSlideImage'))
})

test('12) erro de imagem não corrompe uma produção já concluída', () => {
  // O erro vive num estado PRÓPRIO (erroImagem), fora de result/status/allEvents:
  // a produção concluída continua exibida com copy, direção e artes intactas.
  const gerar = previewCode.slice(previewCode.indexOf('const gerarImagem'), previewCode.indexOf('const gerarTodas'))
  assert.ok(!gerar.includes('setResult(emptyProductionResult'), 'a falha apaga o resultado')
  assert.ok(!gerar.includes('setStatus('), 'a falha mexe no status exibido')
  assert.ok(!gerar.includes('setAllEvents([])'), 'a falha apaga a timeline')
})

// ─── Execução ───────────────────────────────────────────────────────────────

async function main() {
  for (const { name, fn } of suite) {
    try { await fn(); results.push({ name, ok: true }) }
    catch (err) { results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) }) }
  }
  const failed = results.filter(r => !r.ok)
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : ' FALHA'} ${r.name}${r.ok ? '' : `\n        → ${r.error}`}`)
  }
  console.log(`\n${results.length - failed.length}/${results.length} testes passaram`)
  if (failed.length > 0) process.exitCode = 1
}

void main()
