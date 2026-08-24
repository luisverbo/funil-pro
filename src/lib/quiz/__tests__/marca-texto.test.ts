// ============================================================================
// Marca-texto do editor de texto rico — cor de MARCADOR, não de papel
// ----------------------------------------------------------------------------
// O relato: "a cor fica apagadinha quando eu boto pra visualizar". A paleta
// usava pastéis (nível 200 do Tailwind): bonitos no seletor, invisíveis no
// texto publicado contra o fundo branco.
//
// O teste NÃO fixa os hexadecimais — fixa a PROPRIEDADE que faz um
// marca-texto funcionar: cor viva (cromática) e ainda clara o bastante para
// o texto preto continuar legível por cima. Trocar de tom é livre; voltar ao
// pastel, não.
// ============================================================================

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')

const results: { name: string; ok: boolean; error?: string }[] = []
const suite: { name: string; fn: () => void }[] = []
function test(name: string, fn: () => void) { suite.push({ name, fn }) }

const rgb = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
})

/** Quanto a cor "acende": distância entre o canal mais forte e o mais fraco. */
function croma(hex: string): number {
  const { r, g, b } = rgb(hex)
  return Math.max(r, g, b) - Math.min(r, g, b)
}

/** Luminância percebida (0–255): o quanto o olho lê a cor como clara. */
function luminancia(hex: string): number {
  const { r, g, b } = rgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function paletaDeMarcaTexto(): string[] {
  const fonte = ler('src/components/quiz/rich-text-field.tsx')
  const bloco = fonte.slice(fonte.indexOf('const HIGHLIGHTS'), fonte.indexOf('export default'))
  return [...bloco.matchAll(/#[0-9a-fA-F]{6}/g)].map(m => m[0])
}

// ════════════════════════════════════════════════════════════════════════════

test('1) REPRODUÇÃO: nenhuma cor pastel — o marcador precisa acender', () => {
  const cores = paletaDeMarcaTexto()
  assert.ok(cores.length >= 8, `paleta curta demais: ${cores.length} cores`)
  for (const c of cores) {
    // #fef08a (o amarelo pastel antigo) tem croma 116 — abaixo do piso.
    assert.ok(croma(c) >= 120,
      `${c} está lavada demais para marca-texto (croma ${croma(c)}, mínimo 120)`)
  }
})

test('2) o texto PRETO continua legível por cima', () => {
  for (const c of paletaDeMarcaTexto()) {
    // Abaixo de ~120 de luminância o texto preto começa a sumir no fundo.
    assert.ok(luminancia(c) >= 120,
      `${c} é escura demais para texto preto (luminância ${Math.round(luminancia(c))})`)
  }
})

test('3) a paleta cobre a roda de cores, sem repetição', () => {
  const cores = paletaDeMarcaTexto()
  assert.equal(new Set(cores).size, cores.length, 'cor repetida ocupa espaço à toa')

  // Pelo menos um tom quente e um frio: destacar duas ideias diferentes na
  // mesma página exige contraste entre os marcadores.
  const quentes = cores.filter(c => { const { r, b } = rgb(c); return r > b + 40 })
  const frios = cores.filter(c => { const { r, b } = rgb(c); return b > r + 40 })
  assert.ok(quentes.length >= 3, 'poucos tons quentes')
  assert.ok(frios.length >= 3, 'poucos tons frios')
})

test('4) o marca-texto grava cor no estilo (styleWithCSS + hiliteColor)', () => {
  const f = ler('src/components/quiz/rich-text-field.tsx')
  // Sem styleWithCSS o navegador usa <font>, que o renderer descarta —
  // a cor sumiria na publicação por outro motivo.
  assert.ok(f.includes("execCommand('styleWithCSS', false, 'true')"),
    'sem styleWithCSS a cor não vira estilo inline')
  assert.ok(f.includes("execCommand('hiliteColor'"), 'sem comando de marca-texto')
  assert.ok(f.includes("execCommand('backColor'"), 'sem alternativa para navegador antigo')
})

test('5) imagem do quiz aparece INTEIRA — nada de recorte lateral', () => {
  // O relato: "está comendo a foto". `object-cover` faz a imagem PREENCHER a
  // caixa, cortando o que sobra — num banner largo aberto no celular, some
  // metade do texto nas laterais.
  const r = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')

  // Sem comentários: o código EXPLICA o defeito antigo, e essa menção não
  // pode ser confundida com o defeito de volta.
  const semComentarios = r.replace(/\/\*[\s\S]*?\*\//g, '')
  const bloco = semComentarios.slice(
    semComentarios.indexOf("block.type === 'image'"),
    semComentarios.indexOf("block.type === 'video'"))
  assert.ok(bloco.includes('object-contain'), 'o bloco de imagem voltaria a recortar')
  assert.ok(!bloco.includes('object-cover'), 'object-cover no bloco de imagem corta as laterais')
  assert.ok(bloco.includes('h-auto'), 'sem altura automática a proporção se perde')

  // "Cheia" encosta nas bordas SEM cortar: a largura ganha de volta o respiro
  // do container (-mx-4), em vez de a imagem ser recortada para preencher.
  assert.ok(bloco.includes('-mx-4'), 'o tamanho Cheia deixaria moldura sobrando')
  assert.ok(bloco.includes('w-[calc(100%+2rem)]'), 'a largura não compensa o respiro')
  assert.ok(!/full' \? '[^']*object-cover/.test(bloco), 'encostar na borda não pode recortar')

  const hero = semComentarios.slice(
    semComentarios.indexOf("block.type === 'hero'"),
    semComentarios.indexOf("block.type === 'testimonials'"))
  assert.ok(!/max-h-72 object-cover/.test(hero), 'o hero voltaria a cortar banner largo')

  // A prévia do editor precisa mostrar o MESMO enquadramento do publicado —
  // senão o defeito volta a ser invisível para quem monta a página.
  const ed = ler('src/components/quiz/quiz-editor-v2.tsx')
  const previa = ed.slice(ed.indexOf('config.image_url'), ed.indexOf('config.image_url') + 200)
  assert.ok(previa.includes('object-contain'), 'prévia recortando e publicação não')
})

test('6) cada página do quiz começa no TOPO', () => {
  // O defeito: quem rolava até o fim para achar o botão continuava rolado ao
  // avançar — a página seguinte abria no meio, com o começo do texto acima
  // da dobra. É onde o quiz perde gente.
  const r = ler('src/app/pg/[slug]/quiz-renderer-v2.tsx')
  const semComentarios = r.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(semComentarios.includes('window.scrollTo(0, 0)'), 'a página seguinte abriria rolada')
  // Precisa valer para a troca de página E para a tela de resultado.
  // Uma chamada só não resiste ao Safari do iPhone (scroll anchoring + repintura):
  // a subida é repetida no primeiro quadro e logo após a animação de entrada.
  assert.ok(semComentarios.includes('requestAnimationFrame'), 'sem repetir no quadro seguinte, o iOS desfaz')
  assert.ok(semComentarios.includes("overflowAnchor: 'none'"), 'o navegador seguraria a posição visual')
  assert.ok(semComentarios.includes("scrollIntoView({ block: 'start'"), 'sem fallback se quem rola for um container')
  assert.ok(semComentarios.includes('}, [pageIdx, phase])'), 'o topo não seria refeito ao mudar de página ou no resultado')
})

// ─── Execução ───────────────────────────────────────────────────────────────

for (const { name, fn } of suite) {
  try { fn(); results.push({ name, ok: true }) }
  catch (e) { results.push({ name, ok: false, error: e instanceof Error ? e.message : String(e) }) }
}
let passed = 0
for (const r of results) {
  if (r.ok) { passed++; console.log(`  ok   ${r.name}`) }
  else console.log(` FALHA ${r.name}\n        → ${r.error}`)
}
console.log(`\n${passed}/${results.length} testes passaram`)
if (passed !== results.length) process.exit(1)
