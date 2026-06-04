'use client'

import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/actions/auth'
import { LayoutGrid, Plug, Users, BarChart2, Settings, LogOut, User, LayoutTemplate, Globe, Shield } from 'lucide-react'

const NAV = [
  { href: '/funnels',       label: 'Funis',              Icon: LayoutGrid },
  { href: '/integrations',  label: 'Integrações',         Icon: Plug },
  { href: '/leads',         label: 'Leads',               Icon: Users },
  { href: '/templates',     label: 'Templates',           Icon: LayoutTemplate },
  { href: '/pages',         label: 'Páginas',             Icon: Globe },
  { href: '/metrics',       label: 'Métricas',            Icon: BarChart2 },
  { href: '/settings',      label: 'Configurações',       Icon: Settings },
]

const STORAGE_KEY = 'funilpro:sidebar-collapsed'
const EXPANDED_W = 240
const COLLAPSED_W = 64

interface Props {
  displayName: string
  isAdmin?: boolean
  mobileOpen?: boolean
  onMobileClose?: () => void
}

function FunnelLogo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" width={size} height={size}>
      <rect width="28" height="28" rx="7" fill="#6366F1" />
      <path d="M6 7h16l-6.2 7.44V19.5l-3.6-1.8V14.44L6 7z" fill="white" opacity="0.9" />
    </svg>
  )
}

export default function Sidebar({ displayName, isAdmin, mobileOpen = false, onMobileClose }: Props) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

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

  const initials = displayName.split(' ').slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => { onMobileClose?.() }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  const w = collapsed ? COLLAPSED_W : EXPANDED_W

  return (
    <>
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/60" onClick={onMobileClose} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 flex flex-col z-50 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
        style={{
          width: w,
          backgroundColor: '#0C0C0C',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          transition: 'width 200ms ease, transform 200ms ease',
        }}
      >
        {/* Logo */}
        <div
          className="shrink-0 overflow-hidden flex items-center"
          style={{
            height: 60,
            padding: collapsed ? '0' : '0 16px',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          {collapsed ? (
            <FunnelLogo size={28} />
          ) : (
            <div className="flex items-center gap-2.5">
              <FunnelLogo size={28} />
              <span className="text-white font-bold text-lg tracking-tight">FunilPro</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-2 overflow-y-auto">
          {NAV.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 transition-colors ${
                  active
                    ? 'bg-indigo-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-white/8'
                }`}
                style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && <span className="text-sm font-medium">{label}</span>}
              </Link>
            )
          })}

          {isAdmin && (
            <Link
              href="/admin"
              title={collapsed ? 'Admin' : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 mt-2 transition-colors ${
                pathname.startsWith('/admin')
                  ? 'bg-red-700 text-white'
                  : 'text-red-400 hover:text-white hover:bg-red-900/40'
              }`}
              style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
            >
              <Shield size={18} className="shrink-0" />
              {!collapsed && <span className="text-sm font-medium">Admin</span>}
            </Link>
          )}
        </nav>

        {/* User dropdown */}
        <div className="shrink-0 px-2 pb-3" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/8 transition-colors"
            style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
          >
            <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {initials || <User size={14} />}
            </div>
            {!collapsed && (
              <span className="text-sm font-medium text-gray-300 truncate flex-1 text-left">{displayName}</span>
            )}
          </button>

          {dropdownOpen && (
            <div
              className="absolute left-2 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50"
              style={{ bottom: 64, width: collapsed ? 160 : w - 16 }}
            >
              <button
                onClick={() => logout()}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-400 hover:bg-red-900/30 hover:text-red-300 transition-colors"
              >
                <LogOut size={15} />
                Sair
              </button>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={toggle}
          className="absolute -right-3 top-[72px] w-6 h-6 bg-gray-700 border border-gray-600 rounded-full hidden md:flex items-center justify-center text-gray-300 hover:bg-gray-600 z-10"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            {collapsed
              ? <path d="M9 18l6-6-6-6" />
              : <path d="M15 18l-6-6 6-6" />}
          </svg>
        </button>
      </aside>
    </>
  )
}
