'use client'

import React, { useState } from 'react'
import { deleteFunnel } from '@/app/actions/funnels'
import { Trash2 } from 'lucide-react'

interface Props {
  funnelId: string
  funnelName: string
  isPublished: boolean
  onDeleted: () => void
  inline?: boolean
}

export default function DeleteFunnelButton({ funnelId, funnelName, inline }: Props) {
  const [loading, setLoading] = useState(false)

  async function handleDelete() {
    if (loading) return
    setLoading(true)
    try {
      const result = await deleteFunnel(funnelId)
      if (result.success) {
        window.location.href = '/funnels'
      } else {
        alert('Erro ao excluir: ' + (result.error ?? 'tente novamente'))
        setLoading(false)
      }
    } catch (e) {
      alert('Erro: ' + String(e))
      setLoading(false)
    }
  }

  if (inline) {
    return (
      <button
        onClick={handleDelete}
        disabled={loading}
        className="w-full text-left flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition-colors disabled:opacity-50"
        style={{ color: '#ef4444' }}
        onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#FEF2F2'}
        onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
      >
        {loading ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> : <Trash2 size={15} />}
        {loading ? 'Excluindo...' : `Excluir "${funnelName}"`}
      </button>
    )
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="p-2 rounded-lg transition-colors disabled:opacity-50"
      style={{ border: '1px solid #E2E8F0', color: '#ef4444' }}
      title="Excluir funil"
      onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#FEF2F2'}
      onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
    >
      {loading
        ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
        : <Trash2 size={15} />}
    </button>
  )
}
