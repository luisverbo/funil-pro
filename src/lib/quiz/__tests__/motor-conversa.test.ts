// ============================================================================
// Quiz v2 — motor puro (pontuação, ramificação, validação, {{nome}}) e o MODO
// CONVERSA: a página vira passos de chat; opções viram botões; campos viram a
// caixa de digitar; página só de conteúdo ganha "Continuar"; resultado e fim
// iguais ao renderer de páginas.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  calcularPontuacao, proximaPagina, validarBloco, contatoDaPagina, personalizar, passosDaPagina, falasDoBloco,
  textoDaResposta, tempoDigitando, campoDaEntrada, formatoDoQuiz,
} from '@/lib/quiz/motor'
import type { QuizData, QuizPage, QuizBlock, BlockType, BlockConfig } from '@/app/actions/quiz-v2'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
let n = 0
const b = (type: BlockType, config: BlockConfig = {}): QuizBlock => ({ id: `b${++n}`, type, order: n, config })
const pg = (id: string, blocks: QuizBlock[]): QuizPage => ({ id, title: id, order: 0, blocks })

// Blocos criados NA ORDEM em que aparecem (o `order` é a sequência de criação).
const cab = b('heading', { heading_text: '<b>Diagnóstico</b> rápido' }), intro = b('text_block', { content: '<p>Responda em 1 minuto.</p><p>Vamos lá?</p>' })
const escolha = b('single_choice', { question: 'Qual seu objetivo?', options: [{ id: 'o1', label: 'Vender mais', points: 2, emoji: '🚀' }, { id: 'o2', label: 'Só olhar', points: 0, goto_page_id: 'p_fim' }] })
const nome = b('field_text', { label: 'Qual o seu nome?', required: true, field_key: 'nome' })
const email = b('field_email', { label: 'Seu melhor e-mail?', required: true })
const resultado = b('result', { title: 'Parabéns, {{nome}}!', description: 'Você fez {{score}} pontos', show_score: true, cta_text: 'Falar no WhatsApp', cta_url: 'https://wa.me/55' })
const pages: QuizPage[] = [
  pg('p1', [cab, intro, escolha]),
  pg('p2', [nome, email]),
  pg('p3', [b('hero', { hero_headline: 'Quase lá', hero_cta_text: 'Ver resultado' })]),
  pg('p_res', [resultado]),
  pg('p_fim', [b('text_block', { content: 'Tudo bem, até mais!' })]),
]
const data: QuizData = { version: 2, pages, settings: { layout: 'conversa', chat: { nome: 'Ana' } } }

