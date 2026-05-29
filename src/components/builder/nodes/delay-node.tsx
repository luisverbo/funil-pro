'use client'

import React, { useCallback } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
  </svg>
)

export default function DelayNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { setNodes } = useReactFlow()
  const config = (nodeData.config ?? {}) as { duration?: number; unit?: string }

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

  return (
    <BaseNode
      id={id}
      selected={selected}
      headerColor="#8b5cf6"
      headerBg="#f5f3ff"
      icon={ICON}
      typeLabel="Atraso"
      onDelete={handleDelete}
    >
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs font-medium text-gray-500 block mb-1">Duração</label>
          <input
            type="number"
            min={1}
            value={config.duration ?? 1}
            onChange={(e) => update({ duration: Number(e.target.value) })}
            className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs font-medium text-gray-500 block mb-1">Unidade</label>
          <select
            value={config.unit ?? 'horas'}
            onChange={(e) => update({ unit: e.target.value })}
            className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            <option value="minutos">Minutos</option>
            <option value="horas">Horas</option>
            <option value="dias">Dias</option>
          </select>
        </div>
      </div>
    </BaseNode>
  )
}
