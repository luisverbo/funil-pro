'use client'

import '@xyflow/react/dist/style.css'

import React, { useCallback, useEffect, useRef, useState, useTransition } from 'react'
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
  type NodeMouseHandler,
} from '@xyflow/react'
import Link from 'next/link'

import MessageNode from './nodes/message-node'
import ConditionNode from './nodes/condition-node'
import DelayNode from './nodes/delay-node'
import TagNode from './nodes/tag-node'
import SaleNode from './nodes/sale-node'
import EntryNode from './nodes/entry-node'
import CartAbandonedNode from './nodes/cart-abandoned-node'
import GotoNode from './nodes/goto-node'
import AbTestNode from './nodes/ab-test-node'
import RemoveFromFunnelNode from './nodes/remove-from-funnel-node'
import NoteNode from './nodes/note-node'
import CustomEdge from './custom-edge'
import BlockPalette from './block-palette'
import ConfigPanel from './config-panel'
import CapturePageEditor from './capture-page-editor'
import LinksDrawer from './links-drawer'
import VersionDrawer from './version-drawer'

import { saveFunnel, publishFunnel, updateFunnelWhatsapp } from '@/app/actions/funnels'
import { saveVersion } from '@/app/actions/versions'
import TriggerSelector from './trigger-selector'
import type { Funnel, FunnelBlock, FunnelEdge, FunnelNodeData, BlockDTO, EdgeDTO, BlockMetrics, WhatsappInstance } from '@/types'
import type { VersionSnapshot } from '@/app/actions/versions'

const nodeTypes = {
  message: MessageNode,
  condition: ConditionNode,
  delay: DelayNode,
  tag: TagNode,
  sale: SaleNode,
  entry: EntryNode,
  cart_abandoned: CartAbandonedNode,
  goto: GotoNode,
  ab_test: AbTestNode,
  remove_from_funnel: RemoveFromFunnelNode,
  note: NoteNode,
}

const edgeTypes = { custom: CustomEdge }

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: 'Rascunho',  color: '#6b7280', bg: '#f3f4f6' },
  published: { label: 'Publicado', color: '#10b981', bg: '#ecfdf5' },
  paused:    { label: 'Pausado',   color: '#f59e0b', bg: '#fffbeb' },
}

const BLOCK_LABELS: Record<string, string> = {
  message: 'Mensagem', condition: 'Condição', delay: 'Atraso', tag: 'Tag', sale: 'Venda',
  entry: 'Entrada', cart_abandoned: 'Carr. Abandonado', goto: 'Ir para etapa',
  ab_test: 'Divisão A/B', remove_from_funnel: 'Remover do funil', note: 'Nota',
}

interface ActiveTrigger { product_id: string; trigger_event: 'purchase' | 'abandoned_cart' }

interface Props {
  funnel: Funnel & { funnel_product_triggers?: ActiveTrigger[] }
  initialBlocks: FunnelBlock[]
  initialEdges: FunnelEdge[]
  blockMetrics?: Record<string, BlockMetrics> | null
  waInstances?: WhatsappInstance[]
}

