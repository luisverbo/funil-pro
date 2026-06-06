'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface PartnerLogosProps { title?: string; logos?: string[]; grayscale?: boolean; bgColor?: string; textColor?: string; paddingY?: number }

export const PartnerLogos = ({
  title = 'Como visto em',
  logos = [],
  grayscale = true,
  bgColor = '#f8fafc',
  textColor = '#6b7280',
  paddingY = 40,
}: PartnerLogosProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY, color: textColor }} className="w-full px-4 md:px-8">
      <div className="max-w-4xl mx-auto">
        {title && <p className="text-sm font-semibold uppercase tracking-widest text-center mb-6 opacity-60">{title}</p>}
        {logos.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
            {logos.map((url, i) => <img key={i} src={url} alt={`Logo ${i + 1}`} className="h-10 md:h-12 object-contain" style={{ filter: grayscale ? 'grayscale(100%) opacity(0.6)' : 'none' }} />)}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-6">
            {[1, 2, 3, 4].map((i) => <div key={i} className="w-28 h-10 bg-gray-200 rounded-lg animate-pulse" />)}
          </div>
        )}
      </div>
    </div>
  )
}

export const PartnerLogosSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as PartnerLogosProps }))
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Título</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.title} onChange={(e) => setProp((p: PartnerLogosProps) => { p.title = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">URLs das logos (uma por linha)</label><textarea rows={5} className="w-full border border-gray-200 rounded-lg p-2 text-sm font-mono" placeholder="https://exemplo.com/logo.png" value={(props.logos ?? []).join('\n')} onChange={(e) => setProp((p: PartnerLogosProps) => { p.logos = e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })} /></div>
      <div className="flex items-center gap-2"><input type="checkbox" checked={props.grayscale ?? true} onChange={(e) => setProp((p: PartnerLogosProps) => { p.grayscale = e.target.checked })} /><label className="text-xs font-medium text-gray-500">Aplicar filtro cinza</label></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: PartnerLogosProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

PartnerLogos.craft = {
  displayName: 'Logos de Parceiros',
  props: { title: 'Como visto em', logos: [], grayscale: true, bgColor: '#f8fafc', textColor: '#6b7280', paddingY: 40 },
  related: { toolbar: PartnerLogosSettings },
}