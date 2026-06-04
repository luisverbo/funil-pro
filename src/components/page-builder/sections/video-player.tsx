'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface VideoPlayerProps {
  videoUrl?: string
  caption?: string
  bgColor?: string
  paddingY?: number
  aspectRatio?: '16/9' | '9/16' | '4/3'
}

export const VideoPlayer = ({
  videoUrl = '',
  caption = '',
  bgColor = '#0F172A',
  paddingY = 40,
  aspectRatio = '16/9',
}: VideoPlayerProps) => {
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
  const ratioMap: Record<string, string> = { '16/9': 'aspect-video', '9/16': 'aspect-[9/16]', '4/3': 'aspect-[4/3]' }

  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className="w-full px-6"
    >
      <div className="max-w-3xl mx-auto">
        {embedUrl ? (
          <div className={`${ratioMap[aspectRatio]} rounded-xl overflow-hidden shadow-2xl`}>
            <iframe src={embedUrl} className="w-full h-full" allowFullScreen title="Video" />
          </div>
        ) : (
          <div className={`${ratioMap[aspectRatio]} rounded-xl bg-gray-800 flex items-center justify-center`}>
            <div className="text-center text-gray-400">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-16 h-16 mx-auto mb-3 opacity-40">
                <path d="M8 6.82v10.36c0 .79.87 1.27 1.54.84l8.14-5.18c.62-.39.62-1.29 0-1.69L9.54 5.98C8.87 5.55 8 6.03 8 6.82z"/>
              </svg>
              <p className="text-sm">Cole a URL do vídeo no painel</p>
            </div>
          </div>
        )}
        {caption && <p className="text-center text-gray-400 text-sm mt-3">{caption}</p>}
      </div>
    </div>
  )
}

export const VideoPlayerSettings = () => {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props as VideoPlayerProps }))
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">URL do vídeo (YouTube ou Vimeo)</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" placeholder="https://youtube.com/watch?v=..." value={props.videoUrl} onChange={(e) => setProp((p: VideoPlayerProps) => { p.videoUrl = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Legenda (opcional)</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.caption} onChange={(e) => setProp((p: VideoPlayerProps) => { p.caption = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Proporção</label><select className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.aspectRatio} onChange={(e) => setProp((p: VideoPlayerProps) => { p.aspectRatio = e.target.value as VideoPlayerProps['aspectRatio'] })}><option value="16/9">16:9 (Padrão)</option><option value="9/16">9:16 (Vertical)</option><option value="4/3">4:3 (Clássico)</option></select></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: VideoPlayerProps) => { p.bgColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Espaçamento vertical (px)</label><input type="number" className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.paddingY} onChange={(e) => setProp((p: VideoPlayerProps) => { p.paddingY = Number(e.target.value) })} /></div>
    </div>
  )
}

VideoPlayer.craft = {
  displayName: 'Player de Vídeo',
  props: { videoUrl: '', caption: '', bgColor: '#0F172A', paddingY: 40, aspectRatio: '16/9' },
  related: { toolbar: VideoPlayerSettings },
}
