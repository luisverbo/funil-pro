'use client'

import React, { memo, useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { BranchColor, MindLevel } from '@/lib/mindmap/types'

export interface MindNodeData extends Record<string, unknown> {
  label: string
  note?: string
  icon?: string
  level: MindLevel
  color: BranchColor
  childCount: number
  collapsed: boolean
  editing: boolean
  onStartEdit: () => void
  onCommitEdit: (label: string) => void
  onAddChild: () => void
  onToggleCollapse: () => void
}

// Hierarquia visual: raiz forte, ramo médio, descendente leve
const LEVEL_STYLE: Record<MindLevel, { pad: string; text: string; radius: string; minW: number }> = {
  0: { pad: 'px-6 py-4', text: 'text-lg font-bold',      radius: 'rounded-[22px]', minW: 180 },
  1: { pad: 'px-5 py-3', text: 'text-[15px] font-semibold', radius: 'rounded-2xl',  minW: 150 },
  2: { pad: 'px-4 py-2.5', text: 'text-[13px] font-medium', radius: 'rounded-xl',   minW: 120 },
}

function MindNodeComponent({ data, selected }: NodeProps) {
  const d = data as MindNodeData
  const st = LEVEL_STYLE[d.level]
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (d.editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [d.editing])

  // Raiz e ramo principal: fundo sólido da cor. Descendentes: fundo suave.
  const solid = d.level < 2
  const style: React.CSSProperties = solid
    ? { background: d.color.solid, color: '#ffffff', border: `2px solid ${d.color.solid}` }
    : { background: d.color.soft, color: d.color.text, border: `2px solid ${d.color.border}` }

  return (
    <div className="group relative" style={{ minWidth: st.minW }}>
      <Handle type="target" position={Position.Left} className="!opacity-0 !w-2 !h-2 !border-0" />

      <div
        className={`${st.pad} ${st.radius} shadow-sm transition-all duration-150 motion-reduce:transition-none
          ${selected ? 'ring-2 ring-offset-2 ring-indigo-400 shadow-lg' : 'hover:shadow-md'}`}
        style={style}
        onDoubleClick={e => { e.stopPropagation(); d.onStartEdit() }}
        aria-label={d.label || 'Nó do mapa mental'}
      >
        <div className="flex items-center gap-2">
          {d.icon && <span className="text-lg leading-none shrink-0">{d.icon}</span>}
          {d.editing ? (
            <input
              ref={inputRef}
              defaultValue={d.label}
              onBlur={e => d.onCommitEdit(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation()
                if (e.key === 'Enter') { e.preventDefault(); d.onCommitEdit((e.target as HTMLInputElement).value) }
                if (e.key === 'Escape') { e.preventDefault(); d.onCommitEdit(d.label) }
              }}
              className={`${st.text} bg-transparent outline-none border-b border-current/40 min-w-[80px] w-full`}
              style={{ color: 'inherit' }}
            />
          ) : (
            <span className={`${st.text} whitespace-pre-wrap break-words`}>{d.label || 'Sem título'}</span>
          )}
        </div>
        {d.note && (
          <p className={`mt-1 text-[11px] leading-snug ${solid ? 'text-white/80' : 'opacity-70'}`}>{d.note}</p>
        )}
      </div>

      {/* Badge de filhos ocultos (colapsado) */}
      {d.collapsed && d.childCount > 0 && (
        <button
          onClick={e => { e.stopPropagation(); d.onToggleCollapse() }}
          title={`Mostrar ${d.childCount} item(ns)`}
          aria-label={`Expandir ${d.childCount} itens ocultos`}
          className="absolute -right-2.5 top-1/2 -translate-y-1/2 translate-x-full w-6 h-6 rounded-full text-[11px] font-bold text-white shadow flex items-center justify-center transition-transform hover:scale-110"
          style={{ background: d.color.solid }}
        >
          {d.childCount}
        </button>
      )}

      {/* Botão de colapsar (quando expandido e com filhos) */}
      {!d.collapsed && d.childCount > 0 && (
        <button
          onClick={e => { e.stopPropagation(); d.onToggleCollapse() }}
          title="Recolher ramo"
          aria-label="Recolher ramo"
          className="absolute -right-2 top-1/2 -translate-y-1/2 translate-x-full w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-500 text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:text-gray-800"
        >
          −
        </button>
      )}

      {/* "+" para criar filho (aparece no hover) */}
      <button
        onClick={e => { e.stopPropagation(); d.onAddChild() }}
        title="Adicionar item (Tab)"
        aria-label="Adicionar item filho"
        className="absolute -right-3 -bottom-3 w-6 h-6 rounded-full text-white text-sm leading-none shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all hover:scale-110 motion-reduce:transition-none"
        style={{ background: d.color.solid }}
      >
        +
      </button>

      <Handle type="source" position={Position.Right} className="!opacity-0 !w-2 !h-2 !border-0" />
    </div>
  )
}

export const MindNodeView = memo(MindNodeComponent)
