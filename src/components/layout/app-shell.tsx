'use client'

import { useState, useEffect } from 'react'
import Sidebar from './sidebar'

interface Props {
  children: React.ReactNode
  displayName: string
  isAdmin: boolean
}

const EXPANDED_W = 240
const COLLAPSED_W = 64

export default function AppShell({ children, displayName, isAdmin }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem('funilpro:sidebar-collapsed')
      if (stored !== null) setCollapsed(stored === 'true')
    } catch {}
    function onToggle() {
      try { setCollapsed(localStorage.getItem('funilpro:sidebar-collapsed') === 'true') } catch {}
    }
    window.addEventListener('funilpro:sidebar-toggle', onToggle)
    return () => window.removeEventListener('funilpro:sidebar-toggle', onToggle)
  }, [])

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F8FAFC' }}>
      {/* Mobile header */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 h-[52px] flex items-center justify-between px-4 border-b" style={{ backgroundColor: '#0C0C0C', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 28 28" fill="none" width="22" height="22">
            <rect width="28" height="28" rx="7" fill="#6366F1" />
            <path d="M6 7h16l-6.2 7.44V19.5l-3.6-1.8V14.44L6 7z" fill="white" opacity="0.9" />
          </svg>
          <span className="font-semibold text-white text-[15px]" style={{ letterSpacing: '-0.5px' }}>FunilPro</span>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          className="text-white/50 hover:text-white p-1.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors"
          aria-label="Abrir menu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      <Sidebar
        displayName={displayName}
        isAdmin={isAdmin}
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />

      <div className="flex">
        <div
          className="hidden md:block shrink-0"
          style={{ width: collapsed ? COLLAPSED_W : EXPANDED_W, transition: 'width 200ms ease' }}
        />
        <main className="flex-1 min-h-screen p-4 md:p-6 pt-[68px] md:pt-6 animate-page-in">
          {children}
        </main>
      </div>
    </div>
  )
}
