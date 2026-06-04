'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface VslTimedProps {
  videoUrl?: string
  headline?: string
  btnText?: string
  btnColor?: string
  btnLink?: string
  showAfterSeconds?: number
  bgColor?: string
  paddingY?: number
}

export const VslTimed = ({
  videoUrl = '',
  headline = 'Assista até o final e receba um bônus especial',
  btnText = 'Quero Aproveitar Esta Oferta →',
  btnColor = '#16A34A',
  btnLink = '#comprar',
  showAfterSeconds = 30,
  bgColor = '#0F172A',
  paddingY = 60,
}: VslTimedProps) => {
  const { connectors: { connect, drag } } = useNode()

  function getEmbedUrl(url: string) {
    if (!url) return ''
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/)
    if (yt) return `https://www.youtube.com/embed/${yt[1]}`
    const vimeo = url.match(/vimeo\.com\/(\d+)/)
    if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`
    return url
  }

  const embedUrl = getEmbedUrl(videoUrl)

  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className="w-full px-6"
    >
      <div className="max-w-3xl mx-auto">
        {headline && <h2 className="text-2xl font-bold text-white text-center mb-6">{headline}</h2>}
        {embedUrl ? (
          <div className="aspect-video rounded-xl overflow-hidden shadow-2xl mb-6">
            <iframe src={embedUrl} className="w-full h-full" allowFullScreen title="VSL" />
          </div>
        ) : (
          <div className="aspect-video rounded-xl bg-gray-800 flex items-center justify-center mb-6">
            <p className="text-gray-400 text-sm">Cole a URL do vídeo no painel</p>
          </div>
        )}
        <div className="text-center">
          <p className="text-gray-400 text-sm mb-4">Botão aparece após {showAfterSeconds}s de vídeo</p>
          <a href={btnLink} style={{ backgroundColor: btnColor }} className="inline-block px-10 py-5 text-white font-bold rounded-xl text-xl shadow-xl">{btnText}</a>
        </div>
      </div>
    </div>
  )
}

export const VslTimedSettings = () => {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props as VslTimedProps }))
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">URL do vídeo</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" placeholder="https://youtube.com/watch?v=..." value={props.videoUrl} onChange={(e) => setProp((p: VslTimedProps) => { p.videoUrl = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Headline</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.headline} onChange={(e) => setProp((p: VslTimedProps) => { p.headline = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Texto do botão CTA</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.btnText} onChange={(e) => setProp((p: VslTimedProps) => { p.btnText = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Link do botão</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.btnLink} onChange={(e) => setProp((p: VslTimedProps) => { p.btnLink = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor do botão</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.btnColor} onChange={(e) => setProp((p: VslTimedProps) => { p.btnColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Mostrar botão após (segundos)</label><input type="number" className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.showAfterSeconds} onChange={(e) => setProp((p: VslTimedProps) => { p.showAfterSeconds = Number(e.target.value) })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: VslTimedProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

VslTimed.craft = {
  displayName: 'VSL com Botão Temporizado',
  props: { videoUrl: '', headline: 'Assista até o final e receba um bônus especial', btnText: 'Quero Aproveitar Esta Oferta →', btnColor: '#16A34A', btnLink: '#comprar', showAfterSeconds: 30, bgColor: '#0F172A', paddingY: 60 },
  related: { toolbar: VslTimedSettings },
}
