// ============================================================================
// 1ª DM de quem só comentou — sempre pela resposta privada ao comentário
// ----------------------------------------------------------------------------
// Relato do dono (28/09): "ele só comentou, mas não enviou nada no direct".
// A automação disparou (triggers_count subiu) e a resposta pública saiu.
//
// CAUSA RAIZ: com botão no 1º passo, a mensagem ia para o IGSID
// (recipient.id). O Instagram só deixa falar com quem nunca te chamou pela
// RESPOSTA PRIVADA ao comentário (recipient.comment_id). O envio direto era
// recusado e só virava log. O mesmo acontecia com o botão [JÁ SIGO ✅] de
// quem não seguia, e com passo que tinha mídia anexada.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { textoComBotoesEmTexto } from '@/lib/instagram'

const RAIZ = process.cwd()
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8')
const idx = ler('src/lib/instagram/index.ts')
const seq = ler('src/lib/instagram/sequence.ts')
const hook = ler('src/app/api/webhooks/instagram/route.ts')

const tests: Record<string, () => void> = {
  'botões com resposta privada vão com recipient.comment_id, nunca recipient.id': () => {
    const fn = idx.slice(idx.indexOf('export async function sendPrivateReplyWithButtons'), idx.indexOf('export async function sendInstagramActionButtons'))
    assert.ok(fn.includes('recipient: { comment_id: commentId }'))
    assert.ok(!fn.includes('recipient: { id'), 'para quem só comentou, DM direta é recusada')
    assert.ok(fn.includes("template_type: 'button'"))
    assert.ok(fn.includes("type: 'postback'"), 'botão de resposta (EU QUERO) vira postback')
  },
  'se o Instagram recusar o template, ainda entrega o texto pela resposta privada': () => {
    const fn = idx.slice(idx.indexOf('export async function sendPrivateReplyWithButtons'), idx.indexOf('export async function sendInstagramActionButtons'))
    assert.ok(fn.includes('await sendPrivateReplyToComment(commentId, textoComBotoesEmTexto(text, valid))'))
  },
  'texto de reserva: links no corpo e botões de resposta como "Responda: X"': () => {
    assert.equal(textoComBotoesEmTexto('Oi!', [{ title: 'EU QUERO' }]), 'Oi!\n\n👉 Responda: EU QUERO')
    assert.equal(textoComBotoesEmTexto('Oi!', [{ title: 'ACESSAR', url: 'https://x.com' }]), 'Oi!\n\nACESSAR: https://x.com')
    assert.equal(textoComBotoesEmTexto('Oi!', [{ title: 'SIM' }, { title: 'NÃO' }]), 'Oi!\n\n👉 Responda: SIM ou NÃO')
    assert.equal(textoComBotoesEmTexto('Oi!', []), 'Oi!')
  },
  'passo com botão de quem só comentou usa a resposta privada': () => {
    const i = seq.indexOf('if (btns.length > 0 && commentId) {')
    assert.ok(i > 0)
    assert.ok(seq.slice(i, i + 400).includes("sendPrivateReplyWithButtons(commentId, text || 'Toca no botão 👇', btns)"))
    assert.ok(i < seq.indexOf('} else if (btns.length > 0) {'), 'o caso com comentário é checado antes do envio direto')
  },
  'passo com mídia de quem só comentou abre a conversa pela resposta privada antes': () => {
    const i = seq.indexOf('if (step.media_url && step.media_type && commentId) {')
    assert.ok(i > 0)
    const bloco = seq.slice(i, i + 500)
    assert.ok(bloco.indexOf('sendPrivateReplyWithButtons') < bloco.indexOf('sendInstagramMedia'))
  },
  'porteiro "segue o perfil?": mensagem e botão JÁ SIGO numa só resposta privada': () => {
    assert.ok(hook.includes("sendPrivateReplyWithButtons(commentId, gateMsg, [{ title: 'JÁ SIGO ✅' }])"))
    assert.ok(!hook.includes("sendInstagramActionButtons(fromId, 'Quando seguir, me avisa 👇'"), 'a 2ª mensagem direta era recusada')
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
