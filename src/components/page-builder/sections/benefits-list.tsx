'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface BenefitsListProps {
  title?: string
  items?: string[]
  iconColor?: string
  bgColor?: string
  paddingY?: number
}

const defaultItems = [
  'Benefício principal do seu produto ou serviço',
  'Segundo benefício importante para o cliente',
  'Terceiro diferencial que resolve a dor dele',
  'Garantia ou bônus que aumenta o valor percebido',
]

export const BenefitsList = ({
  title = 'O que você vai conseguir:',
  items = defaultItems,
  iconColor = '#6366F1',
  bgColor = '#F8FAFC',
  paddingY = 60,
}: BenefitsListProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className="w-full px-6"
    >
      <div className="max-w-2xl mx-auto">
        {title && <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">{title}</h2>}
        <ul className="space-y-4">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 shrink-0 mt-0.5" style={{ color: iconColor }}>
                <circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" />
                <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-gray-700 text-lg">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export const BenefitsListSettings = () => {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props as BenefitsListProps }))
  const items = props.items ?? defaultItems
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Título</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.title} onChange={(e) => setProp((p: BenefitsListProps) => { p.title = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Benefícios (um por linha)</label>
        <textarea
          className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none"
          rows={6}
          value={items.join('\n')}
          onChange={(e) => setProp((p: BenefitsListProps) => { p.items = e.target.value.split('\n') })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do ícone</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.iconColor} onChange={(e) => setProp((p: BenefitsListProps) => { p.iconColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: BenefitsListProps) => { p.bgColor = e.target.value })} />
      </div>
    </div>
  )
}

BenefitsList.craft = {
  displayName: 'Lista de Benefícios',
  props: { title: 'O que você vai conseguir:', items: defaultItems, iconColor: '#6366F1', bgColor: '#F8FAFC', paddingY: 60 },
  related: { toolbar: BenefitsListSettings },
}
