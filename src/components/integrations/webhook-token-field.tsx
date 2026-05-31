'use client'

import { useState, useTransition } from 'react'
import { saveWebhookToken } from '@/app/actions/webhook-tokens'

interface Props {
  platform: string
  currentToken: string | null
  label: string
  instruction: string
  fieldLabel: string
}

export default function WebhookTokenField({ platform, currentToken, label, instruction, fieldLabel }: Props) {
  const [token, setToken] = useState(currentToken ?? '')
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function generateToken() {
    const t = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    setToken(t)
    setSaved(false)
  }

  function handleSave() {
    startTransition(async () => {
      await saveWebhookToken(platform, token)
      setSaved(true)
    })
  }

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-xs font-medium text-gray-700 mb-1">{label}</p>
      <div className="flex gap-2 mb-1">
        <input
          type="text"
          value={token}
          onChange={(e) => { setToken(e.target.value); setSaved(false) }}
          placeholder="Cole ou gere um token"
          className="flex-1 text-xs font-mono border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <button
          type="button"
          onClick={generateToken}
          className="text-xs px-2 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600 whitespace-nowrap"
        >
          Gerar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!token || isPending}
          className="text-xs px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg whitespace-nowrap"
        >
          {isPending ? '...' : saved ? '✓ Salvo' : 'Salvar'}
        </button>
      </div>
      <p className="text-xs text-gray-400">{fieldLabel}: {instruction}</p>
    </div>
  )
}
