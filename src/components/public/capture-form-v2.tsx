'use client'

import { useState } from 'react'

interface Props {
  funnelId: string
  ctaText: string
  ctaColor: string
  emailEnabled?: boolean
  thankYouMessage?: string
  redirectUrl?: string
  dark?: boolean
}

export default function CaptureFormV2({
  funnelId,
  ctaText,
  ctaColor,
  emailEnabled = false,
  dark = false,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState(false)
  const [phoneError, setPhoneError] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const form = e.currentTarget
    const data = new FormData(form)
    const name = (data.get('name') as string) ?? ''
    const phone = (data.get('phone') as string) ?? ''

    const ne = !name.trim()
    const pe = !phone.trim()
    setNameError(ne)
    setPhoneError(pe)
    if (ne || pe) return

    setLoading(true)

    const params = new URLSearchParams(window.location.search)
    const body: Record<string, string> = {
      name,
      phone,
      email: (data.get('email') as string) ?? '',
    }

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

      window.location.href = `/p/${funnelId}/obrigado`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar')
      setLoading(false)
    }
  }

  const baseInput: React.CSSProperties = {
    width: '100%',
    padding: '14px 16px',
    borderRadius: 12,
    fontSize: 16,
    outline: 'none',
    boxSizing: 'border-box',
    ...(dark
      ? { background: '#1F1F1F', color: 'white' }
      : { background: 'white', color: '#0F0F0F' }),
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      <div>
        <input
          name="name"
          placeholder="Seu nome completo"
          style={{ ...baseInput, border: `1.5px solid ${nameError ? '#ef4444' : dark ? '#333' : '#E5E7EB'}` }}
          onChange={() => setNameError(false)}
        />
        {nameError && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Nome é obrigatório</p>}
      </div>
      <div>
        <input
          name="phone"
          placeholder="WhatsApp com DDD (ex: 11999999999)"
          style={{ ...baseInput, border: `1.5px solid ${phoneError ? '#ef4444' : dark ? '#333' : '#E5E7EB'}` }}
          onChange={() => setPhoneError(false)}
        />
        {phoneError && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>WhatsApp é obrigatório</p>}
      </div>
      {emailEnabled && (
        <input
          name="email"
          type="email"
          placeholder="Seu melhor e-mail"
          style={{ ...baseInput, border: `1.5px solid ${dark ? '#333' : '#E5E7EB'}` }}
        />
      )}
      {error && <p style={{ color: '#ef4444', fontSize: 14, textAlign: 'center' }}>{error}</p>}
      <button
        type="submit"
        disabled={loading}
        style={{
          width: '100%',
          padding: '16px',
          background: loading ? '#9CA3AF' : ctaColor,
          color: 'white',
          border: 'none',
          borderRadius: 12,
          fontSize: 18,
          fontWeight: 700,
          cursor: loading ? 'not-allowed' : 'pointer',
          transition: 'all 0.2s',
        }}
      >
        {loading ? 'Enviando...' : ctaText}
      </button>
    </form>
  )
}
