// ============================================================================
// Calendário de conteúdo — a tela principal de /conteudos
// ----------------------------------------------------------------------------
// Pedido do dono: "está funcional pra caramba, mas não tem cara de ferramenta
// de agendamento; os agendados estão em blocos grandes; quero um calendário
// bonitão, setembro, com os posts dentro dos blocos — não muito pequeno nem
// tão grande; clico e ele aumenta para ver o vídeo e editar. Não remova as
// funcionalidades."
//
// Aqui se tranca:
//   1. a grade do mês (pura): 42 dias, começa na segunda, vira o ano
//   2. itens por dia no fuso de Brasília, vagas livres, miniatura
//   3. a tela: mês é a visão padrão, bloco compacto por post, painel de
//      detalhe com o card completo, fila de aprovação ao lado, e TODAS as
//      funções de antes continuam lá
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  gradeDoMes, somarMeses, itensPorDia, horaEmBrasilia, vagasLivres, miniaturaDe, NOMES_MES, type Conteudo,
} from '@/lib/conteudos-ig/regras'

const RAIZ = process.cwd()
const tela = readFileSync(join(RAIZ, 'src/app/(dashboard)/conteudos/conteudos-client.tsx'), 'utf8')

function item(p: Partial<Conteudo> = {}): Conteudo {
  return {
    id: 'c', tenant_id: 't', conta_instagram_id: null, tipo: 'reel', status: 'agendado',
    data_agendada: '2026-09-24T09:00:00.000Z', midia_urls: ['https://x/v.mp4'], capa_url: null,
    descricao: '', alt_text: null, hashtags: [], palavra_chave: null, tema: null, origem_url: null,
    origem_trecho: null, nota: null, ig_container_id: null, ig_media_id: null, ig_permalink: null,
    erro: null, tentativas: 0, created_at: '2026-09-23T00:00:00.000Z', aprovado_em: null, publicado_em: null, ...p,
  }
}

