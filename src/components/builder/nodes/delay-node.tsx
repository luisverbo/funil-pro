'use client'

import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import BaseNode from './base-node'
import type { NodeProps } from '@xyflow/react'
import type { FunnelNodeData } from '@/types'

export default function DelayNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { updateNodeData, deleteElements } = useReactFlow()

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] })
  }, [id, deleteElements])

  const handleDurationChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { ...nodeData, config: { ...nodeData.config, duration: e.target.value } })
    },
    [id, nodeData, updateNodeData]
  )

  const handleUnitChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateNodeData(id, { ...nodeData, config: { ...nodeData.config, unit: e.target.value } })
    },
    [id, nodeData, updateNodeData]
  )

  const duration = (nodeData.config?.duration as string) ?? '1'
  const unit = (nodeData.config?.unit as string) ?? 'horas'

  return (
    <BaseNode headerColor="bg-blue-500" icon="⏰" label="Delay" id={id} onDelete={handleDelete}>
      <div className="flex gap-2">
        <input
          type="number"
          min="1"
          value={duration}
          onChange={handleDurationChange}
          className="w-16 border border-gray-200 rounded px-2 py-1 text-xs"
        />
        <select
          value={unit}
          onChange={handleUnitChange}
          className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs bg-white"
        >
          <option value="minutos">minutos</option>
          <option value="horas">horas</option>
          <option value="dias">dias</option>
        </select>
      </div>
    </BaseNode>
  )
}
