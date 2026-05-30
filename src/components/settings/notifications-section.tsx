'use client'

import { useState } from 'react'

interface Toggle {
  key: string
  label: string
  defaultOn: boolean
}

const TOGGLES: Toggle[] = [
  { key: 'new_leads', label: 'Novos leads por email', defaultOn: true },
  { key: 'purchase', label: 'Compra realizada', defaultOn: true },
  { key: 'funnel_published', label: 'Funil publicado', defaultOn: false },
]

export default function NotificationsSection() {
  const [values, setValues] = useState<Record<string, boolean>>(
    Object.fromEntries(TOGGLES.map((t) => [t.key, t.defaultOn]))
  )
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="border border-gray-200 rounded-xl p-6 mb-4">
      <h2 className="text-base font-semibold text-gray-800 mb-4">Notificações</h2>
      <div className="space-y-4">
        {TOGGLES.map((toggle) => (
          <div key={toggle.key} className="flex items-center justify-between">
            <span className="text-sm text-gray-700">{toggle.label}</span>
            <button
              type="button"
              onClick={() => setValues((v) => ({ ...v, [toggle.key]: !v[toggle.key] }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                values[toggle.key] ? 'bg-indigo-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  values[toggle.key] ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-5">
        <button
          type="button"
          onClick={handleSave}
          className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          {saved ? 'Salvo!' : 'Salvar'}
        </button>
      </div>
    </div>
  )
}
