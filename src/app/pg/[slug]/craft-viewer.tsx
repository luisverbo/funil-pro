'use client'

import React from 'react'
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

export default function CraftViewer({ craftJson }: { craftJson: object }) {
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

  const hasContent = craftJson && Object.keys(craftJson).length > 0

  return (
    <Editor resolver={resolver} enabled={false}>
      {hasContent ? (
        <Frame data={JSON.stringify(craftJson)}>
          <PageRootNode />
        </Frame>
      ) : (
        <div className="min-h-screen flex items-center justify-center text-gray-400">
          <p>Página em construção</p>
        </div>
      )}
    </Editor>
  )
}
