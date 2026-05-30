'use client'

import { useState, useTransition, useRef } from 'react'
import { saveMetaConfig, testMetaConnection } from '@/app/actions/meta'

interface Props {
  initial?: {
    meta_access_token?: string | null
    meta_ad_account_id?: string | null
    meta_pixel_id?: string | null
  }
  onClose: () => void
}

export default function MetaConnectModal({ initial, onClose }: Props) {
  const [token, setToken] = useState(initial?.meta_access_token ?? '')
  const [accountId, setAccountId] = useState(
    initial?.meta_ad_account_id
      ? `act_${initial.meta_ad_account_id}`
      : ''
  )
  const [pixelId, setPixelId] = useState(initial?.meta_pixel_id ?? '')
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isTesting, startTestTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  function handleTest() {
    if (!token) {
      setTestResult({ ok: false, message: 'Informe o Access Token primeiro' })
      return
    }
    startTestTransition(async () => {
      setTestResult(null)
      const result = await testMetaConnection(token)
      if (result.success) {
        setTestResult({ ok: true, message: `Conectado como ${result.name}` })
      } else {
        setTestResult({ ok: false, message: result.error ?? 'Erro desconhecido' })
      }
    })
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)
    const formData = new FormData(formRef.current!)
    startTransition(async () => {
      const result = await saveMetaConfig(formData)
      if (result.success) {
        onClose()
      } else {
        setSaveError(result.error ?? 'Erro ao salvar')
      }
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg">
              f
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Conectar Meta Ads</h2>
              <p className="text-xs text-gray-500">Configure sua conta de anúncios</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSave} className="space-y-4">
          {/* Access Token */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Meta Access Token
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                name="meta_access_token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="EAAxxxxxxx..."
                className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={handleTest}
                disabled={isTesting || !token}
                className="px-3 py-2.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap transition-colors"
              >
                {isTesting ? 'Testando...' : 'Testar'}
              </button>
            </div>
            {testResult && (
              <p className={`mt-1.5 text-xs ${testResult.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
              </p>
            )}
          </div>

          {/* Ad Account ID */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Ad Account ID
            </label>
            <input
              type="text"
              name="meta_ad_account_id"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              placeholder="act_123456789"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-400">
              Encontre em Meta Business Manager → Contas de Anúncios
            </p>
          </div>

          {/* Pixel ID */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Pixel ID <span className="text-gray-400 font-normal">(opcional)</span>
            </label>
            <input
              type="text"
              name="meta_pixel_id"
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              placeholder="123456789"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {saveError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {saveError}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium rounded-xl px-4 py-2.5 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
