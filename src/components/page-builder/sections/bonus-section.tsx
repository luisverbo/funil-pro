'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface BonusItem { emoji: string; name: string; originalValue: string; description: string }
interface BonusSectionProps { title?: string; items?: BonusItem[]; bgColor?: string; textColor?: string; paddingY?: number }

const DEFAULT_ITEMS: BonusItem[] = [
  { emoji: '📚', name: 'Bônus 1: Guia Completo de Scripts', originalValue: 'R$ 297', description: 'Templates prontos para WhatsApp e email que convertem.' },
  { emoji: '🎯', name: 'Bônus 2: Planilha de ROI', originalValue: 'R$ 197', description: 'Calcule seu retorno sobre investimento automaticamente.' },
  { emoji: '🚀', name: 'Bônus 3: Acesso ao Grupo VIP', originalValue: 'R$ 397', description: 'Comunidade exclusiva com suporte direto por 6 meses.' },
]

export const BonusSection = ({
  title = 'Você também recebe:',
  items = DEFAULT_ITEMS,
  bgColor = '#fffbeb',
  textColor = '#111827',
  paddingY = 48,
}: BonusSectionProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY, color: textColor }} className="w-full px-4 md:px-8">
      <div className="max-w-2xl mx-auto">
        {title && <h2 className="text-2xl md:text-3xl font-bold text-center mb-8">{title}</h2>}
        <div className="space-y-4">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-4 bg-white rounded-2xl p-5 border border-yellow-200 shadow-sm">
              <span className="text-3xl shrink-0">{item.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <p className="font-bold text-base">{item.name}</p>
                  <div className="text-right shrink-0">
                    <span className="text-xs text-gray-400 line-through block">De {item.originalValue}</span>
                    <span className="text-sm font-bold text-green-600">GRÁTIS</span>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mt-1">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export const BonusSectionSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as BonusSectionProps }))
  const items = props.items ?? DEFAULT_ITEMS
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Título</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.title} onChange={(e) => setProp((p: BonusSectionProps) => { p.title = e.target.value })} /></div>
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-500">Bônus</label>
        {items.map((item, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-2 space-y-1">
            <div className="flex gap-1">
              <input className="w-14 border border-gray-200 rounded p-1 text-sm text-center" value={item.emoji} onChange={(e) => setProp((p: BonusSectionProps) => { if (p.items) p.items[i].emoji = e.target.value })} />
              <input className="flex-1 border border-gray-200 rounded p-1 text-sm" placeholder="Nome" value={item.name} onChange={(e) => setProp((p: BonusSectionProps) => { if (p.items) p.items[i].name = e.target.value })} />
            </div>
            <input className="w-full border border-gray-200 rounded p-1 text-sm" placeholder="Valor (ex: R$ 297)" value={item.originalValue} onChange={(e) => setProp((p: BonusSectionProps) => { if (p.items) p.items[i].originalValue = e.target.value })} />
            <input className="w-full border border-gray-200 rounded p-1 text-sm" placeholder="Descrição" value={item.description} onChange={(e) => setProp((p: BonusSectionProps) => { if (p.items) p.items[i].description = e.target.value })} />
            <button onClick={() => setProp((p: BonusSectionProps) => { p.items = (p.items ?? []).filter((_, idx) => idx !== i) })} className="text-xs text-red-400">Remover</button>
          </div>
        ))}
        <button onClick={() => setProp((p: BonusSectionProps) => { p.items = [...(p.items ?? []), { emoji: '🎁', name: 'Novo Bônus', originalValue: 'R$ 197', description: 'Descrição do bônus.' }] })} className="w-full py-1.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500">+ Adicionar bônus</button>
      </div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: BonusSectionProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

BonusSection.craft = {
  displayName: 'Seção de Bônus',
  props: { title: 'Você também recebe:', items: DEFAULT_ITEMS, bgColor: '#fffbeb', textColor: '#111827', paddingY: 48 },
  related: { toolbar: BonusSectionSettings },
}