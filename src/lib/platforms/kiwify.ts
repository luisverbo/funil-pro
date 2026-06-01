// Kiwify product sync — uses client_secret directly as Bearer token
export interface KiwifyProduct {
  id: string
  name: string
  price: number
  type: string
  status: string
}

export async function fetchKiwifyProducts(
  clientId: string,
  clientSecret: string,
  accountId: string,
): Promise<KiwifyProduct[]> {
  // Kiwify Public API: client_secret is used as Bearer token
  // account_id passed as query param
  const url = `https://public-api.kiwify.com/v1/products?account_id=${accountId}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${clientSecret}`,
      'x-client-id': clientId,
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
