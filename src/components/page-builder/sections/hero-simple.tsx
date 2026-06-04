'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface HeroSimpleProps {
  headline?: string
  subheadline?: string
  ctaText?: string
  ctaColor?: string
  ctaLink?: string
  align?: 'center' | 'left'
  bgColor?: string
  paddingY?: number
}

export const HeroSimple = ({
  headline = 'Sua headline poderosa aqui',
  subheadline = 'Seu subtítulo explicando o benefício principal',
  ctaText = 'Quero Começar Agora →',
  ctaColor = '#6366F1',
  ctaLink = '#form',
  align = 'center',
  bgColor = '#ffffff',
  paddingY = 80,
}: HeroSimpleProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className={`w-full px-6 ${align === 'center' ? 'text-center' : 'text-left'}`}
    >
      <div className="max-w-3xl mx-auto">
        <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4 leading-tight">{headline}</h1>
        <p className="text-xl text-gray-600 mb-8">{subheadline}</p>
        {ctaText && (
          <a href={ctaLink} style={{ backgroundColor: ctaColor }} className="inline-block px-8 py-4 text-white font-bold rounded-xl text-lg shadow-lg hover:opacity-90 transition-opacity">
            {ctaText}
          </a>
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
    headline: 'Sua headline poderosa aqui',
    subheadline: 'Seu subtítulo explicando o benefício principal',
    ctaText: 'Quero Começar Agora →',
    ctaColor: '#6366F1',
    ctaLink: '#form',
    align: 'center',
    bgColor: '#ffffff',
    paddingY: 80,
  },
  related: {
    toolbar: HeroSimpleSettings,
  },
}
