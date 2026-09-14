// ============================================================================
// Design premium do quiz — cores derivadas e a casca nova do renderer
// ----------------------------------------------------------------------------
// Pedido do dono: "deixar o quiz muito, muito mais profissional". Um quiz
// profissional não usa uma cor só — usa a FAMÍLIA da cor primária (gradiente,
// sombra colorida, brilho de foco, texto que contrasta). Aqui se tranca:
//   1. a lib de cores (pura): parsing tolerante, contraste WCAG, gradiente
//   2. os presets premium e as opções novas de tema
//   3. a casca do renderer: fundo decorado, cabeçalho com progresso em
//      gradiente, card de conteúdo, opções com badge, botões com sombra
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  hexParaRgb, comAlpha, escurecer, clarear, gradientePrimario, sombraColorida,
  brilhoFoco, textoContraste, decoracaoFundo,
} from '@/lib/quiz/cores'
import { THEME_PRESETS, resolveTheme } from '@/lib/quiz/theme'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const tests: Record<string, () => void> = {
  // ── Cores ─────────────────────────────────────────────────────────────────
  'hex é lido com ou sem #, em 3 ou 6 dígitos; lixo cai no índigo padrão': () => {
    assert.deepEqual(hexParaRgb('#6366f1'), { r: 99, g: 102, b: 241 })
    assert.deepEqual(hexParaRgb('6366f1'), { r: 99, g: 102, b: 241 })
    assert.deepEqual(hexParaRgb('#fff'), { r: 255, g: 255, b: 255 })
    assert.deepEqual(hexParaRgb('não é cor'), { r: 99, g: 102, b: 241 })
    assert.deepEqual(hexParaRgb(null), { r: 99, g: 102, b: 241 })
  },
  'alpha fica entre 0 e 1 e sai como rgba': () => {
    assert.equal(comAlpha('#ff0000', 0.5), 'rgba(255,0,0,0.5)')
    assert.equal(comAlpha('#ff0000', 7), 'rgba(255,0,0,1)')
    assert.equal(comAlpha('#ff0000', -1), 'rgba(255,0,0,0)')
  },
  'escurecer/clarear são monotônicos e nunca estouram 0–255': () => {
    assert.equal(escurecer('#ffffff', 0.5), '#808080')
    assert.equal(escurecer('#000000', 0.5), '#000000')
    assert.equal(clarear('#000000', 0.5), '#808080')
    assert.equal(clarear('#ffffff', 0.5), '#ffffff')
  },
  'contraste WCAG: branco em cor escura, preto em cor clara (botão amarelo!)': () => {
    assert.equal(textoContraste('#6366f1'), '#ffffff')
    assert.equal(textoContraste('#111827'), '#ffffff')
    assert.equal(textoContraste('#facc15'), '#111827', 'texto branco em amarelo é ilegível')
    assert.equal(textoContraste('#ffffff'), '#111827')
  },
  'gradiente, sombra, brilho e decoração são CSS válido derivado da primária': () => {
    const g = gradientePrimario('#6366f1')
    assert.ok(g.startsWith('linear-gradient(135deg'))
    assert.ok(/#[0-9a-f]{6}/.test(g))
    assert.ok(sombraColorida('#6366f1').includes('rgba(99,102,241'))
    assert.ok(sombraColorida('#6366f1', true).includes('0.55'), 'forte = mais opaca')
    assert.ok(brilhoFoco('#6366f1').startsWith('0 0 0 4px rgba(99,102,241'))
    const d = decoracaoFundo('#6366f1', false)
    assert.equal((d.match(/radial-gradient/g) ?? []).length, 2, 'dois orbes')
    assert.ok(decoracaoFundo('#6366f1', true).includes('0.35'), 'no escuro os orbes são mais fortes')
  },

  // ── Tema ──────────────────────────────────────────────────────────────────
  'presets premium existem e ligam a decoração': () => {
    for (const p of ['aurora', 'midnight', 'sunset']) {
      assert.ok(THEME_PRESETS[p], `preset ${p} sumiu`)
      assert.equal(THEME_PRESETS[p].decor, true)
    }
    assert.equal(resolveTheme({ preset: 'aurora' }).decor, true)
    assert.equal(resolveTheme({ preset: 'aurora' }).optionStyle, 'letters')
  },
  'presets antigos NÃO mudam de cara sozinhos (decor desligado, cards)': () => {
    const r = resolveTheme({ preset: 'clean' })
    assert.equal(r.decor, false, 'quiz já publicado não pode ganhar orbes sem o dono pedir')
    assert.equal(r.optionStyle, 'cards')
    assert.equal(r.cardStyleFlat, false)
    assert.equal(resolveTheme({ preset: 'minimal' }).cardStyleFlat, true)
  },
  'o dono pode ligar decoração e mudar o estilo das opções em qualquer preset': () => {
    const r = resolveTheme({ preset: 'clean', decor: true, option_style: 'pills' })
    assert.equal(r.decor, true)
    assert.equal(r.optionStyle, 'pills')
  },

  // ── Renderer ──────────────────────────────────────────────────────────────
  'renderer: cabeçalho com contador, progresso em gradiente e fundo decorado': () => {
    const src = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')
    assert.ok(src.includes('{pageIdx + 1} / {totalPages}'), 'contador "3 / 7" no cabeçalho')
    assert.ok(/gradientePrimario\(corProgresso\)/.test(src), 'barra de progresso em gradiente')
    assert.ok(src.includes('decoracaoFundo(primaryColor, theme.isDark)'), 'orbes do fundo')
    assert.ok(src.includes('floatOrb'), 'os orbes flutuam devagar')
  },
  'renderer: opções com badge A/B/C, cascata e check com pop': () => {
    const src = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')
    assert.ok(src.includes('String.fromCharCode(65 + (i % 26))'), 'letras A, B, C…')
    assert.ok(src.includes('animationDelay: `${i * 60}ms`'), 'entrada em cascata')
    assert.ok(src.includes("animation: 'popIn 260ms"), 'check aparece com pop')
    assert.ok(src.includes("theme.optionStyle === 'pills'"), 'estilo pílulas')
  },
  'renderer: botões em gradiente com sombra colorida e texto que contrasta': () => {
    const src = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')
    assert.ok(src.includes('gradientePrimario(corBtn)'))
    assert.ok(src.includes('textoContraste(corBtn)'), 'botão amarelo não pode ter texto branco')
    assert.ok(src.includes('sombraColorida(corBtn'))
    assert.ok(!/text-white text-base font-semibold rounded-2xl shadow transition hover:opacity-90/.test(src),
      'o botão chapado antigo não pode ter sobrado')
  },
  'renderer: conteúdo em card (exceto flat) e resultado com anel animado': () => {
    const src = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')
    assert.ok(src.includes('const usaCard = !theme.cardStyleFlat'))
    assert.ok(src.includes('ringDraw'), 'o anel do resultado se desenha')
    assert.ok(src.includes('brilhoFoco(primaryColor)'), 'inputs e opções ganham brilho de foco')
  },
  'editor: aba Design expõe estilo das opções e fundo decorado': () => {
    const ed = ler('src/components/quiz/quiz-editor-v2.tsx')
    assert.ok(ed.includes('Estilo das opções de resposta'))
    assert.ok(ed.includes("setTheme({ decor: !theme.decor })"))
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
