'use client'

import { useState } from 'react'
import MetaConnectModal from './meta-connect-modal'

interface Props {
  metaAccessToken: string | null
  metaAdAccountId: string | null
  metaPixelId: string | null
  tenantId: string
}

export default function MetaSection({ metaAccessToken, metaAdAccountId, metaPixelId, tenantId }: Props) {
  const [showModal, setShowModal] = useState(false)
  const isConnected = !!metaAccessToken && !!metaAdAccountId

  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-xs">
          f
        </div>
        <h2 className="text-base font-semibold text-gray-800">Meta Ads</h2>
        {isConnected && (
          <span className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 font-medium px-2 py-0.5 rounded-full border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            Conectado
          </span>
        )}
      </div>

      {!isConnected ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm">
          <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-base">
              f
            </div>
          </div>
          <p className="text-gray-700 font-semibold mb-1">Conecte o Meta Ads</p>
          <p className="text-sm text-gray-400 mb-4 max-w-xs mx-auto">
            Sincronize gastos de anúncios e calcule CPL e ROAS automaticamente por campanha e anúncio.
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl px-5 py-2.5 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Conectar Meta Ads
          </button>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold text-gray-900">Conta de Anúncios</p>
              </div>
              <p className="text-xs text-gray-500 font-mono">
                act_{metaAdAccountId}
              </p>
              {metaPixelId && (
                <p className="text-xs text-gray-400 mt-0.5">Pixel: {metaPixelId}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/api/meta/sync"
                className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium rounded-lg px-3 py-1.5 transition-colors"
              >
                Sincronizar agora
              </a>
              <button
                onClick={() => setShowModal(true)}
                className="text-xs border border-blue-300 text-blue-600 hover:bg-blue-50 font-medium rounded-lg px-3 py-1.5 transition-colors"
              >
                Editar
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <MetaConnectModal
          initial={{
            meta_access_token: metaAccessToken,
            meta_ad_account_id: metaAdAccountId,
            meta_pixel_id: metaPixelId,
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
