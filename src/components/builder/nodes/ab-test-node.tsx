'use client'

import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <path d="M2 12h5" />
    <path d="m5 9 3 3-3 3" />
    <path d="M22 12h-5" />
    <path d="m19 9-3 3 3 3" />
    <rect x="9" y="9" width="6" height="6" rx="1" />
  </svg>
)

export default function AbTestNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as { percent_a?: number; label_a?: string; label_b?: string }
  const percentA = config.percent_a ?? 50
  const labelA = config.label_a || 'A'
  const labelB = config.label_b || 'B'

  const extraHandles = (
    <div className="group relative border-t border-gray-100 bg-gray-50 rounded-b-xl">
      <div className="flex justify-between items-center px-4 py-1.5">
        <span className="text-xs font-semibold text-emerald-600">{labelA}: {percentA}%</span>
        <span className="text-xs font-semibold text-blue-500">{labelB}: {100 - percentA}%</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="a"
        style={{ left: '28%', bottom: -6, width: 12, height: 12, background: 'white', border: '2px solid #10b981', borderRadius: '50%', opacity: 0, transition: 'opacity 0.15s' }}
        className="group-hover:!opacity-100"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        style={{ left: '72%', bottom: -6, width: 12, height: 12, background: 'white', border: '2px solid #3b82f6', borderRadius: '50%', opacity: 0, transition: 'opacity 0.15s' }}
        className="group-hover:!opacity-100"
      />
    </div>
  )

  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#a855f7"
      icon={ICON}
      typeLabel="Divisão A/B"
      preview={`${labelA}: ${percentA}% / ${labelB}: ${100 - percentA}%`}
      extraHandles={extraHandles}
      hideSourceHandle
    />
  )
}
