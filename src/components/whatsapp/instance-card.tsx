'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
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

const STATE_CONFIG = {
  connected:    { bg: '#F0FDF4', border: '#D1FAE5', dot: '#10b981', dotAnim: false, label: 'Conectado' },
  connecting:   { bg: '#FFFBEB', border: '#FEF3C7', dot: '#f59e0b', dotAnim: true,  label: 'Conectando…' },
  disconnected: { bg: '#FFF5F5', border: '#FEE2E2', dot: '#ef4444', dotAnim: false, label: 'Desconectado' },
}

export default function InstanceCard({ instance }: Props) {
  const [status, setStatus] = useState(instance.status)
  const [qrBase64, setQrBase64] = useState<string | null>(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/whatsapp/${instance.id}/status`)
      if (!res.ok) return
      const data = await res.json()
      const newStatus = data.dbStatus as Instance['status']
      setStatus(newStatus)
      if (newStatus === 'connected') setQrBase64(null)
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

  useEffect(() => {
    if (status === 'connected') return
    const id = setInterval(fetchStatus, 5000)
    return () => clearInterval(id)
  }, [status, fetchStatus])

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleDelete = async () => {
    setMenuOpen(false)
    if (!confirm('Remover esta instância WhatsApp?')) return
    setDeleting(true)
    await deleteWhatsappInstance(instance.id)
  }

  const handleShowQr = () => {
    setMenuOpen(false)
    setQrModalOpen(true)
    fetchQr()
  }

  const handleCopyNumber = () => {
    setMenuOpen(false)
    const num = instance.phone_number ?? instance.instance_name
    navigator.clipboard.writeText(num).catch(() => {})
  }

  const cfg = STATE_CONFIG[status] ?? STATE_CONFIG.disconnected
  const displayName = instance.display_name ?? instance.phone_number ?? instance.instance_name
  const displayId = instance.description ?? instance.instance_name

  return (
    <>
      <div
        className="rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 hover:scale-[1.01] hover:shadow-md"
        style={{
          backgroundColor: cfg.bg,
          border: `1px solid ${cfg.border}`,
          animation: 'fadeInUp 0.3s ease both',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          {/* Avatar */}
          <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: '#25D366' }}>
            <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
            </svg>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 text-base leading-tight truncate">{displayName}</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate">{displayId}</p>
          </div>

          {/* ⋮ Menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-white/60 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-9 z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 w-44 text-sm">
                <button onClick={handleShowQr} className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
                    <path d="M14 14h.01M14 17h3M17 14v3M20 14h.01M20 20h.01"/>
                  </svg>
                  Ver QR Code
                </button>
                <button onClick={handleCopyNumber} className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  Copiar número
                </button>
                <div className="border-t border-gray-100 my-1"/>
                <button onClick={handleDelete} disabled={deleting} className="w-full px-4 py-2 text-left text-red-500 hover:bg-red-50 flex items-center gap-2.5 transition-colors disabled:opacity-50">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
                    <polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                  {deleting ? 'Removendo…' : 'Excluir'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Status row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: cfg.dot,
                animation: cfg.dotAnim ? 'pulse 1.5s ease-in-out infinite' : undefined,
              }}
            />
            <span className="text-sm font-medium" style={{ color: cfg.dot }}>{cfg.label}</span>
          </div>

          {status === 'disconnected' && (
            <button
              onClick={handleShowQr}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-white transition-colors"
              style={{ backgroundColor: '#25D366' }}
            >
              Reconectar
            </button>
          )}
          {status === 'connecting' && (
            <svg className="animate-spin w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
          )}
          {status === 'connected' && (
            <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={2.5} className="w-4 h-4">
              <polyline points="20,6 9,17 4,12"/>
            </svg>
          )}
        </div>
      </div>

      {/* QR Code Modal */}
      {qrModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setQrModalOpen(false)}/>
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center" style={{ animation: 'fadeInUp 0.2s ease both' }}>
            <button
              onClick={() => setQrModalOpen(false)}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>

            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: '#25D366' }}>
              <svg viewBox="0 0 24 24" fill="white" className="w-7 h-7">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
              </svg>
            </div>

            <h3 className="font-semibold text-gray-900 mb-1">Conectar WhatsApp</h3>
            <p className="text-sm text-gray-500 mb-4">Abra o WhatsApp → Aparelhos conectados → Conectar aparelho</p>

            {status === 'connected' ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={2.5} className="w-8 h-8">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                </div>
                <p className="font-semibold text-emerald-600 text-lg">Conectado!</p>
                <button onClick={() => setQrModalOpen(false)} className="mt-2 px-6 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors">
                  Fechar
                </button>
              </div>
            ) : loadingQr ? (
              <div className="flex flex-col items-center gap-3 py-8">
                <svg className="animate-spin w-8 h-8 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
                <p className="text-sm text-gray-400">Carregando QR Code…</p>
              </div>
            ) : qrBase64 ? (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                  alt="QR Code WhatsApp"
                  className="w-52 h-52 rounded-xl border border-gray-100"
                />
                <button onClick={fetchQr} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
                  ↻ Atualizar QR Code
                </button>
                <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">Aguardando conexão…</p>
              </div>
            ) : (
              <div className="py-4">
                <button onClick={fetchQr} className="px-6 py-2.5 rounded-xl text-white text-sm font-medium hover:opacity-90 transition-opacity" style={{ backgroundColor: '#25D366' }}>
                  Mostrar QR Code
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}
