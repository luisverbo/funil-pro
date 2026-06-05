'use client'

import React from 'react'
import { type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData, BlockMetrics } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </svg>
)

interface PageConfig {
  page_id?: string
  message?: string
}

export default function PageNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as PageConfig
  const metrics = nodeData.metrics as BlockMetrics | null | undefined

  const preview = config.message
    ? config.message.slice(0, 40) + (config.message.length > 40 ? '…' : '')
    : 'Página — envia link via WA'

  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#8b5cf6"
      icon={ICON}
      typeLabel="Página"
      preview={preview}
      metrics={metrics}
      showMetrics={false}
    />
  )
}
