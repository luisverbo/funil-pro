'use client'

import React, { useState, useCallback } from 'react'
import {
  getBezierPath,
  EdgeLabelRenderer,
  BaseEdge,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react'

const CONDITION_META: Record<string, { label: string; color: string; bg: string }> = {
  default:     { label: 'Padrão',       color: '#3b82f6', bg: '#eff6ff' },
  yes:         { label: '✓ Verdadeiro', color: '#10b981', bg: '#ecfdf5' },
  no:          { label: '✗ Falso',     color: '#ef4444', bg: '#fef2f2' },
  a:           { label: 'Variante A',  color: '#10b981', bg: '#ecfdf5' },
  b:           { label: 'Variante B',  color: '#3b82f6', bg: '#eff6ff' },
  replied:     { label: 'Respondeu',  color: '#8b5cf6', bg: '#f5f3ff' },
  purchased:   { label: 'Comprou',    color: '#f59e0b', bg: '#fffbeb' },
  clicked:     { label: 'Clicou',     color: '#6366f1', bg: '#eef2ff' },
  opened:      { label: 'Abriu',      color: '#10b981', bg: '#ecfdf5' },
  not_opened:  { label: 'Não abriu',  color: '#ef4444', bg: '#fef2f2' },
  not_clicked: { label: 'Não clicou', color: '#f97316', bg: '#fff7ed' },
}

const CONDITIONS = Object.entries(CONDITION_META).map(([value, meta]) => ({ value, ...meta }))

export default function CustomEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const { setEdges, deleteElements } = useReactFlow()
  const [editing, setEditing] = useState(false)

  const condition = (data?.condition as string) ?? 'default'
  const meta = CONDITION_META[condition] ?? CONDITION_META.default

  const handleConditionChange = useCallback((newCondition: string) => {
    setEdges((eds) => eds.map((e) => e.id === id ? { ...e, data: { ...e.data, condition: newCondition } } : e))
    setEditing(false)
  }, [id, setEdges])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    deleteElements({ edges: [{ id }] })
  }, [id, deleteElements])

  const midX = (sourceX + targetX) / 2
  const midY = (sourceY + targetY) / 2

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke: selected ? '#6366f1' : '#94a3b8', strokeWidth: selected ? 2.5 : 1.5 }} />
      <EdgeLabelRenderer>
        <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all', zIndex: 10 }} className="nodrag nopan">
          {editing ? (
            <select autoFocus value={condition} onChange={(e) => handleConditionChange(e.target.value)} onBlur={() => setEditing(false)}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => setEditing(true)}
                className="text-xs font-semibold px-2 py-0.5 rounded-full border shadow-sm transition-all hover:shadow-md"
                style={{ color: meta.color, backgroundColor: meta.bg, borderColor: meta.color + '40' }}>
                {meta.label}
              </button>
              <button onClick={handleDelete} title="Remover conexão"
                className="w-5 h-5 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-red-50 hover:border-red-300 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2.5} className="w-3 h-3">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </div>
        {selected && Math.abs(midX - labelX) + Math.abs(midY - labelY) > 60 && (
          <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${midX}px,${midY}px)`, pointerEvents: 'all', zIndex: 10 }} className="nodrag nopan">
            <button onClick={handleDelete} title="Remover conexão"
              className="w-5 h-5 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-red-50 hover:border-red-300 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2.5} className="w-3 h-3">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
