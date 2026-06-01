'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { listVersions, saveVersion, restoreVersion } from '@/app/actions/versions'
import type { FunnelVersion, VersionSnapshot } from '@/app/actions/versions'

interface Props {
  funnelId: string
  currentSnapshot: VersionSnapshot
  onRestore: (snapshot: VersionSnapshot) => void
  onClose: () => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

export default function VersionDrawer({ funnelId, currentSnapshot, onRestore, onClose }: Props) {
  const [versions, setVersions] = useState<FunnelVersion[]>([])
  const [label, setLabel] = useState('')
  const [isPending, startTransition] = useTransition()
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    listVersions(funnelId).then(setVersions)
  }, [funnelId])

  const handleSave = () => {
    startTransition(async () => {
      const result = await saveVersion(funnelId, currentSnapshot, label.trim() || undefined)
      if (result.success) {
        setLabel('')
        const updated = await listVersions(funnelId)
        setVersions(updated)
        setMsg({ text: 'Versão salva!', ok: true })
      } else {
        setMsg({ text: result.error ?? 'Erro', ok: false })
      }
      setTimeout(() => setMsg(null), 3000)
    })
  }

  const handleRestore = (versionId: string) => {
    startTransition(async () => {
      const result = await restoreVersion(funnelId, versionId)
      if (result.success && result.snapshot) {
        onRestore(result.snapshot)
        setConfirmId(null)
        setMsg({ text: 'Versão restaurada!', ok: true })
        setTimeout(() => setMsg(null), 3000)
      } else {
        setMsg({ text: result.error ?? 'Erro', ok: false })
        setTimeout(() => setMsg(null), 3000)
      }
    })
  }

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
        <p className="font-semibold text-gray-900 text-sm">Histórico de versões</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="p-4 border-b border-gray-100 shrink-0 space-y-2">
        <p className="text-xs text-gray-500 font-medium">Salvar versão atual</p>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Rótulo opcional (ex: antes do lançamento)"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-indigo-400"
        />
        <button
          onClick={handleSave}
          disabled={isPending}
          className="w-full text-sm font-medium py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? 'Salvando...' : 'Salvar versão'}
        </button>
        {msg && (
          <p className={`text-xs font-medium ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {versions.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-8">Nenhuma versão salva ainda.</p>
        )}
        {versions.map((v) => (
          <div key={v.id} className="border border-gray-200 rounded-xl p-3 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-gray-800">
                  v{v.version_number}{v.label ? ` — ${v.label}` : ''}
                </p>
                <p className="text-xs text-gray-400">{formatDate(v.created_at)}</p>
              </div>
              {confirmId === v.id ? (
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => handleRestore(v.id)}
                    disabled={isPending}
                    className="text-xs px-2 py-1 rounded bg-amber-500 text-white font-medium hover:bg-amber-600 disabled:opacity-50"
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmId(v.id)}
                  className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 shrink-0 font-medium"
                >
                  Restaurar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
