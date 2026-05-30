'use client'

import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/actions/auth'
import { LayoutGrid, Plug, Users, BarChart2, Settings, ChevronUp, LogOut, User } from 'lucide-react'

const NAV = [
  { href: '/funnels',      label: 'Funis',          Icon: LayoutGrid },
  { href: '/integrations', label: 'Integrações',     Icon: Plug },
  { href: '/leads',        label: 'Leads',           Icon: Users },
  { href: '/metrics',      label: 'Métricas',        Icon: BarChart2 },
  { href: '/settings',     label: 'Configurações',   Icon: Settings },
]

interface Props {
  displayName: string
}

export default function Sidebar({ displayName }: Props) {
  const pathname = usePathname()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Collapse to icon-only in builder
  const isBuilder = /^\/funnels\/[^/]+\/builder/.test(pathname)
  const collapsed = isBuilder && !hovered
  const width = collapsed ? 60 : 220

  const initials = displayName
    .split(' ').slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '').join('')

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <aside
      onMouseEnter={() => isBuilder && setHovered(true)}
      onMouseLeave={() => { isBuilder && setHovered(false); setDropdownOpen(false) }}
      className="fixed inset-y-0 left-0 flex flex-col z-30 border-r border-white/5 overflow-hidden"
      style={{
        backgroundColor: '#18181B',
        width,
        transition: 'width 200ms ease',
      }}
    >
      {/* Logo */}
      <div className="px-4 py-5 shrink-0 overflow-hidden">
        {collapsed ? (
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">F</span>
          </div>
        ) : (
          <span className="font-bold text-white text-lg tracking-tight whitespace-nowrap">FunilPro</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap overflow-hidden ${
                active
                  ? 'bg-white/10 text-white border-l-2 border-white pl-[9px]'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={17} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
              {!collapsed && label}
            </Link>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-2 py-3 border-t border-white/5 shrink-0" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-white/5 transition-colors text-left overflow-hidden"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
            {initials || <User size={14} />}
          </div>
          {!collapsed && (
            <>
              <span className="flex-1 text-sm font-medium text-white truncate">{displayName}</span>
              <ChevronUp size={14} className={`text-gray-400 shrink-0 transition-transform ${dropdownOpen ? '' : 'rotate-180'}`} />
            </>
          )}
        </button>

        {dropdownOpen && !collapsed && (
          <div className="mt-1 bg-zinc-800 border border-white/10 rounded-xl shadow-lg overflow-hidden">
            <Link
              href="/settings"
              onClick={() => setDropdownOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors"
            >
              <User size={14} className="text-gray-400" />
              Perfil
            </Link>
            <form action={logout}>
              <button type="submit" className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors">
                <LogOut size={14} />
                Sair
              </button>
            </form>
          </div>
        )}
      </div>
    </aside>
  )
}
