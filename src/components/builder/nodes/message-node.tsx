'use client'

import React, { useCallback } from 'react'
import { useReactFlow, type NodeProps } from '@xyflow/react'
import BaseNode from './base-node'
import type { FunnelNodeData } from '@/types'

const ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

type MediaType = 'none' | 'image' | 'video' | 'document'

interface MessageConfig {
  channel?: string
  body?: string
  media_type?: MediaType
  media_url?: string
}

const MEDIA_LABELS: Record<MediaType, string> = {
  none: 'Sem anexo',
  image: '🖼️ Imagem',
  video: '🎬 Vídeo',
  document: '📄 PDF / Arquivo',
}

export default function MessageNode({ id, data, selected }: NodeProps) {
  const nodeData = data as unknown as FunnelNodeData
  const { setNodes } = useReactFlow()
  const config = (nodeData.config ?? {}) as MessageConfig

  const update = useCallback((patch: Partial<MessageConfig>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, config: { ...config, ...patch } } } : n
      )
    )
  }, [id, config, setNodes])

  const handleDelete = useCallback(() => {
    setNodes((nds) => nds.filter((n) => n.id !== id))
  }, [id, setNodes])

  const mediaType = config.media_type ?? 'none'

  return (
    <BaseNode
      id={id}
      selected={selected}
      headerColor="#0ea5e9"
      headerBg="#f0f9ff"
      icon={ICON}
      typeLabel="Mensagem"
      onDelete={handleDelete}
    >
      {/* Canal */}
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">Canal</label>
        <select
          value={config.channel ?? 'whatsapp'}
          onChange={(e) => update({ channel: e.target.value })}
          className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
        >
          <option value="whatsapp">WhatsApp</option>
          <option value="email">E-mail</option>
        </select>
      </div>

      {/* Texto */}
      <div>
        <label className="text-xs font-medium text-gray-500 block mb-1">
          {mediaType !== 'none' ? 'Legenda / Texto' : 'Mensagem'}
        </label>
        <textarea
          value={config.body ?? ''}
          onChange={(e) => update({ body: e.target.value })}
          placeholder="Digite o texto..."
          rows={3}
          className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
        />
      </div>

      {/* Mídia — só WA */}
      {(config.channel ?? 'whatsapp') === 'whatsapp' && (
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1">Anexo</label>
          <select
            value={mediaType}
            onChange={(e) => update({ media_type: e.target.value as MediaType, media_url: '' })}
            className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            {(Object.keys(MEDIA_LABELS) as MediaType[]).map((k) => (
              <option key={k} value={k}>{MEDIA_LABELS[k]}</option>
            ))}
          </select>

          {mediaType !== 'none' && (
            <div className="mt-1.5">
              <input
                type="url"
                value={config.media_url ?? ''}
                onChange={(e) => update({ media_url: e.target.value })}
                placeholder={
                  mediaType === 'image' ? 'URL da imagem (https://...)' :
                  mediaType === 'video' ? 'URL do vídeo (https://...)' :
                  'URL do arquivo PDF (https://...)'
                }
                className="nodrag w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <p className="text-xs text-gray-400 mt-1 leading-tight">
                Use um link público direto para o arquivo.
              </p>
            </div>
          )}
        </div>
      )}
    </BaseNode>
  )
}
