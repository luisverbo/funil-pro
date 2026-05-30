'use client'

import '@xyflow/react/dist/style.css'

import React, { useCallback, useState, useTransition } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,

  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  addEdge,
  type Node,
  type Edge,
  type OnConnect,
} from '@xyflow/react'
import Link from 'next/link'

import MessageNode from './nodes/message-node'
import ConditionNode from './nodes/condition-node'
import DelayNode from './nodes/delay-node'
import TagNode from './nodes/tag-node'
import SaleNode from './nodes/sale-node'
import CustomEdge from './custom-edge'
import BlockPalette from './block-palette'

import { saveFunnel, publishFunnel } from '@/app/actions/funnels'
import type { Funnel, FunnelBlock, FunnelEdge, FunnelNodeData, BlockDTO, EdgeDTO } from '@/types'

const nodeTypes = {
  message: MessageNode,
  condition: ConditionNode,
  delay: DelayNode,
  tag: TagNode,
  sale: SaleNode,
}

const edgeTypes = { custom: CustomEdge }


const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: 'Rascunho',  color: '#6b7280', bg: '#f3f4f6' },
  published: { label: 'Publicado', color: '#10b981', bg: '#ecfdf5' },
  paused:    { label: 'Pausado',   color: '#f59e0b', bg: '#fffbeb' },
}

interface Props {
  funnel: Funnel
  initialBlocks: FunnelBlock[]
  initialEdges: FunnelEdge[]
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

function BuilderCanvas({ funnel, initialBlocks, initialEdges }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialBlocks.map(blockToNode))
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges.map(dbEdgeToFlowEdge))
  const { screenToFlowPosition } = useReactFlow()

  const [isPending, startTransition] = useTransition()
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [funnelStatus, setFunnelStatus] = useState(funnel.status)
  const [editingName, setEditingName] = useState(false)
  const [funnelName, setFunnelName] = useState(funnel.name)

  const showMsg = (text: string, ok: boolean) => {
    setStatusMsg({ text, ok })
    setTimeout(() => setStatusMsg(null), 3000)
  }

  const onConnect: OnConnect = useCallback(
    (connection) =>
      setEdges((eds) => addEdge({ ...connection, type: 'custom', data: { condition: 'default' } }, eds)),
    [setEdges]
  )

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const type = e.dataTransfer.getData('application/reactflow')
      if (!type) return
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const LABELS: Record<string, string> = {
        message: 'Mensagem', condition: 'Condição', delay: 'Atraso', tag: 'Tag', sale: 'Venda',
      }
      setNodes((nds) => nds.concat({
        id: crypto.randomUUID(),
        type,
        position,
        data: { label: LABELS[type] ?? type, blockType: type, config: {} } as FunnelNodeData,
      }))
    },
    [screenToFlowPosition, setNodes]
  )

  const handleSave = useCallback(() => {
    startTransition(async () => {
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
      showMsg(result.success ? 'Salvo com sucesso' : `Erro: ${result.error}`, !!result.success)
    })
  }, [nodes, edges, funnel.id, startTransition])

  const handlePublish = useCallback(() => {
    startTransition(async () => {
      const result = await publishFunnel(funnel.id)
      if (result.success) setFunnelStatus('published')
      showMsg(result.success ? 'Funil publicado!' : `Erro: ${result.error}`, !!result.success)
    })
  }, [funnel.id, startTransition])

  const statusMeta = STATUS_META[funnelStatus] ?? STATUS_META.draft

  return (
    <div className="flex h-[calc(100vh-61px)] -m-6 bg-gray-50">
      <BlockPalette />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0 gap-4">
          {/* Left */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/funnels"
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors shrink-0"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <polyline points="15,18 9,12 15,6" />
              </svg>
              Funis
            </Link>
            <span className="text-gray-200">/</span>
            {editingName ? (
              <input
                autoFocus
                value={funnelName}
                onChange={(e) => setFunnelName(e.target.value)}
                onBlur={() => setEditingName(false)}
                onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
                className="text-sm font-semibold text-gray-800 border-b-2 border-indigo-500 bg-transparent outline-none px-0.5 min-w-0 w-48"
              />
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="text-sm font-semibold text-gray-800 hover:text-indigo-600 transition-colors truncate max-w-xs"
              >
                {funnelName}
              </button>
            )}
            <span
              className="text-xs font-semibold px-2.5 py-0.5 rounded-full shrink-0"
              style={{ color: statusMeta.color, backgroundColor: statusMeta.bg }}
            >
              {statusMeta.label}
            </span>
          </div>

          {/* Right */}
          <div className="flex items-center gap-2 shrink-0">
            {statusMsg && (
              <span className={`text-xs font-medium ${statusMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                {statusMsg.text}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={isPending}
              className="flex items-center gap-1.5 text-sm px-3.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 font-medium"
            >
              {isPending ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17,21 17,13 7,13 7,21" />
                  <polyline points="7,3 7,8 15,8" />
                </svg>
              )}
              Salvar
            </button>
            <button
              onClick={handlePublish}
              disabled={isPending || funnelStatus === 'published'}
              className="flex items-center gap-1.5 text-sm px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 font-medium"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
              </svg>
              {funnelStatus === 'published' ? 'Publicado' : 'Publicar'}
            </button>
          </div>
        </header>

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            snapToGrid
            snapGrid={[20, 20]}
            fitView
            deleteKeyCode="Delete"
            defaultEdgeOptions={{ type: 'custom', data: { condition: 'default' } }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} color="#e2e8f0" size={1.5} />
            <Controls className="!shadow-md !rounded-xl !border !border-gray-200 !bg-white" />
          </ReactFlow>
        </div>
      </div>
    </div>
  )
}

export default function FunnelBuilder(props: Props) {
  return (
    <ReactFlowProvider>
      <BuilderCanvas {...props} />
    </ReactFlowProvider>
  )
}
