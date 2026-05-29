'use client'

import React, { useCallback } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
)

export default function SaleNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { setNodes } = useReactFlow()
  const config = (nodeData.config ?? {}) as { payment_link?: string; product_name?: string }

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
      headerColor="#f97316"
      headerBg="#fff7ed"
      icon={ICON}
      typeLabel="Venda"
      onDelete={handleDelete}
    >
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Produto</label>
        <input
          type="text"
          value={config.product_name ?? ''}
          onChange={(e) => update({ product_name: e.target.value })}
          placeholder="Nome do produto"
          className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Link de pagamento</label>
        <input
          type="url"
          value={config.payment_link ?? ''}
          onChange={(e) => update({ payment_link: e.target.value })}
          placeholder="https://..."
          className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
      </div>
    </BaseNode>
  )
}
