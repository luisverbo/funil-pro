'use client'

import { useState, useTransition } from 'react'
import { saveAdminSettings } from '@/app/actions/admin'

interface Props {
  settings: Record<string, string>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function Field({ label, name, value, type = 'text', placeholder, id }: { label: string; name: string; value: string; type?: string; placeholder?: string; id?: string }) {
  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={value}
        placeholder={placeholder}
        id={id ?? name}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  )
}

export default function SettingsForm({ settings }: Props) {
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  function handleSave(section: string[]) {
    return (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      const fd = new FormData(e.currentTarget)
      const filtered = new FormData()
      for (const key of section) {
        filtered.append(key, fd.get(key) as string ?? '')
      }
      startTransition(async () => {
        await saveAdminSettings(filtered)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      })
    }
  }

  async function testEvolution() {
    setTestStatus('loading')
    const url = (document.getElementById('evolution_api_url') as HTMLInputElement)?.value
    const key = (document.getElementById('evolution_api_key') as HTMLInputElement)?.value
    try {
      const res = await fetch('/api/admin/test-evolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, key }),
      })
      setTestStatus(res.ok ? 'ok' : 'error')
    } catch {
      setTestStatus('error')
    }
    setTimeout(() => setTestStatus('idle'), 3000)
  }

  return (
    <div>
      {saved && (
        <div className="mb-4 px-4 py-2 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          Configurações salvas com sucesso!
        </div>
      )}

      {/* Meta Ads */}
      <Section title="Meta Ads OAuth">
        <p className="text-sm text-gray-500 mb-4">
          Acesse <strong>developers.facebook.com</strong> → Criar app → tipo Business → adicionar produto Marketing API → copiar App ID e App Secret.
        </p>
        <form onSubmit={handleSave(['meta_app_id', 'meta_app_secret'])}>
          <Field label="Meta App ID" name="meta_app_id" value={settings.meta_app_id ?? ''} placeholder="123456789" />
          <Field label="Meta App Secret" name="meta_app_secret" value={settings.meta_app_secret ?? ''} type="password" placeholder="••••••••" />
          <button
            type="submit"
            disabled={isPending}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            Salvar
          </button>
        </form>
      </Section>

      {/* Evolution API */}
      <Section title="Evolution API (WhatsApp)">
        <form onSubmit={handleSave(['evolution_api_url', 'evolution_api_key'])}>
          <Field label="URL da API" name="evolution_api_url" value={settings.evolution_api_url ?? ''} placeholder="https://api.seuservidor.com" id="evolution_api_url" />
          <Field label="API Key" name="evolution_api_key" value={settings.evolution_api_key ?? ''} type="password" placeholder="••••••••" id="evolution_api_key" />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
            >
              Salvar
            </button>
            <button
              type="button"
              onClick={testEvolution}
              disabled={testStatus === 'loading'}
              className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
            >
              {testStatus === 'loading' ? 'Testando...' : testStatus === 'ok' ? 'Conectado!' : testStatus === 'error' ? 'Falhou' : 'Testar conexão'}
            </button>
          </div>
        </form>
      </Section>

      {/* Resend */}
      <Section title="Resend (E-mail)">
        <form onSubmit={handleSave(['resend_api_key', 'resend_domain'])}>
          <Field label="API Key" name="resend_api_key" value={settings.resend_api_key ?? ''} type="password" placeholder="re_••••••••" />
          <Field label="Domínio padrão de envio" name="resend_domain" value={settings.resend_domain ?? ''} placeholder="seudominio.com" />
          <button
            type="submit"
            disabled={isPending}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            Salvar
          </button>
        </form>
      </Section>
    </div>
  )
}
