import { NextResponse } from 'next/server'

export async function GET() {
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY

  if (!url || !key) {
    return NextResponse.json({ error: 'Env vars missing', urlSet: !!url, keySet: !!key })
  }

  const testName = `debug_test_${Date.now()}`

  try {
    // Test create instance — same call as createWhatsappInstance
    const res = await fetch(`${url}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ instanceName: testName, qrcode: true }),
    })
    const text = await res.text()

    // Immediately delete if created
    if (res.ok) {
      await fetch(`${url}/instance/delete/${testName}`, {
        method: 'DELETE',
        headers: { apikey: key },
      }).catch(() => {})
    }

    return NextResponse.json({
      endpoint: `POST ${url}/instance/create`,
      status: res.status,
      ok: res.ok,
      responseBody: text.slice(0, 1000),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) })
  }
}
