'use client'

import React from 'react'

const GROUPS = [
  {
    title: 'INÍCIO',
    blocks: [
      {
        type: 'entry',
        label: 'Entrada',
        desc: 'Ponto de início do funil',
        color: '#6366f1',
        bg: '#eef2ff',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
          </svg>
        ),
      },
      {
        type: 'cart_abandoned',
        label: 'Carr. Abandonado',
        desc: 'Gatilho de carrinho abandonado',
        color: '#6366f1',
        bg: '#eef2ff',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'COMUNICAÇÃO',
    blocks: [
      {
        type: 'message',
        label: 'Mensagem',
        desc: 'Envia WA ou e-mail',
        color: '#0ea5e9',
        bg: '#f0f9ff',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'LÓGICA',
    blocks: [
      {
        type: 'condition',
        label: 'Condição',
        desc: 'Bifurca o fluxo (Sim / Não)',
        color: '#f59e0b',
        bg: '#fffbeb',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
            <path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 6H8a2 2 0 0 0-2 2v7" />
            <circle cx="6" cy="18" r="3" />
          </svg>
        ),
      },
      {
        type: 'delay',
        label: 'Atraso',
        desc: 'Aguarda antes de continuar',
        color: '#8b5cf6',
        bg: '#f5f3ff',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'AÇÕES',
    blocks: [
      {
        type: 'tag',
        label: 'Tag',
        desc: 'Marca o lead com uma tag',
        color: '#10b981',
        bg: '#ecfdf5',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
        ),
      },
      {
        type: 'sale',
        label: 'Venda',
        desc: 'Envia link de pagamento',
        color: '#f97316',
        bg: '#fff7ed',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        ),
      },
    ],
  },
]

interface Props {
  onBlockClick?: (type: string) => void
  mode?: 'sidebar' | 'sheet'
}

export default function BlockPalette({ onBlockClick, mode = 'sidebar' }: Props) {
  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('application/reactflow', type)
    e.dataTransfer.effectAllowed = 'move'
  }

  if (mode === 'sheet') {
    return (
      <div className="p-4 space-y-4">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
              {group.title}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {group.blocks.map((block) => (
                <button
                  key={block.type}
                  onClick={() => onBlockClick?.(block.type)}
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-white text-left active:bg-gray-50 transition-colors"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: block.bg, color: block.color }}
                  >
                    {block.icon}
                  </div>
                  <p className="text-sm font-medium text-gray-800">{block.label}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <aside className="w-56 bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Blocos</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2 px-1">
              {group.title}
            </p>
            <div className="space-y-1.5">
              {group.blocks.map((block) => (
                <div
                  key={block.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, block.type)}
                  className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-100 bg-white cursor-grab active:cursor-grabbing select-none hover:border-gray-200 hover:shadow-sm transition-all duration-150"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: block.bg, color: block.color }}
                  >
                    {block.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{block.label}</p>
                    <p className="text-xs text-gray-400 truncate">{block.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
        <p className="text-xs text-gray-400 leading-relaxed">
          Arraste um bloco para o canvas.
        </p>
      </div>
    </aside>
  )
}