const tests: Record<string, () => void | Promise<void>> = {
  'motor: pontuação derivada das respostas; ramificação por opção, resultado e fim; validação; contato': () => {
    const ans = { [escolha.id]: 'Vender mais' }
    assert.equal(calcularPontuacao(pages, ans), 2)
    assert.deepEqual(proximaPagina(pages, 0, ans, 2), { tipo: 'pagina', idx: 1 })
    assert.deepEqual(proximaPagina(pages, 0, { [escolha.id]: 'Só olhar' }, 0), { tipo: 'pagina', idx: 4 }, 'opção com destino')
    assert.deepEqual(proximaPagina(pages, 2, ans, 2), { tipo: 'pagina', idx: 3 }, 'resultado sem faixas: vai para a página dele (igual ao de páginas)')
    assert.deepEqual(proximaPagina(pages, 3, ans, 2), { tipo: 'resultado', bloco: resultado }, 'na página do resultado, mostra o resultado')
    assert.deepEqual(proximaPagina(pages, 4, ans, 2), { tipo: 'fim' })
    assert.equal(validarBloco(nome, ''), 'Campo obrigatório'); assert.equal(validarBloco(email, 'x'), 'E-mail inválido'); assert.equal(validarBloco(email, 'a@b.co'), null)
    assert.equal(validarBloco(b('field_phone', {}), '119'), 'Telefone inválido'); assert.equal(validarBloco(b('field_phone', {}), '(11) 99999-9999'), null)
    const fc = b('final_capture', { show_name: true, show_phone: true, required: true })
    assert.equal(validarBloco(fc, null, { name: '', email: '', phone: '' }), 'Preencha seu nome')
    assert.equal(validarBloco(fc, null, { name: 'Bia', email: '', phone: '11999999999' }), null)
    const lead = contatoDaPagina(pages[1], { [nome.id]: 'Bia Souza', [email.id]: 'bia@x.com' }, {})
    assert.deepEqual(lead, { name: 'Bia Souza', email: 'bia@x.com' })
    assert.equal(personalizar('Oi {{nome}}, {{score}} pts, {{email}}', pages, { [nome.id]: 'Bia Souza', [email.id]: 'bia@x.com' }, lead, 7), 'Oi Bia, 7 pts, bia@x.com')
    assert.equal(formatoDoQuiz(data), 'conversa'); assert.equal(formatoDoQuiz({ ...data, settings: {} }), 'paginas')
  },
  'conversa: página vira passos — falas (sem HTML) antes da pergunta, opções = botões; campos = caixa; hero com CTA = botão': () => {
    const p1 = passosDaPagina(pages[0])
    assert.equal(p1.length, 1); assert.equal(p1[0].entrada, escolha)
    assert.deepEqual(p1[0].falas, [{ t: 'texto', texto: 'Diagnóstico rápido' }, { t: 'texto', texto: 'Responda em 1 minuto.\nVamos lá?' }, { t: 'texto', texto: 'Qual seu objetivo?' }])
    const p2 = passosDaPagina(pages[1])
    assert.equal(p2.length, 2); assert.equal(p2[0].entrada, nome); assert.equal(p2[1].entrada, email)
    assert.deepEqual(p2[1].falas, [{ t: 'texto', texto: 'Seu melhor e-mail?' }])
    const p3 = passosDaPagina(pages[2])
    assert.equal(p3.length, 1); assert.equal(p3[0].entrada, null); assert.equal(p3[0].botao?.texto, 'Ver resultado')
    // só conteúdo → "Continuar" (texto configurável); resultado não vira fala
    const p5 = passosDaPagina(pages[4], 'Seguir')
    assert.equal(p5[0].botao?.texto, 'Seguir'); assert.deepEqual(passosDaPagina(pages[3]), [], 'página só com resultado: sem "Continuar"')
    assert.deepEqual(passosDaPagina(pg('r2', [b('text_block', { content: 'Calculando…' }), b('result', { title: 'X' })])), [{ falas: [{ t: 'texto', texto: 'Calculando…' }], entrada: null, botao: null }], 'conteúdo antes do resultado sai sozinho')
    // botão externo / WhatsApp guarda a URL; loading vira espera
    const pb = passosDaPagina(pg('x', [b('text_block', { content: 'Oi' }), b('button', { button_text: 'Site', button_action: 'external_url', button_url: 'https://x.com' }), b('loading', { loading_text: 'Analisando…', loading_seconds: 2 })]))
    assert.equal(pb[0].botao?.url, 'https://x.com'); assert.equal(pb[1].esperaSeg, 2)
    assert.deepEqual(falasDoBloco(b('image', { image_url: 'u.jpg' })), [{ t: 'imagem', url: 'u.jpg' }])
    assert.equal(falasDoBloco(b('features', { features: [] }))[0].t, 'cartao')
    assert.equal(textoDaResposta(escolha, 'Vender mais'), '🚀 Vender mais'); assert.equal(textoDaResposta(b('multi_choice', {}), ['a', 'b']), 'a, b')
    assert.equal(textoDaResposta(b('final_capture', {}), null, { name: 'Bia', email: 'b@x.com', phone: '' }), 'Bia · b@x.com')
    assert.deepEqual(campoDaEntrada(email), { tipo: 'email', placeholder: 'seu@email.com', inputMode: 'email' })
    assert.equal(campoDaEntrada(b('field_phone', { placeholder: 'Zap' })).placeholder, 'Zap')
    const t = tempoDigitando({ t: 'texto', texto: 'x'.repeat(100) })
    assert.ok(t > 1000 && t < 2600); assert.ok(tempoDigitando({ t: 'texto', texto: 'x'.repeat(100) }, 'rapida') < t); assert.ok(tempoDigitando({ t: 'texto', texto: 'oi' }) >= 300)
  },
  'telas: renderer de conversa ligado pelo settings.layout; editor tem o formato e os campos do chat; renderer de páginas intocado': () => {
    assert.match(ler('src/app/pg/[slug]/page.tsx'), /settings\?\.layout === 'conversa'[\s\S]*QuizChatRenderer/)
    const ed = ler('src/components/quiz/quiz-editor-v2.tsx')
    assert.match(ed, /Formato do quiz/); assert.match(ed, /onUpdateSettings\(\{ layout: k \}\)/); assert.match(ed, /chat: \{ \.\.\.settings\.chat, nome: e\.target\.value \}/)
    const r = ler('src/app/pg/[slug]/quiz-chat-renderer.tsx')
    assert.match(r, /passosDaPagina\(page, textoContinuar\)/); assert.match(r, /\/api\/quiz\/\$\{pageId\}\/submit/); assert.match(r, /dispararIntegracoes\(pageId/)
    assert.match(r, /tracking: capturarOrigem\(\)/, 'origem do 1º toque igual ao de páginas')
    assert.match(ler('src/app/actions/quiz-v2.ts'), /layout\?: 'paginas' \| 'conversa'/)
  },
}

;(async () => {
  let passed = 0
  const nomes = Object.keys(tests)
  for (const nome of nomes) {
    try { await tests[nome](); passed++; console.log(`  ok   ${nome}`) }
    catch (e) { console.log(` FALHA ${nome}\n        → ${e instanceof Error ? e.message : String(e)}`) }
  }
  console.log(`\n${passed}/${nomes.length} testes passaram`)
  if (passed !== nomes.length) process.exit(1)
})()
