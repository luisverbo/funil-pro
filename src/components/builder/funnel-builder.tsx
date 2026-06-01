'use client'

import '@xyflow/react/dist/style.css'

import React, { useCallback, useState, useTransition } from 'react'
import {
  ReactFlow, Background, BackgroundVariant, Controls,
  useNodesState, useEdgesState, useReactFlow, ReactFlowProvider, addEdge,
  type Node, type Edge, type OnConnect, type NodeMouseHandler,
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
import CustomEdge from './custom-edge'
import BlockPalette from './block-palette'
import ConfigPanel from './config-panel'
import CapturePageEditor from './capture-page-editor'
import LinksDrawer from './links-drawer'

import { saveFunnel, publishFunnel, updateFunnelWhatsapp } from '@/app/actions/funnels'
import TriggerSelector from './trigger-selector'
import type { Funnel, FunnelBlock, FunnelEdge, FunnelNodeData, BlockDTO, EdgeDTO, BlockMetrics, WhatsappInstance } from '@/types'

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
}

const edgeTypes = { custom: CustomEdge }

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  draft:     { label: 'Rascunho',  color: '#6b7280', bg: '#f3f4f6' },
  published: { label: 'Publicado', color: '#10b981', bg: '#ecfdf5' },
  paused:    { label: 'Pausado',   color: '#f59e0b', bg: '#fffbeb' },
}

const BLOCK_LABELS: Record<string, string> = {
  message: 'Mensagem', condition: 'Condição', delay: 'Atraso', tag: 'Tag',
  sale: 'Venda', entry: 'Entrada', cart_abandoned: 'Carr. Abandonado',
  goto: 'Ir para etapa', ab_test: 'Divisão A/B', remove_from_funnel: 'Remover do funil',
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
    data: { label: block.label, blockType: block.block_type, config, metrics: metrics?.[block.id] ?? null } as FunnelNodeData,
  }
}

function dbEdgeToFlowEdge(edge: FunnelEdge): Edge {
  return { id: edge.id, source: edge.source_block_id, target: edge.target_block_id, type: 'custom', data: { condition: edge.condition ?? 'default' } }
}

