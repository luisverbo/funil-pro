'use client'

import React, { useCallback } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
)

export default function TagNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { setNodes } = useReactFlow()
  const config = (nodeData.config ?? {}) as { tag_name?: string; action?: string }

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
      headerColor="#10b981"
      headerBg="#ecfdf5"
      icon={ICON}
      typeLabel="Tag"
      onDelete={handleDelete}
    >
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Nome da tag</label>
        <input
          type="text"
          value={config.tag_name ?? ''}
          onChange={(e) => update({ tag_name: e.target.value })}
          placeholder="Ex: cliente-quente"
          className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-400"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-gray-500">Ação:</label>
        <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs">
          {(['add', 'remove'] as const).map((a) => (
            <button
              key={a}
              onClick={() => update({ action: a })}
              className={`nodrag px-2.5 py-1 transition-colors ${
                (config.action ?? 'add') === a
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white text-gray-500 hover:bg-gray-50'
              }`}
            >
              {a === 'add' ? 'Adicionar' : 'Remover'}
            </button>
          ))}
        </div>
      </div>
    </BaseNode>
  )
}
