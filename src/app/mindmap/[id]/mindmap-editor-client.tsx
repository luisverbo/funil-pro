'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap,
  useReactFlow, useNodesState, type Node, type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { MindNodeView, type MindNodeData } from '@/components/mindmap/mind-node'
import { NodeInspector } from '@/components/mindmap/node-inspector'
import { MindToolbar } from '@/components/mindmap/mind-toolbar'
import { saveMindMapNodes, renameMindMap } from '@/app/actions/mindmaps'
import {
  descendantsOf, hiddenIds, levelOf, newNodeId, resolveBranchColor,
  BRANCH_COLORS, type MindMap, type MindNode,
} from '@/lib/mindmap/types'

const nodeTypes = { mind: MindNodeView }
const H_GAP = 260   // distância horizontal pai → filho
const V_GAP = 84    // distância vertical entre irmãos
const HISTORY_LIMIT = 50

type SaveState = 'idle' | 'saving' | 'saved'

function EditorInner({ map }: { map: MindMap }) {
  const router = useRouter()
  const rf = useReactFlow()

  const [nodes, setNodes] = useState<MindNode[]>(map.nodes)
  const [selectedId, setSelectedId] = useState<string | null>(map.nodes[0]?.id ?? null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState(map.title)
  const [showGrid, setShowGrid] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [exporting, setExporting] = useState(false)

  // ── histórico (undo/redo) — snapshots limitados ──
  const past = useRef<MindNode[][]>([])
  const future = useRef<MindNode[][]>([])
  const [histTick, setHistTick] = useState(0)

  const commit = useCallback((next: MindNode[] | ((prev: MindNode[]) => MindNode[])) => {
    setNodes(prev => {
      const resolved = typeof next === 'function' ? (next as (p: MindNode[]) => MindNode[])(prev) : next
      past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), prev]
      future.current = []
      setHistTick(t => t + 1)
      return resolved
    })
  }, [])

  const undo = useCallback(() => {
    setNodes(prev => {
      const last = past.current.pop()
      if (!last) return prev
      future.current = [prev, ...future.current.slice(0, HISTORY_LIMIT - 1)]
      setHistTick(t => t + 1)
      return last
    })
  }, [])

  const redo = useCallback(() => {
    setNodes(prev => {
      const next = future.current.shift()
      if (!next) return prev
      past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), prev]
      setHistTick(t => t + 1)
      return next
    })
  }, [])

  // ── autosave com debounce (~1s) ──
  const dirty = useRef(false)
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    dirty.current = true
    setSaveState('saving')
    const t = setTimeout(async () => {
      await saveMindMapNodes(map.id, nodes)
      dirty.current = false
      setSaveState('saved')
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1600)
    }, 1000)
    return () => clearTimeout(t)
  }, [nodes, map.id])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // histTick força reavaliar os refs de histórico a cada mudança
  const canUndo = useMemo(() => past.current.length > 0, [histTick])   // eslint-disable-line react-hooks/exhaustive-deps
  const canRedo = useMemo(() => future.current.length > 0, [histTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const hidden = useMemo(() => hiddenIds(nodes), [nodes])
  const childrenOf = useCallback((id: string) => nodes.filter(n => n.parentId === id).sort((a, b) => a.order - b.order), [nodes])

  // ── operações na árvore ──
  const patchNode = useCallback((id: string, patch: Partial<MindNode>) => {
    commit(prev => prev.map(n => (n.id === id ? { ...n, ...patch } : n)))
  }, [commit])

  const addChild = useCallback((parentId: string) => {
    const parent = byId.get(parentId)
    if (!parent) return
    const sibs = nodes.filter(n => n.parentId === parentId)
    const id = newNodeId()
    // empilha abaixo do último irmão; o 1º filho nasce alinhado ao pai
    const lastY = sibs.length > 0 ? Math.max(...sibs.map(s => s.y)) + V_GAP : parent.y
    const node: MindNode = {
      id, parentId, label: '',
      x: parent.x + H_GAP,
      y: lastY,
      order: sibs.length,
    }
    // filho novo em ramo principal ganha cor própria da paleta (visual MindMeister)
    if (!parent.parentId) node.color = BRANCH_COLORS[sibs.length % BRANCH_COLORS.length].key
    commit(prev => prev.map(n => (n.id === parentId ? { ...n, collapsed: false } : n)).concat(node))
    setSelectedId(id)
    setEditingId(id)
  }, [byId, nodes, commit])

  const addSibling = useCallback((id: string) => {
    const node = byId.get(id)
    if (!node?.parentId) return
    addChild(node.parentId)
  }, [byId, addChild])

  const removeNode = useCallback((id: string) => {
    const node = byId.get(id)
    if (!node?.parentId) return   // raiz não é removível
    const kids = descendantsOf(id, nodes)
    if (kids.length > 0 && !confirm(`Excluir este item e os ${kids.length} abaixo dele?`)) return
    const doomed = new Set([id, ...kids])
    commit(prev => prev.filter(n => !doomed.has(n.id)))
    setSelectedId(node.parentId)
    setEditingId(null)
  }, [byId, nodes, commit])

  const toggleCollapse = useCallback((id: string) => {
    commit(prev => prev.map(n => (n.id === id ? { ...n, collapsed: !n.collapsed } : n)))
  }, [commit])

  /** Oculta SÓ este item (e o que estiver abaixo dele) */
  const hideSelf = useCallback((id: string) => {
    const node = byId.get(id)
    if (!node?.parentId) return   // a raiz não some
    commit(prev => prev.map(n => (n.id === id ? { ...n, hidden: true } : n)))
    setSelectedId(node.parentId)
    setEditingId(null)
  }, [byId, commit])

  /** Reexibe os filhos diretos que estavam ocultos individualmente */
  const showHiddenChildren = useCallback((parentId: string) => {
    commit(prev => prev.map(n => (n.parentId === parentId && n.hidden ? { ...n, hidden: false } : n)))
  }, [commit])

  // ── navegação por setas ──
  const navigate = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    if (!selectedId) return
    const cur = byId.get(selectedId)
    if (!cur) return
    if (dir === 'left' && cur.parentId) { setSelectedId(cur.parentId); return }
    if (dir === 'right') {
      const kids = childrenOf(cur.id).filter(k => !hidden.has(k.id))
      if (kids.length) setSelectedId(kids[0].id)
      return
    }
    const sibs = (cur.parentId ? childrenOf(cur.parentId) : [cur]).filter(s => !hidden.has(s.id))
    const i = sibs.findIndex(s => s.id === cur.id)
    const j = dir === 'up' ? i - 1 : i + 1
    if (j >= 0 && j < sibs.length) setSelectedId(sibs[j].id)
  }, [selectedId, byId, childrenOf, hidden])

  // ── atalhos de teclado ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
        return
      }
      if (typing) return
      if (!selectedId) return

      switch (e.key) {
        case 'Tab':       e.preventDefault(); addChild(selectedId); break
        case 'Enter':     e.preventDefault(); addSibling(selectedId); break
        case 'F2':        e.preventDefault(); setEditingId(selectedId); break
        case 'Delete':
        case 'Backspace': e.preventDefault(); removeNode(selectedId); break
        case 'Escape':    e.preventDefault(); setEditingId(null); setSelectedId(null); break
        case 'ArrowUp':   e.preventDefault(); navigate('up'); break
        case 'ArrowDown': e.preventDefault(); navigate('down'); break
        case 'ArrowLeft': e.preventDefault(); navigate('left'); break
        case 'ArrowRight':e.preventDefault(); navigate('right'); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, addChild, addSibling, removeNode, navigate, undo, redo])

  // ── nós do React Flow ──
  // O React Flow gerencia o arrasto internamente (useNodesState). O modelo só é
  // sincronizado quando a ESTRUTURA muda — não a cada pixel do arrasto — senão
  // o canvas inteiro re-renderiza e "pisca".
  const [rfNodes, setRfNodes, onRfNodesChange] = useNodesState<Node>([])

  const buildNodes = useCallback((): Node[] => nodes
    .filter(n => !hidden.has(n.id))
    .map(n => {
      const color = resolveBranchColor(n, byId)
      const data: MindNodeData = {
        label: n.label,
        note: n.note,
        icon: n.icon,
        imageUrl: n.imageUrl,
        linkUrl: n.linkUrl,
        shape: n.shape ?? 'solid',
        bold: n.bold,
        italic: n.italic,
        underline: n.underline,
        fontSize: n.fontSize,
        textColor: n.textColor,
        level: levelOf(n, byId),
        color,
        childCount: nodes.filter(c => c.parentId === n.id).length,
        hiddenChildCount: nodes.filter(c => c.parentId === n.id && c.hidden).length,
        collapsed: !!n.collapsed,
        isRoot: !n.parentId,
        editing: editingId === n.id,
        onStartEdit: () => setEditingId(n.id),
        onCommitEdit: (label: string) => { patchNode(n.id, { label }); setEditingId(null) },
        onAddChild: () => addChild(n.id),
        onToggleCollapse: () => toggleCollapse(n.id),
        onHideSelf: () => hideSelf(n.id),
        onShowHiddenChildren: () => showHiddenChildren(n.id),
      }
      return { id: n.id, type: 'mind', position: { x: n.x, y: n.y }, data, selected: selectedId === n.id }
    }), [nodes, hidden, byId, editingId, selectedId, patchNode, addChild, toggleCollapse, hideSelf, showHiddenChildren])

  // Assinatura da estrutura (sem posições): muda só quando algo visual/estrutural muda
  const structureKey = useMemo(() => JSON.stringify(
    nodes.map(n => [n.id, n.parentId, n.label, n.note, n.icon, n.color, n.collapsed, n.hidden,
      n.shape, n.imageUrl, n.linkUrl, n.bold, n.italic, n.underline, n.fontSize, n.textColor])
  ), [nodes])

  useEffect(() => {
    setRfNodes(buildNodes())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, selectedId, editingId, histTick])

  const rfEdges: Edge[] = useMemo(() => nodes
    .filter(n => n.parentId && !hidden.has(n.id) && !hidden.has(n.parentId))
    .map(n => {
      const color = resolveBranchColor(n, byId)
      const lvl = levelOf(n, byId)
      return {
        id: `e-${n.id}`,
        source: n.parentId!,
        target: n.id,
        type: 'default',                      // bezier suave
        style: { stroke: color.solid, strokeWidth: lvl === 1 ? 2.5 : 1.8, opacity: 0.85 },
      }
    }), [nodes, hidden, byId])

  // Ao SOLTAR o nó, grava a posição no modelo (o arrasto em si é interno do RF)
  const onNodeDragStop = useCallback((_: unknown, n: Node) => {
    commit(prev => prev.map(m =>
      m.id === n.id ? { ...m, x: Math.round(n.position.x), y: Math.round(n.position.y) } : m
    ))
  }, [commit])

  // ── exportações ──
  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify({ title, nodes }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title.replace(/[^\w\-]+/g, '-').toLowerCase()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [title, nodes])

  const exportPng = useCallback(async () => {
    setExporting(true)
    try {
      const visible = nodes.filter(n => !hidden.has(n.id))
      if (visible.length === 0) return
      const PAD = 60
      const NODE_W = 200, NODE_H = 56
      const minX = Math.min(...visible.map(n => n.x)) - PAD
      const minY = Math.min(...visible.map(n => n.y)) - PAD
      const maxX = Math.max(...visible.map(n => n.x)) + NODE_W + PAD
      const maxY = Math.max(...visible.map(n => n.y)) + NODE_H + PAD
      const w = Math.max(400, maxX - minX), h = Math.max(300, maxY - minY)

      const canvas = document.createElement('canvas')
      const scale = 2
      canvas.width = w * scale; canvas.height = h * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(scale, scale)
      ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, w, h)

      // conexões (bezier)
      for (const n of visible) {
        if (!n.parentId || hidden.has(n.parentId)) continue
        const p = byId.get(n.parentId); if (!p) continue
        const c = resolveBranchColor(n, byId)
        const x1 = p.x - minX + NODE_W / 2, y1 = p.y - minY + NODE_H / 2
        const x2 = n.x - minX, y2 = n.y - minY + NODE_H / 2
        ctx.beginPath(); ctx.moveTo(x1, y1)
        ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2)
        ctx.strokeStyle = c.solid; ctx.lineWidth = 2; ctx.globalAlpha = 0.85; ctx.stroke(); ctx.globalAlpha = 1
      }
      // nós
      for (const n of visible) {
        const c = resolveBranchColor(n, byId)
        const lvl = levelOf(n, byId)
        const solid = lvl < 2
        const x = n.x - minX, y = n.y - minY
        const text = `${n.icon ? n.icon + ' ' : ''}${n.label || 'Sem título'}`
        ctx.font = `${lvl === 0 ? 'bold 17px' : lvl === 1 ? '600 15px' : '500 13px'} system-ui, sans-serif`
        const tw = ctx.measureText(text).width
        const bw = Math.max(110, tw + 34), bh = lvl === 0 ? 52 : lvl === 1 ? 46 : 40
        const r = 14
        ctx.beginPath()
        ctx.moveTo(x + r, y); ctx.lineTo(x + bw - r, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + r)
        ctx.lineTo(x + bw, y + bh - r); ctx.quadraticCurveTo(x + bw, y + bh, x + bw - r, y + bh)
        ctx.lineTo(x + r, y + bh); ctx.quadraticCurveTo(x, y + bh, x, y + bh - r)
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
        ctx.fillStyle = solid ? c.solid : c.soft; ctx.fill()
        ctx.strokeStyle = solid ? c.solid : c.border; ctx.lineWidth = 2; ctx.stroke()
        ctx.fillStyle = solid ? '#ffffff' : c.text
        ctx.textBaseline = 'middle'
        ctx.fillText(text, x + 17, y + bh / 2)
      }

      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = `${title.replace(/[^\w\-]+/g, '-').toLowerCase()}.png`
      a.click()
    } finally { setExporting(false) }
  }, [nodes, hidden, byId, title])

  const selected = selectedId ? byId.get(selectedId) : undefined
  const saveLabel = saveState === 'saving' ? 'Salvando…' : saveState === 'saved' ? '✓ Salvo' : ''

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50" style={{ zIndex: 30 }}>
      {/* Topbar */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0">
        <button onClick={() => router.push('/mindmaps')} className="text-sm text-indigo-600 hover:underline">← Mapas</button>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => renameMindMap(map.id, title)}
          aria-label="Título do mapa"
          className="font-semibold text-gray-900 outline-none bg-transparent border-b border-transparent focus:border-indigo-300 max-w-[260px]"
        />
        <span className="text-xs text-gray-400 min-w-[70px]">{saveLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden md:inline text-[11px] text-gray-400">
            <kbd className="px-1 py-0.5 bg-gray-100 rounded">Tab</kbd> filho ·
            <kbd className="px-1 py-0.5 bg-gray-100 rounded ml-1">Enter</kbd> irmão ·
            <kbd className="px-1 py-0.5 bg-gray-100 rounded ml-1">F2</kbd> editar
          </span>
          <button
            onClick={() => selectedId && addChild(selectedId)}
            disabled={!selectedId}
            className="px-3 py-1.5 text-sm font-semibold text-white rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 hover:opacity-90 disabled:opacity-40">
            + Item
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 relative">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onRfNodesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, n) => { setSelectedId(n.id); setEditingId(null) }}
            onPaneClick={() => { setSelectedId(null); setEditingId(null) }}
            nodesConnectable={false}
            panOnScroll
            selectionOnDrag={false}
            panOnDrag={[0, 1, 2]}   /* arrasta o canvas; botões do nó usam .nopan pra não roubar o clique */
            zoomOnScroll
            minZoom={0.2}
            maxZoom={2}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            {showGrid && <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="#dcdfe6" />}
            <MiniMap
              pannable zoomable
              className="!bg-white/90 !border !border-gray-200 !rounded-xl"
              nodeColor={(n) => (n.data as MindNodeData)?.color?.solid ?? '#6366f1'}
              maskColor="rgba(248,250,252,0.7)"
            />
          </ReactFlow>

          <MindToolbar
            onZoomIn={() => rf.zoomIn({ duration: 180 })}
            onZoomOut={() => rf.zoomOut({ duration: 180 })}
            onFit={() => rf.fitView({ duration: 250, padding: 0.2 })}
            showGrid={showGrid}
            onToggleGrid={() => setShowGrid(g => !g)}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            onExportPng={exportPng}
            onExportJson={exportJson}
            exporting={exporting}
          />
        </div>

        {selected && (
          <NodeInspector
            node={selected}
            childCount={descendantsOf(selected.id, nodes).length}
            onChange={patch => patchNode(selected.id, patch)}
            onDelete={() => removeNode(selected.id)}
            onAddChild={() => addChild(selected.id)}
            onAddSibling={() => addSibling(selected.id)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  )
}

export default function MindMapEditorClient({ map }: { map: MindMap }) {
  return (
    <ReactFlowProvider>
      <EditorInner map={map} />
    </ReactFlowProvider>
  )
}
