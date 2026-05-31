import { createClient } from '@/lib/supabase/server'
import AppShell from '@/components/layout/app-shell'

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

  return (
    <AppShell displayName={displayName} isAdmin={isAdmin}>
      {children}
    </AppShell>
  )
}
