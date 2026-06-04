'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface CtaButtonProps {
  text?: string
  subtext?: string
  btnColor?: string
  textColor?: string
  link?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  align?: 'center' | 'left' | 'right'
  bgColor?: string
  paddingY?: number
}

const sizeClasses: Record<string, string> = {
  sm: 'px-6 py-3 text-base',
  md: 'px-8 py-4 text-lg',
  lg: 'px-10 py-5 text-xl',
  xl: 'px-12 py-6 text-2xl',
}

export const CtaButton = ({
  text = 'Quero Garantir Minha Vaga Agora →',
  subtext = '✓ Acesso imediato  ✓ Garantia de 7 dias',
  btnColor = '#16A34A',
  textColor = '#ffffff',
  link = '#',
  size = 'lg',
  align = 'center',
  bgColor = '#ffffff',
  paddingY = 40,
}: CtaButtonProps) => {
  const { connectors: { connect, drag } } = useNode()
  const alignMap: Record<string, string> = { center: 'text-center', left: 'text-left', right: 'text-right' }
  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className={`w-full px-6 ${alignMap[align]}`}
    >
      <a href={link} style={{ backgroundColor: btnColor, color: textColor }} className={`inline-block font-bold rounded-xl shadow-xl ${sizeClasses[size]} hover:opacity-90 transition-opacity`}>{text}</a>
      {subtext && <p className="text-gray-500 text-sm mt-3">{subtext}</p>}
    </div>
  )
}

export const CtaButtonSettings = () => {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props as CtaButtonProps }))
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Texto do botão</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.text} onChange={(e) => setProp((p: CtaButtonProps) => { p.text = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Subtexto</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.subtext} onChange={(e) => setProp((p: CtaButtonProps) => { p.subtext = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Link</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.link} onChange={(e) => setProp((p: CtaButtonProps) => { p.link = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Tamanho</label><select className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.size} onChange={(e) => setProp((p: CtaButtonProps) => { p.size = e.target.value as CtaButtonProps['size'] })}><option value="sm">Pequeno</option><option value="md">Médio</option><option value="lg">Grande</option><option value="xl">Extra Grande</option></select></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Alinhamento</label><select className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.align} onChange={(e) => setProp((p: CtaButtonProps) => { p.align = e.target.value as CtaButtonProps['align'] })}><option value="center">Centro</option><option value="left">Esquerda</option><option value="right">Direita</option></select></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor do botão</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.btnColor} onChange={(e) => setProp((p: CtaButtonProps) => { p.btnColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: CtaButtonProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

CtaButton.craft = {
  displayName: 'Botão CTA',
  props: { text: 'Quero Garantir Minha Vaga Agora →', subtext: '✓ Acesso imediato  ✓ Garantia de 7 dias', btnColor: '#16A34A', textColor: '#ffffff', link: '#', size: 'lg', align: 'center', bgColor: '#ffffff', paddingY: 40 },
  related: { toolbar: CtaButtonSettings },
}
