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
  default:     { label: 'Padrão',     color: '#3b82f6', bg: '#eff6ff' },
  opened:      { label: 'Abriu',      color: '#10b981', bg: '#ecfdf5' },
  not_opened:  { label: 'Não abriu',  color: '#ef4444', bg: '#fef2f2' },
  clicked:     { label: 'Clicou',     color: '#6366f1', bg: '#eef2ff' },
  not_clicked: { label: 'Não clicou', color: '#f97316', bg: '#fff7ed' },
  replied:     { label: 'Respondeu',  color: '#8b5cf6', bg: '#f5f3ff' },
  purchased:   { label: 'Comprou',    color: '#f59e0b', bg: '#fffbeb' },
}

const CONDITIONS = Object.entries(CONDITION_META).map(([value, meta]) => ({ value, ...meta }))

export default function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition,
    targetX, targetY, targetPosition,
  })
  const { setEdges } = useReactFlow()
  const [editing, setEditing] = useState(false)

  const condition = (data?.condition as string) ?? 'default'
  const meta = CONDITION_META[condition] ?? CONDITION_META.default

  const handleConditionChange = useCallback((newCondition: string) => {
    setEdges((eds) =>
      eds.map((e) => e.id === id ? { ...e, data: { ...e.data, condition: newCondition } } : e)
    )
    setEditing(false)
  }, [id, setEdges])

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? '#6366f1' : '#94a3b8',
          strokeWidth: selected ? 2.5 : 1.5,
        }}
      />

      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            zIndex: 10,
          }}
          className="nodrag nopan"
        >
          {editing ? (
            <select
              autoFocus
              value={condition}
              onChange={(e) => handleConditionChange(e.target.value)}
              onBlur={() => setEditing(false)}
              className="text-xs border border-gray-300 rounded-lg px-2 py-1 bg-white shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-semibold px-2 py-0.5 rounded-full border shadow-sm transition-all hover:shadow-md"
              style={{ color: meta.color, backgroundColor: meta.bg, borderColor: meta.color + '40' }}
            >
              {meta.label}
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
