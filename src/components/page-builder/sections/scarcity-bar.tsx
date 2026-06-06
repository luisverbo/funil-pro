'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface ScarcityBarProps {
  text?: string
  filledPercent?: number
  barColor?: string
  bgColor?: string
  textColor?: string
  paddingY?: number
}

export const ScarcityBar = ({
  text = 'Restam apenas 13 vagas',
  filledPercent = 87,
  barColor = '#ef4444',
  bgColor = '#fff',
  textColor = '#111827',
  paddingY = 32,
}: ScarcityBarProps) => {
  const { connectors: { connect, drag } } = useNode()
  const clamped = Math.min(100, Math.max(0, filledPercent))
  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className="w-full px-6"
    >
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <p className="font-semibold text-base md:text-lg" style={{ color: textColor }}>{text}</p>
          <span className="text-sm font-bold px-3 py-1 rounded-full text-white" style={{ backgroundColor: barColor }}>{clamped}% preenchido</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-5 overflow-hidden">
          <div className="h-5 rounded-full transition-all duration-500" style={{ width: `${clamped}%`, backgroundColor: barColor }} />
        </div>
        <p className="text-xs mt-2 text-right opacity-60" style={{ color: textColor }}>Apenas {100 - clamped}% das vagas restantes</p>
      </div>
    </div>
  )
}

export const ScarcityBarSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as ScarcityBarProps }))
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.text} onChange={(e) => setProp((p: ScarcityBarProps) => { p.text = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Porcentagem preenchida ({props.filledPercent}%)</label>
        <input type="range" min={0} max={100} className="w-full" value={props.filledPercent} onChange={(e) => setProp((p: ScarcityBarProps) => { p.filledPercent = Number(e.target.value) })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor da barra</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.barColor} onChange={(e) => setProp((p: ScarcityBarProps) => { p.barColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: ScarcityBarProps) => { p.bgColor = e.target.value })} />
      </div>
    </div>
  )
}

ScarcityBar.craft = {
  displayName: 'Vagas Limitadas',
  props: { text: 'Restam apenas 13 vagas', filledPercent: 87, barColor: '#ef4444', bgColor: '#fff', textColor: '#111827', paddingY: 32 },
  related: { toolbar: ScarcityBarSettings },
}