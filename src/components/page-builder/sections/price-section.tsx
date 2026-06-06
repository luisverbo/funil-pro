'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface PriceSectionProps {
  fromPrice?: string; mainPrice?: string; installments?: string; description?: string
  ctaText?: string; ctaLink?: string; ctaColor?: string; badge?: string
  bgColor?: string; textColor?: string; paddingY?: number
}

export const PriceSection = ({
  fromPrice = 'R$ 497', mainPrice = 'R$ 197', installments = 'ou 12x de R$ 18,97',
  description = 'Acesso vitalício + todas as atualizações + suporte por 12 meses',
  ctaText = 'Garantir Acesso Agora →', ctaLink = '#', ctaColor = '#16a34a',
  badge = 'Oferta por tempo limitado', bgColor = '#ffffff', textColor = '#111827', paddingY = 64,
}: PriceSectionProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY, color: textColor }} className="w-full px-4 md:px-8">
      <div className="max-w-md mx-auto">
        <div className="rounded-3xl border-2 border-gray-200 shadow-xl p-8 text-center bg-white">
          {badge && <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-bold px-4 py-1.5 rounded-full mb-6 uppercase tracking-wide">{badge}</span>}
          {fromPrice && <p className="text-gray-400 line-through text-lg mb-1">De {fromPrice}</p>}
          <p style={{ color: ctaColor }} className="text-5xl md:text-6xl font-black mb-2">{mainPrice}</p>
          {installments && <p className="text-gray-500 text-sm mb-4">{installments}</p>}
          {description && <p className="text-gray-600 text-sm mb-8 leading-relaxed">{description}</p>}
          <a href={ctaLink} style={{ backgroundColor: ctaColor }} className="block w-full py-4 px-8 text-white font-bold rounded-xl text-lg shadow-lg hover:opacity-90 transition-opacity">{ctaText}</a>
          <p className="text-xs text-gray-400 mt-4">✓ Pagamento 100% seguro</p>
        </div>
      </div>
    </div>
  )
}

export const PriceSectionSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as PriceSectionProps }))
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Badge</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.badge} onChange={(e) => setProp((p: PriceSectionProps) => { p.badge = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Preço “De” (riscado)</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.fromPrice} onChange={(e) => setProp((p: PriceSectionProps) => { p.fromPrice = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Preço principal</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.mainPrice} onChange={(e) => setProp((p: PriceSectionProps) => { p.mainPrice = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Parcelamento</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.installments} onChange={(e) => setProp((p: PriceSectionProps) => { p.installments = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Descrição</label><textarea rows={2} className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.description} onChange={(e) => setProp((p: PriceSectionProps) => { p.description = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Texto do botão</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.ctaText} onChange={(e) => setProp((p: PriceSectionProps) => { p.ctaText = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Link do botão</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.ctaLink} onChange={(e) => setProp((p: PriceSectionProps) => { p.ctaLink = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor do botão</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.ctaColor} onChange={(e) => setProp((p: PriceSectionProps) => { p.ctaColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: PriceSectionProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

PriceSection.craft = {
  displayName: 'Seção de Preço',
  props: { fromPrice: 'R$ 497', mainPrice: 'R$ 197', installments: 'ou 12x de R$ 18,97', description: 'Acesso vitalício + todas as atualizações', ctaText: 'Garantir Acesso Agora →', ctaLink: '#', ctaColor: '#16a34a', badge: 'Oferta por tempo limitado', bgColor: '#ffffff', textColor: '#111827', paddingY: 64 },
  related: { toolbar: PriceSectionSettings },
}