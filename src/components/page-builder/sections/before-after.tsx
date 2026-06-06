'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface BeforeAfterProps {
  title?: string
  leftTitle?: string
  rightTitle?: string
  leftItems?: string[]
  rightItems?: string[]
  bgColor?: string
  paddingY?: number
}

const DEFAULT_LEFT = ['Gasta horas tentando entender tráfego', 'Perde dinheiro com campanhas sem estratégia', 'Não sabe de onde vêm seus clientes', 'Trabalha muito e fatura pouco']
const DEFAULT_RIGHT = ['Domina tráfego pago em poucas semanas', 'Cada real investido gera retorno previsível', 'Rastreia cada lead do clique à compra', 'Escala seu negócio com método comprovado']

export const BeforeAfter = ({
  title = 'Veja a diferença',
  leftTitle = 'Sem o produto',
  rightTitle = 'Com o produto',
  leftItems = DEFAULT_LEFT,
  rightItems = DEFAULT_RIGHT,
  bgColor = '#ffffff',
  paddingY = 48,
}: BeforeAfterProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }} className="w-full px-6">
      <div className="max-w-4xl mx-auto">
        {title && <h2 className="text-2xl md:text-3xl font-bold text-center text-gray-900 mb-8">{title}</h2>}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 rounded-2xl overflow-hidden border border-red-200 shadow-sm">
            <div className="bg-red-500 px-5 py-4 text-center"><h3 className="text-white font-bold text-lg">{leftTitle}</h3></div>
            <div className="bg-red-50 px-5 py-4 space-y-3">
              {leftItems.map((item, idx) => <div key={idx} className="flex items-start gap-3"><span className="flex-shrink-0 text-lg mt-0.5">❌</span><span className="text-sm text-red-900 leading-relaxed">{item}</span></div>)}
            </div>
          </div>
          <div className="flex-1 rounded-2xl overflow-hidden border border-green-200 shadow-sm">
            <div className="bg-green-600 px-5 py-4 text-center"><h3 className="text-white font-bold text-lg">{rightTitle}</h3></div>
            <div className="bg-green-50 px-5 py-4 space-y-3">
              {rightItems.map((item, idx) => <div key={idx} className="flex items-start gap-3"><span className="flex-shrink-0 text-lg mt-0.5">✅</span><span className="text-sm text-green-900 leading-relaxed">{item}</span></div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const BeforeAfterSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as BeforeAfterProps }))
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Título</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.title} onChange={(e) => setProp((p: BeforeAfterProps) => { p.title = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Título coluna esquerda</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.leftTitle} onChange={(e) => setProp((p: BeforeAfterProps) => { p.leftTitle = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Itens do Antes (um por linha)</label><textarea className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none" rows={4} value={(props.leftItems ?? DEFAULT_LEFT).join('\n')} onChange={(e) => setProp((p: BeforeAfterProps) => { p.leftItems = e.target.value.split('\n') })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Título coluna direita</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.rightTitle} onChange={(e) => setProp((p: BeforeAfterProps) => { p.rightTitle = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Itens do Depois (um por linha)</label><textarea className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none" rows={4} value={(props.rightItems ?? DEFAULT_RIGHT).join('\n')} onChange={(e) => setProp((p: BeforeAfterProps) => { p.rightItems = e.target.value.split('\n') })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: BeforeAfterProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

BeforeAfter.craft = {
  displayName: 'Antes e Depois',
  props: { title: 'Veja a diferença', leftTitle: 'Sem o produto', rightTitle: 'Com o produto', leftItems: DEFAULT_LEFT, rightItems: DEFAULT_RIGHT, bgColor: '#ffffff', paddingY: 48 },
  related: { toolbar: BeforeAfterSettings },
}