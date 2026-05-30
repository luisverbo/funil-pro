'use client'

import { useState } from 'react'

interface Props {
  funnelId: string
  ctaText: string
  ctaColor: string
  fieldsEnabled: Record<string, boolean>
  inputClassName?: string
  thankYouPath: string
}

export default function CaptureFormV2({
  funnelId,
  ctaText,
  ctaColor,
  fieldsEnabled,
  inputClassName = '',
  thankYouPath,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = e.currentTarget
    const data = new FormData(form)

    const params = new URLSearchParams(window.location.search)
    const body: Record<string, string> = {
      name: (data.get('name') as string) ?? '',
      phone: (data.get('phone') as string) ?? '',
      email: (data.get('email') as string) ?? '',
    }

    // UTM params
    for (const key of ['utm_source', 'utm_campaign', 'utm_campaign_id', 'utm_adset_id', 'utm_ad_id', 'utm_content']) {
      const v = params.get(key)
      if (v) body[key] = v
    }
    body.referrer_url = document.referrer || ''
    body.landing_url = window.location.href

    try {
      const res = await fetch(`/api/funnels/${funnelId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as { error?: string }).error || 'Erro ao enviar')
      }

      window.location.href = thankYouPath
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar')
      setLoading(false)
    }
  }

  const baseInput = `w-full px-4 py-3 rounded-lg text-sm border focus:outline-none focus:ring-2 focus:ring-indigo-500 ${inputClassName}`

  return (
    <form onSubmit={handleSubmit} className="space-y-3 w-full">
      {fieldsEnabled.name !== false && (
        <input
          name="name"
          required
          placeholder="Seu nome"
          className={baseInput}
        />
      )}
      {fieldsEnabled.phone !== false && (
        <input
          name="phone"
          required
          placeholder="WhatsApp (com DDD)"
          className={baseInput}
        />
      )}
      {fieldsEnabled.email && (
        <input
          name="email"
          type="email"
          placeholder="Seu melhor email"
          className={baseInput}
        />
      )}
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        style={{ backgroundColor: ctaColor }}
        className="w-full py-3.5 rounded-lg text-white font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {loading ? 'Enviando...' : ctaText}
      </button>
    </form>
  )
}
