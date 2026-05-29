'use client'

import React, { useCallback } from 'react'
import { useReactFlow, Handle, Position, type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 6H8a2 2 0 0 0-2 2v7" /><circle cx="6" cy="18" r="3" />
  </svg>
)

const CONDITIONS = [
  { value: 'opened', label: 'Abriu mensagem' },
  { value: 'not_opened', label: 'Não abriu' },
  { value: 'clicked', label: 'Clicou no link' },
  { value: 'not_clicked', label: 'Não clicou' },
  { value: 'replied', label: 'Respondeu' },
  { value: 'purchased', label: 'Comprou' },
]

export default function ConditionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { setNodes } = useReactFlow()
  const config = (nodeData.config ?? {}) as { condition?: string }

  const update = useCallback((patch: Partial<typeof config>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, config: { ...config, ...patch } } } : n
      )
    )
  }, [id, config, setNodes])

  const handleDelete = useCallback(() => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
  }, [id, setNodes])

  const extraHandles = (
    <div className="relative h-8 bg-white border-t border-gray-100">
      <div className="absolute inset-x-0 flex justify-between items-center px-6 h-full">
        <span className="text-xs font-semibold text-emerald-600">Sim ✓</span>
        <span className="text-xs font-semibold text-red-500">Não ✗</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        style={{ left: '28%', bottom: -8, borderColor: '#10b981' }}
        className="!w-4 !h-4 !bg-white !border-2 !rounded-full"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        style={{ left: '72%', bottom: -8, borderColor: '#ef4444' }}
        className="!w-4 !h-4 !bg-white !border-2 !rounded-full"
      />
    </div>
  )

  return (
    <BaseNode
      id={id}
      selected={selected}
      headerColor="#f59e0b"
      headerBg="#fffbeb"
      icon={ICON}
      typeLabel="Condição"
      onDelete={handleDelete}
      extraHandles={extraHandles}
      hideSourceHandle
    >
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Verificar se o lead</label>
        <select
          value={config.condition ?? 'opened'}
          onChange={(e) => update({ condition: e.target.value })}
          className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          {CONDITIONS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
    </BaseNode>
  )
}
