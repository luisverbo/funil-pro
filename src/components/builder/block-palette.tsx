'use client'

import React from 'react'

const BLOCKS = [
  {
    type: 'message',
    label: 'Mensagem',
    desc: 'Envia WA ou e-mail',
    color: '#0ea5e9',
    bg: '#f0f9ff',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    type: 'condition',
    label: 'Condição',
    desc: 'Bifurca o fluxo',
    color: '#f59e0b',
    bg: '#fffbeb',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
        <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 6H8a2 2 0 0 0-2 2v7" /><circle cx="6" cy="18" r="3" />
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
        <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
      </svg>
    ),
  },
  {
    type: 'tag',
    label: 'Tag',
    desc: 'Marca o lead',
    color: '#10b981',
    bg: '#ecfdf5',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" />
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
]

export default function BlockPalette() {
  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('application/reactflow', type)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="w-60 bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Blocos</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {BLOCKS.map((block) => (
          <div
            key={block.type}
            draggable
            onDragStart={(e) => onDragStart(e, block.type)}
            className="group flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-white cursor-grab active:cursor-grabbing select-none transition-all duration-150"
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLElement
              el.style.borderColor = block.color
              el.style.backgroundColor = block.bg
              el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLElement
              el.style.borderColor = '#f3f4f6'
              el.style.backgroundColor = 'white'
              el.style.boxShadow = 'none'
            }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: block.bg, color: block.color }}
            >
              {block.icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">{block.label}</p>
              <p className="text-xs text-gray-400 truncate">{block.desc}</p>
            </div>
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-300 group-hover:text-gray-400 shrink-0 ml-auto">
              <circle cx="9" cy="5" r="1.5" fill="currentColor" />
              <circle cx="9" cy="12" r="1.5" fill="currentColor" />
              <circle cx="9" cy="19" r="1.5" fill="currentColor" />
              <circle cx="15" cy="5" r="1.5" fill="currentColor" />
              <circle cx="15" cy="12" r="1.5" fill="currentColor" />
              <circle cx="15" cy="19" r="1.5" fill="currentColor" />
            </svg>
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
        <p className="text-xs text-gray-400 leading-relaxed">
          Arraste um bloco para o canvas para adicioná-lo ao funil.
        </p>
      </div>
    </aside>
  )
}
