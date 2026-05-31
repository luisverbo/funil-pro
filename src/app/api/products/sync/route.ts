import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKiwifyProducts } from '@/lib/platforms/kiwify'
import { fetchHotmartProducts } from '@/lib/platforms/hotmart'
import { fetchEduzzProducts } from '@/lib/platforms/eduzz'
import { fetchYampiProducts } from '@/lib/platforms/yampi'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: ut } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!ut) return NextResponse.json({ error: 'Tenant not found' }, { status: 403 })

  const body = await req.json()
  const { platform, credentials } = body as {
    platform: 'kiwify' | 'hotmart' | 'eduzz' | 'yampi'
    credentials: Record<string, string>
  }

  let products: { id: string; name: string; price: number; type: string; status: string }[] = []

  try {
    if (platform === 'kiwify') {
      products = await fetchKiwifyProducts(credentials.client_id, credentials.client_secret, credentials.account_id)
    } else if (platform === 'hotmart') {
      products = await fetchHotmartProducts(credentials.token)
    } else if (platform === 'eduzz') {
      products = await fetchEduzzProducts(credentials.apiKey, credentials.email)
    } else if (platform === 'yampi') {
      products = await fetchYampiProducts(credentials.alias, credentials.token, credentials.secretKey)
    } else {
      return NextResponse.json({ error: 'Unknown platform' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }

  const admin = createAdminClient()

  const rows = products.map((p) => ({
    tenant_id: ut.tenant_id,
    platform,
    product_id_external: p.id,
    name: p.name,
    price_cents: Math.round(p.price * 100),
    type: p.type,
    status: p.status,
  }))

  const { error } = await admin
    .from('products')
    .upsert(rows, { onConflict: 'tenant_id,platform,product_id_external', ignoreDuplicates: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ synced: rows.length })
}
