'use client'

import React from 'react'
import { type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
  </svg>
)

interface AgentConfig {
  agent_id?: string
  agent_name?: string
  objective?: string
}

const OBJECTIVE_LABEL: Record<string, string> = {
  qualify: '🎯 Qualificar',
  sell_direct: '💰 Vender',
  route_to_funnel: '🔀 Rotear',
}

export default function AgentNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as AgentConfig

  const preview = config.agent_id
    ? `${config.agent_name ?? 'Agente'} · ${OBJECTIVE_LABEL[config.objective ?? ''] ?? 'IA'}`
    : 'Selecionar agente...'

  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#6366f1"
      icon={ICON}
      typeLabel="Agente IA"
      preview={preview}
    />
  )
}
