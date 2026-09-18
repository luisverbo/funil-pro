// ============================================================================
// Tamanho do título da pergunta — pergunta e campo na mesma escala
// ----------------------------------------------------------------------------
// Relato do dono: numa página que mistura campo de formulário ("Qual é o seu
// nome?") e pergunta de escolha ("qual seu sexo"), a pergunta saía enorme ao
// lado dos rótulos e não havia como ajustar — "fica despropocional e fica
// feio". O tamanho estava fixo no renderer.
//
// Aqui se tranca:
//   1. a escala (pura): 4 degraus, padrão = o tamanho de hoje
//   2. 'pequeno' = exatamente o rótulo de campo de hoje (1,125rem / 600), o
//      degrau que deixa a página uniforme
//   3. as costuras: renderer sem tamanho chumbado, editor com o seletor nos
//      quatro lugares, preview do canvas acompanhando
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  TAMANHOS_TITULO, PADRAO_TITULO, ROTULOS_TAMANHO, tamanhoValido,
  estiloDoTitulo, estiloDoSubtitulo, tamanhoNoPreview,
} from '@/lib/quiz/tipografia'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

/** "clamp(1rem, 0.94rem + 0.3vw, 1.125rem)" → 1.125 (o teto, em rem) */
function teto(fontSize: string): number {
  const m = fontSize.match(/([\d.]+)rem\s*\)\s*$/) ?? fontSize.match(/^([\d.]+)rem$/)
  assert.ok(m, `não consegui ler o teto de "${fontSize}"`)
  return Number(m![1])
}

const tests: Record<string, () => void> = {
  // ── A escala ──────────────────────────────────────────────────────────────
  'quatro degraus, todos com rótulo em português': () => {
    assert.deepEqual([...TAMANHOS_TITULO], ['pequeno', 'medio', 'grande', 'gigante'])
    for (const t of TAMANHOS_TITULO) assert.ok(ROTULOS_TAMANHO[t], `falta rótulo de ${t}`)
    assert.ok(tamanhoValido('medio'))
    assert.ok(!tamanhoValido('enorme'))
    assert.ok(!tamanhoValido(undefined))
  },
  'padrão é o tamanho de HOJE — quiz publicado não muda sozinho': () => {
    assert.equal(PADRAO_TITULO, 'grande')
    const g = estiloDoTitulo(undefined)
    assert.equal(teto(g.fontSize), 2.125, 'o desktop tinha 2.125rem antes deste recurso')
    assert.equal(g.fontWeight, 800)
    assert.deepEqual(estiloDoTitulo('lixo'), g, 'valor inválido cai no padrão, não quebra a página')
  },
  'pequeno é exatamente o rótulo de campo de hoje — é o degrau que empareja': () => {
    const p = estiloDoTitulo('pequeno')
    assert.equal(teto(p.fontSize), 1.125, 'text-lg = 1.125rem')
    assert.equal(p.fontWeight, 600, 'font-semibold = 600')
  },
  'a escala é monotônica: cada degrau é maior que o anterior': () => {
    const tetos = TAMANHOS_TITULO.map(t => teto(estiloDoTitulo(t).fontSize))
    for (let i = 1; i < tetos.length; i++) {
      assert.ok(tetos[i] > tetos[i - 1], `${TAMANHOS_TITULO[i]} não é maior que ${TAMANHOS_TITULO[i - 1]}`)
    }
    const prev = TAMANHOS_TITULO.map(t => Number(tamanhoNoPreview(t).replace('rem', '')))
    for (let i = 1; i < prev.length; i++) assert.ok(prev[i] > prev[i - 1], 'o preview precisa acompanhar')
  },
  'todo degrau cresce com a tela sem estourar no celular (clamp)': () => {
    for (const t of TAMANHOS_TITULO) {
      const fs = estiloDoTitulo(t).fontSize
      if (t === 'pequeno') continue
      assert.ok(fs.startsWith('clamp('), `${t} precisa ser responsivo`)
      const m = fs.match(/^clamp\(([\d.]+)rem/)
      assert.ok(m && Number(m[1]) < teto(fs), `${t}: no celular tem que ser menor que no desktop`)
    }
  },
  'subtítulo acompanha o título e nunca fica maior que ele': () => {
    for (const t of TAMANHOS_TITULO) {
      const sub = teto(estiloDoSubtitulo(t).fontSize)
      assert.ok(sub < teto(estiloDoTitulo(t).fontSize), `subtítulo de ${t} competiria com o título`)
    }
    assert.deepEqual(estiloDoSubtitulo('lixo'), estiloDoSubtitulo('grande'))
  },

  // ── Costuras ──────────────────────────────────────────────────────────────
  'renderer: nenhum título de pergunta com tamanho chumbado': () => {
    const src = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')
    assert.ok(!/text-2xl md:text-\[2\.125rem\] font-extrabold/.test(src), 'a pergunta grande fixa não pode ter sobrado')
    assert.ok(!/<h2 className="text-2xl font-bold mb-6"/.test(src), 'a escala tinha tamanho fixo')
    assert.ok(!/className="block text-lg font-semibold mb-3"/.test(src), 'o rótulo de campo tinha tamanho fixo')
    const usos = (src.match(/estiloDoTitulo\(config\.title_size/g) ?? []).length
    assert.ok(usos >= 6, `pergunta, escala, vídeo e os 3 grupos de campo precisam usar a régua (achei ${usos})`)
    assert.ok(src.includes("estiloDoSubtitulo(config.title_size)"))
  },
  'renderer: campo herda "pequeno" — o rótulo continua igual ao de hoje': () => {
    const src = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')
    assert.ok(src.includes("estiloDoTitulo(config.title_size ?? 'pequeno')"), 'sem escolha, o campo fica como sempre foi')
  },
  'editor: seletor aparece em pergunta, escala, vídeo-resposta e campos': () => {
    const ed = ler('src/components/quiz/quiz-editor-v2.tsx')
    assert.ok(ed.includes('function SeletorTamanhoTitulo'))
    const usos = (ed.match(/<SeletorTamanhoTitulo/g) ?? []).length
    assert.equal(usos, 4, 'escolha, escala, vídeo-resposta e campos de formulário')
    assert.ok(ed.includes('padrao="pequeno"'), 'no campo o padrão é o tamanho atual do rótulo')
    assert.ok(ed.includes("setConfigKey('title_size', t)"))
    assert.ok(ed.includes('Use o mesmo tamanho nos campos e nas perguntas'), 'a dica que resolve a desproporção')
  },
  'editor: o canvas mostra o tamanho escolhido — não pode mentir sobre o resultado': () => {
    const ed = ler('src/components/quiz/quiz-editor-v2.tsx')
    const usos = (ed.match(/tamanhoNoPreview\(/g) ?? []).length
    assert.ok(usos >= 4, `preview de pergunta, campos e vídeo (achei ${usos})`)
  },
  'o tipo title_size existe no BlockConfig com os quatro valores': () => {
    const t = ler('src/app/actions/quiz-v2.ts')
    assert.ok(t.includes("title_size?: 'pequeno' | 'medio' | 'grande' | 'gigante'"))
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
