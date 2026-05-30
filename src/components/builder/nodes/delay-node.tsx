'use client'

import React from 'react'
import { type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
  </svg>
)

export default function DelayNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as { duration?: number; unit?: string }

  const preview = config.duration
    ? `Aguardar ${config.duration} ${config.unit ?? 'horas'}`
    : ''

  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#8b5cf6"
      icon={ICON}
      typeLabel="Atraso"
      preview={preview}
    />
  )
}
