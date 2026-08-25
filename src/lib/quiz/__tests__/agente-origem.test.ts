// ============================================================================
// Agente: ORIGEM da conversa visível para o dono
// ----------------------------------------------------------------------------
// O dono roda o mesmo agente no Instagram e no chat web e precisa saber de
// onde veio cada lead — e qual canal converte mais. O canal sempre foi
// gravado (`agent_conversations.channel`); o que faltava era MOSTRAR.
//
// Trancado aqui:
//   1. listConversations devolve o canal (com fallback p/ banco antigo)
//   2. o funil do agente traz o comparativo por canal (volume + quentes + %)
//   3. a tela de conversas tem a coluna Origem e o filtro por canal
//   4. test drive não infla os números do funil
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const tests: Record<string, () => void> = {
  'listConversations devolve o canal e aceita filtro por canal': () => {
    const src = ler('src/app/actions/ai-agents.ts')
    assert.ok(/listConversations[\s\S]{0,400}channel\?: string/.test(src), 'sem opção de filtro por canal')
    assert.ok(/channel: string \| null/.test(src), 'a linha da conversa precisa carregar o canal')
    assert.ok(/montar\(false\)/.test(src), 'banco sem a coluna channel precisa de fallback')
  },
  'funil do agente compara canais e exclui test drive': () => {
    const src = ler('src/app/actions/ai-agents.ts')
    assert.ok(src.includes('porCanal'), 'sem comparativo por canal não dá para saber o que converte mais')
    assert.ok(/channel !== 'test'/.test(src), 'test drive inflaria os números do funil')
    assert.ok(/quentes[\s\S]{0,300}taxa/.test(src), 'cada canal precisa de quentes e taxa de conversão')
  },
  'tela de conversas mostra a coluna Origem e filtra por canal': () => {
    const src = ler('src/app/(dashboard)/agents/[id]/conversations/conversations-client.tsx')
    assert.ok(src.includes('>Origem<'), 'falta a coluna Origem na tabela')
    assert.ok(src.includes('canalDe(c.channel)'), 'a linha precisa traduzir o canal')
    assert.ok(src.includes('applyCanal'), 'falta o filtro por canal')
    assert.ok(src.includes('qual canal converte mais'), 'falta o comparativo visual por canal')
  },
  'rótulos de canal cobrem os três meios em uso': () => {
    const src = ler('src/app/(dashboard)/agents/[id]/conversations/conversations-client.tsx')
    for (const c of ['whatsapp', 'web', 'instagram']) {
      assert.ok(src.includes(`${c}:`), `canal ${c} sem rótulo`)
    }
  },
}

// ─── Execução ───────────────────────────────────────────────────────────────

let passed = 0
const nomes = Object.keys(tests)
for (const nome of nomes) {
  try { tests[nome](); passed++; console.log(`  ok   ${nome}`) }
  catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
}
console.log(`\n${passed}/${nomes.length} testes passaram`)
if (passed !== nomes.length) process.exit(1)
