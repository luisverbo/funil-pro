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

const handleStyle = (color: string): React.CSSProperties => ({
  width: 10,
  height: 10,
  background: '#fff',
  border: `2px solid ${color}`,
  borderRadius: '50%',
  opacity: 0,
  transition: 'opacity 0.15s',
})

export default function BaseNode({
  id: _id,
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
      className="group rounded-[10px] bg-white transition-all duration-150 cursor-pointer"
      style={{
        width: 208,
        border: selected ? `2px solid #6366F1` : `1px solid #E2E8F0`,
        borderLeft: selected ? `2px solid #6366F1` : `3px solid ${borderColor}`,
        boxShadow: selected
          ? `0 0 0 4px rgba(99,102,241,0.12), 0 4px 16px rgba(0,0,0,0.10)`
          : '0 2px 8px rgba(0,0,0,0.06)',
      }}
      onMouseEnter={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.borderColor = '#CBD5E1'
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLElement).style.borderColor = '#E2E8F0'
      }}
    >
      {!hideTargetHandle && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ ...handleStyle(borderColor), top: -5 }}
          className="group-hover:!opacity-100"
        />
      )}

      <div style={{ padding: '10px 12px' }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <span style={{ color: borderColor, display: 'flex', alignItems: 'center' }}>{icon}</span>
          <span
            className="font-semibold uppercase"
            style={{ fontSize: 10, letterSpacing: '0.7px', color: '#94A3B8' }}
          >
            {typeLabel}
          </span>
        </div>
        <p className="truncate leading-snug" style={{ fontSize: 13, fontWeight: 500, color: '#1E293B' }}>
          {preview || <span style={{ color: '#94A3B8', fontStyle: 'italic', fontWeight: 400 }}>Sem configuração</span>}
        </p>

        {showMetrics && (
          <div className="mt-2 pt-2 grid grid-cols-4 gap-0.5" style={{ borderTop: '1px solid #F1F5F9' }}>
            {METRIC_LABELS.map(({ key, label }) => (
              <div key={key} className="flex flex-col items-center">
                <span className="text-xs font-bold" style={{ color: '#1E293B' }}>
                  {metrics ? metrics[key] : '—'}
                </span>
                <span className="text-center leading-tight" style={{ fontSize: 9, color: '#94A3B8' }}>{label}</span>
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
          style={{ ...handleStyle(borderColor), bottom: -5 }}
          className="group-hover:!opacity-100"
        />
      )}
    </div>
  )
}
