'use client'

import React from 'react'
import { type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
    <path d="M5 5v14" />
  </svg>
)

export default function GotoNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as { target_label?: string; target_block_id?: string }
  const preview = config.target_label ? `→ ${config.target_label}` : ''

  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#8b5cf6"
      icon={ICON}
      typeLabel="Ir para etapa"
      preview={preview}
      hideSourceHandle
    />
  )
}