function BuilderCanvas({ funnel, initialBlocks, initialEdges, blockMetrics, waInstances = [] }: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialBlocks.map((b) => blockToNode(b, funnel.id, blockMetrics)))
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges.map(dbEdgeToFlowEdge))
  const { screenToFlowPosition } = useReactFlow()

  const [isPending, startTransition] = useTransition()
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [funnelStatus, setFunnelStatus] = useState(funnel.status)
  const [editingName, setEditingName] = useState(false)
  const [funnelName, setFunnelName] = useState(funnel.name)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showCaptureEditor, setShowCaptureEditor] = useState(false)
  const [showLinksDrawer, setShowLinksDrawer] = useState(false)
  const [showMobilePalette, setShowMobilePalette] = useState(false)
  const [waInstanceId, setWaInstanceId] = useState<string | null>(funnel.whatsapp_instance_id)
  const [waDropdownOpen, setWaDropdownOpen] = useState(false)

  const showMsg = (text: string, ok: boolean) => {
    setStatusMsg({ text, ok })
    setTimeout(() => setStatusMsg(null), 3000)
  }

  const onConnect: OnConnect = useCallback(
    (connection) => {
      const h = connection.sourceHandle
      const condition = (h === 'yes' || h === 'no' || h === 'a' || h === 'b') ? h : 'default'
      setEdges((eds) => addEdge({ ...connection, type: 'custom', data: { condition } }, eds))
    },
    [setEdges]
  )

  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
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
        const config = type === 'entry' ? { entry_type: 'link_utm', funnel_id: funnel.id } : {}
        return nds.concat({ id: crypto.randomUUID(), type, position, data: { label: BLOCK_LABELS[type] ?? type, blockType: type, config } as FunnelNodeData })
      })
    },
    [screenToFlowPosition, setNodes, funnel.id]
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
        id: e.id, source_block_id: e.source, target_block_id: e.target,
        condition: (e.data?.condition as string) ?? 'default',
      }))
      const result = await saveFunnel(funnel.id, blocks, flowEdges)
      showMsg(result.success ? 'Salvo com sucesso' : `Erro: ${result.error}`, !!result.success)
    })
  }, [nodes, edges, funnel.id, startTransition])

  const handleSelectWaInstance = useCallback((id: string | null) => {
    setWaInstanceId(id)
    setWaDropdownOpen(false)
    startTransition(async () => { await updateFunnelWhatsapp(funnel.id, id) })
  }, [funnel.id, startTransition])

  const handlePublish = useCallback(() => {
    if (!waInstanceId) { showMsg('Selecione uma instância WhatsApp antes de publicar', false); return }
    startTransition(async () => {
      const result = await publishFunnel(funnel.id)
      if (result.success) setFunnelStatus('published')
      showMsg(result.success ? 'Funil publicado!' : `Erro: ${result.error}`, !!result.success)
    })
  }, [funnel.id, startTransition, waInstanceId])

  const handleAddBlockMobile = useCallback((type: string) => {
    setNodes((nds) => {
      if (type === 'entry' && nds.some((n) => n.type === 'entry')) return nds
      const config = type === 'entry' ? { entry_type: 'link_utm', funnel_id: funnel.id } : {}
      return nds.concat({ id: crypto.randomUUID(), type, position: { x: 80 + Math.random() * 160, y: 80 + nds.length * 120 }, data: { label: BLOCK_LABELS[type] ?? type, blockType: type, config } as FunnelNodeData })
    })
    setShowMobilePalette(false)
  }, [setNodes, funnel.id])

  const statusMeta = STATUS_META[funnelStatus] ?? STATUS_META.draft
  const selectedInstance = waInstances.find((i) => i.id === waInstanceId) ?? null
  const isWaDisconnected = selectedInstance && selectedInstance.status !== 'connected'

  return (
    <div className="flex h-[calc(100dvh-52px)] md:h-[calc(100vh-61px)] -m-4 md:-m-6 bg-gray-50">
      <div className="hidden md:flex">
        <BlockPalette />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {isWaDisconnected && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-1.5 flex items-center gap-2 shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-red-500 shrink-0">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span className="text-xs text-red-600 font-medium">WhatsApp desconectado — as mensagens não serão enviadas</span>
          </div>
        )}

        <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/funnels" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><polyline points="15,18 9,12 15,6" /></svg>
              Funis
            </Link>
            <span className="text-gray-200">/</span>
            {editingName ? (
              <input autoFocus value={funnelName} onChange={(e) => setFunnelName(e.target.value)}
                onBlur={() => setEditingName(false)} onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
                className="text-sm font-semibold text-gray-800 border-b-2 border-indigo-500 bg-transparent outline-none px-0.5 min-w-0 w-48" />
            ) : (
              <button onClick={() => setEditingName(true)} className="text-sm font-semibold text-gray-800 hover:text-indigo-600 transition-colors truncate max-w-xs">
                {funnelName}
              </button>
            )}
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full shrink-0" style={{ color: statusMeta.color, backgroundColor: statusMeta.bg }}>
              {statusMeta.label}
            </span>
            <TriggerSelector
              funnelId={funnel.id}
              initialTriggers={((funnel as Props['funnel']).funnel_product_triggers ?? []) as unknown as { id: string; platform: string; product_name: string; trigger_event: 'purchase' | 'abandoned_cart' }[]}
            />
            {/* WhatsApp selector */}
            <div className="relative shrink-0">
              <button onClick={() => setWaDropdownOpen((v) => !v)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors font-medium ${
                  selectedInstance
                    ? selectedInstance.status === 'connected' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-600'
                    : 'border-amber-200 bg-amber-50 text-amber-600'
                }`}>
                {selectedInstance ? (
                  <><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedInstance.status === 'connected' ? 'bg-green-500' : 'bg-red-400'}`} />
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5 shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.555 4.116 1.528 5.843L0 24l6.302-1.513A11.94 11.94 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.89 0-3.663-.497-5.198-1.367l-.371-.22-3.742.897.938-3.635-.242-.374A9.944 9.944 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
                  <span className="max-w-[100px] truncate">{selectedInstance.instance_name}</span></>
                ) : (
                  <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 shrink-0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>Sem WhatsApp</>
                )}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 shrink-0"><polyline points="6,9 12,15 18,9" /></svg>
              </button>
              {waDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                  <button onClick={() => handleSelectWaInstance(null)} className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors flex items-center gap-2 ${!waInstanceId ? 'bg-gray-50 font-medium' : ''}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />Nenhum
                  </button>
                  {waInstances.length === 0 && <p className="px-3 py-2 text-xs text-gray-400 italic">Nenhuma instância cadastrada</p>}
                  {waInstances.map((inst) => (
                    <button key={inst.id} onClick={() => handleSelectWaInstance(inst.id)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors flex items-center gap-2 ${waInstanceId === inst.id ? 'bg-indigo-50' : ''}`}>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${inst.status === 'connected' ? 'bg-green-500' : inst.status === 'connecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
                      <span className="flex-1 truncate font-medium text-gray-700">{inst.instance_name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${inst.status === 'connected' ? 'bg-green-100 text-green-600' : inst.status === 'connecting' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-500'}`}>
                        {inst.status === 'connected' ? 'Conectado' : inst.status === 'connecting' ? 'Conectando' : 'Desconectado'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {statusMsg && <span className={`text-xs font-medium ${statusMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{statusMsg.text}</span>}
            <button onClick={() => { setShowLinksDrawer(v => !v); setShowCaptureEditor(false) }}
              className="flex items-center gap-1.5 text-sm px-3.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors font-medium">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Links
            </button>
            <button onClick={() => { setShowCaptureEditor(v => !v); setShowLinksDrawer(false) }}
              className="flex items-center gap-1.5 text-sm px-3.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors font-medium">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              Página
            </button>
            <button onClick={handleSave} disabled={isPending}
              className="flex items-center gap-1.5 text-sm px-3.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 font-medium">
              {isPending ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17,21 17,13 7,13 7,21" /><polyline points="7,3 7,8 15,8" />
                </svg>
              )}
              Salvar
            </button>
            <button onClick={handlePublish} disabled={isPending || funnelStatus === 'published'}
              className="flex items-center gap-1.5 text-sm px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50 font-medium">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
              </svg>
              {funnelStatus === 'published' ? 'Publicado' : 'Publicar'}
            </button>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1">
            <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onConnect={onConnect} onDrop={onDrop} onDragOver={onDragOver} onNodeClick={onNodeClick}
              onPaneClick={() => setSelectedNodeId(null)} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              snapToGrid snapGrid={[20, 20]} fitView deleteKeyCode="Delete"
              defaultEdgeOptions={{ type: 'custom', data: { condition: 'default' } }}>
              <Background variant={BackgroundVariant.Dots} gap={20} color="#e2e8f0" size={1.5} />
              <Controls className="!shadow-md !rounded-xl !border !border-gray-200 !bg-white" />
            </ReactFlow>
          </div>
          {selectedNodeId && !showCaptureEditor && !showLinksDrawer && (
            <ConfigPanel selectedNodeId={selectedNodeId} nodes={nodes} onClose={() => setSelectedNodeId(null)}
              funnelId={funnel.id} onOpenCaptureEditor={() => setShowCaptureEditor(true)}
              waInstances={waInstances} waInstanceId={waInstanceId} />
          )}
          {showCaptureEditor && (
            <CapturePageEditor funnelId={funnel.id} onClose={() => setShowCaptureEditor(false)}
              entryType={(nodes.find(n => n.type === 'entry')?.data as FunnelNodeData | undefined)?.config?.entry_type as string | undefined}
              onSaved={(tpl) => {
                setNodes((nds) => nds.map((n) => {
                  if (n.type !== 'entry') return n
                  const nd = n.data as FunnelNodeData
                  return { ...n, data: { ...nd, config: { ...nd.config, page_configured: true, page_template: tpl } } }
                }))
              }} />
          )}
          {showLinksDrawer && (
            <LinksDrawer funnelId={funnel.id} onClose={() => setShowLinksDrawer(false)}
              entryType={(nodes.find(n => n.type === 'entry')?.data as FunnelNodeData | undefined)?.config?.entry_type as string | undefined} />
          )}
        </div>
      </div>

      <div className="md:hidden">
        <button onClick={() => setShowMobilePalette(true)}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 bg-indigo-600 text-white rounded-full shadow-lg flex items-center justify-center text-2xl font-light hover:bg-indigo-700"
          aria-label="Adicionar bloco">+</button>
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
