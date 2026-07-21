import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logoutInstance, restartInstance } from '@/lib/evolution'

// Força reconexão: desloga a sessão fantasma na Evolution (que fica dizendo
// "open" mesmo com o celular desconectado) e libera a geração de QR novo.
export async function POST(
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

  const { data: ut } = await supabase.from('users_tenants').select('tenant_id').eq('user_id', user.id).single()
  if (!ut || ut.tenant_id !== instance.tenant_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await logoutInstance(instance.instance_name).catch(() => {})
    await restartInstance(instance.instance_name).catch(() => {})
    await admin.from('whatsapp_instances').update({ status: 'disconnected' }).eq('id', instanceId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
