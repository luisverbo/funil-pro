// ============================================================================
// Gravador de voz → WhatsApp: WebM/Opus vira OGG/Opus sem perda
// ----------------------------------------------------------------------------
// O Chrome grava a voz em WebM, que a Meta recusa — mas o codec (Opus) é o
// mesmo do OGG que ela aceita. O reempacotador abre o WebM, tira os pacotes
// intactos e sela em OGG. Estes testes montam um WebM SINTÉTICO byte a byte
// (a estrutura EBML real do MediaRecorder) e conferem o OGG que sai.
// ============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  amostrasDoPacoteOpus, lerWebmOpus, webmParaOgg,
} from '@/lib/whatsapp-cloud/webm-para-ogg'

const RAIZ = process.cwd()

// ─── Construtor de WebM sintético (EBML mínimo, como o MediaRecorder) ───────

function vintTamanho(n: number): number[] {
  // 1 byte para valores < 127 (suficiente para os testes)
  return [0x80 | n]
}

function elemento(id: number[], corpo: number[]): number[] {
  return [...id, ...vintTamanho(corpo.length), ...corpo]
}

/** SimpleBlock: trilha 1 + timecode 0 + flags 0 + pacote. */
function simpleBlock(pacote: number[]): number[] {
  return elemento([0xa3], [0x81, 0x00, 0x00, 0x00, ...pacote])
}

/** Pacote Opus de 20ms CELT (config 31 → TOC 0xF8, código 0 = 1 frame). */
const PACOTE_20MS = [0xf8, 0x01, 0x02, 0x03]
/** Pacote Opus de 10ms SILK NB (config 0, código 0). */
const PACOTE_10MS_SILK = [0x00, 0x0a, 0x0b]

const OPUS_HEAD = [
  0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,  // "OpusHead"
  1, 1, 0x38, 0x01, 0x80, 0xbb, 0x00, 0x00, 0, 0, 0,
]

function webmSintetico(): Uint8Array {
  const codecPrivate = elemento([0x63, 0xa2], OPUS_HEAD)
  const trackEntry = elemento([0xae], codecPrivate)
  const tracks = elemento([0x16, 0x54, 0xae, 0x6b], trackEntry)
  const cluster = elemento([0x1f, 0x43, 0xb6, 0x75], [
    ...simpleBlock(PACOTE_20MS),
    ...simpleBlock(PACOTE_20MS),
    ...simpleBlock(PACOTE_10MS_SILK),
  ])
  const segment = elemento([0x18, 0x53, 0x80, 0x67], [...tracks, ...cluster])
  return new Uint8Array(segment)
}

const tests: Record<string, () => void> = {
  'duração dos pacotes sai do TOC (a base do granulepos)': () => {
    assert.equal(amostrasDoPacoteOpus(new Uint8Array(PACOTE_20MS)), 960, '20ms @48kHz = 960 amostras')
    assert.equal(amostrasDoPacoteOpus(new Uint8Array(PACOTE_10MS_SILK)), 480, '10ms = 480')
    assert.equal(amostrasDoPacoteOpus(new Uint8Array([])), 0, 'pacote vazio não soma')
  },

  'o parser EBML acha o OpusHead e TODOS os pacotes do WebM': () => {
    const lido = lerWebmOpus(webmSintetico())
    assert.ok(lido, 'WebM sintético válido precisa ser lido')
    assert.equal(lido!.pacotes.length, 3)
    assert.deepEqual([...lido!.pacotes[0]], PACOTE_20MS)
    assert.deepEqual([...lido!.opusHead ?? []], OPUS_HEAD, 'o cabeçalho oficial vem do CodecPrivate')
  },

  'o OGG que sai é um Opus-in-Ogg de verdade': () => {
    const ogg = webmParaOgg(webmSintetico())
    assert.ok(ogg, 'a conversão não pode falhar num WebM válido')
    const texto = Buffer.from(ogg!).toString('latin1')
    assert.equal(texto.slice(0, 4), 'OggS', 'toda página Ogg começa com OggS')
    assert.ok(texto.includes('OpusHead'), 'sem OpusHead o WhatsApp rejeita')
    assert.ok(texto.includes('OpusTags'), 'OpusTags é obrigatório no Opus-in-Ogg')
    // 3 páginas no mínimo: head, tags, áudio
    const paginas = texto.split('OggS').length - 1
    assert.ok(paginas >= 3, `esperava >=3 páginas, achei ${paginas}`)
    // A última página carrega o granulepos total: 960+960+480 = 2400 amostras
    const bytes = ogg!
    let ultimaPagina = -1
    for (let i = 0; i + 4 <= bytes.length; i++) {
      if (bytes[i] === 0x4f && bytes[i + 1] === 0x67 && bytes[i + 2] === 0x67 && bytes[i + 3] === 0x53) ultimaPagina = i
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset + ultimaPagina)
    assert.equal(dv.getUint32(6, true), 2400, 'granulepos final = soma das amostras dos pacotes')
    assert.equal(bytes[ultimaPagina + 5], 0x04, 'a última página leva a flag de fim de stream')
  },

  'lixo não vira OGG — devolve null com honestidade': () => {
    assert.equal(webmParaOgg(new Uint8Array([1, 2, 3, 4])), null)
    assert.equal(webmParaOgg(new Uint8Array(0)), null)
  },

  'o composer tem o gravador estilo WhatsApp': () => {
    const ui = readFileSync(join(RAIZ, 'src/app/(dashboard)/whatsapp/whatsapp-client.tsx'), 'utf8')
    assert.ok(ui.includes('iniciarGravacao'), 'falta o gravador')
    assert.ok(ui.includes('MediaRecorder'), 'a gravação é do microfone, não de arquivo')
    assert.ok(ui.includes('webmParaOgg'), 'Chrome grava WebM — sem o reempacotador a Meta recusa')
    assert.ok(/texto\.trim\(\) \?[\s\S]{0,1200}🎤/.test(ui),
      'sem texto o botão é o MICROFONE, com texto vira enviar — igual ao WhatsApp')
    assert.ok(ui.includes('pararGravacao(true)'), 'tem que dar para descartar a gravação')
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
