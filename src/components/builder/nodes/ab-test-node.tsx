'use client'

import React from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { FunnelNodeData } from '@/types'

export default function AbTestNode({ data, selected }: NodeProps) {
  const d = data as FunnelNodeData
  const percentA = (d.config?.percent_a as number) ?? 50
  const percentB = 100 - percentA
  const labelA = (d.config?.label_a as string) || 'Variante A'
  const labelB = (d.config?.label_b as string) || 'Variante B'

  return (
    <div
      className="rounded-xl border-2 bg-white shadow-sm min-w-[200px] max-w-[240px]"
      style={{ borderColor: selected ? '#a855f7' : '#d8b4fe' }}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-purple-400 !border-white !border-2" />

      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#faf5ff' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth={2} className="w-3.5 h-3.5">
              <line x1="4" y1="12" x2="20" y2="12" /><line x1="12" y1="4" x2="12" y2="20" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-gray-700">Divisão A/B</span>
        </div>
        <div className="flex gap-1 text-xs">
          <span className="flex-1 text-center py-1 rounded-md font-semibold" style={{ background: '#d1fae5', color: '#065f46' }}>
            A {percentA}%
          </span>
          <span className="flex-1 text-center py-1 rounded-md font-semibold" style={{ background: '#dbeafe', color: '#1e40af' }}>
            B {percentB}%
          </span>
        </div>
        <div className="flex gap-1 text-xs mt-1 text-gray-400">
          <span className="flex-1 text-center truncate">{labelA}</span>
          <span className="flex-1 text-center truncate">{labelB}</span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        id="a"
        style={{ left: '28%', background: '#10b981', borderColor: 'white', borderWidth: 2, width: 12, height: 12 }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="b"
        style={{ left: '72%', background: '#3b82f6', borderColor: 'white', borderWidth: 2, width: 12, height: 12 }}
      />
    </div>
  )
}
