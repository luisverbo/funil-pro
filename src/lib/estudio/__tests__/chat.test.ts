// ============================================================================
// Estúdio IA — Fase 2b: chat do estúdio (estilo WhatsApp Web)
// ----------------------------------------------------------------------------
// O Luís não tem mais o WhatsApp do número no celular: tudo passa por aqui.
// Trava: idioma pelo DDI, Ana × Luís, janela, mídia guardada (a URL da Meta
// expira), envio por upload direto, PWA, e nada de token na tela.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  paisDoWaId, bandeira, devolveParaAna, tempoDaJanela, tick, tipoCloudDoMime, tipoDoHistorico,
  extensaoDoMime, caminhoMidiaDaConversa, previaDaMensagem, LIMITE_ENVIO,
} from '@/lib/estudio/chat'
import { baixarMidiaDaMeta } from '@/lib/estudio/midia'
import { lerWebhookCloud } from '@/lib/whatsapp-cloud/webhook-parser'

const ler = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

const tests: Record<string, () => void | Promise<void>> = {
  'idioma pelo DDI (decisão de 23/10), com prefixo mais longo primeiro': () => {
    assert.deepEqual(paisDoWaId('5521990773595'), { pais: 'BR', idioma: 'pt-BR' })
    assert.deepEqual(paisDoWaId('351912345678'), { pais: 'PT', idioma: 'pt-PT' })
    assert.deepEqual(paisDoWaId('34600111222'), { pais: 'ES', idioma: 'es-ES' })
    assert.deepEqual(paisDoWaId('5215512345678'), { pais: 'MX', idioma: 'es-MX' })
    assert.deepEqual(paisDoWaId('5491112345678'), { pais: 'AR', idioma: 'es-AR' })
    assert.deepEqual(paisDoWaId('573001112222'), { pais: 'CO', idioma: 'es-CO' })
    assert.deepEqual(paisDoWaId('14155550100'), { pais: 'US', idioma: 'en-US' })
    assert.deepEqual(paisDoWaId('4915112345678'), { pais: null, idioma: 'en' })
    assert.equal(bandeira('BR'), '🇧🇷'); assert.equal(bandeira(null), '🌐')
  },
  'Ana × Luís: manual pausa; volta sozinha após N horas; "Assumir" não volta': () => {
    const agora = new Date('2026-10-26T12:00:00Z')
    assert.ok(!devolveParaAna({ modo: 'ana', humano_desde: null, humano_fixo: false }, 2, agora))
    assert.ok(!devolveParaAna({ modo: 'humano', humano_desde: '2026-10-26T11:00:00Z', humano_fixo: false }, 2, agora))
    assert.ok(devolveParaAna({ modo: 'humano', humano_desde: '2026-10-26T09:59:00Z', humano_fixo: false }, 2, agora))
    assert.ok(!devolveParaAna({ modo: 'humano', humano_desde: '2026-10-20T00:00:00Z', humano_fixo: true }, 2, agora), 'assumido fica com o Luís')
  },
  'janela: contador e fechada': () => {
    const agora = new Date('2026-10-26T12:00:00Z')
    assert.equal(tempoDaJanela('2026-10-27T11:12:00Z', agora), '23h 12min')
    assert.equal(tempoDaJanela('2026-10-26T12:45:00Z', agora), '45min')
    assert.equal(tempoDaJanela('2026-10-26T11:00:00Z', agora), null)
  },
  'ticks: ✓ enviado, ✓✓ entregue, ✓✓ azul lido, ! falhou': () => {
    assert.equal(tick('sent').simbolo, '✓'); assert.equal(tick('delivered').simbolo, '✓✓')
    assert.ok(tick('read').azul); assert.ok(!tick('delivered').azul); assert.ok(tick('failed').falhou)
  },
  'mídia: tipo da Cloud API, extensão, limites e caminho no bucket privado': () => {
    assert.equal(tipoCloudDoMime('image/jpeg'), 'image'); assert.equal(tipoCloudDoMime('image/webp'), 'document')
    assert.equal(tipoCloudDoMime('audio/ogg'), 'audio'); assert.equal(tipoCloudDoMime('video/mp4'), 'video')
    assert.equal(tipoCloudDoMime('application/pdf'), 'document'); assert.equal(tipoDoHistorico('image'), 'imagem')
    assert.equal(extensaoDoMime('audio/ogg; codecs=opus'), 'ogg'); assert.equal(extensaoDoMime('x/y', 'a.DOCX'), 'docx')
    assert.equal(LIMITE_ENVIO.image, 5 * 1024 * 1024)
    assert.equal(caminhoMidiaDaConversa('c1', 'meu arquivo (1).pdf'), 'conversas/c1/meu_arquivo_1_.pdf')
    assert.equal(previaDaMensagem('audio', '[🎙 áudio]'), '🎙 Áudio'); assert.equal(previaDaMensagem('texto', 'oi'), 'oi')
  },
  'baixar da Meta: GET /{media_id} → url → bytes com o token no header': async () => {
    const chamadas: { url: string; h?: HeadersInit }[] = []
    const fn = (async (url: string, init?: RequestInit) => {
      chamadas.push({ url, h: init?.headers })
      if (url.includes('graph.facebook.com')) return new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'image/jpeg' }))
      return new Response(new Uint8Array([1, 2, 3]))
    }) as unknown as typeof fetch
    const r = await baixarMidiaDaMeta('MID1', 'TOK', fn)
    assert.deepEqual([...r.bytes], [1, 2, 3]); assert.equal(r.mime, 'image/jpeg')
    assert.ok(chamadas[0].url.endsWith('/MID1')); assert.ok(chamadas.every(c => !c.url.includes('TOK')))
    assert.equal((chamadas[1].h as Record<string, string>).Authorization, 'Bearer TOK')
  },
  'parser: figurinha, localização, mime e nome do documento': () => {
    const r = lerWebhookCloud({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'P' }, messages: [
      { id: 'a', from: '55', timestamp: '1', type: 'sticker', sticker: { id: 'S1', mime_type: 'image/webp' } },
      { id: 'b', from: '55', timestamp: '1', type: 'location', location: { latitude: -22.9, longitude: -43.2, name: 'Copacabana' } },
      { id: 'c', from: '55', timestamp: '1', type: 'document', document: { id: 'D1', mime_type: 'application/pdf', filename: 'comprovante.pdf' } },
    ] } }] }] })
    assert.equal(r.mensagens[0].tipoBruto, 'sticker'); assert.equal(r.mensagens[0].mediaId, 'S1'); assert.equal(r.mensagens[0].mediaMime, 'image/webp')
    assert.deepEqual(r.mensagens[1].localizacao, { lat: -22.9, lng: -43.2, nome: 'Copacabana' })
    assert.equal(r.mensagens[2].mediaNome, 'comprovante.pdf')
    assert.equal(r.mensagens[0].tipo, 'outro', 'o tipo do inbox não muda')
  },
  'entrada: baixa a mídia na hora, conta não lida, grava país/idioma, Ana quieta com o Luís': () => {
    const e = ler('src/lib/estudio/entrada.ts')
    assert.ok(e.includes('await guardarMidiaRecebida(admin, contatoId, m.wamid, m.mediaId, cfg.access_token, m.mediaNome)'))
    assert.ok(e.includes('nao_lidas: Number(existente?.nao_lidas ?? 0) + 1'))
    assert.ok(e.includes('const { pais, idioma } = paisDoWaId(m.de)'))
    assert.ok(e.includes("if (modo === 'humano') return"))
    assert.ok(e.includes("if (faltaColuna(eMsg?.message))"), 'sem o SQL novo, a Fase 2 continua funcionando')
  },
  'envio: janela checada, upload direto assinado, caminho do próprio contato, manual pausa a Ana': () => {
    const a = ler('src/app/actions/estudio-chat.ts')
    assert.ok(a.includes('const fora = checarJanela(c); if (fora) return fora'))
    assert.ok(a.includes('.createSignedUploadUrl(path)'))
    assert.ok(a.includes("if (!path.startsWith(`conversas/${contatoId}/`)) return { success: false, error: 'Arquivo inválido.' }"))
    assert.ok(a.includes("modo: 'humano', humano_desde: new Date().toISOString(), precisa_humano: false"))
    assert.ok(a.includes("const permitidos = new Set((meus ?? []).map(p => p.id))"), 'fotos só de pedidos do próprio contato')
    assert.ok(!/access_token/.test(a.split('export async function abrirConversaChat')[1].split('export async function')[0]), 'abrir conversa não devolve token')
    assert.ok(!/^export type \{/m.test(a))
  },
  'tela: voz OGG/Opus, polling, notificação pelo service worker, assumir/devolver': () => {
    const t = ler('src/app/(dashboard)/estudio-ia/aba-conversas.tsx')
    assert.ok(t.includes('webmParaOgg(new Uint8Array(await blob.arrayBuffer()))'))
    assert.ok(t.includes('setInterval(carregar, 5000)') && t.includes('setInterval(tick, 3000)'))
    assert.ok(t.includes("navigator.serviceWorker.register('/sw-estudio.js')"))
    assert.ok(t.includes("definirAtendimentoChat(c.id, 'ana')") && t.includes("definirAtendimentoChat(c.id, 'luis')"))
    assert.ok(t.includes('uploadToSignedUrl(up.path, up.token, arquivo'))
  },
  'PWA: manifest abre no chat e passa sem login; despachante conhece as ações do chat': () => {
    assert.ok(ler('src/app/manifest.ts').includes("start_url: '/estudio-ia?aba=conversas'"))
    assert.ok(ler('src/proxy.ts').includes("'/manifest.webmanifest', '/sw-estudio.js'"))
    assert.ok(ler('public/sw-estudio.js').includes("addEventListener('notificationclick'"))
    const r = ler('src/app/api/estudio/route.ts')
    for (const op of ['abrirConversaChat', 'enviarMidiaChat', 'definirAtendimentoChat', 'enviarModeloChat']) assert.ok(r.split('OPERACOES')[1].includes(op), op)
  },
  'SQL do chat: só colunas novas, nada da seção 4 renomeado': () => {
    const sql = ler('supabase/migrations/20261026000000_estudio_ia_chat.sql')
    assert.ok(!/RENAME|DROP COLUMN|DROP TABLE/i.test(sql))
    for (const c of ['pais', 'idioma', 'nao_lidas', 'modo', 'humano_desde', 'humano_fixo', 'notas', 'precisa_humano', 'media_path', 'autor', 'pausa_humano_horas']) {
      assert.ok(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\b`).test(sql), c)
    }
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
