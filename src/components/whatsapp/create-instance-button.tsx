'use client'

import React, { useCallback, useEffect, useState, useTransition } from 'react'
import { createWhatsappInstance } from '@/app/actions/whatsapp'
import { Plus, X } from 'lucide-react'

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export default function CreateInstanceButton() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'qr'>('form')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [qrBase64, setQrBase64] = useState<string | null>(null)
  const [loadingQr, setLoadingQr] = useState(false)
  const [connStatus, setConnStatus] = useState<'waiting' | 'connected'>('waiting')
  const [isPending, startTransition] = useTransition()

  const fetchQr = useCallback(async (id: string) => {
    setLoadingQr(true)
    try {
      const res = await fetch(`/api/whatsapp/${id}/qrcode`)
      if (!res.ok) return
      const data = await res.json()
      const base64 = data?.qrcode?.base64 ?? data?.base64
      if (base64) setQrBase64(base64)
    } catch {} finally {
      setLoadingQr(false)
    }
  }, [])

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/whatsapp/${id}/status`)
      if (!res.ok) return
      const data = await res.json()
      if (data.dbStatus === 'connected') setConnStatus('connected')
    } catch {}
  }, [])

  useEffect(() => {
    if (!instanceId || step !== 'qr' || connStatus === 'connected') return
    const interval = setInterval(() => pollStatus(instanceId), 3000)
    return () => clearInterval(interval)
  }, [instanceId, step, connStatus, pollStatus])

  useEffect(() => {
    if (connStatus !== 'connected') return
    const t = setTimeout(() => handleClose(), 2200)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connStatus])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    const fd = new FormData()
    fd.set('name', name.trim())
    fd.set('phone', phone.trim())
    startTransition(async () => {
      const result = await createWhatsappInstance(fd)
      if (result.error) {
        alert(result.error)
      } else if (result.instanceId) {
        setInstanceId(result.instanceId)
        setStep('qr')
        fetchQr(result.instanceId)
      }
    })
  }

  const handleClose = () => {
    setOpen(false)
    setStep('form')
    setName('')
    setPhone('')
    setInstanceId(null)
    setQrBase64(null)
    setLoadingQr(false)
    setConnStatus('waiting')
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm"
        style={{ backgroundColor: '#25D366' }}
      >
        <Plus size={15} strokeWidth={2.5} />
        Nova Instância
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => !isPending && handleClose()} />

          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden" style={{ animation: 'fadeInUp 0.2s ease both' }}>
            {/* Close */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X size={16} />
            </button>

            {step === 'form' ? (
              <div className="p-6">
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-gray-900">Nova Instância WhatsApp</h2>
                  <p className="text-sm text-gray-500 mt-0.5">Conecte um número para enviar mensagens pelo seu funil</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Nome da instância <span className="text-red-500">*</span>
                    </label>
                    <input
                      autoFocus
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Vendas Emagrecimento"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition"
                      required
                    />
                    {name.trim() && (
                      <p className="mt-1.5 text-xs text-gray-400">
                        ID: <span className="font-mono text-gray-500">{slugify(name)}</span>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Número <span className="text-gray-400 font-normal">(opcional — só para referência)</span>
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+55 11 99999-9999"
                      className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition"
                    />
                  </div>

                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={handleClose}
                      className="flex-1 px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={!name.trim() || isPending}
                      className="flex-1 px-4 py-2.5 text-white text-sm font-semibold rounded-xl transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                      style={{ backgroundColor: '#25D366' }}
                    >
                      {isPending ? (
                        <>
                          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                          </svg>
                          Criando…
                        </>
                      ) : (
                        'Criar e conectar →'
                      )}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div className="p-6 text-center">
                {connStatus === 'connected' ? (
                  <div className="flex flex-col items-center gap-4 py-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={2.5} className="w-9 h-9">
                        <polyline points="20,6 9,17 4,12"/>
                      </svg>
                    </div>
                    <div>
                      <p className="text-xl font-bold text-emerald-600">Conectado! ✓</p>
                      <p className="text-sm text-gray-500 mt-1">Seu WhatsApp está pronto para uso</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: '#25D366' }}>
                      <svg viewBox="0 0 24 24" fill="white" className="w-7 h-7">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.025.502 3.935 1.386 5.611L0 24l6.545-1.371A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.148-1.424l-.369-.22-3.882.814.825-3.802-.24-.381A9.944 9.944 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                      </svg>
                    </div>

                    <h3 className="font-semibold text-gray-900 mb-1">Escaneie o QR Code</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Abra o WhatsApp → <strong>Aparelhos conectados</strong> → Conectar aparelho
                    </p>

                    {loadingQr ? (
                      <div className="flex flex-col items-center gap-3 py-8">
                        <svg className="animate-spin w-8 h-8 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                        </svg>
                        <p className="text-sm text-gray-400">Gerando QR Code…</p>
                      </div>
                    ) : qrBase64 ? (
                      <div className="flex flex-col items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={qrBase64.startsWith('data:') ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                          alt="QR Code WhatsApp"
                          className="w-52 h-52 rounded-xl border border-gray-100 mx-auto"
                        />
                        <button
                          onClick={() => instanceId && fetchQr(instanceId)}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          ↻ Atualizar QR Code
                        </button>
                        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-1.5">
                          <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                          </svg>
                          Aguardando conexão…
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => instanceId && fetchQr(instanceId)}
                        className="px-6 py-2.5 rounded-xl text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                        style={{ backgroundColor: '#25D366' }}
                      >
                        Mostrar QR Code
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}
