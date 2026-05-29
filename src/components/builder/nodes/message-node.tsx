import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'
import type { NodeProps } from '@xyflow/react'

export default function MessageNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { updateNodeData, deleteElements } = useReactFlow()

  const handleDelete = useCallback((nodeId: string) => {
    deleteElements({ nodes: [{ id: nodeId }] })
  }, [deleteElements])

  const handleChannelChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { ...nodeData, config: { ...nodeData.config, channel: e.target.value } })
  }, [id, nodeData, updateNodeData])

  const channel = (nodeData.config?.channel as string) ?? 'whatsapp'

  return (
    <BaseNode
      headerColor="bg-green-500"
      icon="💬"
      label="Mensagem"
      id={id}
      onDelete={handleDelete}
    >
      <select
        value={channel}
        onChange={handleChannelChange}
        className="w-full border border-gray-200 rounded px-2 py-1 text-xs bg-white"
      >
        <option value="whatsapp">WhatsApp</option>
        <option value="email">E-mail</option>
      </select>
    </BaseNode>
  )
}
