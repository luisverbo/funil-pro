'use client'

import dynamic from 'next/dynamic'
import React from 'react'

const CraftViewer = dynamic(() => import('./craft-viewer'), { ssr: false, loading: () => <div className="min-h-screen bg-white" /> })

export default function PageRenderer({ craftJson, pageId, variables }: { craftJson: object; pageId?: string; variables?: Record<string, string> }) {
  return <CraftViewer craftJson={craftJson} pageId={pageId} variables={variables} />
}