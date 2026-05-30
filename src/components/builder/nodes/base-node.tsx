'use client'

import React from 'react'
import { Handle, Position } from '@xyflow/react'

interface BaseNodeProps {
  id: string
  selected?: boolean
  headerColor: string
  headerBg: string
  icon: React.ReactNode
  typeLabel: string
  onDelete?: (id: string) => void
  children?: React.ReactNode
  extraHandles?: React.ReactNode
  hideSourceHandle?: boolean
}

export default function BaseNode({
  id,
  selected,
  headerColor,
  headerBg,
  icon,
  typeLabel,
  onDelete,
  children,
  extraHandles,
  hideSourceHandle,
}: BaseNodeProps) {
  return (
    <div
      className="rounded-xl transition-all duration-150"
      style={{
        width: 220,
        border: selected ? `2px solid #6366f1` : `2px solid ${headerColor}22`,
        boxShadow: selected
          ? '0 0 0 3px rgba(99,102,241,0.15), 0 4px 16px rgba(0,0,0,0.10)'
          : '0 2px 12px rgba(0,0,0,0.08)',
      }}
    >
      {/* Target handle (input — top center) — NO negative positioning, React Flow manages it */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          width: 14,
          height: 14,
          background: 'white',
          border: `2.5px solid ${headerColor}`,
          borderRadius: '50%',
          top: -7,
        }}
      />

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded-t-xl"
        style={{ backgroundColor: headerBg }}
      >
        <div className="flex items-center gap-2">
          <div style={{ color: headerColor }}>{icon}</div>
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: headerColor }}>
            {typeLabel}
          </span>
        </div>
        {onDelete && (
          <button
            onClick={() => onDelete(id)}
            className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Body */}
      <div className="bg-white px-3 py-2.5 space-y-2 rounded-b-xl">
        {children}
      </div>

      {/* Extra handles (condition node dual outputs) */}
      {extraHandles}

      {/* Default source handle (output — bottom center) */}
      {!hideSourceHandle && !extraHandles && (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{
            width: 14,
            height: 14,
            background: 'white',
            border: `2.5px solid ${headerColor}`,
            borderRadius: '50%',
            bottom: -7,
          }}
        />
      )}
    </div>
  )
}
