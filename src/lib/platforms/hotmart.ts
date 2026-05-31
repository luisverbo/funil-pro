// Hotmart product sync
export interface HotmartProduct {
  id: string
  name: string
  price: number
  type: string
  status: string
}

export async function fetchHotmartProducts(token: string): Promise<HotmartProduct[]> {
  const res = await fetch('https://sandbox.hotmart.com/product/api/v1/product/list', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Hotmart API error: ${res.status}`)
  const json = await res.json()
  const items = json.items ?? json.data ?? json.products ?? []
  return (items as Record<string, unknown>[]).map((p) => ({
    id: String(p.id ?? p.ucode ?? ''),
    name: String(p.name ?? ''),
    price: Number((p.price as Record<string, unknown>)?.value ?? p.price ?? 0),
    type: String(p.productFormat ?? 'digital'),
    status: String(p.status ?? 'active'),
  }))
}
