'use client'

import React from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { FunnelNodeData } from '@/types'

export default function GotoNode({ data, selected }: NodeProps) {
  const d = data as FunnelNodeData
  const targetLabel = (d.config?.target_label as string) || 'Selecionar bloco...'

  return (
    <div
      className="rounded-xl border-2 bg-white shadow-sm min-w-[180px] max-w-[220px]"
      style={{ borderColor: selected ? '#8b5cf6' : '#c4b5fd' }}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-violet-400 !border-white !border-2" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#f5f3ff' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth={2.5} className="w-3.5 h-3.5">
              <polyline points="9,18 15,12 9,6" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-gray-700">Ir para etapa</span>
        </div>
        <p className="text-xs text-violet-700 font-medium truncate">→ {targetLabel}</p>
      </div>
    </div>
  )
}
