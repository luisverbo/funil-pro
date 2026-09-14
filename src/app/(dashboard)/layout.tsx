import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/layout/app-shell'
import { canShowContentStudioNav } from '@/lib/content-studio/nav-access'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Usuário'

  let isAdmin = false
  let plan = 'starter'
  if (user) {
    const { data: ut } = await supabase
      .from('users_tenants')
      .select('role, tenant_id')
      .eq('user_id', user.id)
      .single()
    isAdmin = ut?.role === 'admin'
    if (ut?.tenant_id) {
      const { data: t } = await supabase.from('tenants').select('plan').eq('id', ut.tenant_id).single()
      plan = (t?.plan as string) ?? 'starter'
    }
  }

  // Decisão feita AQUI (servidor): o cliente só recebe um boolean.
  const showContentStudio = user ? canShowContentStudioNav(user.id) : false

  return (
    <AppShell displayName={displayName} isAdmin={isAdmin} showContentStudio={showContentStudio} plan={plan}>
      {children}
    </AppShell>
  )
}
