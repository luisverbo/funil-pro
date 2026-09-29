// ============================================================================
// Duplicar automação do Instagram
// ----------------------------------------------------------------------------
// Pedido do dono: "tem automação que eu replico e só mudo o post e alguma
// coisa; não preciso criar do zero".
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { nomeDaCopia } from '@/lib/pages/editor-path'

const ler = (r: string) => readFileSync(join(process.cwd(), r), 'utf8')
const acoes = ler('src/app/actions/ig-automations.ts')
const tela = ler('src/app/(dashboard)/instagram/instagram-client.tsx')
const fn = acoes.slice(acoes.indexOf('export async function duplicateIgAutomation'), acoes.indexOf('export async function deleteIgAutomation'))

const tests: Record<string, () => void> = {
  'a cópia leva o fluxo inteiro': () => {
    for (const campo of ['trigger_type', 'media_id', 'conteudo_id', 'keywords', 'comment_replies', 'dm_steps', 'dm_use_agent', 'funnel_id', 'lead_tag', 'follow_gate', 'follow_gate_message', 'canvas']) {
      assert.ok(fn.includes(`${campo}: o.${campo}`), `a cópia não leva ${campo}`)
    }
  },
  'nasce pausada e zerada — não disputa comentários com a original': () => {
    assert.ok(fn.includes("status: 'paused'"))
    assert.ok(fn.includes('triggers_count: 0'))
  },
  'só duplica automação do próprio tenant': () => {
    assert.ok(fn.includes(".eq('id', id).eq('tenant_id', tenantId).single()"))
    assert.ok(fn.includes('tenant_id: tenantId,'))
  },
  'nome da cópia não empilha "Cópia de Cópia de"': () => {
    assert.ok(fn.includes('name: nomeDaCopia(o.name)'))
    assert.equal(nomeDaCopia('VOTO'), 'Cópia de VOTO')
    assert.equal(nomeDaCopia('Cópia de VOTO'), 'Cópia de VOTO')
  },
  'botão no card, a cópia aparece ao lado e abre para editar': () => {
    assert.ok(tela.includes('title="Duplicar automação"'))
    assert.ok(tela.includes('nova.splice(i + 1, 0, automation)'))
    assert.ok(tela.includes('await openEdit(automation)'))
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
