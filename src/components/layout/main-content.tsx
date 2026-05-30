'use client'

import { usePathname } from 'next/navigation'

export default function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isBuilder = /^\/funnels\/[^/]+\/builder/.test(pathname)

  return (
    <main
      className="min-h-screen p-6 transition-[margin] duration-200"
      style={{ marginLeft: isBuilder ? 60 : 220 }}
    >
      {children}
    </main>
  )
}
