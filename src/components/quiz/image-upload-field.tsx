'use client'

import React, { useRef, useState } from 'react'
import { uploadQuizImage } from '@/app/actions/upload'

interface Props {
  value: string
  onChange: (url: string) => void
  label?: string
  compact?: boolean
}

export default function ImageUploadField({ value, onChange, label, compact = false }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    const result = await uploadQuizImage(fd)
    setUploading(false)
    if (result.url) onChange(result.url)
    else setError(result.error ?? 'Erro no upload')
  }

  const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white'

  if (compact) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          {value ? (
            <img src={value} alt="" className="w-8 h-8 rounded object-cover border border-gray-200 shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center text-gray-300 text-xs">🖼</div>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50 shrink-0"
          >
            {uploading ? '...' : value ? 'Trocar' : 'Foto'}
          </button>
          {value && (
            <button type="button" onClick={() => onChange('')} className="text-[10px] text-red-400 hover:text-red-600 shrink-0">×</button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
        </div>
        {/* #13: erro também aparece no modo compact (antes falhava em silêncio) */}
        {error && <p className="text-[10px] text-red-500 leading-tight">{error}</p>}
      </div>
    )
  }

  return (
    <div>
      {label && <label className="block text-xs font-semibold text-gray-500 mb-1.5">{label}</label>}
      {value && (
        <div className="relative mb-2 group">
          <img src={value} alt="" className="w-full max-h-32 object-cover rounded-lg border border-gray-200" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute top-1.5 right-1.5 w-6 h-6 bg-white/90 rounded-lg text-red-500 text-sm shadow opacity-0 group-hover:opacity-100 transition"
          >×</button>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex-1 py-2 text-xs font-medium border border-dashed border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 transition disabled:opacity-50"
        >
          {uploading ? 'Enviando…' : '📤 Enviar imagem'}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className={inputCls + ' mt-2 text-xs'}
        placeholder="ou cole uma URL https://..."
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}
