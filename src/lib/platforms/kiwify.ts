// Kiwify product sync — OAuth2 client_credentials com Basic Auth
export interface KiwifyProduct {
  id: string
  name: string
  price: number
  type: string
  status: string
}

async function getKiwifyToken(clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch('https://api.kiwify.com.br/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basic}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kiwify OAuth error: ${res.status} ${text}`)
  }
  const json = await res.json()
  return (json.access_token ?? json.token) as string
}

export async function fetchKiwifyProducts(
  clientId: string,
  clientSecret: string,
  accountId: string,
): Promise<KiwifyProduct[]> {
  const token = await getKiwifyToken(clientId, clientSecret)
  const res = await fetch(`https://api.kiwify.com.br/v1/products?account_id=${accountId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Kiwify API error: ${res.status} ${text}`)
  }
  const json = await res.json()
  const items = json.data ?? json.products ?? json ?? []
  return (items as Record<string, unknown>[]).map((p) => ({
    id: String(p.id ?? p.product_id ?? ''),
    name: String(p.name ?? p.title ?? ''),
    price: Number(p.price ?? p.value ?? 0),
    type: String(p.type ?? 'digital'),
    status: String(p.status ?? 'active'),
  }))
}
