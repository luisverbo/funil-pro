'use client'

import { useState, useCallback } from 'react'
import { getBezierPath, EdgeLabelRenderer, useReactFlow } from '@xyflow/react'
import type { EdgeProps } from '@xyflow/react'
import type { EdgeCondition } from '@/types'

const CONDITIONS: { value: EdgeCondition; label: string }[] = [
  { value: 'default', label: 'Padrão' },
  { value: 'opened', label: 'Abriu' },
  { value: 'not_opened', label: 'Não abriu' },
  { value: 'clicked', label: 'Clicou' },
  { value: 'not_clicked', label: 'Não clicou' },
  { value: 'replied', label: 'Respondeu' },
  { value: 'purchased', label: 'Comprou' },
]

export default function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [open, setOpen] = useState(false)
  const { setEdges } = useReactFlow()
  const condition = (data?.condition as EdgeCondition) ?? 'default'
  const conditionLabel = CONDITIONS.find((c) => c.value === condition)?.label ?? 'Padrão'

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const handleChange = useCallback(
    (value: EdgeCondition) => {
      setEdges((edges) =>
        edges.map((e) =>
          e.id === id ? { ...e, data: { ...e.data, condition: value } } : e
        )
      )
      setOpen(false)
    },
    [id, setEdges]
  )

  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        strokeWidth={2}
        stroke="#6366f1"
        fill="none"
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          <button
            onClick={() => setOpen((o) => !o)}
            className="bg-white border border-indigo-300 text-indigo-700 text-xs rounded-full px-2 py-0.5 shadow-sm hover:bg-indigo-50 transition"
          >
            {conditionLabel}
          </button>
          {open && (
            <div className="absolute z-10 mt-1 left-0 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[120px]">
              {CONDITIONS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => handleChange(c.value)}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${condition === c.value ? 'font-semibold text-indigo-600' : 'text-gray-700'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
