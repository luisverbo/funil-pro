// ============================================================================
// Estúdio IA — Fase 5: motor "API automática" (Google Gemini) — seção 8b
// ----------------------------------------------------------------------------
// gerarFotoGemini: gemini-3-pro-image, UMA pose por chamada, partes =
//   [prompt_cliente preenchido, rosto, corpo], 4:5, 2K. A imagem volta em
//   candidates[0].content.parts[].inlineData.
// notaDoRosto: gemini-2.5-flash compara rosto da cliente × foto gerada e
//   devolve 0–10 (< 7 → gerar de novo 1 vez e ficar com a melhor).
// `fetchFn` injetável: os testes nunca chamam a API de verdade.
// ============================================================================
import { lerNota } from './producao'

export const MODELO_IMAGEM = 'gemini-3-pro-image'
export const MODELO_NOTA = 'gemini-2.5-flash'
const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
type Fetch = typeof fetch

export interface Imagem { bytes: Uint8Array; mime: string }

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const parteImagem = (i: Imagem) => ({ inline_data: { mime_type: /png/.test(i.mime) ? 'image/png' : /webp/.test(i.mime) ? 'image/webp' : 'image/jpeg', data: b64(i.bytes) } })

type RespostaGemini = {
  candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

async function chamar(modelo: string, chave: string, corpo: unknown, f: Fetch): Promise<RespostaGemini> {
  const r = await f(`${URL_BASE}/${modelo}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': chave, 'content-type': 'application/json' }, body: JSON.stringify(corpo),
  })
  const j = await r.json().catch(() => null) as RespostaGemini | null
  if (!r.ok || !j) throw new Error(j?.error?.message ?? `Gemini HTTP ${r.status}`)
  if (j.promptFeedback?.blockReason) throw new Error(`Gemini bloqueou: ${j.promptFeedback.blockReason}`)
  return j
}

export function imagemDaResposta(j: RespostaGemini): Imagem | null {
  for (const p of j.candidates?.[0]?.content?.parts ?? []) {
    const d = p.inlineData?.data ?? p.inline_data?.data
    if (d) return { bytes: new Uint8Array(Buffer.from(d, 'base64')), mime: p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? 'image/png' }
  }
  return null
}

export async function gerarFotoGemini(prompt: string, rosto: Imagem, corpo: Imagem, chave: string, f: Fetch = fetch): Promise<Imagem> {
  const j = await chamar(MODELO_IMAGEM, chave, {
    contents: [{ role: 'user', parts: [{ text: prompt }, parteImagem(rosto), parteImagem(corpo)] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5', imageSize: '2K' } },
  }, f)
  const img = imagemDaResposta(j)
  if (!img) throw new Error(`Gemini não devolveu imagem (${j.candidates?.[0]?.finishReason ?? 'sem motivo'})`)
  return img
}

export const PERGUNTA_NOTA = 'De 0 a 10, quanto a pessoa da 2ª imagem é a mesma da 1ª (formato do rosto, olhos, nariz, boca, idade)? Responda só o número.'

/** Nota 0–10 do rosto; erro/ilegível → null (não trava a entrega). */
export async function notaDoRosto(rosto: Imagem, gerada: Imagem, chave: string, f: Fetch = fetch): Promise<number | null> {
  try {
    const j = await chamar(MODELO_NOTA, chave, {
      contents: [{ role: 'user', parts: [parteImagem(rosto), parteImagem(gerada), { text: PERGUNTA_NOTA }] }],
      generationConfig: { maxOutputTokens: 16, thinkingConfig: { thinkingBudget: 0 } },
    }, f)
    return lerNota((j.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join(''))
  } catch (err) {
    console.warn('[estudio/gemini] nota do rosto falhou:', String(err).slice(0, 200))
    return null
  }
}
