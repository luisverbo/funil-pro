'use client'

import React, { useState } from 'react'
import { uploadQuizImage } from '@/app/actions/upload'

// Campo de imagem dos painéis de configuração: upload direto (Supabase Storage)
// ou URL manual — antes só existia URL.
export function ImageInput({ label, value, onChange }: { label: string; value?: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true); setErr(null)
    const fd = new FormData(); fd.append('file', file)
    const r = await uploadQuizImage(fd)
    setBusy(false)
    if (r.error) setErr(r.error)
    else if (r.url) onChange(r.url)
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {value ? (
        <div className="flex items-center gap-2 mb-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="w-14 h-14 rounded-lg object-cover border border-gray-200" />
          <button type="button" onClick={() => onChange('')} className="text-xs text-red-500 hover:underline">remover</button>
        </div>
      ) : (
        <label className={`flex items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-lg py-2.5 text-xs text-gray-500 cursor-pointer hover:border-indigo-300 mb-1.5 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
          {busy ? 'Enviando…' : '📷 Enviar imagem'}
          <input type="file" accept="image/*" className="hidden" onChange={pick} />
        </label>
      )}
      <input
        className="w-full border border-gray-200 rounded-lg p-2 text-sm"
        placeholder="ou cole uma URL https://…"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
      {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
    </div>
  )
}
