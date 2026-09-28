// ============================================================================
// Automação do Instagram em post AGENDADO (estilo ManyChat)
// ----------------------------------------------------------------------------
// Pedido do dono: "no ManyChat eu escolho um vídeo que ainda está agendado e
// configuro a automação; quando ele cai, já está pronta".
//
// A automação só guardava `media_id` (ID do post no Instagram), que só existe
// depois de publicado. Aqui se tranca:
//   1. a automação pode apontar para um conteúdo do /conteudos (conteudo_id)
//   2. o banco liga o post sozinho quando o publicador grava o ig_media_id
//      (gatilho — vale para o cron e para "Publicar agora")
//   3. ENQUANTO espera, ela não responde a nada (senão viraria "qualquer post")
//   4. escolher um post publicado deixa de esperar o agendado, e vice-versa
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const sql = ler('supabase/migrations/20260928000000_automacao_post_agendado.sql')
const webhook = ler('src/app/api/webhooks/instagram/route.ts')
const acoes = ler('src/app/actions/ig-automations.ts')
const tela = ler('src/app/(dashboard)/instagram/instagram-client.tsx')

const tests: Record<string, () => void> = {
  'coluna conteudo_id ligada ao conteúdo, sem apagar a automação se o conteúdo sumir': () => {
    assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS conteudo_id uuid REFERENCES conteudos_instagram(id) ON DELETE SET NULL'))
  },
  'gatilho copia o ig_media_id para as automações que esperavam — só do mesmo tenant, sem sobrescrever': () => {
    assert.ok(sql.includes('AFTER UPDATE OF ig_media_id ON conteudos_instagram'))
    assert.ok(sql.includes('SET media_id = NEW.ig_media_id'))
    assert.ok(sql.includes('WHERE conteudo_id = NEW.id'))
    assert.ok(sql.includes('AND tenant_id = NEW.tenant_id'), 'nunca liga automação de outro cliente')
    assert.ok(sql.includes('AND media_id IS NULL'), 'post escolhido à mão não é trocado')
    assert.ok(sql.includes('OLD.ig_media_id IS DISTINCT FROM NEW.ig_media_id'))
  },
  'webhook: automação esperando o post agendado NÃO responde a comentário nenhum': () => {
    assert.ok(webhook.includes('media_id, conteudo_id, keywords'), 'o webhook precisa ler conteudo_id')
    const i = webhook.indexOf('if (a.conteudo_id && !a.media_id) return false')
    assert.ok(i > 0, 'sem isso ela viraria "qualquer post"')
    assert.ok(i < webhook.indexOf('if (a.media_id && a.media_id !== mediaId) return false'), 'a espera é checada antes')
  },
  'ações: criar com post publicado ignora o agendado; atualizar alterna os dois': () => {
    assert.ok(acoes.includes('conteudo_id: input.media_id ? null : (input.conteudo_id || null)'))
    assert.ok(acoes.includes('if (patch.media_id) final.conteudo_id = null'))
    assert.ok(acoes.includes('else if (patch.conteudo_id) final.media_id = null'))
    assert.ok(acoes.includes('conteudo_id: string | null'))
  },
  'lista de conteúdos para escolher: do tenant, sem descartados': () => {
    const fn = acoes.slice(acoes.indexOf('export async function listConteudosParaAutomacao'))
    assert.ok(fn.includes(".eq('tenant_id', tenantId)"))
    assert.ok(fn.includes(".in('status', ['pendente', 'agendado', 'publicando', 'publicado'])"))
    assert.ok(!fn.includes("'descartado'"))
  },
  'tela: seção de agendados no seletor, com data em Brasília e aviso de pendente': () => {
    assert.ok(tela.includes('📅 Agendados no Conteúdos'))
    assert.ok(tela.includes("agendados.filter(c => c.status !== 'publicado')"))
    assert.ok(tela.includes("timeZone: 'America/Sao_Paulo'"))
    assert.ok(tela.includes('Esse post ainda está pendente: aprove em Conteúdos'))
    assert.ok(tela.includes('conteudo_id: agendado?.id ?? null'))
  },
  'tela: escolher post publicado ou "todos" desmarca o agendado': () => {
    assert.ok(tela.includes("onClick={() => { setSelectedPost('all'); setSelectedAgendado(null) }}"))
    assert.ok(tela.includes('onClick={() => { setSelectedPost(p); setSelectedAgendado(null) }}'))
    assert.ok(tela.includes('onClick={() => { setSelectedAgendado(c); setSelectedPost(null) }}'))
  },
  'card mostra que está esperando o post, com a data': () => {
    assert.ok(tela.includes('Post agendado · ${quandoEmBrasilia(c.data_agendada)} — liga quando publicar'))
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
