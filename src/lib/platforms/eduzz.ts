// Eduzz product sync
export interface EduzzProduct {
  id: string
  name: string
  price: number
  type: string
  status: string
}

export async function fetchEduzzProducts(apiKey: string, email: string): Promise<EduzzProduct[]> {
  const res = await fetch('https://api2.eduzz.com/product/get_list', {
    headers: {
      'PublicKey': apiKey,
      'Email': email,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Eduzz API error: ${res.status}`)
  const json = await res.json()
  const items = json.data ?? []
  return (items as Record<string, unknown>[]).map((p) => ({
    id: String(p.content_id ?? p.id ?? ''),
    name: String(p.content_title ?? p.name ?? ''),
    price: Number(p.content_price ?? p.price ?? 0),
    type: String(p.content_type ?? 'digital'),
    status: String(p.status ?? 'active'),
  }))
}
