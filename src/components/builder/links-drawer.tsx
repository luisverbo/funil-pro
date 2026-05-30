'use client'

import { useState } from 'react'
import { Globe, BarChart2, Zap, X, Copy, Check } from 'lucide-react'

interface Props {
  funnelId: string
  onClose: () => void
  entryType?: string
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://funil-pro.vercel.app'

export default function LinksDrawer({ funnelId, onClose, entryType = 'link_utm' }: Props) {
  const [copied, setCopied] = useState<string | null>(null)

  const captureUrl = `${APP_URL}/p/${funnelId}`
  const metaUrl = `${APP_URL}/p/${funnelId}?utm_source=meta&utm_campaign={{campaign.id}}&utm_content={{ad.id}}`
  const apiUrl = `${APP_URL}/api/funnels/${funnelId}/activate`
  const utmUrl = `${APP_URL}/f/${funnelId}?utm_source=meta&utm_campaign={{campaign.id}}&utm_content={{ad.id}}`

  const links = entryType === 'form'
    ? [
        { key: 'capture', title: 'Página de Captura', url: captureUrl, desc: 'Compartilhe este link nos seus anúncios e posts para capturar leads.', Icon: Globe },
        { key: 'meta', title: 'Meta Ads (com UTM)', url: metaUrl, desc: 'Cole no campo URL do anúncio. As macros {{...}} são substituídas automaticamente pelo Meta.', Icon: BarChart2 },
        { key: 'api', title: 'API de Ativação', url: apiUrl, desc: 'Endpoint POST (JSON: {name, phone, email}). Use em integrações externas.', Icon: Zap },
      ]
    : entryType === 'webhook'
    ? [
        { key: 'api', title: 'Endpoint de Ativação (Webhook)', url: apiUrl, desc: 'Endpoint POST (JSON: {name, phone, email}). Configure em plataformas externas para ativar o funil.', Icon: Zap },
        { key: 'meta', title: 'Meta Ads (com UTM)', url: utmUrl, desc: 'Use este link com macros do Meta para rastrear a origem dos leads.', Icon: BarChart2 },
      ]
    : [
        // link_utm (default)
        { key: 'utm', title: 'Link com UTM (Meta Ads)', url: utmUrl, desc: 'Cole no campo URL do anúncio Meta. As macros {{...}} são substituídas automaticamente.', Icon: BarChart2 },
        { key: 'api', title: 'API de Ativação', url: apiUrl, desc: 'Endpoint POST (JSON: {name, phone, email}). Use em integrações externas.', Icon: Zap },
      ]

  function handleCopy(key: string, url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  return (
    <div className="w-80 border-l border-gray-200 bg-white h-full overflow-y-auto flex flex-col shrink-0">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-800">Links do Funil</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition-colors">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-4">
        {links.map(({ key, title, url, desc, Icon }) => (
          <div key={key} className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-semibold text-gray-800">{title}</span>
            </div>
            <p className="text-xs text-gray-500 mb-2">{desc}</p>
            <code className="text-xs bg-gray-100 px-2 py-1 rounded break-all block mt-1">{url}</code>
            <button
              onClick={() => handleCopy(key, url)}
              className="mt-2 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              {copied === key ? (
                <>
                  <Check className="w-3 h-3 text-green-500" />
                  Copiado!
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copiar
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
