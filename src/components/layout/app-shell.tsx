'use client'

import { useState, useEffect } from 'react'
import Sidebar from './sidebar'

interface Props {
  children: React.ReactNode
  displayName: string
  isAdmin: boolean
}

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
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Mobile header */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 h-[52px] bg-[#18181B] flex items-center justify-between px-4 border-b border-white/5">
        <span className="font-bold text-white text-base tracking-tight">FunilPro</span>
        <button
          onClick={() => setMobileOpen(true)}
          className="text-gray-400 hover:text-white p-1.5 rounded-lg min-w-[44px] min-h-[44px] flex items-center justify-center"
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
        {/* Desktop sidebar spacer */}
        <div
          className="hidden md:block shrink-0"
          style={{ width: collapsed ? 60 : 220, transition: 'width 200ms ease' }}
        />
        <main className="flex-1 min-h-screen p-4 md:p-6 pt-[68px] md:pt-6">
          {children}
        </main>
      </div>
    </div>
  )
}
