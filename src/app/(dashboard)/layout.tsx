import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/actions/auth'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Usuário'

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <span className="font-bold text-indigo-600 text-lg">FunilPro</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{displayName}</span>
          <form action={logout}>
            <button
              type="submit"
              className="text-sm text-gray-500 hover:text-red-600 transition-colors cursor-pointer"
            >
              Sair
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
