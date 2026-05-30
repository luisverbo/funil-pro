'use client'
import React from 'react'
import { type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
  </svg>
)

const PLATFORM_LABELS: Record<string, string> = {
  all: 'Todas as plataformas',
  hotmart: 'Hotmart',
  kiwify: 'Kiwify',
  eduzz: 'Eduzz',
  yampi: 'Yampi',
}

export default function CartAbandonedNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as { platform?: string }
  const preview = PLATFORM_LABELS[config.platform ?? 'all'] ?? 'Todas as plataformas'
  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#6366f1"
      icon={ICON}
      typeLabel="Carr. Abandonado"
      preview={preview}
      hideTargetHandle
    />
  )
}
