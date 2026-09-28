// ============================================================================
// Editor visual das automações do Instagram no celular
// ----------------------------------------------------------------------------
// Pedido do dono: "ajusta para mobile para eu poder usar no celular". No
// celular o painel de 340px esmagava o canvas numa faixa, o cabeçalho do app
// cobria a barra do editor, e ligar blocos exigia arrastar com o dedo.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ed = readFileSync(join(process.cwd(), 'src/app/(dashboard)/instagram/[id]/editor/editor-client.tsx'), 'utf8')

const tests: Record<string, () => void> = {
  'editor fica por cima do cabeçalho do app no celular': () => {
    assert.ok(ed.includes('style={{ zIndex: 45 }}'), 'z 30 deixava o cabeçalho (z 40) cobrir a barra do editor')
  },
  'painel: coluna no computador, folha por cima no celular aberta ao tocar no bloco': () => {
    assert.ok(ed.includes("${painelAberto ? 'flex' : 'hidden'} md:flex fixed md:static"))
    assert.ok(ed.includes('md:w-[340px]'))
    assert.ok(ed.includes('onNodeClick={(_, n) => { setSelected(n.id); setPainelAberto(true) }}'))
    assert.ok(ed.includes('Ver canvas'), 'botão para voltar ao canvas')
    assert.ok(ed.includes('onClick={() => setPainelAberto(false)}'))
  },
  'ligar blocos por toque: bolinha e depois destino': () => {
    assert.ok(ed.includes('connectOnClick'))
    assert.ok(ed.includes('toque na bolinha e depois no bloco de destino'))
  },
  'barra superior cabe no celular': () => {
    assert.ok(ed.includes('flex flex-wrap items-center gap-2'))
    assert.ok(ed.includes('env(safe-area-inset-top)'))
    assert.ok(ed.includes('<span className="hidden sm:inline"> Automações</span>'))
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
