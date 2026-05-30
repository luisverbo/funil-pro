'use client'

import React, { useCallback } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { FunnelNodeData } from '@/types'

const ENTRY_TYPES = [
  { value: 'link_utm', label: 'Link UTM' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'form', label: 'Formulário' },
]

const COLOR = '#6366f1'
const BG = '#eef2ff'

interface EntryConfig {
  entry_type?: string
  funnel_id?: string
}

export default function EntryNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { setNodes } = useReactFlow()
  const config = (nodeData.config ?? {}) as EntryConfig

  const update = useCallback((patch: Partial<EntryConfig>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, config: { ...config, ...patch } } } : n
      )
    )
  }, [id, config, setNodes])

  const handleDelete = useCallback(() => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
  }, [id, setNodes])

  const funnelId = config.funnel_id ?? ''
  const appUrl = 'https://funil-pro.vercel.app'
  const activateUrl = funnelId ? `${appUrl}/api/funnels/${funnelId}/activate` : `${appUrl}/api/funnels/{id}/activate`

  return (
    <div
      className="rounded-xl transition-all duration-150"
      style={{
        width: 260,
        border: selected ? `2px solid #6366f1` : `2px solid ${COLOR}44`,
        boxShadow: selected
          ? '0 0 0 3px rgba(99,102,241,0.15), 0 4px 16px rgba(0,0,0,0.10)'
          : '0 2px 12px rgba(0,0,0,0.08)',
      }}
    >
      {/* No target handle — entry is always first */}

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded-t-xl"
        style={{ backgroundColor: BG }}
      >
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke={COLOR} strokeWidth={2} className="w-4 h-4">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: COLOR }}>
            Entrada
          </span>
          <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full font-medium">início</span>
        </div>
        <button
          onClick={handleDelete}
          className="w-5 h-5 rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="bg-white px-3 py-2.5 space-y-2.5 rounded-b-xl">
        {/* Tipo de entrada */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Tipo de entrada</label>
          <select
            value={config.entry_type ?? 'link_utm'}
            onChange={(e) => update({ entry_type: e.target.value })}
            className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            {ENTRY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* URL de ativação */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">URL de ativação</label>
          <div className="bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 flex items-center gap-1">
            <span className="text-xs text-gray-500 font-mono break-all leading-tight select-all">
              POST {activateUrl}
            </span>
          </div>
        </div>

        {/* Campos esperados */}
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Campos esperados</label>
          <div className="flex flex-wrap gap-1">
            {['nome', 'email', 'telefone', 'utm_source', 'utm_ad_id'].map((f) => (
              <span key={f} className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded font-mono">
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Source handle (output — bottom center) */}
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          width: 14,
          height: 14,
          background: 'white',
          border: `2.5px solid ${COLOR}`,
          borderRadius: '50%',
          bottom: -7,
        }}
      />
    </div>
  )
}
