import { NextResponse } from 'next/server'

export async function GET() {
  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY

  if (!url || !key) {
    return NextResponse.json({ error: 'Env vars missing', urlSet: !!url, keySet: !!key })
  }

  try {
    const res = await fetch(`${url}/instance/fetchInstances`, {
      headers: { apikey: key },
    })
    const text = await res.text()
    return NextResponse.json({
      status: res.status,
      ok: res.ok,
      url,
      keyLength: key.length,
      keyFirst4: key.slice(0, 4),
      body: text.slice(0, 500),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err), url, keyLength: key.length })
  }
}
