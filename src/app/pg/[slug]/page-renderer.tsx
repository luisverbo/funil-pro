'use client'

import dynamic from 'next/dynamic'
import React from 'react'

const CraftViewer = dynamic(() => import('./craft-viewer'), { ssr: false, loading: () => <div className="min-h-screen bg-white" /> })

export default function PageRenderer({ craftJson, pageId }: { craftJson: object; pageId?: string }) {
  return <CraftViewer craftJson={craftJson} pageId={pageId} />
}
