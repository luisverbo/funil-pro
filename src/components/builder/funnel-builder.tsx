'use client'

import { useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import MessageNode from './nodes/message-node'
import ConditionNode from './nodes/condition-node'
import DelayNode from './nodes/delay-node'
import TagNode from './nodes/tag-node'
import SaleNode from './nodes/sale-node'
import BlockPalette from './block-palette'
import CustomEdge from './custom-edge'
import type { Funnel, FunnelBlock, FunnelEdge, FunnelNodeData, BlockDTO, EdgeDTO, BlockType } from '@/types'
import { saveFunnel, publishFunnel } from '@/app/actions/funnels'

const nodeTypes = {
  message: MessageNode,
  condition: ConditionNode,
  delay: DelayNode,
  tag: TagNode,
  sale: SaleNode,
}

const edgeTypes = {
  custom: CustomEdge,
}

function blockToNode(block: FunnelBlock): Node {
  return {
    id: block.id,
    type: block.block_type,
    position: { x: block.position_x, y: block.position_y },
    data: {
      label: block.label,
      blockType: block.block_type,
      config: block.config,
    } as FunnelNodeData,
  }
}

function dbEdgeToFlowEdge(edge: FunnelEdge): Edge {
  return {
    id: edge.id,
    source: edge.source_block_id,
    target: edge.target_block_id,
    type: 'custom',
    data: { condition: edge.condition ?? 'default' },
  }
}

interface Props {
  funnel: Funnel
  initialBlocks: FunnelBlock[]
  initialEdges: FunnelEdge[]
}

export default function FunnelBuilder({ funnel, initialBlocks, initialEdges }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialBlocks.map(blockToNode))
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges.map(dbEdgeToFlowEdge))
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, type: 'custom', data: { condition: 'default' } }, eds)),
    [setEdges]
  )

  const addNode = useCallback((type: BlockType) => {
    const labels: Record<BlockType, string> = {
      message: 'Mensagem',
      condition: 'Condição',
      delay: 'Aguardar',
      tag: 'Tag',
      sale: 'Venda',
      form: 'Formulário',
      page: 'Página',
    }
    const newNode: Node = {
      id: crypto.randomUUID(),
      type,
      position: { x: 200 + nodes.length * 20, y: 100 + nodes.length * 20 },
      data: {
        label: labels[type] ?? type,
        blockType: type,
        config: {},
      } as FunnelNodeData,
    }
    setNodes((nds) => [...nds, newNode])
  }, [nodes.length, setNodes])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveMessage(null)

    const blocks: BlockDTO[] = nodes.map((n) => ({
      id: n.id,
      block_type: ((n.data as FunnelNodeData).blockType as string) ?? n.type ?? 'message',
      label: (n.data as FunnelNodeData).label ?? '',
      config: (n.data as FunnelNodeData).config ?? {},
      position_x: n.position.x,
      position_y: n.position.y,
    }))

    const flowEdges: EdgeDTO[] = edges.map((e) => ({
      id: e.id,
      source_block_id: e.source,
      target_block_id: e.target,
      condition: (e.data?.condition as string) ?? 'default',
    }))

    const result = await saveFunnel(funnel.id, blocks, flowEdges)
    setSaving(false)
    setSaveMessage(result.success ? 'Salvo!' : `Erro: ${result.error}`)
    setTimeout(() => setSaveMessage(null), 3000)
  }, [nodes, edges, funnel.id])

  const handlePublish = useCallback(async () => {
    setPublishing(true)
    const result = await publishFunnel(funnel.id)
    setPublishing(false)
    setSaveMessage(result.success ? 'Publicado!' : `Erro: ${result.error}`)
    setTimeout(() => setSaveMessage(null), 3000)
  }, [funnel.id])

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 64px)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <span className="font-semibold text-gray-800 text-sm truncate max-w-[200px]">{funnel.name}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          funnel.status === 'published' ? 'bg-green-100 text-green-700' :
          funnel.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
          'bg-gray-100 text-gray-500'
        }`}>
          {funnel.status === 'published' ? 'Publicado' : funnel.status === 'paused' ? 'Pausado' : 'Rascunho'}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {saveMessage && (
            <span className={`text-xs font-medium ${saveMessage.startsWith('Erro') ? 'text-red-600' : 'text-green-600'}`}>
              {saveMessage}
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-4 py-1.5 bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="text-xs px-4 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {publishing ? 'Publicando...' : 'Publicar'}
          </button>
        </div>
      </div>

      {/* Main area: palette + canvas */}
      <div className="flex flex-1 overflow-hidden">
        <BlockPalette onAddNode={addNode} />

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            deleteKeyCode="Delete"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#e5e7eb" />
            <Controls />
            <MiniMap nodeStrokeWidth={3} zoomable pannable />
          </ReactFlow>
        </div>
      </div>
    </div>
  )
}
