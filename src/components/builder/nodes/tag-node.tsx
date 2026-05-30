'use client'

import React from 'react'
import { type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
)

export default function TagNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as { tag_name?: string; action?: string }

  const action = config.action === 'remove' ? 'Remover' : 'Adicionar'
  const preview = config.tag_name
    ? `${action}: ${config.tag_name}`
    : ''

  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#10b981"
      icon={ICON}
      typeLabel="Tag"
      preview={preview}
    />
  )
}
