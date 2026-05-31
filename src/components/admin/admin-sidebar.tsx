'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid, Users, LayoutTemplate, Settings, ArrowLeft, ListTodo } from 'lucide-react'

const NAV = [
  { href: '/admin', label: 'Visão Geral', Icon: LayoutGrid, exact: true },
  { href: '/admin/tenants', label: 'Clientes', Icon: Users },
  { href: '/admin/templates', label: 'Templates', Icon: LayoutTemplate },
  { href: '/admin/queue', label: 'Fila de Jobs', Icon: ListTodo },
  { href: '/admin/settings', label: 'Configurações', Icon: Settings },
]

interface Props {
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export default function AdminSidebar({ mobileOpen = false, onMobileClose }: Props) {
  const pathname = usePathname()

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 flex flex-col z-50 border-r border-white/5 transition-transform duration-200 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
        style={{ backgroundColor: '#18181B', width: 224 }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4 shrink-0">
          <span className="font-bold text-white text-lg tracking-tight">FunilPro</span>
          <span className="text-xs font-semibold bg-red-600 text-white px-1.5 py-0.5 rounded">Admin</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-1 space-y-0.5">
          {NAV.map(({ href, label, Icon, exact }) => {
            const active = exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                onClick={onMobileClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px] ${
                  active
                    ? 'bg-white/10 text-white border-l-2 border-white pl-[10px]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={17} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Back to App */}
        <div className="px-2 py-3 border-t border-white/5 shrink-0">
          <Link
            href="/funnels"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors min-h-[44px]"
          >
            <ArrowLeft size={17} className="shrink-0" />
            Voltar ao App
          </Link>
        </div>
      </aside>
    </>
  )
}
