'use client'

import React from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'

export default function RemoveFromFunnelNode({ selected }: NodeProps) {
  return (
    <div
      className="rounded-xl border-2 bg-white shadow-sm min-w-[180px] max-w-[220px]"
      style={{ borderColor: selected ? '#ef4444' : '#fca5a5' }}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !bg-red-400 !border-white !border-2" />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: '#fef2f2' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2} className="w-3.5 h-3.5">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-gray-700">Remover do funil</span>
        </div>
        <p className="text-xs text-red-500">Encerra a jornada do lead</p>
      </div>
    </div>
  )
}
