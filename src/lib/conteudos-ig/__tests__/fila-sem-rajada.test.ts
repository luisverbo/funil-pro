// ============================================================================
// Fim das "rajadas" + Repostar
// ----------------------------------------------------------------------------
// 04–05/10: reels saíram em sequência, fora de hora (05/10 09:20–09:32).
// CAUSA RAIZ: "Descartar e puxar a fila" recuava TODOS os seguintes 1 dia,
// às cegas — item ia para o passado (o cron publica o vencido na hora) e
// vários reels empilhavam no mesmo horário.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acoesPermitidas, podeFazer, dataNoFuturo, FOLGA_AGENDAMENTO_MS } from '@/lib/conteudos-ig/regras'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const sql = ler('supabase/migrations/20261005000000_conteudos_fila_sem_rajada.sql')
const acoes = ler('src/app/actions/conteudos-ig.ts')
const tela = ler('src/app/(dashboard)/conteudos/conteudos-client.tsx')

const tests: Record<string, () => void> = {
  'puxar_fila em corrente: herda a data do anterior, nunca recua às cegas': () => {
    assert.ok(!sql.includes("data_agendada - interval '1 day'"), 'o recuo cego de 1 dia é a causa raiz')
    assert.ok(sql.includes('UPDATE conteudos_instagram SET data_agendada = v_vaga WHERE id = r.id;'))
    assert.ok(sql.includes('v_vaga := r.data_agendada;'))
    assert.ok(sql.includes("IF v_vaga <= now() + interval '10 minutes' THEN\n    RETURN 0;"), 'vaga no passado não puxa nada')
  },
  'reserva: só publica o que venceu há até 60 min; mais velho vira erro com motivo': () => {
    assert.ok(sql.includes("AND data_agendada >= now() - interval '60 minutes'"))
    assert.ok(sql.includes("AND data_agendada < now() - interval '60 minutes';"))
    assert.ok(sql.includes("passou sem publicar"))
  },
  'reserva: no máximo um por tipo por rodada, ainda com SKIP LOCKED': () => {
    assert.ok(sql.includes('SELECT DISTINCT ON (tenant_id, tipo) id'))
    assert.ok(sql.includes('FOR UPDATE SKIP LOCKED'))
  },
  'data no futuro: folga de 2 min': () => {
    const agora = new Date('2026-10-05T12:00:00Z')
    assert.equal(FOLGA_AGENDAMENTO_MS, 120_000)
    assert.ok(!dataNoFuturo('2026-10-05T11:00:00Z', agora))
    assert.ok(!dataNoFuturo('2026-10-05T12:01:00Z', agora), 'em cima da hora não vale')
    assert.ok(dataNoFuturo('2026-10-05T12:05:00Z', agora))
    assert.ok(!dataNoFuturo('lixo', agora))
  },
  'ações: editar recusa data no passado; aprovar e tentar de novo vencidos vão para a próxima vaga': () => {
    assert.ok(acoes.includes("if (!dataNoFuturo(iso)) return { success: false, error: 'Escolha um horário no futuro — data no passado faria o post sair na hora.' }"))
    assert.equal((acoes.match(/if \(!dataNoFuturo\(item\.data_agendada\)\) upd\.data_agendada = await proximaVaga\(tenantId, item\.tipo\)/g) ?? []).length, 2)
    assert.ok(acoes.includes(".gt('data_agendada', new Date(Date.now() + FOLGA_AGENDAMENTO_MS).toISOString())"), 'aprovar todos não manda vencido direto')
  },
  'repostar: só publicado; limpa a publicação antiga e agenda no futuro': () => {
    assert.deepEqual(acoesPermitidas('publicado'), ['repostar'])
    assert.ok(!podeFazer('agendado', 'repostar'))
    assert.ok(acoes.includes('export async function repostarConteudo('))
    assert.ok(acoes.includes('ig_container_id: null, ig_media_id: null, ig_permalink: null, publicado_em: null,'))
    assert.ok(acoes.includes(".eq('id', id).eq('tenant_id', tenantId).eq('status', 'publicado')"))
    assert.ok(ler('src/app/api/conteudos/route.ts').includes('repostarConteudo'))
    assert.ok(tela.includes("acoes.includes('repostar')"))
    assert.ok(tela.includes('repostarConteudo(aberto.id, dataLocal || undefined)'))
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
