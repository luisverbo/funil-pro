'use client'

import React from 'react'
import { Handle, Position } from '@xyflow/react'
import type { BlockMetrics } from '@/types'

interface BaseNodeProps {
  id: string
  selected?: boolean
  borderColor: string
  icon: React.ReactNode
  typeLabel: string
  preview: string
  extraHandles?: React.ReactNode
  hideSourceHandle?: boolean
  hideTargetHandle?: boolean
  metrics?: BlockMetrics | null
  showMetrics?: boolean
}

const METRIC_LABELS = [
  { key: 'sent',      label: 'Enviado' },
  { key: 'delivered', label: 'Entregue' },
  { key: 'opened',    label: 'Aberto' },
  { key: 'clicked',   label: 'Clicado' },
] as const

export default function BaseNode({
  id,
  selected,
  borderColor,
  icon,
  typeLabel,
  preview,
  extraHandles,
  hideSourceHandle,
  hideTargetHandle,
  metrics,
  showMetrics,
}: BaseNodeProps) {
  return (
    <div
      className="group rounded-xl bg-white transition-all duration-150 cursor-pointer"
      style={{
        width: 200,
        border: selected ? `2px solid ${borderColor}` : `1px solid #e5e7eb`,
        borderLeft: `3px solid ${borderColor}`,
        boxShadow: selected
          ? `0 0 0 3px ${borderColor}22, 0 4px 16px rgba(0,0,0,0.10)`
          : '0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
      {!hideTargetHandle && (
        <Handle
          type="target"
          position={Position.Top}
          style={{
            width: 12, height: 12,
            background: 'white',
            border: `2px solid ${borderColor}`,
            borderRadius: '50%',
            top: -6, opacity: 0,
            transition: 'opacity 0.15s',
          }}
          className="group-hover:!opacity-100"
        />
      )}

      <div className="px-3 py-2.5">
        {/* Type row */}
        <div className="flex items-center gap-1.5 mb-1">
          <span style={{ color: borderColor }}>{icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: borderColor }}>
            {typeLabel}
          </span>
        </div>
        {/* Preview */}
        <p className="text-sm text-gray-700 truncate leading-snug">
          {preview || <span className="text-gray-400 italic">Sem configuração</span>}
        </p>

        {/* Inline metrics (message + sale nodes) */}
        {showMetrics && (
          <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-4 gap-0.5">
            {METRIC_LABELS.map(({ key, label }) => (
              <div key={key} className="flex flex-col items-center">
                <span className="text-xs font-bold text-gray-800">
                  {metrics ? metrics[key] : '—'}
                </span>
                <span className="text-[9px] text-gray-400 leading-tight text-center">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {extraHandles}

      {!hideSourceHandle && !extraHandles && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{
            width: 12, height: 12,
            background: 'white',
            border: `2px solid ${borderColor}`,
            borderRadius: '50%',
            bottom: -6, opacity: 0,
            transition: 'opacity 0.15s',
          }}
          className="group-hover:!opacity-100"
        />
      )}
    </div>
  )
}
