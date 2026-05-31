// Yampi product sync
export interface YampiProduct {
  id: string
  name: string
  price: number
  type: string
  status: string
}

export async function fetchYampiProducts(alias: string, token: string, secretKey: string): Promise<YampiProduct[]> {
  const res = await fetch(`https://api.dooki.com.br/v2/${alias}/catalog/products`, {
    headers: {
      'User-Token': token,
      'User-Secret-Key': secretKey,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Yampi API error: ${res.status}`)
  const json = await res.json()
  const items = json.data?.data ?? json.data ?? []
  return (items as Record<string, unknown>[]).map((p) => ({
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    price: Number(p.price ?? 0),
    type: 'physical',
    status: String(p.is_active ? 'active' : 'inactive'),
  }))
}
