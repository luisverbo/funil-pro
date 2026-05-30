import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import MyTemplatesTable from '@/components/templates/my-templates-table'
import type { FunnelTemplate } from '@/types'

export default async function MyTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ut } = await supabase
    .from('users_tenants')
    .select('tenant_id')
    .eq('user_id', user.id)
    .single()

  if (!ut) redirect('/login')

  const admin = createAdminClient()
  const { data: templates } = await admin
    .from('funnel_templates')
    .select('*')
    .eq('tenant_id', ut.tenant_id)
    .order('created_at', { ascending: false })

  const list = (templates ?? []) as FunnelTemplate[]

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meus Templates</h1>
          <p className="text-gray-500 text-sm mt-1">Templates que você salvou a partir dos seus funis</p>
        </div>
        <Link
          href="/templates"
          className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition"
        >
          Ver Marketplace
        </Link>
      </div>

      <MyTemplatesTable initialTemplates={list} />
    </div>
  )
}
