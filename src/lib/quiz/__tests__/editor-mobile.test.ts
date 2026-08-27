// ============================================================================
// Editor de quiz no CELULAR — um painel por vez, abas no rodapé
// ----------------------------------------------------------------------------
// Relatado com print: no celular as 4 colunas fixas (Blocos | Páginas |
// Página | Editar) estouravam a tela — impossível editar ou ver qualquer
// coisa. No desktop nada muda; no mobile cada painel vira uma aba.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const src = readFileSync(join(RAIZ, 'src/components/quiz/quiz-editor-v2.tsx'), 'utf8')

const tests: Record<string, () => void> = {
  'os quatro painéis têm largura total no celular e a fixa no desktop': () => {
    assert.ok(src.includes('w-full md:w-48'), 'palette sem largura responsiva')
    assert.ok(src.includes('w-full md:w-[180px]'), 'lista de páginas sem largura responsiva')
    assert.ok(src.includes('w-full md:w-72'), 'painel de edição sem largura responsiva')
  },
  'no celular só UM painel aparece por vez; no desktop todos': () => {
    // O padrão do wrapper: hidden no mobile quando não é o ativo, md:flex sempre.
    const wrappers = src.match(/painelMobile === '\w+' \? 'flex' : 'hidden'\} md:flex/g) ?? []
    assert.ok(wrappers.length >= 4, `esperava 4 wrappers responsivos, achei ${wrappers.length}`)
  },
  'a barra de abas do celular existe e some no desktop': () => {
    assert.ok(/md:hidden flex border-t/.test(src), 'sem a barra de abas o celular fica preso num painel')
    for (const aba of ['Blocos', 'Páginas', 'Editar']) {
      assert.ok(src.includes(aba), `aba ${aba} sumiu`)
    }
    assert.ok(src.includes('env(safe-area-inset-bottom)'), 'iPhone com notch cobre a barra sem o safe-area')
  },
  'no celular, tocar num bloco ADICIONA (arrastar entre abas não existe)': () => {
    assert.ok(src.includes('onTapBlock'), 'palette sem o toque do celular')
    assert.ok(/matchMedia\('\(min-width: 768px\)'\)\.matches\) return/.test(src),
      'no desktop o clique NÃO pode criar bloco — lá o gesto é arrastar')
    assert.ok(src.includes('Toque para adicionar à página atual'), 'sem a dica, ninguém descobre o toque')
  },
  'selecionar página/bloco navega para o painel certo no celular': () => {
    assert.ok(/setSelectedPageId\(id\); setSelectedBlockId\(null\); setPainelMobile\('canvas'\)/.test(src),
      'escolher página deve mostrar a página')
    assert.ok(/setSelectedBlockId\(id\); setPainelMobile\('editar'\)/.test(src),
      'tocar num bloco deve abrir a edição dele')
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
