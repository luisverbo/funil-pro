import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/sidebar'
import MainContent from '@/components/layout/main-content'

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
    <div className="min-h-screen bg-[#F9FAFB]">
      <Sidebar displayName={displayName} isAdmin={isAdmin} />
      <MainContent>{children}</MainContent>
    </div>
  )
}
