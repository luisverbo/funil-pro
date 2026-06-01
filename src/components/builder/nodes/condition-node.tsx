'use client'

import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 6H8a2 2 0 0 0-2 2v7" />
    <circle cx="6" cy="18" r="3" />
  </svg>
)

const CONDITION_LABELS: Record<string, string> = {
  opened: 'Abriu mensagem',
  not_opened: 'Não abriu mensagem',
  clicked: 'Clicou no link',
  not_clicked: 'Não clicou no link',
  replied: 'Respondeu (qualquer coisa)',
  replied_with: 'Respondeu com',
  purchased: 'Comprou',
  tag: 'Tem tag',
}

export default function ConditionNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as { condition?: string; replied_with?: string; purchased_product?: string; tag_name?: string }

  let preview = config.condition
    ? CONDITION_LABELS[config.condition] ?? config.condition
    : ''

  if (config.condition === 'replied_with' && config.replied_with) {
    preview = `Respondeu com "${config.replied_with.toUpperCase()}"`
  } else if (config.condition === 'purchased' && config.purchased_product) {
    preview = `Comprou "${config.purchased_product}"`
  } else if (config.condition === 'tag' && config.tag_name) {
    preview = `Tem tag "${config.tag_name}"`
  }

  const extraHandles = (
    <div className="group relative border-t border-gray-100 bg-gray-50 rounded-b-xl">
      <div className="flex justify-between items-center px-4 py-1.5">
        <span className="text-xs font-semibold text-emerald-600">Sim</span>
        <span className="text-xs font-semibold text-red-500">Não</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        style={{
          left: '28%',
          bottom: -6,
          width: 12,
          height: 12,
          background: 'white',
          border: '2px solid #10b981',
          borderRadius: '50%',
          opacity: 0,
          transition: 'opacity 0.15s',
        }}
        className="group-hover:!opacity-100"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        style={{
          left: '72%',
          bottom: -6,
          width: 12,
          height: 12,
          background: 'white',
          border: '2px solid #ef4444',
          borderRadius: '50%',
          opacity: 0,
          transition: 'opacity 0.15s',
        }}
        className="group-hover:!opacity-100"
      />
    </div>
  )

  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#f59e0b"
      icon={ICON}
      typeLabel="Condição"
      preview={preview}
      extraHandles={extraHandles}
      hideSourceHandle
    />
  )
}
