import { NextResponse } from 'next/server'

export const maxDuration = 30

export async function GET() {
  const url = process.env.EVOLUTION_API_URL ?? '(não definido)'
  const key = process.env.EVOLUTION_API_KEY ? `${process.env.EVOLUTION_API_KEY.slice(0, 8)}...` : '(não definido)'
  const instanceName = 't7fb200_luis_funil_pro_mpsjyw0j'
  const testPhone = '5521985285047'
  const testMessage = 'Teste do FunilPro — diagnóstico de envio'

  // Testa conexão com a Evolution API
  let statusCheck: unknown = null
  let statusError: string | null = null
  try {
    const r = await fetch(`${url}/instance/connectionState/${instanceName}`, {
      headers: { apikey: process.env.EVOLUTION_API_KEY ?? '' },
      signal: AbortSignal.timeout(8000),
    })
    statusCheck = await r.json().catch(() => r.text())
  } catch (e) {
    statusError = String(e)
  }

  // Testa envio com formato v2: { number, text }
  let sendV2: unknown = null
  let sendV2Error: string | null = null
  try {
    const r = await fetch(`${url}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_API_KEY ?? '' },
      body: JSON.stringify({ number: testPhone, text: testMessage }),
      signal: AbortSignal.timeout(8000),
    })
    const body = await r.text()
    sendV2 = { status: r.status, body }
  } catch (e) {
    sendV2Error = String(e)
  }

  return NextResponse.json({
    env: { url, key },
    connectionState: statusCheck ?? statusError,
    sendV2: sendV2 ?? sendV2Error,
  })
}