const tests: Record<string, () => void> = {
  // ── Grade ─────────────────────────────────────────────────────────────────
  'setembro/2026: 42 células, começa na segunda 31/08, 30 dias do mês': () => {
    const g = gradeDoMes(2026, 9)
    assert.equal(g.length, 42, 'altura fixa: o calendário não pula entre meses')
    assert.equal(g[0].dia, '2026-08-31', '1º de setembro de 2026 é terça → a grade abre na segunda 31/08')
    assert.equal(g[0].doMes, false)
    assert.equal(g[1].dia, '2026-09-01'); assert.equal(g[1].doMes, true)
    assert.equal(g.filter(d => d.doMes).length, 30)
    assert.equal(g[41].dia, '2026-10-11')
  },
  'mês que começa no domingo (fevereiro/2026) abre a grade 6 dias antes': () => {
    const g = gradeDoMes(2026, 3)   // 1º/03/2026 é domingo
    assert.equal(g[0].dia, '2026-02-23')
    assert.equal(g[6].dia, '2026-03-01')
  },
  'navegação de mês vira o ano nos dois sentidos': () => {
    assert.deepEqual(somarMeses(2026, 12, 1), { ano: 2027, mes: 1 })
    assert.deepEqual(somarMeses(2026, 1, -1), { ano: 2025, mes: 12 })
    assert.deepEqual(somarMeses(2026, 9, 0), { ano: 2026, mes: 9 })
    assert.equal(NOMES_MES[8], 'Setembro')
  },

  // ── Itens ─────────────────────────────────────────────────────────────────
  'itens por dia de Brasília, ordenados pela hora; descartado fica fora por padrão': () => {
    const m = itensPorDia([
      item({ id: 'b', tipo: 'carrossel', data_agendada: '2026-09-24T18:00:00.000Z', midia_urls: ['https://a', 'https://b'] }),
      item({ id: 'a', data_agendada: '2026-09-24T09:00:00.000Z' }),
      item({ id: 'x', data_agendada: '2026-09-25T02:30:00.000Z' }),   // 23:30 do dia 24 em Brasília
      item({ id: 'd', status: 'descartado', data_agendada: '2026-09-26T09:00:00.000Z' }),
    ])
    assert.deepEqual(m.get('2026-09-24')?.map(c => c.id), ['a', 'b', 'x'])
    assert.equal(m.get('2026-09-26'), undefined)
    assert.ok(itensPorDia([item({ status: 'descartado' })], true).size === 1, 'com o filtro ligado, aparece')
  },
  'hora em Brasília e vagas livres do dia': () => {
    assert.equal(horaEmBrasilia('2026-09-24T18:00:00.000Z'), '15:00')
    assert.deepEqual(vagasLivres(undefined), ['reel', 'carrossel'])
    assert.deepEqual(vagasLivres([item()]), ['carrossel'])
    assert.deepEqual(vagasLivres([item({ status: 'descartado' })]), ['reel', 'carrossel'], 'descartado não ocupa vaga')
  },
  'miniatura: capa do reel, 1ª imagem do carrossel; reel sem capa usa o vídeo': () => {
    assert.equal(miniaturaDe(item({ capa_url: 'https://c.jpg' })), 'https://c.jpg')
    assert.equal(miniaturaDe(item()), null)
    assert.equal(miniaturaDe(item({ tipo: 'carrossel', midia_urls: ['https://1', 'https://2'] })), 'https://1')
  },

  // ── A tela ────────────────────────────────────────────────────────────────
  'calendário do mês é a visão padrão, com Mês / Semana / Lista': () => {
    assert.ok(tela.includes("useState<Visao>('mes')"))
    assert.ok(tela.includes("[['mes', 'Mês'], ['semana', 'Semana'], ['lista', 'Lista']]"))
    assert.ok(tela.includes('gradeDoMes(mes.ano, mes.mes)'))
    assert.ok(tela.includes('`${NOMES_MES[mes.mes - 1]} ${mes.ano}`'), 'título "Setembro 2026"')
    assert.ok(tela.includes('irParaHoje'), 'botão Hoje')
  },
  'cada post é um bloco compacto com miniatura, horário e cor do status': () => {
    assert.ok(tela.includes('function BlocoPost'))
    assert.ok(tela.includes('<BlocoPost key={c.id} c={c} onAbrir={() => setAbertoId(c.id)} />'))
    assert.ok(tela.includes('horaEmBrasilia(c.data_agendada)'))
    assert.ok(tela.includes('function Miniatura'))
    assert.ok(/min-h-\[92px\].*sm:min-h-\[124px\]/.test(tela), 'célula nem pequena demais nem enorme')
  },
  'clicar abre o painel com o card completo (vídeo, edição, ações) e navega ←/→': () => {
    assert.ok(tela.includes('{aberto && ('))
    assert.ok(tela.includes('<CardConteudo key={`${aberto.id}'))
    assert.ok(tela.includes("e.key === 'ArrowRight'") && tela.includes("e.key === 'Escape'"))
  },
  'fila de aprovação ao lado, com aprovar rápido e aprovar todos': () => {
    assert.ok(tela.includes('Para aprovar'))
    assert.ok(tela.includes("agir(c.id, () => aprovarConteudo(c.id), 'Aprovado')"))
    assert.ok(tela.includes('Aprovar todos os ${pendentes.length} pendentes'))
  },
  'legenda de status é também filtro; descartado começa oculto': () => {
    assert.ok(tela.includes("new Set<StatusConteudo>(['descartado'])"))
    assert.ok(tela.includes('alternarFiltro(st)'))
  },
  'NADA do que existia sumiu': () => {
    for (const t of [
      'Pendentes', 'Agendados', 'Publicados', 'Erros',           // abas (na Lista)
      'Aprovar todos os', 'Descartar e puxar a fila', 'Só descartar',
      'Tentar de novo', 'Publicar agora (teste)', 'Voltar para pendente',
      'gradeDaSemana(', 'recorteVisivel(', 'datetime-local',
      'muted playsInline', 'snap-x snap-mandatory', 'Ver no Instagram',
      'visíveis antes do &quot;mais&quot;', 'Alt text', 'Palavra-chave', 'Trecho de origem',
      'explicarErroDeToken(conexao.error)',
    ]) assert.ok(tela.includes(t), `sumiu: ${t}`)
  },
}

let passed = 0
const nomes = Object.keys(tests)
for (const nome of nomes) {
  try { tests[nome](); passed++; console.log(`  ok   ${nome}`) }
  catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
}
console.log(`\n${passed}/${nomes.length} testes passaram`)
if (passed !== nomes.length) process.exit(1)
