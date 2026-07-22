'use client'

import { useNode } from '@craftjs/core'
import React from 'react'
import { ImageInput } from '../image-input'

interface HeroSimpleProps {
  badge?: string
  headline?: string
  subheadline?: string
  ctaText?: string
  ctaSubtext?: string
  ctaColor?: string
  ctaLink?: string
  align?: 'center' | 'left'
  bgColor?: string
  bgGradient?: boolean
  bgGradientTo?: string
  textColor?: string
  paddingY?: number
  imageUrl?: string
}

export const HeroSimple = ({
  badge = '',
  headline = 'Sua headline poderosa aqui',
  subheadline = 'Seu subtítulo explicando o benefício principal',
  ctaText = 'Quero Começar Agora →',
  ctaSubtext = '',
  ctaColor = '#6366F1',
  ctaLink = '#form',
  align = 'center',
  bgColor = '#ffffff',
  bgGradient = false,
  bgGradientTo = '#6366F1',
  textColor = '',
  paddingY = 80,
  imageUrl = '',
}: HeroSimpleProps) => {
  const { connectors: { connect, drag } } = useNode()

  // Auto-detect light/dark background to set text color when not explicitly set
  const resolvedTextColor = textColor || (() => {
    const hex = bgColor.replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.5 ? '#111827' : '#ffffff'
  })()

  const subColor = textColor
    ? textColor + 'cc'
    : resolvedTextColor === '#ffffff' ? 'rgba(255,255,255,0.75)' : '#4b5563'

  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{
        background: bgGradient ? `linear-gradient(135deg, ${bgColor} 0%, ${bgGradientTo} 100%)` : bgColor,
        paddingTop: paddingY, paddingBottom: paddingY,
      }}
      className={`w-full px-6 ${align === 'center' ? 'text-center' : 'text-left'}`}
    >
      <div className="max-w-3xl mx-auto">
        {badge && (
          <span className="inline-block text-sm font-semibold px-4 py-1.5 rounded-full mb-5"
            style={{ backgroundColor: resolvedTextColor === '#ffffff' ? 'rgba(255,255,255,0.15)' : `${ctaColor}18`, color: resolvedTextColor === '#ffffff' ? '#ffffff' : ctaColor }}>
            {badge}
          </span>
        )}
        <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight" style={{ color: resolvedTextColor }}>{headline}</h1>
        <p className="text-xl mb-8" style={{ color: subColor }}>{subheadline}</p>
        {ctaText && (
          <a href={ctaLink} style={{ backgroundColor: ctaColor }} className="inline-block px-8 py-4 text-white font-bold rounded-xl text-lg shadow-lg hover:opacity-90 transition-opacity">
            {ctaText}
          </a>
        )}
        {ctaSubtext && (
          <p className="text-sm mt-3" style={{ color: subColor }}>{ctaSubtext}</p>
        )}
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="mt-10 w-full rounded-2xl shadow-2xl" />
        )}
      </div>
    </div>
  )
}

export const HeroSimpleSettings = () => {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props }))
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Selo (ex: 🔥 Vagas limitadas) — opcional</label>
        <input
          className="w-full border border-gray-200 rounded-lg p-2 text-sm"
          value={props.badge ?? ''}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.badge = e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Headline</label>
        <textarea
          className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none"
          rows={3}
          value={props.headline}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.headline = e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Subtítulo</label>
        <textarea
          className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none"
          rows={2}
          value={props.subheadline}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.subheadline = e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto do Botão</label>
        <input
          className="w-full border border-gray-200 rounded-lg p-2 text-sm"
          value={props.ctaText}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.ctaText = e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto pequeno abaixo do botão</label>
        <input
          className="w-full border border-gray-200 rounded-lg p-2 text-sm"
          placeholder="🔒 Pagamento seguro · Garantia de 7 dias"
          value={props.ctaSubtext ?? ''}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.ctaSubtext = e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Link do Botão</label>
        <input
          className="w-full border border-gray-200 rounded-lg p-2 text-sm"
          value={props.ctaLink}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.ctaLink = e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do Botão</label>
        <input
          type="color"
          className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer"
          value={props.ctaColor}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.ctaColor = e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor de Fundo</label>
        <input
          type="color"
          className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer"
          value={props.bgColor}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.bgColor = e.target.value })}
        />
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" checked={props.bgGradient ?? false} onChange={(e) => setProp((p: HeroSimpleProps) => { p.bgGradient = e.target.checked })} className="accent-indigo-600" />
        Fundo em gradiente
      </label>
      {props.bgGradient && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cor final do gradiente</label>
          <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgGradientTo ?? '#6366F1'} onChange={(e) => setProp((p: HeroSimpleProps) => { p.bgGradientTo = e.target.value })} />
        </div>
      )}
      <ImageInput label="Imagem do hero (mockup/foto abaixo do botão)" value={props.imageUrl} onChange={(url) => setProp((p: HeroSimpleProps) => { p.imageUrl = url })} />
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do Texto (deixe em branco para automático)</label>
        <div className="flex gap-2 items-center">
          <input
            type="color"
            className="h-9 w-16 border border-gray-200 rounded-lg cursor-pointer"
            value={props.textColor || '#111827'}
            onChange={(e) => setProp((p: HeroSimpleProps) => { p.textColor = e.target.value })}
          />
          <button
            className="text-xs text-gray-500 underline"
            onClick={() => setProp((p: HeroSimpleProps) => { p.textColor = '' })}
          >
            Automático
          </button>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Alinhamento</label>
        <select
          className="w-full border border-gray-200 rounded-lg p-2 text-sm"
          value={props.align}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.align = e.target.value as 'center' | 'left' })}
        >
          <option value="center">Centralizado</option>
          <option value="left">Esquerda</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Espaçamento vertical (px)</label>
        <input
          type="number"
          className="w-full border border-gray-200 rounded-lg p-2 text-sm"
          value={props.paddingY}
          onChange={(e) => setProp((p: HeroSimpleProps) => { p.paddingY = Number(e.target.value) })}
        />
      </div>
    </div>
  )
}

HeroSimple.craft = {
  displayName: 'Hero Simples',
  props: {
    badge: '',
    headline: 'Sua headline poderosa aqui',
    subheadline: 'Seu subtítulo explicando o benefício principal',
    ctaText: 'Quero Começar Agora →',
    ctaSubtext: '',
    ctaColor: '#6366F1',
    ctaLink: '#form',
    align: 'center',
    bgColor: '#ffffff',
    bgGradient: false,
    bgGradientTo: '#6366F1',
    textColor: '',
    paddingY: 80,
    imageUrl: '',
  },
  related: {
    toolbar: HeroSimpleSettings,
  },
}
