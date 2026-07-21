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
import { CountdownTimer } from '@/components/page-builder/sections/countdown-timer'
import { Guarantee } from '@/components/page-builder/sections/guarantee'
import { FaqAccordion } from '@/components/page-builder/sections/faq-accordion'
import { AuthorBio } from '@/components/page-builder/sections/author-bio'
import { ScarcityBar } from '@/components/page-builder/sections/scarcity-bar'
import { BeforeAfter } from '@/components/page-builder/sections/before-after'
import { BonusSection } from '@/components/page-builder/sections/bonus-section'
import { PartnerLogos } from '@/components/page-builder/sections/partner-logos'
import { RichText } from '@/components/page-builder/sections/rich-text'
import { PriceSection } from '@/components/page-builder/sections/price-section'
import { FullwidthBanner } from '@/components/page-builder/sections/fullwidth-banner'
import { ThankYouHero } from '@/components/page-builder/sections/thank-you-hero'
import { Columns, Column } from '@/components/page-builder/sections/columns'

interface PageRootProps {
  children?: React.ReactNode
  backgroundColor?: string
  bgGradient?: boolean
  bgGradientTo?: string
  fontFamily?: string
}

const PAGE_FONTS: Record<string, string> = {
  Inter: 'Inter:wght@400;600;700;800',
  Poppins: 'Poppins:wght@400;600;700;800',
  Montserrat: 'Montserrat:wght@400;600;700;800',
  'Playfair Display': 'Playfair+Display:wght@400;600;700;800',
}

const PageRootNode = ({ children, backgroundColor = '#ffffff', bgGradient = false, bgGradientTo = '#eef2ff', fontFamily = '' }: PageRootProps) => {
  const fontSpec = fontFamily ? PAGE_FONTS[fontFamily] : undefined
  return (
    <div style={{
      background: bgGradient ? `linear-gradient(160deg, ${backgroundColor} 0%, ${bgGradientTo} 100%)` : backgroundColor,
      minHeight: '100vh',
      fontFamily: fontFamily ? `'${fontFamily}', system-ui, sans-serif` : undefined,
    }} className="w-full">
      {fontSpec && (
        // eslint-disable-next-line @next/next/no-page-custom-font
        <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${fontSpec}&display=swap`} />
      )}
      {children}
    </div>
  )
}

PageRootNode.craft = {
  displayName: 'Página',
  props: { backgroundColor: '#ffffff', bgGradient: false, bgGradientTo: '#eef2ff', fontFamily: '' },
  isCanvas: true,
}

const PageRoot = PageRootNode

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
    if (lid) { localStorage.setItem('funil_lid', lid); return lid }
    return localStorage.getItem('funil_lid')
  }

  const track = (eventType: string, eventData?: Record<string, unknown>) => {
    const leadId = getLeadId()
    if (!leadId) return
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: leadId, page_id: pageId, event_type: eventType, event_data: eventData }) }).catch(() => {})
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const lid = params.get('lid')
    if (lid) localStorage.setItem('funil_lid', lid)
    // guarda os UTMs da entrada — o formulário de captura envia junto (atribuição)
    const utm: Record<string, string> = {}
    for (const k of ['utm_source', 'utm_campaign', 'utm_campaign_id', 'utm_adset_id', 'utm_ad_id', 'utm_content']) {
      const v = params.get(k); if (v) utm[k] = v
    }
    if (Object.keys(utm).length > 0) {
      try { localStorage.setItem('funil_utm', JSON.stringify(utm)) } catch {}
    }
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
  'HeroSimple', 'CaptureForm', 'VideoPlayer', 'VslTimed', 'BenefitsList',
  'Testimonial', 'CtaButton', 'DeliveryCard', 'CountdownTimer', 'Guarantee',
  'FaqAccordion', 'AuthorBio', 'ScarcityBar', 'BeforeAfter', 'BonusSection',
  'PartnerLogos', 'RichText', 'PriceSection', 'FullwidthBanner', 'ThankYouHero',
  'Columns', 'Column',
])

function cleanCraftJson(json: object): object {
  const nodes = json as Record<string, { type?: { resolvedName?: string }; nodes?: string[]; linkedNodes?: Record<string, string> }>
  const cleaned: typeof nodes = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (id === 'ROOT') { cleaned[id] = node; continue }
    const name = node?.type?.resolvedName
    if (name && KNOWN_COMPONENTS.has(name)) cleaned[id] = node
  }
  if (cleaned.ROOT) {
    const rootNodes = cleaned.ROOT.nodes ?? []
    cleaned.ROOT.nodes = rootNodes.filter((id) => id in cleaned)
  }
  return cleaned
}

function applyVariables(craftJson: object, variables: Record<string, string>): object {
  if (!variables || Object.keys(variables).length === 0) return craftJson
  let str = JSON.stringify(craftJson)
  for (const [key, value] of Object.entries(variables)) {
    // escapa o valor pra não quebrar o JSON (aspas, barras, quebras de linha)
    const safe = JSON.stringify(String(value)).slice(1, -1)
    str = str.replaceAll(`{${key}}`, safe)
  }
  try { return JSON.parse(str) } catch { return craftJson }
}

export default function CraftViewer({ craftJson, pageId, variables }: { craftJson: object; pageId?: string; variables?: Record<string, string> }) {
  const resolver = {
    HeroSimple, CaptureForm, VideoPlayer, VslTimed, BenefitsList, Testimonial,
    CtaButton, DeliveryCard, CountdownTimer, Guarantee, FaqAccordion, AuthorBio,
    ScarcityBar, BeforeAfter, BonusSection, PartnerLogos, RichText, PriceSection,
    FullwidthBanner, ThankYouHero, Columns, Column, PageRootNode, PageRoot,
  }

  const hasContent = craftJson && Object.keys(craftJson).length > 0
  const cleanedJson = hasContent ? cleanCraftJson(craftJson) : craftJson
  const finalJson = variables ? applyVariables(cleanedJson, variables) : cleanedJson

  return (
    <TrackingProvider pageId={pageId}>
      <Editor resolver={resolver} enabled={false}>
        {hasContent ? (
          <Frame data={JSON.stringify(finalJson)}>
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