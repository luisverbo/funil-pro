'use client'

import { useNode, useEditor, Element } from '@craftjs/core'
import React from 'react'

// ─── Colunas: layout lado a lado com canvases aninhados ──────────────────────
// Arraste QUALQUER seção pra dentro de cada coluna. No celular empilha.

interface ColumnProps { children?: React.ReactNode }

export const Column = ({ children }: ColumnProps) => {
  const { connectors: { connect } } = useNode()
  const { enabled } = useEditor((state) => ({ enabled: state.options.enabled }))
  const empty = React.Children.count(children) === 0
  return (
    <div ref={(ref) => { if (ref) connect(ref) }} className="flex-1 min-w-0">
      {empty && enabled ? (
        <div className="min-h-[90px] h-full border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center text-xs text-gray-400 select-none">
          solte uma seção aqui
        </div>
      ) : children}
    </div>
  )
}

Column.craft = {
  displayName: 'Coluna',
  rules: {
    // dentro da coluna só entram seções (não outra página inteira)
    canMoveIn: () => true,
  },
}

interface ColumnsProps {
  cols?: number
  gap?: number
  bgColor?: string
  paddingY?: number
  stackMobile?: boolean
  verticalAlign?: 'start' | 'center' | 'end'
}

export const Columns = ({
  cols = 2,
  gap = 24,
  bgColor = '#ffffff',
  paddingY = 24,
  stackMobile = true,
  verticalAlign = 'start',
}: ColumnsProps) => {
  const { connectors: { connect, drag } } = useNode()
  const count = Math.min(3, Math.max(2, cols))
  const alignCls = verticalAlign === 'center' ? 'md:items-center' : verticalAlign === 'end' ? 'md:items-end' : 'md:items-start'
  return (
    <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }} className="w-full px-6">
      <div className={`max-w-5xl mx-auto flex ${stackMobile ? 'flex-col md:flex-row' : 'flex-row'} ${alignCls}`} style={{ gap }}>
        <Element is={Column} id="col-0" canvas />
        <Element is={Column} id="col-1" canvas />
        {count >= 3 && <Element is={Column} id="col-2" canvas />}
      </div>
    </div>
  )
}

export const ColumnsSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as ColumnsProps }))
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Número de colunas</label>
        <select className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.cols ?? 2}
          onChange={(e) => setProp((p: ColumnsProps) => { p.cols = Number(e.target.value) })}>
          <option value={2}>2 colunas</option>
          <option value={3}>3 colunas</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Espaço entre colunas (px)</label>
        <input type="number" className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.gap ?? 24}
          onChange={(e) => setProp((p: ColumnsProps) => { p.gap = Number(e.target.value) })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Alinhamento vertical</label>
        <select className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.verticalAlign ?? 'start'}
          onChange={(e) => setProp((p: ColumnsProps) => { p.verticalAlign = e.target.value as ColumnsProps['verticalAlign'] })}>
          <option value="start">Topo</option>
          <option value="center">Centro</option>
          <option value="end">Base</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" checked={props.stackMobile ?? true} onChange={(e) => setProp((p: ColumnsProps) => { p.stackMobile = e.target.checked })} className="accent-indigo-600" />
        Empilhar no celular
      </label>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor ?? '#ffffff'}
          onChange={(e) => setProp((p: ColumnsProps) => { p.bgColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Espaçamento vertical (px)</label>
        <input type="number" className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.paddingY ?? 24}
          onChange={(e) => setProp((p: ColumnsProps) => { p.paddingY = Number(e.target.value) })} />
      </div>
    </div>
  )
}

Columns.craft = {
  displayName: 'Colunas',
  props: { cols: 2, gap: 24, bgColor: '#ffffff', paddingY: 24, stackMobile: true, verticalAlign: 'start' },
  related: { toolbar: ColumnsSettings },
}
