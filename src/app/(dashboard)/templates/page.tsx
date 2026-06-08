import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import TemplatesClient from '@/components/templates/templates-client'
import TemplatesHeader from '@/components/templates/templates-header'
import type { FunnelTemplate } from '@/types'

export default async function TemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ut } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!ut) redirect('/onboarding')

  const admin = createAdminClient()

  const [{ data: templates }, { data: userFunnels }] = await Promise.all([
    admin
      .from('funnel_templates')
      .select('*')
      .eq('is_public', true)
      .order('downloads_count', { ascending: false }),
    admin
      .from('funnels')
      .select('id, name, status')
      .eq('tenant_id', ut.tenant_id)
      .order('created_at', { ascending: false }),
  ])

  const list = (templates ?? []) as FunnelTemplate[]
  const funnels = (userFunnels ?? []) as { id: string; name: string; status: string }[]

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <TemplatesHeader userFunnels={funnels} />
      <TemplatesClient initialTemplates={list} onCreateTemplate={() => {}} />
    </div>
  )
}
