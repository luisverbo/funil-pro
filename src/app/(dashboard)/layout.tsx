import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { logout } from '@/app/actions/auth'

const NAV = [
  { href: '/funnels',      label: 'Funis' },
  { href: '/integrations', label: 'Integrações' },
  { href: '/leads',        label: 'Leads' },
  { href: '/metrics',      label: 'Métricas' },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Usuário'

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-0 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-bold text-indigo-600 text-lg py-3">FunilPro</span>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-4 text-sm text-gray-500 hover:text-gray-900 border-b-2 border-transparent hover:border-indigo-500 transition-all"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
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
