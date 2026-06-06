'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface FullwidthBannerProps { imageUrl?: string; overlayColor?: string; overlayOpacity?: number; text?: string; textColor?: string; heightPx?: number; bgColor?: string }

export const FullwidthBanner = ({
  imageUrl = '', overlayColor = '#000000', overlayOpacity = 0.4,
  text = '', textColor = '#ffffff', heightPx = 400, bgColor = '#1f2937',
}: FullwidthBannerProps) => {
  const { connectors: { connect, drag } } = useNode()
  const hex2rgb = (hex: string) => { const r = parseInt(hex.slice(1, 3), 16); const g = parseInt(hex.slice(3, 5), 16); const b = parseInt(hex.slice(5, 7), 16); return `${r}, ${g}, ${b}` }
  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ height: `${heightPx}px`, backgroundColor: bgColor, backgroundImage: imageUrl ? `url(${imageUrl})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      className="w-full overflow-hidden"
    >
      {(imageUrl || overlayOpacity > 0) && <div style={{ position: 'absolute', inset: 0, backgroundColor: `rgba(${hex2rgb(overlayColor)}, ${overlayOpacity})` }} />}
      {text && <p style={{ color: textColor, position: 'relative', zIndex: 1 }} className="text-2xl md:text-4xl font-bold text-center px-8">{text}</p>}
      {!imageUrl && !text && <p className="text-gray-400 text-sm relative z-10">Configure a imagem no painel de propriedades</p>}
    </div>
  )
}

export const FullwidthBannerSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as FullwidthBannerProps }))
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">URL da imagem de fundo</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" placeholder="https://..." value={props.imageUrl} onChange={(e) => setProp((p: FullwidthBannerProps) => { p.imageUrl = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Altura (px)</label><input type="number" className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.heightPx} onChange={(e) => setProp((p: FullwidthBannerProps) => { p.heightPx = Number(e.target.value) })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Texto sobreposto</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.text} onChange={(e) => setProp((p: FullwidthBannerProps) => { p.text = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor do overlay</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.overlayColor} onChange={(e) => setProp((p: FullwidthBannerProps) => { p.overlayColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Opacidade ({Math.round((props.overlayOpacity ?? 0.4) * 100)}%)</label><input type="range" min={0} max={1} step={0.05} className="w-full" value={props.overlayOpacity} onChange={(e) => setProp((p: FullwidthBannerProps) => { p.overlayOpacity = Number(e.target.value) })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor do texto</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.textColor} onChange={(e) => setProp((p: FullwidthBannerProps) => { p.textColor = e.target.value })} /></div>
    </div>
  )
}

FullwidthBanner.craft = {
  displayName: 'Banner Fullwidth',
  props: { imageUrl: '', overlayColor: '#000000', overlayOpacity: 0.4, text: '', textColor: '#ffffff', heightPx: 400, bgColor: '#1f2937' },
  related: { toolbar: FullwidthBannerSettings },
}