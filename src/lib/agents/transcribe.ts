// Transcrição de áudio via OpenAI Whisper. Opcional: se OPENAI_API_KEY não
// estiver configurada, retorna null e o agente pede o texto com naturalidade.

export async function transcribeAudio(base64: string, mimetype = 'audio/ogg'): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  try {
    const buf = Buffer.from(base64, 'base64')
    const ext = mimetype.includes('mp4') || mimetype.includes('m4a') ? 'm4a'
      : mimetype.includes('mpeg') || mimetype.includes('mp3') ? 'mp3' : 'ogg'
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(buf)], { type: mimetype }), `audio.${ext}`)
    form.append('model', 'whisper-1')
    form.append('language', 'pt')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!res.ok) {
      console.error(`[transcribe] whisper status=${res.status}: ${await res.text().catch(() => '')}`)
      return null
    }
    const json = await res.json() as { text?: string }
    return json.text?.trim() || null
  } catch (err) {
    console.error(`[transcribe] falhou: ${String(err)}`)
    return null
  }
}
