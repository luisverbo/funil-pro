'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface CaptureFormProps {
  title?: string
  namePlaceholder?: string
  emailPlaceholder?: string
  phonePlaceholder?: string
  showPhone?: boolean
  btnText?: string
  btnColor?: string
  bgColor?: string
  paddingY?: number
}

export const CaptureForm = ({
  title = 'Garanta sua vaga gratuita',
  namePlaceholder = 'Seu nome completo',
  emailPlaceholder = 'Seu melhor e-mail',
  phonePlaceholder = 'Seu WhatsApp',
  showPhone = true,
  btnText = 'Quero Participar Agora →',
  btnColor = '#6366F1',
  bgColor = '#F8FAFC',
  paddingY = 60,
}: CaptureFormProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className="w-full px-6"
    >
      <div className="max-w-md mx-auto">
        {title && <h2 className="text-2xl font-bold text-gray-900 text-center mb-6">{title}</h2>}
        <div className="space-y-3">
          <input type="text" placeholder={namePlaceholder} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-700 bg-white focus:outline-none" readOnly />
          <input type="email" placeholder={emailPlaceholder} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-700 bg-white focus:outline-none" readOnly />
          {showPhone && <input type="tel" placeholder={phonePlaceholder} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-700 bg-white focus:outline-none" readOnly />}
          <button style={{ backgroundColor: btnColor }} className="w-full py-4 text-white font-bold rounded-xl text-lg shadow-lg">{btnText}</button>
        </div>
      </div>
    </div>
  )
}

export const CaptureFormSettings = () => {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props as CaptureFormProps }))
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Título</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.title} onChange={(e) => setProp((p: CaptureFormProps) => { p.title = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Placeholder nome</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.namePlaceholder} onChange={(e) => setProp((p: CaptureFormProps) => { p.namePlaceholder = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Placeholder e-mail</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.emailPlaceholder} onChange={(e) => setProp((p: CaptureFormProps) => { p.emailPlaceholder = e.target.value })} /></div>
      <div className="flex items-center gap-2"><input type="checkbox" id="showPhone" checked={props.showPhone} onChange={(e) => setProp((p: CaptureFormProps) => { p.showPhone = e.target.checked })} /><label htmlFor="showPhone" className="text-xs font-medium text-gray-500">Mostrar campo telefone</label></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Placeholder telefone</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.phonePlaceholder} onChange={(e) => setProp((p: CaptureFormProps) => { p.phonePlaceholder = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Texto do botão</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.btnText} onChange={(e) => setProp((p: CaptureFormProps) => { p.btnText = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor do botão</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.btnColor} onChange={(e) => setProp((p: CaptureFormProps) => { p.btnColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: CaptureFormProps) => { p.bgColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Espaçamento vertical (px)</label><input type="number" className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.paddingY} onChange={(e) => setProp((p: CaptureFormProps) => { p.paddingY = Number(e.target.value) })} /></div>
    </div>
  )
}

CaptureForm.craft = {
  displayName: 'Formulário de Captura',
  props: { title: 'Garanta sua vaga gratuita', namePlaceholder: 'Seu nome completo', emailPlaceholder: 'Seu melhor e-mail', phonePlaceholder: 'Seu WhatsApp', showPhone: true, btnText: 'Quero Participar Agora →', btnColor: '#6366F1', bgColor: '#F8FAFC', paddingY: 60 },
  related: { toolbar: CaptureFormSettings },
}
