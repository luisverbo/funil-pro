'use client'

import React, { createContext, useContext, useEffect } from 'react'
import { Editor, Frame } from '@craftjs/core'
import { HeroSimple } from '@/components/page-builder/sections/hero-simple'
import { CaptureForm } from '@/components/page-builder/sections/capture-form'
import { VideoPlayer } from '@/components/page-builder/sections/video-player'
import { VslTimed } from '@/components/page-builder/sections/vsl-timed'
import { BenefitsList } from '@/components/page-builder/sections/benefits-list'
import { Testimonial } from '@/components/page-builder/sections/testimonial'
import { CtaButton } from '@/components/page-builder/sections/cta-button'
import { DeliveryCard } from '@/components/page-builder/sections/delivery-card'

interface PageRootProps {
  children?: React.ReactNode
  backgroundColor?: string
}

const PageRootNode = ({ children, backgroundColor = '#ffffff' }: PageRootProps) => (
  <div style={{ backgroundColor, minHeight: '100vh' }} className="w-full">{children}</div>
)

PageRootNode.craft = {
  displayName: 'Página',
  props: { backgroundColor: '#ffffff' },
  isCanvas: true,
}

const PageRoot = PageRootNode

// Context so page sections can access page_id and lead_id
export interface PageTrackingContext {
  pageId?: string
  getLeadId: () => string | null
  track: (eventType: string, eventData?: Record<string, unknown>) => void
}

export const PageTrackingCtx = createContext<PageTrackingContext>({
  getLeadId: () => null,
  track: () => {},
})

export function usePageTracking() {
  return useContext(PageTrackingCtx)
}

function TrackingProvider({ pageId, children }: { pageId?: string; children: React.ReactNode }) {
  const getLeadId = () => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    const lid = params.get('lid')
    if (lid) {
      localStorage.setItem('funil_lid', lid)
      return lid
    }
    return localStorage.getItem('funil_lid')
  }

  const track = (eventType: string, eventData?: Record<string, unknown>) => {
    const leadId = getLeadId()
    if (!leadId) return
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lead_id: leadId, page_id: pageId, event_type: eventType, event_data: eventData }),
    }).catch(() => {})
  }

  // Fire page_viewed on mount
  useEffect(() => {
    // Capture lid from URL into localStorage
    const params = new URLSearchParams(window.location.search)
    const lid = params.get('lid')
    if (lid) localStorage.setItem('funil_lid', lid)

    track('page_viewed')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <PageTrackingCtx.Provider value={{ pageId, getLeadId, track }}>
      {children}
    </PageTrackingCtx.Provider>
  )
}

const KNOWN_COMPONENTS = new Set([
  'PageRootNode', 'PageRoot',
  'HeroSimple', 'CaptureForm', 'VideoPlayer', 'VslTimed',
  'BenefitsList', 'Testimonial', 'CtaButton', 'DeliveryCard',
])

function cleanCraftJson(json: object): object {
  const data = json as Record<string, { type: { resolvedName?: string } | string; nodes?: string[] }>
  const badIds = new Set<string>()
  for (const [id, node] of Object.entries(data)) {
    if (id === 'ROOT') continue
    const typeName = typeof node.type === 'string' ? node.type : (node.type?.resolvedName ?? '')
    if (!KNOWN_COMPONENTS.has(typeName)) badIds.add(id)
  }
  if (badIds.size === 0) return json
  const cleaned: Record<string, unknown> = {}
  for (const [id, node] of Object.entries(data)) {
    if (badIds.has(id)) continue
    const n = node as Record<string, unknown>
    cleaned[id] = Array.isArray(n.nodes)
      ? { ...n, nodes: (n.nodes as string[]).filter(nid => !badIds.has(nid)) }
      : n
  }
  return cleaned
}

export default function CraftViewer({ craftJson, pageId }: { craftJson: object; pageId?: string }) {
  const resolver = {
    HeroSimple,
    CaptureForm,
    VideoPlayer,
    VslTimed,
    BenefitsList,
    Testimonial,
    CtaButton,
    DeliveryCard,
    PageRootNode,
    PageRoot,
  }

  const cleanJson = cleanCraftJson(craftJson)
  const hasContent = cleanJson && Object.keys(cleanJson).length > 0

  return (
    <TrackingProvider pageId={pageId}>
      <Editor resolver={resolver} enabled={false}>
        {hasContent ? (
          <Frame data={JSON.stringify(cleanJson)}>
            <PageRootNode />
          </Frame>
        ) : (
          <div className="min-h-screen flex items-center justify-center text-gray-400">
            <p>Página em construção</p>
          </div>
        )}
      </Editor>
    </TrackingProvider>
  )
}
