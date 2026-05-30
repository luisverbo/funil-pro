'use client'

import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/actions/auth'
import { LayoutGrid, Plug, Users, BarChart2, Settings, LogOut, User, PanelLeftClose, PanelLeftOpen, LayoutTemplate } from 'lucide-react'

const NAV = [
  { href: '/funnels',      label: 'Funis',          Icon: LayoutGrid },
  { href: '/integrations', label: 'Integrações',     Icon: Plug },
  { href: '/leads',        label: 'Leads',           Icon: Users },
  { href: '/templates',    label: 'Templates',       Icon: LayoutTemplate },
  { href: '/metrics',      label: 'Métricas',        Icon: BarChart2 },
  { href: '/settings',     label: 'Configurações',   Icon: Settings },
]

const STORAGE_KEY = 'funilpro:sidebar-collapsed'

interface Props {
  displayName: string
}

export default function Sidebar({ displayName }: Props) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load persisted preference
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored !== null) setCollapsed(stored === 'true')
    } catch {}
  }, [])

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v
      try {
        localStorage.setItem(STORAGE_KEY, String(next))
        window.dispatchEvent(new Event('funilpro:sidebar-toggle'))
      } catch {}
      return next
    })
  }

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
      className="fixed inset-y-0 left-0 flex flex-col z-30 border-r border-white/5"
      style={{
        backgroundColor: '#18181B',
        width: collapsed ? 60 : 220,
        transition: 'width 200ms ease',
      }}
    >
      {/* Logo + toggle */}
      <div className="flex items-center justify-between px-3 py-4 shrink-0 overflow-hidden">
        {!collapsed && (
          <span className="font-bold text-white text-lg tracking-tight whitespace-nowrap">FunilPro</span>
        )}
        {collapsed && (
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center mx-auto">
            <span className="text-white font-bold text-xs">F</span>
          </div>
        )}
        <button
          onClick={toggle}
          title={collapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
          className={`text-gray-500 hover:text-white transition-colors shrink-0 ${collapsed ? 'hidden' : 'ml-auto'}`}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* Toggle button when collapsed — separate row */}
      {collapsed && (
        <button
          onClick={toggle}
          title="Expandir sidebar"
          className="mx-auto mb-2 text-gray-500 hover:text-white transition-colors"
        >
          <PanelLeftOpen size={16} />
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {NAV.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap overflow-hidden ${
                collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5'
              } ${
                active
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
              style={active && !collapsed ? { borderLeft: '2px solid white', paddingLeft: 10 } : {}}
            >
              <Icon size={17} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
              {!collapsed && label}

              {/* Tooltip when collapsed */}
              {collapsed && (
                <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-zinc-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                  {label}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* User footer */}
      <div className={`py-3 border-t border-white/5 shrink-0 ${collapsed ? 'px-2' : 'px-2'}`} ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen((v) => !v)}
          title={collapsed ? displayName : undefined}
          className={`group relative w-full flex items-center rounded-lg hover:bg-white/5 transition-colors text-left overflow-hidden ${
            collapsed ? 'justify-center py-2' : 'gap-3 px-2.5 py-2'
          }`}
        >
          <div className="w-7 h-7 rounded-full bg-indigo-500 text-white flex items-center justify-center text-xs font-bold shrink-0">
            {initials || <User size={14} />}
          </div>
          {!collapsed && (
            <span className="flex-1 text-sm font-medium text-white truncate">{displayName}</span>
          )}
          {collapsed && (
            <span className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded-md bg-zinc-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-lg">
              {displayName}
            </span>
          )}
        </button>

        {dropdownOpen && (
          <div className={`mt-1 bg-zinc-800 border border-white/10 rounded-xl shadow-lg overflow-hidden ${collapsed ? 'absolute left-16 bottom-4 w-40' : ''}`}>
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
