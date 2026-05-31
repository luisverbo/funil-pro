'use client'

import { useState } from 'react'

interface Props {
  platform: string
  platformLabel: string
}

const CREDENTIAL_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  kiwify: [{ key: 'apiKey', label: 'API Key', placeholder: 'kw_...' }],
  hotmart: [{ key: 'token', label: 'Bearer Token', placeholder: 'seu token hotmart' }],
  eduzz: [
    { key: 'apiKey', label: 'Public Key', placeholder: 'sua public key' },
    { key: 'email', label: 'E-mail da conta', placeholder: 'email@exemplo.com' },
  ],
  yampi: [
    { key: 'alias', label: 'Alias da loja', placeholder: 'minha-loja' },
    { key: 'token', label: 'User Token', placeholder: 'seu user token' },
    { key: 'secretKey', label: 'Secret Key', placeholder: 'sua secret key' },
  ],
}

export default function ProductSyncButton({ platform, platformLabel }: Props) {
  const [open, setOpen] = useState(false)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const fields = CREDENTIAL_FIELDS[platform] ?? []

  const handleSync = async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/products/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, credentials }),
      })
      const json = await res.json()
      if (json.synced !== undefined) setResult(`✓ ${json.synced} produto(s) sincronizado(s)`)
      else setResult(`Erro: ${json.error ?? 'Desconhecido'}`)
    } catch {
      setResult('Erro ao conectar com a API')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium underline"
      >
        🔄 Sincronizar produtos
      </button>

      {open && (
        <div className="mt-3 bg-gray-50 rounded-xl p-3 border border-gray-200">
          <p className="text-xs font-semibold text-gray-700 mb-2">Credenciais {platformLabel}</p>
          {fields.map((f) => (
            <div key={f.key} className="mb-2">
              <label className="text-xs text-gray-500 block mb-0.5">{f.label}</label>
              <input
                type="password"
                placeholder={f.placeholder}
                value={credentials[f.key] ?? ''}
                onChange={(e) => setCredentials((c) => ({ ...c, [f.key]: e.target.value }))}
                className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          ))}
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={handleSync}
              disabled={loading}
              className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
            >
              {loading ? 'Sincronizando…' : 'Sincronizar'}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancelar
            </button>
            {result && <span className="text-xs text-emerald-600 font-medium">{result}</span>}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            As credenciais são usadas somente para a sincronização e não são salvas.
          </p>
        </div>
      )}
    </div>
  )
}
