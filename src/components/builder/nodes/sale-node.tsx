'use client'

import React from 'react'
import { type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
)

export default function SaleNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as { product_name?: string; payment_link?: string }

  const preview = config.product_name ?? config.payment_link ?? ''

  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#f97316"
      icon={ICON}
      typeLabel="Venda"
      preview={preview}
    />
  )
}
