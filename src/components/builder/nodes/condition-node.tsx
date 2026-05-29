'use client'

import { useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import { useReactFlow } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { FunnelNodeData } from '@/types'

export default function ConditionNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { deleteElements } = useReactFlow()

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] })
  }, [id, deleteElements])

  return (
    <div className="min-w-[200px] rounded-xl border border-gray-200 shadow-sm bg-white overflow-hidden">
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />

      <div className="bg-yellow-500 px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">⚡</span>
          <span className="text-sm font-semibold text-white">Condição</span>
        </div>
        <button
          onClick={handleDelete}
          className="text-white/70 hover:text-white text-xs leading-none px-1"
          title="Remover"
        >
          ✕
        </button>
      </div>

      <div className="px-3 py-2 text-xs text-gray-500">
        {nodeData.label || 'Se / Senão'}
      </div>

      {/* Two source handles: left=Sim, right=Não */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="yes"
        style={{ left: '30%' }}
        className="!bg-green-500"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="no"
        style={{ left: '70%' }}
        className="!bg-red-400"
      />
      <div className="flex justify-between px-4 pb-2 text-xs text-gray-400">
        <span>Sim</span>
        <span>Não</span>
      </div>
    </div>
  )
}
