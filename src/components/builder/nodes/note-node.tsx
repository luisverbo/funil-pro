'use client'

import React, { useCallback } from 'react'
import { NodeResizer, useReactFlow } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { FunnelNodeData } from '@/types'

export default function NoteNode({ id, data, selected }: NodeProps) {
  const d = data as FunnelNodeData
  const { updateNodeData } = useReactFlow()

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData(id, { ...d, config: { ...d.config, text: e.target.value } })
    },
    [id, d, updateNodeData]
  )

  return (
    <div
      className="w-full h-full rounded-lg border-2 shadow-sm"
      style={{ backgroundColor: '#FEFCE8', borderColor: selected ? '#ca8a04' : '#fde047', minWidth: 160, minHeight: 80 }}
    >
      <NodeResizer minWidth={160} minHeight={80} isVisible={selected} lineStyle={{ borderColor: '#fde047' }} handleStyle={{ background: '#ca8a04', borderColor: 'white', width: 8, height: 8 }} />
      <textarea
        className="w-full h-full bg-transparent resize-none outline-none text-sm text-yellow-900 p-2 placeholder-yellow-400"
        placeholder="Anotação..."
        value={(d.config?.text as string) ?? ''}
        onChange={handleChange}
        style={{ minHeight: 80 }}
      />
    </div>
  )
}
