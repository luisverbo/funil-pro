'use client'

import React, { useCallback } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export default function MessageNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { setNodes } = useReactFlow()
  const config = (nodeData.config ?? {}) as { channel?: string; body?: string }

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
      headerColor="#0ea5e9"
      headerBg="#f0f9ff"
      icon={ICON}
      typeLabel="Mensagem"
      onDelete={handleDelete}
    >
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Canal</label>
        <select
          value={config.channel ?? 'whatsapp'}
          onChange={(e) => update({ channel: e.target.value })}
          className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="email">E-mail</option>
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Mensagem</label>
        <textarea
          value={config.body ?? ''}
          onChange={(e) => update({ body: e.target.value })}
          placeholder="Digite o texto da mensagem..."
          rows={3}
          className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
        />
      </div>
    </BaseNode>
  )
}
