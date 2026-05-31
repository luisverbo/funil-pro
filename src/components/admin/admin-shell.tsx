'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import AdminSidebar from './admin-sidebar'

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Mobile header */}
      <header className="md:hidden fixed top-0 inset-x-0 z-40 h-[52px] bg-[#18181B] flex items-center justify-between px-4 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white text-base tracking-tight">FunilPro</span>
          <span className="text-xs font-semibold bg-red-600 text-white px-1.5 py-0.5 rounded">Admin</span>
        </div>
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

      <AdminSidebar mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />

      <div className="flex">
        <div className="hidden md:block shrink-0" style={{ width: 224 }} />
        <main className="flex-1 min-h-screen p-4 md:p-8 pt-[68px] md:pt-8">
          {children}
        </main>
      </div>
    </div>
  )
}
