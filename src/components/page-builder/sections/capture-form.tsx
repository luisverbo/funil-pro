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
  redirectUrl?: string
  successTitle?: string
  successMessage?: string
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
  redirectUrl = '',
  successTitle = 'Recebemos seus dados!',
  successMessage = 'Em breve entraremos em contato.',
}: CaptureFormProps) => {
  const { connectors: { connect, drag } } = useNode()
  const { enabled: editorEnabled } = useEditor((state) => ({ enabled: state.options.enabled }))
  const { pageId, track } = usePageTracking()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (editorEnabled) return
    setError(null)
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
    const phoneDigits = phone.replace(/\D/g, '')
    if (!emailOk && !(showPhone && phoneDigits.length >= 10)) {
      setError(showPhone ? 'Informe um e-mail ou WhatsApp válido' : 'Informe um e-mail válido')
      return
    }
    setSubmitting(true)
    try {
      // UTM da URL atual (ou capturada na entrada da página)
      let utm: Record<string, string> = {}
      try { utm = JSON.parse(localStorage.getItem('funil_utm') ?? '{}') } catch {}
      const sp = new URLSearchParams(window.location.search)
      for (const k of ['utm_source', 'utm_campaign', 'utm_campaign_id', 'utm_adset_id', 'utm_ad_id', 'utm_content']) {
        const v = sp.get(k); if (v) utm[k] = v
      }
      const res = await fetch(`/api/pages/${pageId}/capture`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), email: email.trim(), phone: phoneDigits, utm,
          referrer: document.referrer, landing_url: window.location.href,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error ?? 'Erro ao enviar, tente de novo'); return }
      if (json.leadId) localStorage.setItem('funil_lid', json.leadId)
      track('form_submitted', { name, email })
      if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).fbq) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).fbq('track', 'Lead')
      }
      if (redirectUrl) { window.location.href = redirectUrl; return }
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
      className="w-full px-5 md:px-6"
    >
      <div className="max-w-md mx-auto">
        {title && <h2 className={`text-2xl font-bold text-gray-900 ${titleAlign} mb-6`}>{title}</h2>}
        {submitted && !editorEnabled ? (
          <div className="text-center py-8">
            <div className="text-5xl mb-4">✅</div>
            <p className="text-lg font-semibold text-gray-800">{successTitle}</p>
            <p className="text-sm text-gray-500 mt-2">{successMessage}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="text"
              placeholder={namePlaceholder}
              value={editorEnabled ? '' : name}
              onChange={(e) => { if (!editorEnabled) setName(e.target.value) }}
              readOnly={editorEnabled}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <input
              type="email"
              placeholder={emailPlaceholder}
              value={editorEnabled ? '' : email}
              onChange={(e) => { if (!editorEnabled) setEmail(e.target.value) }}
              readOnly={editorEnabled}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            {showPhone && (
              <input
                type="tel"
                placeholder={phonePlaceholder}
                value={editorEnabled ? '' : phone}
                onChange={(e) => { if (!editorEnabled) setPhone(e.target.value) }}
                readOnly={editorEnabled}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            )}
            {error && <p className="text-sm text-red-500 text-center">{error}</p>}
            <button
              type={editorEnabled ? 'button' : 'submit'}
              disabled={submitting}
              style={{ backgroundColor: btnColor }}
              className="w-full min-h-[52px] py-4 text-white font-bold rounded-xl text-lg shadow-lg disabled:opacity-70 transition-opacity"
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
      <div className="border-t pt-3">
        <label className="block text-xs font-medium text-gray-500 mb-1">Redirecionar após enviar (URL)</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" placeholder="https://… ou /pg/obrigado (vazio = mensagem)" value={props.redirectUrl ?? ''} onChange={(e) => setProp((p: CaptureFormProps) => { p.redirectUrl = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Título de sucesso</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.successTitle ?? ''} onChange={(e) => setProp((p: CaptureFormProps) => { p.successTitle = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Mensagem de sucesso</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.successMessage ?? ''} onChange={(e) => setProp((p: CaptureFormProps) => { p.successMessage = e.target.value })} />
      </div>
      <p className="text-[11px] text-emerald-600 bg-emerald-50 rounded-lg p-2">✅ O lead é salvo no CRM automaticamente. Se a página estiver ligada a um funil (⚙️ Configurações), ele entra no funil na hora.</p>
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
    redirectUrl: '',
    successTitle: 'Recebemos seus dados!',
    successMessage: 'Em breve entraremos em contato.',
  },
  related: { toolbar: CaptureFormSettings },
}
