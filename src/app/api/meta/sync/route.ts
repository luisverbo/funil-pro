import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncMetaAdMetrics } from '@/lib/meta/sync'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: ut } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!ut) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  const synced = await syncMetaAdMetrics(ut.tenant_id)
  return NextResponse.json({ success: true, synced })
}
