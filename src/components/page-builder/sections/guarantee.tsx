'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface GuaranteeProps {
  days?: number
  title?: string
  text?: string
  sealColor?: string
  bgColor?: string
  textColor?: string
  paddingY?: number
}

export const Guarantee = ({
  days = 7,
  title = 'Garantia Incondicional de 7 Dias',
  text = 'Se por qualquer motivo você não ficar 100% satisfeito com o produto, basta nos enviar um e-mail em até 7 dias após a compra e devolveremos cada centavo do seu investimento. Sem perguntas, sem burocracia.',
  sealColor = '#16a34a',
  bgColor = '#f0fdf4',
  textColor = '#111827',
  paddingY = 48,
}: GuaranteeProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className="w-full px-6"
    >
      <div className="max-w-xl mx-auto">
        <div className="rounded-2xl border-2 p-8 text-center shadow-sm" style={{ borderColor: sealColor }}>
          <div className="flex justify-center mb-5">
            <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M50 8 L60.5 36.5 L91 36.5 L66.2 54.5 L76.8 83 L50 65 L23.2 83 L33.8 54.5 L9 36.5 L39.5 36.5 Z" stroke={sealColor} strokeWidth="2.5" fill="none" />
              <path d="M35 50 L45 62 L67 38" stroke={sealColor} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <text x="50" y="84" textAnchor="middle" fontSize="10" fontWeight="700" fill={sealColor}>{days} DIAS</text>
            </svg>
          </div>
          <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: textColor }}>{title}</h2>
          <p className="text-sm md:text-base leading-relaxed opacity-80" style={{ color: textColor }}>{text}</p>
        </div>
      </div>
    </div>
  )
}

export const GuaranteeSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as GuaranteeProps }))
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Dias de garantia</label>
        <input type="number" min={1} className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.days} onChange={(e) => setProp((p: GuaranteeProps) => { p.days = Number(e.target.value) })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Título</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.title} onChange={(e) => setProp((p: GuaranteeProps) => { p.title = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto da garantia</label>
        <textarea className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none" rows={4} value={props.text} onChange={(e) => setProp((p: GuaranteeProps) => { p.text = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do selo</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.sealColor} onChange={(e) => setProp((p: GuaranteeProps) => { p.sealColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: GuaranteeProps) => { p.bgColor = e.target.value })} />
      </div>
    </div>
  )
}

Guarantee.craft = {
  displayName: 'Garantia',
  props: { days: 7, title: 'Garantia Incondicional de 7 Dias', text: 'Se por qualquer motivo você não ficar 100% satisfeito com o produto, basta nos enviar um e-mail em até 7 dias após a compra e devolveremos cada centavo do seu investimento. Sem perguntas, sem burocracia.', sealColor: '#16a34a', bgColor: '#f0fdf4', textColor: '#111827', paddingY: 48 },
  related: { toolbar: GuaranteeSettings },
}