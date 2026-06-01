'use client'

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'funilpro:sidebar-collapsed'
const EXPANDED_W = 240
const COLLAPSED_W = 64

export default function MainContent({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored !== null) setCollapsed(stored === 'true')
    } catch {}
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setCollapsed(e.newValue === 'true')
    }
    function onToggle() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY)
        setCollapsed(stored === 'true')
      } catch {}
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('funilpro:sidebar-toggle', onToggle)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('funilpro:sidebar-toggle', onToggle)
    }
  }, [])

  return (
    <main
      className="min-h-screen p-6 animate-page-in"
      style={{
        marginLeft: collapsed ? COLLAPSED_W : EXPANDED_W,
        transition: 'margin-left 200ms ease',
      }}
    >
      {children}
    </main>
  )
}
