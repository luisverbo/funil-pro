'use client'

import dynamic from 'next/dynamic'
import type { Funnel, FunnelBlock, FunnelEdge } from '@/types'

const FunnelBuilder = dynamic(() => import('./funnel-builder'), { ssr: false })

interface Props {
  funnel: Funnel
  initialBlocks: FunnelBlock[]
  initialEdges: FunnelEdge[]
}

export default function FunnelBuilderWrapper(props: Props) {
  return <FunnelBuilder {...props} />
}
