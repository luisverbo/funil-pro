'use client'

import React from 'react'
import { type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

interface MessageConfig {
  channel?: string
  body?: string
  media_type?: string
}

export default function MessageNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const config = (nodeData.config ?? {}) as MessageConfig

  const channel = config.channel === 'email' ? 'Email' : 'WhatsApp'
  const preview = config.body
    ? `${channel}: ${config.body}`
    : `Via ${channel}`

  return (
    <BaseNode
      id={id}
      selected={selected}
      borderColor="#0ea5e9"
      icon={ICON}
      typeLabel="Mensagem"
      preview={preview}
    />
  )
}
