'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { deleteWhatsappInstance } from '@/app/actions/whatsapp'

interface Instance {
  id: string
  instance_name: string
  display_name: string | null
  description: string | null
  status: 'connected' | 'disconnected' | 'connecting'
  phone_number: string | null
  created_at: string
}

interface Props {
  instance: Instance
}

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  connected:    { label: 'Conectado',    color: '#10b981', bg: '#ecfdf5', dot: 'bg-emerald-400' },
  connecting:   { label: 'Conectando…',  color: '#f59e0b', bg: '#fffbeb', dot: 'bg-amber-400' },
  disconnected: { label: 'Desconectado', color: '#6b7280', bg: '#f3f4f6', dot: 'bg-gray-400' },
}

export default function InstanceCard({ instance }: Props) {
  const [status, setStatus] = useState(instance.status)
  const [qrBase64, setQrBase64] = useState<string | null>(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [polling, setPolling] = useState(instance.status !== 'connected')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/${instance.id}/status`)
      if (!res.ok) return
      const data = await res.json()
      const newStatus = data.dbStatus as Instance['status']
      setStatus(newStatus)
      if (newStatus === 'connected') {
        setPolling(false)
        setQrBase64(null)
      }
    } catch {}
  }, [instance.id])

  const fetchQr = useCallback(async () => {
    setLoadingQr(true)
    try {
      const res = await fetch(`/api/whatsapp/${instance.id}/qrcode`)
      if (!res.ok) return
      const data = await res.json()
      const base64 = data?.qrcode?.base64 ?? data?.base64
      if (base64) setQrBase64(base64)
    } catch {} finally {
      setLoadingQr(false)
    }
  }, [instance.id])

  // Poll status every 5s while not connected
  useEffect(() => {
    if (!polling) return
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [polling, fetchStatus])

  const handleDelete = async () => {
    if (!confirm('Remover esta instância WhatsApp?')) return
    setDeleting(true)
    await deleteWhatsappInstance(instance.id)
  }

  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.disconnected

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-emerald-500">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
          </div>
          <div>
            <p className="font-semibold text-gray-800 text-sm">
              {instance.display_name ?? instance.phone_number ?? instance.instance_name}
            </p>
            <p className="text-xs text-gray-400">
              {instance.description ?? instance.instance_name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full"
            style={{ color: badge.color, backgroundColor: badge.bg }}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${badge.dot} ${status === 'connecting' ? 'animate-pulse' : ''}`} />
            {badge.label}
          </span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <polyline points="3,6 5,6 21,6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6m4-6v6" /><path d="M9 6V4h6v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* QR Code section */}
      {status !== 'connected' && (
        <div className="border border-dashed border-gray-200 rounded-xl p-4 flex flex-col items-center gap-3 bg-gray-50">
          {qrBase64 ? (
            <>
              <p className="text-xs text-gray-500 text-center">
                Escaneie com o WhatsApp para conectar
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt="QR Code WhatsApp"
                className="w-48 h-48 rounded-lg"
              />
              <button
                onClick={fetchQr}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                ↻ Atualizar QR Code
              </button>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 text-gray-300">
                <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
                <path d="M14 14h.01M14 17h3M17 14v3M20 14h.01M20 20h.01" />
              </svg>
              <p className="text-xs text-gray-400 text-center">
                Clique em &quot;Mostrar QR Code&quot; para escanear com o WhatsApp
              </p>
              <button
                onClick={fetchQr}
                disabled={loadingQr}
                className="text-sm font-medium px-4 py-2 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
              >
                {loadingQr ? 'Carregando…' : 'Mostrar QR Code'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Connected state */}
      {status === 'connected' && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 rounded-xl px-4 py-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
            <polyline points="20,6 9,17 4,12" />
          </svg>
          WhatsApp conectado e pronto para uso
        </div>
      )}
    </div>
  )
}
