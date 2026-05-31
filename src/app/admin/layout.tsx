import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminShell from '@/components/admin/admin-shell'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: ut } = await supabase
    .from('users_tenants')
    .select('role')
    .eq('user_id', user.id)
    .single()

  if (!ut || ut.role !== 'admin') redirect('/funnels')

  return <AdminShell>{children}</AdminShell>
}
