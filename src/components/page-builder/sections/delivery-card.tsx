'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface DeliveryCardProps {
  headline?: string
  description?: string
  accessLink?: string
  accessLinkText?: string
  supportEmail?: string
  items?: string[]
  bgColor?: string
  cardColor?: string
  accentColor?: string
  paddingY?: number
}

const defaultItems = [
  'Acesso à área de membros por 12 meses',
  'Suporte por e-mail em até 24h úteis',
  'Bônus exclusivos liberados agora',
]

export const DeliveryCard = ({
  headline = 'Seu acesso está liberado! 🎉',
  description = 'Parabéns pela sua decisão! Clique abaixo para acessar todo o conteúdo que você adquiriu.',
  accessLink = '#',
  accessLinkText = 'Acessar meu conteúdo agora →',
  supportEmail = 'suporte@seudominio.com.br',
  items = defaultItems,
  bgColor = '#F0FDF4',
  cardColor = '#ffffff',
  accentColor = '#16A34A',
  paddingY = 60,
}: DeliveryCardProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className="w-full px-6"
    >
      <div className="max-w-lg mx-auto">
        <div style={{ backgroundColor: cardColor }} className="rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          <div style={{ backgroundColor: accentColor }} className="p-6 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-8 h-8"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-white">{headline}</h2>
          </div>
          <div className="p-6">
            <p className="text-gray-600 text-center mb-6">{description}</p>
            <ul className="space-y-3 mb-6">
              {items.map((item, i) => (
                <li key={i} className="flex items-center gap-3 text-gray-700">
                  <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 shrink-0" style={{ color: accentColor }}><circle cx="12" cy="12" r="10" fill="currentColor" opacity="0.15" /><path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  {item}
                </li>
              ))}
            </ul>
            <a href={accessLink} style={{ backgroundColor: accentColor }} className="block w-full text-center py-4 text-white font-bold rounded-xl text-lg shadow-lg mb-4">{accessLinkText}</a>
            {supportEmail && <p className="text-center text-gray-400 text-sm">Dúvidas? <a href={`mailto:${supportEmail}`} className="underline">{supportEmail}</a></p>}
          </div>
        </div>
      </div>
    </div>
  )
}

export const DeliveryCardSettings = () => {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props as DeliveryCardProps }))
  const items = props.items ?? defaultItems
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Headline</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.headline} onChange={(e) => setProp((p: DeliveryCardProps) => { p.headline = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Descrição</label><textarea className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none" rows={2} value={props.description} onChange={(e) => setProp((p: DeliveryCardProps) => { p.description = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Link de acesso</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.accessLink} onChange={(e) => setProp((p: DeliveryCardProps) => { p.accessLink = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Texto do link</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.accessLinkText} onChange={(e) => setProp((p: DeliveryCardProps) => { p.accessLinkText = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">E-mail de suporte</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.supportEmail} onChange={(e) => setProp((p: DeliveryCardProps) => { p.supportEmail = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Itens inclusos (um por linha)</label><textarea className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none" rows={4} value={items.join('\n')} onChange={(e) => setProp((p: DeliveryCardProps) => { p.items = e.target.value.split('\n') })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de destaque</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.accentColor} onChange={(e) => setProp((p: DeliveryCardProps) => { p.accentColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: DeliveryCardProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

DeliveryCard.craft = {
  displayName: 'Card de Entrega',
  props: { headline: 'Seu acesso está liberado! 🎉', description: 'Parabéns pela sua decisão!', accessLink: '#', accessLinkText: 'Acessar meu conteúdo agora →', supportEmail: 'suporte@seudominio.com.br', items: defaultItems, bgColor: '#F0FDF4', cardColor: '#ffffff', accentColor: '#16A34A', paddingY: 60 },
  related: { toolbar: DeliveryCardSettings },
}
