'use client'

import React, { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/app/actions/auth'
import { LayoutGrid, Plug, Users, BarChart2, Settings, LogOut, User, LayoutTemplate, Globe, Shield, Bot, Camera } from 'lucide-react'

const NAV = [
  { href: '/funnels',       label: 'Funis',              Icon: LayoutGrid },
  { href: '/integrations',  label: 'Integrações',         Icon: Plug },
  { href: '/leads',         label: 'Leads',               Icon: Users },
  { href: '/templates',     label: 'Templates',           Icon: LayoutTemplate },
  { href: '/pages',         label: 'Páginas',             Icon: Globe },
  { href: '/agents',        label: 'Agentes IA',          Icon: Bot },
  { href: '/instagram',     label: 'Instagram',           Icon: Camera },
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
            justifyContent: collapsed ? 'center' : 'space-between',
          }}
        >
          {collapsed ? (
            <button onClick={toggle} title="Expandir sidebar" className="flex items-center justify-center transition-opacity hover:opacity-80">
              <FunnelLogo size={28} />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <FunnelLogo size={26} />
                <span
                  className="text-white font-semibold text-[15px] whitespace-nowrap"
                  style={{ letterSpacing: '-0.5px' }}
                >
                  FunilPro
                </span>
              </div>
              <button
                onClick={toggle}
                title="Recolher sidebar"
                className="text-white/30 hover:text-white/60 transition-colors p-1 rounded-md"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <polyline points="15,18 9,12 15,6" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Separator */}
        <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', flexShrink: 0 }} />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden" style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(({ href, label, Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                className="group relative flex items-center rounded-lg transition-all duration-150 whitespace-nowrap overflow-hidden"
                style={{
                  gap: collapsed ? 0 : 10,
                  padding: collapsed ? '10px 0' : '8px 10px 8px 12px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  minHeight: 40,
                  backgroundColor: active ? 'rgba(255,255,255,0.08)' : undefined,
                  borderLeft: active ? '2px solid #6366F1' : '2px solid transparent',
                  paddingLeft: active && !collapsed ? 10 : undefined,
                }}
              >
                <Icon
                  size={18}
                  strokeWidth={active ? 2.5 : 2}
                  className={`shrink-0 transition-colors ${active ? 'text-white' : 'text-white/40 group-hover:text-white/90'}`}
                />
                {!collapsed && (
                  <span
                    className={`text-[13.5px] transition-colors ${
                      active ? 'text-white font-medium' : 'text-white/60 group-hover:text-white/90'
                    }`}
                  >
                    {label}
                  </span>
                )}
                {!active && (
                  <span
                    className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
                  />
                )}
                {collapsed && (
                  <span
                    className="pointer-events-none absolute left-full ml-2 px-2.5 py-1.5 rounded-lg text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl"
                    style={{ backgroundColor: '#1F1F1F', border: '1px solid rgba(255,255,255,0.1)' }}
                  >
                    {label}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Admin */}
        {isAdmin && (
          <div style={{ padding: '4px 8px' }}>
            <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 6 }} />
            <Link
              href="/admin"
              title={collapsed ? 'Admin' : undefined}
              className="group relative flex items-center rounded-lg transition-all duration-150 overflow-hidden"
              style={{
                gap: collapsed ? 0 : 10,
                padding: collapsed ? '10px 0' : '8px 12px',
                justifyContent: collapsed ? 'center' : 'flex-start',
                minHeight: 40,
              }}
            >
              <Shield size={18} strokeWidth={2} className="shrink-0 text-red-400" />
              {!collapsed && (
                <>
                  <span className="text-[13.5px] text-red-400 font-medium">Admin</span>
                  <span
                    className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: '#f87171', letterSpacing: '0.5px' }}
                  >
                    ADMIN
                  </span>
                </>
              )}
              <span
                className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ backgroundColor: 'rgba(239,68,68,0.06)' }}
              />
              {collapsed && (
                <span
                  className="pointer-events-none absolute left-full ml-2 px-2.5 py-1.5 rounded-lg text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl"
                  style={{ backgroundColor: '#1F1F1F', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  Admin
                </span>
              )}
            </Link>
          </div>
        )}

        {/* User footer */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 8px' }} ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            title={collapsed ? displayName : undefined}
            className="group relative w-full flex items-center rounded-lg transition-colors text-left overflow-hidden"
            style={{
              gap: collapsed ? 0 : 10,
              padding: collapsed ? '8px 0' : '8px 10px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              minHeight: 44,
            }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
              style={{ backgroundColor: '#6366F1', color: 'white' }}
            >
              {initials || <User size={13} />}
            </div>
            {!collapsed && (
              <>
                <span className="flex-1 text-[13.5px] font-medium text-white/90 truncate">{displayName}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 shrink-0 text-white/30">
                  <polyline points="6,9 12,15 18,9" />
                </svg>
              </>
            )}
            <span
              className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
            />
            {collapsed && (
              <span
                className="pointer-events-none absolute left-full ml-2 px-2.5 py-1.5 rounded-lg text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl"
                style={{ backgroundColor: '#1F1F1F', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {displayName}
              </span>
            )}
          </button>

          {dropdownOpen && (
            <div
              className="animate-modal-in mt-1 overflow-hidden rounded-xl shadow-xl"
              style={{
                ...(collapsed ? { position: 'absolute', left: 76, bottom: 16, width: 160 } : {}),
                backgroundColor: '#1A1A1A',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              <Link
                href="/settings"
                onClick={() => setDropdownOpen(false)}
                className="flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <User size={14} className="text-white/40" />
                Perfil
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  <LogOut size={14} />
                  Sair
                </button>
              </form>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
