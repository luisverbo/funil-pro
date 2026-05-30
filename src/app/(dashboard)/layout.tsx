import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Usuário'

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <Sidebar displayName={displayName} />
      <main className="ml-[220px] min-h-screen p-6">{children}</main>
    </div>
  )
}
