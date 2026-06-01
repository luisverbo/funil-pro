'use client'

import React from 'react'
import { type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <line x1="18" y1="8" x2="23" y2="13" />
    <line x1="23" y1="8" x2="18" y2="13" />
  </svg>
)

export default function RemoveFromFunnelNode({ id, data, selected }: NodeProps) {
  void data
  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#ef4444"
      icon={ICON}
      typeLabel="Remover do funil"
      preview="Encerra a jornada do lead"
      hideSourceHandle
    />
  )
}
