'use client'

import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import BaseNode from './base-node'
import type { NodeProps } from '@xyflow/react'
import type { FunnelNodeData } from '@/types'

export default function TagNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { updateNodeData, deleteElements } = useReactFlow()

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] })
  }, [id, deleteElements])

  const handleTagChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { ...nodeData, config: { ...nodeData.config, tag: e.target.value } })
    },
    [id, nodeData, updateNodeData]
  )

  const tag = (nodeData.config?.tag as string) ?? ''

  return (
    <BaseNode headerColor="bg-purple-500" icon="🏷️" label="Tag" id={id} onDelete={handleDelete}>
      <input
        type="text"
        value={tag}
        onChange={handleTagChange}
        placeholder="Nome da tag"
        className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
      />
    </BaseNode>
  )
}