function blockToNode(block: FunnelBlock, funnelId: string, metrics?: Record<string, BlockMetrics> | null): Node {
  const config = block.block_type === 'entry'
    ? { entry_type: 'link_utm', funnel_id: funnelId, ...block.config }
    : block.config
  return {
    id: block.id,
    type: block.block_type,
    position: { x: block.position_x, y: block.position_y },
    data: {
      label: block.label,
      blockType: block.block_type,
      config,
      metrics: metrics?.[block.id] ?? null,
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

const MAX_HISTORY = 30

function BuilderCanvas({ funnel, initialBlocks, initialEdges, blockMetrics, waInstances = [] }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialBlocks.map((b) => blockToNode(b, funnel.id, blockMetrics)))
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges.map(dbEdgeToFlowEdge))
  const { screenToFlowPosition, fitView } = useReactFlow()

  const [isPending, startTransition] = useTransition()
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [funnelStatus, setFunnelStatus] = useState(funnel.status)
  const [editingName, setEditingName] = useState(false)
  const [funnelName, setFunnelName] = useState(funnel.name)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showCaptureEditor, setShowCaptureEditor] = useState(false)
  const [showLinksDrawer, setShowLinksDrawer] = useState(false)
  const [showVersionDrawer, setShowVersionDrawer] = useState(false)
  const [showMobilePalette, setShowMobilePalette] = useState(false)
  const [waInstanceId, setWaInstanceId] = useState<string | null>(funnel.whatsapp_instance_id)
  const [waDropdownOpen, setWaDropdownOpen] = useState(false)

  // Undo/redo history
  const historyRef = useRef<{ nodes: Node[]; edges: Edge[] }[]>([])
  const historyIndexRef = useRef(-1)
  const isRestoringRef = useRef(false)

  // Push to history on meaningful changes (not during restore)
  useEffect(() => {
    if (isRestoringRef.current) return
    const snapshot = { nodes, edges }
    const idx = historyIndexRef.current
    const history = historyRef.current
    // Avoid duplicate snapshots
    if (idx >= 0) {
      const last = history[idx]
      if (JSON.stringify(last) === JSON.stringify(snapshot)) return
    }
    // Drop redo states
    historyRef.current = history.slice(0, idx + 1).concat(snapshot).slice(-MAX_HISTORY)
    historyIndexRef.current = historyRef.current.length - 1
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  const undo = useCallback(() => {
    const idx = historyIndexRef.current
    if (idx <= 0) return
    isRestoringRef.current = true
    const prev = historyRef.current[idx - 1]
    historyIndexRef.current = idx - 1
    setNodes(prev.nodes)
    setEdges(prev.edges)
    setTimeout(() => { isRestoringRef.current = false }, 50)
  }, [setNodes, setEdges])

  const redo = useCallback(() => {
    const idx = historyIndexRef.current
    if (idx >= historyRef.current.length - 1) return
    isRestoringRef.current = true
    const next = historyRef.current[idx + 1]
    historyIndexRef.current = idx + 1
    setNodes(next.nodes)
    setEdges(next.edges)
    setTimeout(() => { isRestoringRef.current = false }, 50)
  }, [setNodes, setEdges])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey
      if (!meta) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  const canUndo = historyIndexRef.current > 0
  const canRedo = historyIndexRef.current < historyRef.current.length - 1

  // Auto-layout (BFS from entry node)
  const handleAutoLayout = useCallback(() => {
    const entryNode = nodes.find((n) => n.type === 'entry')
    const startId = entryNode?.id ?? nodes[0]?.id
    if (!startId) return

    // Build adjacency list
    const adj: Record<string, string[]> = {}
    for (const e of edges) {
      if (!adj[e.source]) adj[e.source] = []
      adj[e.source].push(e.target)
    }

    const visited = new Set<string>()
    const queue: { id: string; depth: number; row: number }[] = [{ id: startId, depth: 0, row: 0 }]
    const positions: Record<string, { x: number; y: number }> = {}
    const depthCount: Record<number, number> = {}
    visited.add(startId)

    while (queue.length > 0) {
      const { id, depth, row } = queue.shift()!
      positions[id] = { x: depth * 280, y: row * 160 }
      const children = adj[id] ?? []
      let childRow = depthCount[depth + 1] ?? 0
      for (const child of children) {
        if (!visited.has(child)) {
          visited.add(child)
          queue.push({ id: child, depth: depth + 1, row: childRow })
          depthCount[depth + 1] = ++childRow
        }
      }
    }

    // Place unvisited nodes below
    let extraRow = Object.keys(positions).length
    for (const n of nodes) {
      if (!positions[n.id]) {
        positions[n.id] = { x: 0, y: extraRow * 160 }
        extraRow++
      }
    }

    setNodes((nds) => nds.map((n) => ({ ...n, position: positions[n.id] ?? n.position })))
    setTimeout(() => fitView({ padding: 0.2 }), 50)
  }, [nodes, edges, setNodes, fitView])

  const showMsg = (text: string, ok: boolean) => {
    setStatusMsg({ text, ok })
    setTimeout(() => setStatusMsg(null), 3000)
  }

  const onConnect: OnConnect = useCallback(
    (connection) => {
      let condition = 'default'
      if (connection.sourceHandle === 'yes' || connection.sourceHandle === 'no') condition = connection.sourceHandle
      if (connection.sourceHandle === 'a' || connection.sourceHandle === 'b') condition = connection.sourceHandle
      setEdges((eds) => addEdge({ ...connection, type: 'custom', data: { condition } }, eds))
    },
    [setEdges]
  )

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === 'note') return // notes are edited directly on canvas
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id))
  }, [])

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
      setNodes((nds) => {
        if (type === 'entry' && nds.some((n) => n.type === 'entry')) return nds
        const config =
          type === 'entry' ? { entry_type: 'link_utm', funnel_id: funnel.id } :
          type === 'delay' ? { duration: 1, unit: 'horas' } :
          {}
        return nds.concat({
          id: crypto.randomUUID(),
          type,
          position,
          data: { label: BLOCK_LABELS[type] ?? type, blockType: type, config } as FunnelNodeData,
        })
      })
    },
    [screenToFlowPosition, setNodes, funnel.id]
  )

  const getSnapshot = useCallback((): VersionSnapshot => {
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
    return { blocks, edges: flowEdges }
  }, [nodes, edges])

  const handleSave = useCallback(() => {
    startTransition(async () => {
      const snap = getSnapshot()
      const result = await saveFunnel(funnel.id, snap.blocks as BlockDTO[], snap.edges as EdgeDTO[])
      showMsg(result.success ? 'Salvo com sucesso' : `Erro: ${result.error}`, !!result.success)
    })
  }, [getSnapshot, funnel.id, startTransition])

  const handleSelectWaInstance = useCallback((id: string | null) => {
    setWaInstanceId(id)
    setWaDropdownOpen(false)
    startTransition(async () => {
      await updateFunnelWhatsapp(funnel.id, id)
    })
  }, [funnel.id, startTransition])

  const handlePublish = useCallback(() => {
    if (!waInstanceId) {
      showMsg('Selecione uma instância WhatsApp antes de publicar', false)
      return
    }
    startTransition(async () => {
      const snap = getSnapshot()
      const result = await publishFunnel(funnel.id)
      if (result.success) {
        setFunnelStatus('published')
        // auto-save version on publish
        await saveVersion(funnel.id, snap, 'Publicação')
      }
      showMsg(result.success ? 'Funil publicado!' : `Erro: ${result.error}`, !!result.success)
    })
  }, [funnel.id, startTransition, waInstanceId, getSnapshot])

  const handleRestoreVersion = useCallback((snapshot: VersionSnapshot) => {
    isRestoringRef.current = true
    const restoredNodes = (snapshot.blocks as BlockDTO[]).map((b) => ({
      id: b.id,
      type: b.block_type,
      position: { x: b.position_x, y: b.position_y },
      data: { label: b.label, blockType: b.block_type, config: b.config } as FunnelNodeData,
    }))
    const restoredEdges = (snapshot.edges as EdgeDTO[]).map((e) => ({
      id: e.id,
      source: e.source_block_id,
      target: e.target_block_id,
      type: 'custom',
      data: { condition: e.condition },
    }))
    setNodes(restoredNodes)
    setEdges(restoredEdges)
    setTimeout(() => { isRestoringRef.current = false }, 50)
    setShowVersionDrawer(false)
    showMsg('Versão restaurada!', true)
  }, [setNodes, setEdges])

  const statusMeta = STATUS_META[funnelStatus] ?? STATUS_META.draft

  const handleAddBlockMobile = useCallback((type: string) => {
    setNodes((nds) => {
      if (type === 'entry' && nds.some((n) => n.type === 'entry')) return nds
      const config =
        type === 'entry' ? { entry_type: 'link_utm', funnel_id: funnel.id } :
        type === 'delay' ? { duration: 1, unit: 'horas' } :
        {}
      return nds.concat({
        id: crypto.randomUUID(),
        type,
        position: { x: 80 + Math.random() * 160, y: 80 + nds.length * 120 },
        data: { label: BLOCK_LABELS[type] ?? type, blockType: type, config } as FunnelNodeData,
      })
    })
    setShowMobilePalette(false)
  }, [setNodes, funnel.id])

  const selectedInstance = waInstances.find((i) => i.id === waInstanceId) ?? null
  const isWaDisconnected = selectedInstance && selectedInstance.status !== 'connected'

  const rightPanelOpen = (selectedNodeId && !showCaptureEditor && !showLinksDrawer && !showVersionDrawer) ||
    showCaptureEditor || showLinksDrawer || showVersionDrawer

  return (
    <div className="flex h-[calc(100dvh-52px)] md:h-[calc(100vh-61px)] -m-4 md:-m-6 bg-gray-50">
      {/* Desktop sidebar palette */}
      <div className="hidden md:flex">
        <BlockPalette />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* WhatsApp disconnection warning */}
        {isWaDisconnected && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-1.5 flex items-center gap-2 shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-red-500 shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span className="text-xs text-red-600 font-medium">WhatsApp desconectado — as mensagens não serão enviadas</span>
          </div>
        )}

        {/* Header */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0 gap-2">
          {/* Left */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
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
                className="text-sm font-semibold text-gray-800 border-b-2 border-indigo-500 bg-transparent outline-none px-0.5 min-w-0 w-40"
              />
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="text-sm font-semibold text-gray-800 hover:text-indigo-600 transition-colors truncate max-w-[160px]"
              >
                {funnelName}
              </button>
            )}
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 hidden sm:inline-flex"
              style={{ color: statusMeta.color, backgroundColor: statusMeta.bg }}
            >
              {statusMeta.label}
            </span>

            <TriggerSelector
              funnelId={funnel.id}
              initialTriggers={((funnel as Props['funnel']).funnel_product_triggers ?? []) as unknown as { id: string; platform: string; product_name: string; trigger_event: 'purchase' | 'abandoned_cart' }[]}
            />

            {/* WhatsApp instance selector */}
            <div className="relative shrink-0 hidden sm:block">
              <button
                onClick={() => setWaDropdownOpen((v) => !v)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors font-medium ${
                  selectedInstance
                    ? selectedInstance.status === 'connected'
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-red-200 bg-red-50 text-red-600'
                    : 'border-amber-200 bg-amber-50 text-amber-600'
                }`}
              >
                {selectedInstance ? (
                  <>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedInstance.status === 'connected' ? 'bg-green-500' : 'bg-red-400'}`} />
                    <span className="max-w-[80px] truncate">{selectedInstance.instance_name}</span>
                  </>
                ) : (
                  <span>Sem WA</span>
                )}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 shrink-0">
                  <polyline points="6,9 12,15 18,9" />
                </svg>
              </button>
              {waDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  <button
                    onClick={() => handleSelectWaInstance(null)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors flex items-center gap-2 ${!waInstanceId ? 'bg-gray-50 font-medium' : ''}`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                    Nenhum
                  </button>
                  {waInstances.map((inst) => (
                    <button
                      key={inst.id}
                      onClick={() => handleSelectWaInstance(inst.id)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors flex items-center gap-2 ${waInstanceId === inst.id ? 'bg-indigo-50' : ''}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${inst.status === 'connected' ? 'bg-green-500' : inst.status === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
                      <span className="flex-1 truncate font-medium text-gray-700">{inst.instance_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-1.5 shrink-0">
            {statusMsg && (
              <span className={`text-xs font-medium hidden sm:block ${statusMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                {statusMsg.text}
              </span>
            )}

            {/* Undo/Redo */}
            <button
              onClick={undo}
              disabled={!canUndo}
              title="Desfazer (Ctrl+Z)"
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
              </svg>
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title="Refazer (Ctrl+Y)"
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
              </svg>
            </button>

            {/* Auto-layout */}
            <button
              onClick={handleAutoLayout}
              title="Organizar automaticamente"
              className="hidden sm:flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors font-medium"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              Organizar
            </button>

            {/* Version history */}
            <button
              onClick={() => { setShowVersionDrawer((v) => !v); setShowCaptureEditor(false); setShowLinksDrawer(false); setSelectedNodeId(null) }}
              title="Histórico de versões"
              className="hidden sm:flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors font-medium"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                <polyline points="12,7 12,12 15,15" />
              </svg>
              Versões
            </button>

            <button
              onClick={() => { setShowLinksDrawer(v => !v); setShowCaptureEditor(false); setShowVersionDrawer(false) }}
              className="hidden sm:flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors font-medium"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Links
            </button>
            <button
              onClick={() => { setShowCaptureEditor(v => !v); setShowLinksDrawer(false); setShowVersionDrawer(false) }}
              className="hidden sm:flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors font-medium"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              Página
            </button>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
            >
              {isPending ? (
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
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
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors font-medium"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
              </svg>
              {funnelStatus === 'published' ? 'Publicado' : 'Publicar'}
            </button>
          </div>
        </header>

        {/* Canvas + Right Panel */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 relative">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onPaneClick={() => { setSelectedNodeId(null); setWaDropdownOpen(false) }}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              snapToGrid
              snapGrid={[20, 20]}
              fitView
              deleteKeyCode="Delete"
              selectionOnDrag
              multiSelectionKeyCode="Shift"
              defaultEdgeOptions={{ type: 'custom', data: { condition: 'default' } }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} color="#e2e8f0" size={1.5} />
              <Controls className="!shadow-md !rounded-xl !border !border-gray-200 !bg-white" />
            </ReactFlow>
            {/* Canvas footer hint */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none">
              <span className="text-xs text-gray-400 bg-white/80 px-3 py-1 rounded-full border border-gray-200 shadow-sm">
                Shift + clique para selecionar múltiplos · Delete para excluir
              </span>
            </div>
          </div>

          {selectedNodeId && !showCaptureEditor && !showLinksDrawer && !showVersionDrawer && (
            <ConfigPanel
              selectedNodeId={selectedNodeId}
              nodes={nodes}
              onClose={() => setSelectedNodeId(null)}
              funnelId={funnel.id}
              onOpenCaptureEditor={() => setShowCaptureEditor(true)}
              waInstances={waInstances}
              waInstanceId={waInstanceId}
            />
          )}
          {showCaptureEditor && (
            <CapturePageEditor
              funnelId={funnel.id}
              onClose={() => setShowCaptureEditor(false)}
              entryType={(nodes.find(n => n.type === 'entry')?.data as FunnelNodeData | undefined)?.config?.entry_type as string | undefined}
              onSaved={(tpl) => {
                setNodes((nds) =>
                  nds.map((n) => {
                    if (n.type !== 'entry') return n
                    const nd = n.data as FunnelNodeData
                    return { ...n, data: { ...nd, config: { ...nd.config, page_configured: true, page_template: tpl } } }
                  })
                )
              }}
            />
          )}
          {showLinksDrawer && (
            <LinksDrawer
              funnelId={funnel.id}
              onClose={() => setShowLinksDrawer(false)}
              entryType={(nodes.find(n => n.type === 'entry')?.data as FunnelNodeData | undefined)?.config?.entry_type as string | undefined}
            />
          )}
          {showVersionDrawer && (
            <VersionDrawer
              funnelId={funnel.id}
              currentSnapshot={getSnapshot()}
              onRestore={handleRestoreVersion}
              onClose={() => setShowVersionDrawer(false)}
            />
          )}
        </div>
      </div>

      {/* Mobile: FAB + block bottom sheet */}
      <div className="md:hidden">
        <button
          onClick={() => setShowMobilePalette(true)}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center text-2xl font-light hover:bg-indigo-700"
          aria-label="Adicionar bloco"
        >
          +
        </button>

        {showMobilePalette && (
          <>
            <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setShowMobilePalette(false)} />
            <div className="fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-2xl shadow-xl max-h-[80vh] overflow-y-auto">
              <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mt-3 mb-1" />
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                <p className="font-semibold text-gray-900 text-sm">Adicionar bloco</p>
                <button onClick={() => setShowMobilePalette(false)} className="text-gray-400 hover:text-gray-700 p-1">✕</button>
              </div>
              <BlockPalette mode="sheet" onBlockClick={handleAddBlockMobile} />
            </div>
          </>
        )}
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
