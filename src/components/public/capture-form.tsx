'use client'

import { useState } from 'react'

interface UtmParams {
  utm_source?: string
  utm_campaign?: string
  utm_campaign_id?: string
  utm_adset_id?: string
  utm_ad_id?: string
  utm_content?: string
  referrer_url?: string
  landing_url?: string
}

interface CaptureFormProps {
  funnelId: string
  funnelName: string
  initialUtms: UtmParams
  pixelId?: string | null
}

export default function CaptureForm({ funnelId, funnelName, initialUtms, pixelId }: CaptureFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/funnels/${funnelId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: email || undefined,
          phone,
          ...initialUtms,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Erro ao enviar. Tente novamente.')
      }

      // Fire Meta Pixel Lead event if pixel is configured
      if (pixelId && typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).fbq) {
        ;(window as unknown as Record<string, (...args: unknown[]) => void>).fbq('track', 'Lead')
      }

      window.location.href = `/f/${funnelId}/obrigado`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro inesperado')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
          Nome completo <span className="text-red-500">*</span>
        </label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Seu nome completo"
          className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900 placeholder-gray-400"
        />
      </div>

      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
          WhatsApp <span className="text-red-500">*</span>
        </label>
        <input
          id="phone"
          type="tel"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(11) 99999-9999"
          className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900 placeholder-gray-400"
        />
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
          E-mail <span className="text-gray-400 text-xs">(opcional)</span>
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com"
          className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-gray-900 placeholder-gray-400"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 px-6 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? 'Enviando...' : 'Quero participar'}
      </button>

      <p className="text-xs text-center text-gray-400">
        Seus dados estão seguros. Não enviamos spam.
      </p>
    </form>
  )
}
