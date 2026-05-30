'use client'

import dynamic from 'next/dynamic'
import type { Funnel, FunnelBlock, FunnelEdge, BlockMetrics, WhatsappInstance } from '@/types'

const FunnelBuilder = dynamic(() => import('./funnel-builder'), { ssr: false })

interface Props {
  funnel: Funnel
  initialBlocks: FunnelBlock[]
  initialEdges: FunnelEdge[]
  blockMetrics?: Record<string, BlockMetrics> | null
  waInstances?: WhatsappInstance[]
}

export default function FunnelBuilderWrapper(props: Props) {
  return <FunnelBuilder {...props} />
}
