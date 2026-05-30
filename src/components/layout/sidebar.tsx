'use client'

import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/actions/auth'
import {
  LayoutGrid,
  Plug,
  Users,
  BarChart2,
  Settings,
  ChevronUp,
  LogOut,
  User,
} from 'lucide-react'

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
  const dropdownRef = useRef<HTMLDivElement>(null)

  const initials = displayName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <aside className="fixed inset-y-0 left-0 w-[220px] bg-white border-r border-gray-100 flex flex-col z-30">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <span className="font-bold text-indigo-600 text-lg tracking-tight">FunilPro</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon
                size={17}
                className={active ? 'text-indigo-600' : 'text-gray-400'}
                strokeWidth={active ? 2.5 : 2}
              />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-gray-100" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors text-left"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
            {initials || <User size={14} />}
          </div>
          <span className="flex-1 text-sm font-medium text-gray-700 truncate">{displayName}</span>
          <ChevronUp
            size={14}
            className={`text-gray-400 transition-transform ${dropdownOpen ? '' : 'rotate-180'}`}
          />
        </button>

        {dropdownOpen && (
          <div className="mt-1 bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
            <Link
              href="/settings"
              onClick={() => setDropdownOpen(false)}
              className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <User size={14} className="text-gray-400" />
              Perfil
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
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
