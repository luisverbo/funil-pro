import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ pages: [] }, { status: 401 })

    const { data: membership } = await supabase
      .from('users_tenants')
      .select('tenant_id')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    if (!membership?.tenant_id) return NextResponse.json({ pages: [] })

    const { data: pages } = await supabase
      .from('pages')
      .select('id, title, slug, published')
      .eq('tenant_id', membership.tenant_id)
      .order('created_at', { ascending: false })

    return NextResponse.json({ pages: pages ?? [] })
  } catch (err) {
    console.error('[pages/list]', err)
    return NextResponse.json({ pages: [] }, { status: 500 })
  }
}
