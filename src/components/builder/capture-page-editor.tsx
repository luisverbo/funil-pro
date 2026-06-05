'use client'

import { useState, useEffect } from 'react'
import { X, Copy, Check, ExternalLink } from 'lucide-react'
import { saveCapturePageConfig, getCapturePageConfig } from '@/app/actions/funnels'

interface Props {
  funnelId: string
  onClose: () => void
  entryType?: string
  onSaved?: (template: string) => void
}

const TEMPLATES = [
  { key: 'minimal', label: 'Minimal' },
  { key: 'dark', label: 'Dark' },
  { key: 'split', label: 'Split' },
]

export default function CapturePageEditor({ funnelId, onClose, entryType, onSaved }: Props) {
  const [template, setTemplate] = useState('minimal')
  const [headline, setHeadline] = useState('')
  const [subheadline, setSubheadline] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [ctaColor, setCtaColor] = useState('#6366f1')
  const [logoUrl, setLogoUrl] = useState('')
  const [bgImageUrl, setBgImageUrl] = useState('')
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [thankYouMessage, setThankYouMessage] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isExisting, setIsExisting] = useState(false)
  const [loading, setLoading] = useState(true)

  // Use window.location.origin so the link always reflects the current domain
  const appUrl = typeof window !== 'undefined' ? window.location.origin : (process.env.NEXT_PUBLIC_APP_URL ?? '')
  const pageUrl = `${appUrl}/p/${funnelId}`

  useEffect(() => {
    async function loadConfig() {
      setLoading(true)
      const data = await getCapturePageConfig(funnelId)
      if (data?.page_config) {
        setIsExisting(true)
        const cfg = data.page_config as Record<string, unknown>
        if (data.page_template) setTemplate(data.page_template)
        if (cfg.headline) setHeadline(cfg.headline as string)
        if (cfg.subheadline) setSubheadline(cfg.subheadline as string)
        if (cfg.cta_text) setCtaText(cfg.cta_text as string)
        if (cfg.cta_color) setCtaColor(cfg.cta_color as string)
        if (cfg.logo_url) setLogoUrl(cfg.logo_url as string)
        if (cfg.bg_image_url) setBgImageUrl(cfg.bg_image_url as string)
        if (cfg.redirect_url) setRedirectUrl(cfg.redirect_url as string)
        if (cfg.thank_you_message) setThankYouMessage(cfg.thank_you_message as string)
        const fields = cfg.fields_enabled as Record<string, boolean> | undefined
        if (fields?.email !== undefined) setEmailEnabled(fields.email)
      }
      setLoading(false)
    }
    loadConfig()
  }, [funnelId])

  async function handleSave() {
    setSaving(true)
    const page_config: Record<string, unknown> = {
      headline,
      subheadline,
      cta_text: ctaText,
      cta_color: ctaColor,
      logo_url: logoUrl || undefined,
      bg_image_url: bgImageUrl || undefined,
      fields_enabled: { name: true, phone: true, email: emailEnabled },
      thank_you_message: thankYouMessage,
      redirect_url: redirectUrl || undefined,
    }
    await saveCapturePageConfig(funnelId, { template, page_config })
    setSaving(false)
    setSaved(true)
    setIsExisting(true)
    onSaved?.(template)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleCopy() {
    navigator.clipboard.writeText(pageUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) {
    return (
      <div className="w-80 border-l border-gray-200 bg-white h-full flex items-center justify-center shrink-0">
        <div className="text-sm text-gray-400">Carregando...</div>
      </div>
    )
  }

  return (
    <div className="w-80 border-l border-gray-200 bg-white h-full overflow-y-auto flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-800">
          {isExisting ? 'Editar página de captura' : 'Criar página de captura'}
        </span>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition-colors">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-5">
        {/* Template picker */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Template</p>
          <div className="flex gap-2">
            {TEMPLATES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTemplate(key)}
                className={`flex-1 rounded-lg overflow-hidden border-2 transition-all ${
                  template === key ? 'border-indigo-500' : 'border-gray-200'
                }`}
              >
                {key === 'minimal' && (
                  <div className="h-14 bg-white flex flex-col justify-end p-1">
                    <div className="h-2 rounded bg-indigo-400 w-full" />
                  </div>
                )}
                {key === 'dark' && (
                  <div className="h-14 bg-gray-900 flex flex-col justify-end p-1">
                    <div className="h-2 rounded bg-indigo-500 w-full" />
                  </div>
                )}
                {key === 'split' && (
                  <div className="h-14 flex">
                    <div className="w-1/2 bg-gray-800" />
                    <div className="w-1/2 bg-white flex flex-col justify-end p-1">
                      <div className="h-2 rounded bg-indigo-400 w-full" />
                    </div>
                  </div>
                )}
                <p className="text-center text-xs py-1 text-gray-600 font-medium bg-gray-50">{label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Content fields */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase">Conteúdo</p>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Headline</label>
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="Ex: Aprenda a vender no automático"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Subheadline</label>
            <input
              value={subheadline}
              onChange={(e) => setSubheadline(e.target.value)}
              placeholder="Ex: Preencha seus dados e receba acesso"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Texto do botão CTA</label>
            <input
              value={ctaText}
              onChange={(e) => setCtaText(e.target.value)}
              placeholder="Ex: Quero acesso agora"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Cor do botão</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={ctaColor}
                onChange={(e) => setCtaColor(e.target.value)}
                className="h-9 w-14 rounded border border-gray-300 cursor-pointer p-0.5"
              />
              <span className="text-xs text-gray-500">{ctaColor}</span>
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Logo URL</label>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {template === 'split' && (
            <div>
              <label className="block text-xs text-gray-600 mb-1">Imagem de fundo (lado esquerdo)</label>
              <input
                value={bgImageUrl}
                onChange={(e) => setBgImageUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}
        </div>

        {/* Form fields */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Campos do formulário</p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-not-allowed opacity-60">
              <input type="checkbox" checked readOnly disabled className="rounded" />
              Nome
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-not-allowed opacity-60">
              <input type="checkbox" checked readOnly disabled className="rounded" />
              WhatsApp
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={emailEnabled}
                onChange={(e) => setEmailEnabled(e.target.checked)}
                className="rounded"
              />
              Email
            </label>
          </div>
        </div>

        {/* Thank you */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase">Obrigado</p>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Mensagem de obrigado</label>
            <textarea
              value={thankYouMessage}
              onChange={(e) => setThankYouMessage(e.target.value)}
              placeholder="Obrigado! Verifique seu WhatsApp."
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">URL de redirecionamento</label>
            <input
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* Link + preview */}
        <div className="border border-gray-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase">Link da página</p>
          <code className="text-xs bg-gray-100 px-2 py-1 rounded break-all block">{pageUrl}</code>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {copied ? <><Check className="w-3 h-3 text-green-500" /> Copiado!</> : <><Copy className="w-3 h-3" /> Copiar</>}
            </button>
            <button
              onClick={() => window.open(`/p/${funnelId}`, '_blank')}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Ver página
            </button>
          </div>
        </div>
      </div>

      {/* Footer save button */}
      <div className="p-4 border-t border-gray-100">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {saved ? 'Salvo!' : saving ? 'Salvando...' : 'Salvar'}
        </button>
        {saved && (
          <a
            href={`/p/${funnelId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 mt-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
          >
            <ExternalLink className="w-4 h-4 text-green-500 shrink-0" />
            <span className="text-xs text-green-700 font-medium">Ver página</span>
          </a>
        )}
        {saved && entryType === 'form' && (
          <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-indigo-500 shrink-0">
              <polyline points="20,6 9,17 4,12" />
            </svg>
            <span className="text-xs text-indigo-700 font-medium">Página vinculada ao bloco Entrada ✓</span>
          </div>
        )}
      </div>
    </div>
  )
}
