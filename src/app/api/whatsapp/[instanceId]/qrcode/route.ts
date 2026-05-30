import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getInstanceQRCode } from '@/lib/evolution'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  const { instanceId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: instance } = await admin
    .from('whatsapp_instances')
    .select('instance_name, tenant_id')
    .eq('id', instanceId)
    .single()

  if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Verify tenant ownership
  const { data: ut } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!ut || ut.tenant_id !== instance.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const data = await getInstanceQRCode(instance.instance_name)
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Evolution API error' }, { status: 500 })
  }
}
