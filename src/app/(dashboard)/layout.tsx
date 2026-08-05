import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/layout/app-shell'
import { canShowContentStudioNav } from '@/lib/content-studio/nav-access'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Usuário'

  let isAdmin = false
  if (user) {
    const { data: ut } = await supabase
      .from('users_tenants')
      .select('role')
      .eq('user_id', user.id)
      .single()
    isAdmin = ut?.role === 'admin'
  }

  // Decisão feita AQUI (servidor): o cliente só recebe um boolean.
  const showContentStudio = user ? canShowContentStudioNav(user.id) : false

  return (
    <AppShell displayName={displayName} isAdmin={isAdmin} showContentStudio={showContentStudio}>
      {children}
    </AppShell>
  )
}
