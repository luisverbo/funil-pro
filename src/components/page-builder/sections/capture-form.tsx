'use client'

import { useNode, useEditor } from '@craftjs/core'
import React, { useState } from 'react'
import { usePageTracking } from '@/app/pg/[slug]/craft-viewer'

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
  textAlign?: 'center' | 'left'
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
  textAlign = 'center',
}: CaptureFormProps) => {
  const { connectors: { connect, drag } } = useNode()
  const { enabled: editorEnabled } = useEditor((state) => ({ enabled: state.options.enabled }))
  const { track } = usePageTracking()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editorEnabled) return
    setSubmitting(true)
    try {
      track('form_submitted', { name, email, phone })
      if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).fbq) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).fbq('track', 'Lead', { name, email, phone })
      }
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  const titleAlign = textAlign === 'left' ? 'text-left' : 'text-center'

  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className="w-full px-6"
    >
      <div className="max-w-md mx-auto">
        {title && <h2 className={`text-2xl font-bold text-gray-900 ${titleAlign} mb-6`}>{title}</h2>}
        {submitted && !editorEnabled ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-4">✅</div>
            <p className="text-lg font-semibold text-gray-800">Recebemos seus dados!</p>
            <p className="text-sm text-gray-500 mt-2">Em breve entraremos em contato.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              placeholder={namePlaceholder}
              value={editorEnabled ? '' : name}
              onChange={(e) => { if (!editorEnabled) setName(e.target.value) }}
              readOnly={editorEnabled}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <input
              type="email"
              placeholder={emailPlaceholder}
              value={editorEnabled ? '' : email}
              onChange={(e) => { if (!editorEnabled) setEmail(e.target.value) }}
              readOnly={editorEnabled}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            {showPhone && (
              <input
                type="tel"
                placeholder={phonePlaceholder}
                value={editorEnabled ? '' : phone}
                onChange={(e) => { if (!editorEnabled) setPhone(e.target.value) }}
                readOnly={editorEnabled}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            )}
            <button
              type={editorEnabled ? 'button' : 'submit'}
              disabled={submitting}
              style={{ backgroundColor: btnColor }}
              className="w-full py-4 text-white font-bold rounded-xl text-lg shadow-lg disabled:opacity-70 transition-opacity"
            >
              {submitting ? 'Enviando...' : btnText}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export const CaptureFormSettings = () => {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props as CaptureFormProps }))
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Título do formulário</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.title} onChange={(e) => setProp((p: CaptureFormProps) => { p.title = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Alinhamento do título</label>
        <select className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.textAlign ?? 'center'} onChange={(e) => setProp((p: CaptureFormProps) => { p.textAlign = e.target.value as 'center' | 'left' })}>
          <option value="center">Centro</option>
          <option value="left">Esquerda</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Placeholder nome</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.namePlaceholder} onChange={(e) => setProp((p: CaptureFormProps) => { p.namePlaceholder = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Placeholder e-mail</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.emailPlaceholder} onChange={(e) => setProp((p: CaptureFormProps) => { p.emailPlaceholder = e.target.value })} />
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="showPhone" checked={props.showPhone} onChange={(e) => setProp((p: CaptureFormProps) => { p.showPhone = e.target.checked })} />
        <label htmlFor="showPhone" className="text-xs font-medium text-gray-500">Mostrar campo telefone</label>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Placeholder telefone</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.phonePlaceholder} onChange={(e) => setProp((p: CaptureFormProps) => { p.phonePlaceholder = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto do botão</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.btnText} onChange={(e) => setProp((p: CaptureFormProps) => { p.btnText = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do botão</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.btnColor} onChange={(e) => setProp((p: CaptureFormProps) => { p.btnColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: CaptureFormProps) => { p.bgColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Espaçamento vertical (px)</label>
        <input type="number" className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.paddingY} onChange={(e) => setProp((p: CaptureFormProps) => { p.paddingY = Number(e.target.value) })} />
      </div>
    </div>
  )
}

CaptureForm.craft = {
  displayName: 'Formulário de Captura',
  props: {
    title: 'Garanta sua vaga gratuita',
    namePlaceholder: 'Seu nome completo',
    emailPlaceholder: 'Seu melhor e-mail',
    phonePlaceholder: 'Seu WhatsApp',
    showPhone: true,
    btnText: 'Quero Participar Agora →',
    btnColor: '#6366F1',
    bgColor: '#F8FAFC',
    paddingY: 60,
    textAlign: 'center',
  },
  related: { toolbar: CaptureFormSettings },
}
