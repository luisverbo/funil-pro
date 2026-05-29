'use client'

import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import BaseNode from './base-node'
import type { NodeProps } from '@xyflow/react'
import type { FunnelNodeData } from '@/types'

export default function SaleNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { updateNodeData, deleteElements } = useReactFlow()

  const handleDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] })
  }, [id, deleteElements])

  const handleLinkChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { ...nodeData, config: { ...nodeData.config, paymentLink: e.target.value } })
    },
    [id, nodeData, updateNodeData]
  )

  const paymentLink = (nodeData.config?.paymentLink as string) ?? ''

  return (
    <BaseNode headerColor="bg-orange-500" icon="💰" label="Venda" id={id} onDelete={handleDelete}>
      <input
        type="url"
        value={paymentLink}
        onChange={handleLinkChange}
        placeholder="Link de pagamento"
        className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
      />
    </BaseNode>
  )
}
