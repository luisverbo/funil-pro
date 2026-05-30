'use client'

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'funilpro:sidebar-collapsed'

export default function MainContent({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    // Read initial state
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored !== null) setCollapsed(stored === 'true')
    } catch {}

    // Listen for storage changes (when sidebar toggles)
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setCollapsed(e.newValue === 'true')
    }
    // Also poll via custom event since same-tab localStorage doesn't fire storage event
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
      className="min-h-screen p-6"
      style={{
        marginLeft: collapsed ? 60 : 220,
        transition: 'margin-left 200ms ease',
      }}
    >
      {children}
    </main>
  )
}
