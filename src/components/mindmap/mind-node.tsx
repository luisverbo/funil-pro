'use client'

import React, { memo, useEffect, useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { BranchColor, MindLevel, MindShape } from '@/lib/mindmap/types'

export interface MindNodeData extends Record<string, unknown> {
  label: string
  note?: string
  icon?: string
  imageUrl?: string
  linkUrl?: string
  shape: MindShape
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontSize?: 'sm' | 'md' | 'lg'
  textColor?: string
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
const LEVEL_STYLE: Record<MindLevel, { pad: string; text: string; minW: number }> = {
  0: { pad: 'px-6 py-4',   text: 'text-lg',      minW: 180 },
  1: { pad: 'px-5 py-3',   text: 'text-[15px]',  minW: 150 },
  2: { pad: 'px-4 py-2.5', text: 'text-[13px]',  minW: 120 },
}
const SIZE_CLASS = { sm: 'text-[12px]', md: '', lg: 'text-xl' }

/** Estilo visual conforme a forma escolhida */
function shapeStyle(shape: MindShape, color: BranchColor, level: MindLevel): { style: React.CSSProperties; radius: string } {
  const filled = level < 2   // raiz e ramo principal preenchidos no modo sólido
  switch (shape) {
    case 'outline':
      return { style: { background: '#ffffff', color: color.text, border: `2px solid ${color.solid}` }, radius: 'rounded-2xl' }
    case 'pill':
      return {
        style: filled
          ? { background: color.solid, color: '#fff', border: `2px solid ${color.solid}` }
          : { background: color.soft, color: color.text, border: `2px solid ${color.border}` },
        radius: 'rounded-full',
      }
    case 'sharp':
      return {
        style: filled
          ? { background: color.solid, color: '#fff', border: `2px solid ${color.solid}` }
          : { background: color.soft, color: color.text, border: `2px solid ${color.border}` },
        radius: 'rounded-[4px]',
      }
    case 'underline':
      return { style: { background: 'transparent', color: color.text, borderBottom: `3px solid ${color.solid}` }, radius: 'rounded-none' }
    case 'plain':
      return { style: { background: 'transparent', color: color.text, border: '2px solid transparent' }, radius: 'rounded-xl' }
    case 'solid':
    default:
      return {
        style: filled
          ? { background: color.solid, color: '#fff', border: `2px solid ${color.solid}` }
          : { background: color.soft, color: color.text, border: `2px solid ${color.border}` },
        radius: level === 0 ? 'rounded-[22px]' : level === 1 ? 'rounded-2xl' : 'rounded-xl',
      }
  }
}

function MindNodeComponent({ data, selected }: NodeProps) {
  const d = data as MindNodeData
  const lv = LEVEL_STYLE[d.level]
  const { style, radius } = shapeStyle(d.shape ?? 'solid', d.color, d.level)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxed = d.shape !== 'plain' && d.shape !== 'underline'

  useEffect(() => {
    if (d.editing) { inputRef.current?.focus(); inputRef.current?.select() }
  }, [d.editing])

  const textCls = [
    SIZE_CLASS[d.fontSize ?? 'md'] || lv.text,
    d.bold === false ? 'font-normal' : d.level === 0 ? 'font-bold' : d.level === 1 ? 'font-semibold' : 'font-medium',
    d.bold ? 'font-extrabold' : '',
    d.italic ? 'italic' : '',
    d.underline ? 'underline' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="group relative" style={{ minWidth: lv.minW, maxWidth: 260 }}>
      <Handle type="target" position={Position.Left} className="!opacity-0 !w-2 !h-2 !border-0" />

      <div
        className={`${boxed ? lv.pad : 'px-2 py-1'} ${radius} ${boxed ? 'shadow-sm' : ''} transition-all duration-150 motion-reduce:transition-none
          ${selected ? 'ring-2 ring-offset-2 ring-indigo-400 shadow-lg' : boxed ? 'hover:shadow-md' : ''}`}
        style={{ ...style, ...(d.textColor ? { color: d.textColor } : {}) }}
        onDoubleClick={e => { e.stopPropagation(); d.onStartEdit() }}
        aria-label={d.label || 'Nó do mapa mental'}
      >
        {d.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.imageUrl} alt="" className="w-full max-h-28 object-cover rounded-lg mb-2" draggable={false} />
        )}
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
              className={`${textCls} bg-transparent outline-none border-b border-current/40 min-w-[80px] w-full`}
              style={{ color: 'inherit' }}
            />
          ) : (
            <span className={`${textCls} whitespace-pre-wrap break-words`}>{d.label || 'Sem título'}</span>
          )}
          {d.linkUrl && (
            <a href={d.linkUrl} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title={d.linkUrl} aria-label="Abrir link"
              className="shrink-0 opacity-70 hover:opacity-100 transition-opacity">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.5 1.5" />
                <path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.5-1.5" />
              </svg>
            </a>
          )}
        </div>
        {d.note && (
          <p className="mt-1 text-[11px] leading-snug opacity-75">{d.note}</p>
        )}
      </div>

      {/* Controles centralizados na lateral direita: [+] adicionar · [−] recolher */}
      <div className="absolute top-1/2 -translate-y-1/2 left-full ml-2 flex items-center gap-1">
        <button
          onClick={e => { e.stopPropagation(); d.onAddChild() }}
          title="Adicionar item (Tab)"
          aria-label="Adicionar item filho"
          className="w-6 h-6 rounded-full text-white text-sm leading-none shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all hover:scale-110 motion-reduce:transition-none"
          style={{ background: d.color.solid }}
        >
          +
        </button>
        {d.childCount > 0 && (
          <button
            onClick={e => { e.stopPropagation(); d.onToggleCollapse() }}
            title={d.collapsed ? `Mostrar ${d.childCount} item(ns)` : 'Recolher ramo'}
            aria-label={d.collapsed ? `Expandir ${d.childCount} itens` : 'Recolher ramo'}
            className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shadow transition-all hover:scale-110 motion-reduce:transition-none
              ${d.collapsed ? 'text-white' : 'bg-white border border-gray-300 text-gray-500 opacity-0 group-hover:opacity-100'}`}
            style={d.collapsed ? { background: d.color.solid } : undefined}
          >
            {d.collapsed ? d.childCount : '−'}
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!opacity-0 !w-2 !h-2 !border-0" />
    </div>
  )
}

export const MindNodeView = memo(MindNodeComponent)
