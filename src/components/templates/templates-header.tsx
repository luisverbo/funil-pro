'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import CreateTemplateDrawer from './create-template-drawer'

interface UserFunnel { id: string; name: string; status: string }
interface Props { userFunnels: UserFunnel[] }

export default function TemplatesHeader({ userFunnels }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Marketplace de Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Copie um funil pronto e personalize para o seu negócio</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href="/templates/my" className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition-colors">
            Meus Templates
          </Link>
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4"><path d="M12 5v14M5 12h14"/></svg>
            Criar Template
          </button>
        </div>
      </div>
      {drawerOpen && <CreateTemplateDrawer userFunnels={userFunnels} onClose={() => setDrawerOpen(false)} />}
    </>
  )
}
