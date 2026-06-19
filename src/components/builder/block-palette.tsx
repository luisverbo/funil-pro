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
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
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
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
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
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        ),
      },
      {
        type: 'funnel_page',
        label: 'Página',
        desc: 'Envia link de página',
        color: '#8b5cf6',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="9" y1="21" x2="9" y2="9" />
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
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
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
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
          </svg>
        ),
      },
      {
        type: 'goto',
        label: 'Ir para etapa',
        desc: 'Redireciona para outro bloco',
        color: '#8b5cf6',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <polyline points="9,18 15,12 9,6" />
          </svg>
        ),
      },
      {
        type: 'ab_test',
        label: 'Divisão A/B',
        desc: 'Divide leads em variantes',
        color: '#ec4899',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <line x1="4" y1="12" x2="20" y2="12" /><line x1="12" y1="4" x2="12" y2="20" />
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
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
        ),
      },
      {
        type: 'sale',
        label: 'Venda',
        desc: 'Envia link de pagamento',
        color: '#ef4444',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        ),
      },
      {
        type: 'remove_from_funnel',
        label: 'Remover do funil',
        desc: 'Encerra jornada do lead',
        color: '#ef4444',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ),
      },
      {
        type: 'agent',
        label: 'Agente IA',
        desc: 'Ativa atendimento inteligente',
        color: '#6366f1',
        scaleOnly: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" /><path d="M12 7v4" />
            <line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'ANOTAÇÕES',
    blocks: [
      {
        type: 'note',
        label: 'Nota',
        desc: 'Anotação no canvas (não executa)',
        color: '#ca8a04',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
        ),
      },
    ],
  },
]

interface Props {
  onBlockClick?: (type: string) => void
  mode?: 'sidebar' | 'sheet'
  tenantPlan?: string
}

export default function BlockPalette({ onBlockClick, mode = 'sidebar', tenantPlan }: Props) {
  const isScale = tenantPlan === 'scale'
  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('application/reactflow', type)
    e.dataTransfer.effectAllowed = 'move'
  }

  if (mode === 'sheet') {
    return (
      <div className="p-4 space-y-5">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-[11px] font-semibold uppercase mb-2 px-1" style={{ letterSpacing: '1px', color: '#94A3B8' }}>
              {group.title}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {group.blocks.map((block) => {
                const locked = !!(block as { scaleOnly?: boolean }).scaleOnly && !isScale
                return (
                <button
                  key={block.type}
                  onClick={() => { if (!locked) onBlockClick?.(block.type) }}
                  disabled={locked}
                  title={locked ? 'Disponível no plano Scale' : undefined}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors active:scale-[0.98] ${locked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  style={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0' }}
                >
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${block.color}14`, color: block.color }}>
                    {block.icon}
                  </div>
                  <p className="text-[13px] font-medium" style={{ color: '#1E293B' }}>{block.label}</p>
                </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <aside className="flex flex-col overflow-hidden shrink-0" style={{ width: 220, backgroundColor: '#FFFFFF', borderRight: '1px solid #E2E8F0' }}>
      <div className="shrink-0 px-4 py-3.5" style={{ borderBottom: '1px solid #F1F5F9' }}>
        <p className="text-[11px] font-semibold uppercase" style={{ letterSpacing: '1px', color: '#94A3B8' }}>Blocos</p>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ padding: '12px 8px' }}>
        {GROUPS.map((group) => (
          <div key={group.title} className="mb-5">
            <p className="text-[11px] font-semibold uppercase px-2 mb-2" style={{ letterSpacing: '1px', color: '#94A3B8' }}>
              {group.title}
            </p>
            <div className="space-y-1">
              {group.blocks.map((block) => {
                const locked = !!(block as { scaleOnly?: boolean }).scaleOnly && !isScale
                return (
                <div
                  key={block.type}
                  draggable={!locked}
                  onDragStart={(e) => { if (locked) { e.preventDefault(); return } onDragStart(e, block.type) }}
                  title={locked ? 'Disponível no plano Scale' : undefined}
                  className={`flex items-center gap-3 rounded-lg select-none transition-colors ${locked ? 'cursor-not-allowed opacity-50' : 'cursor-grab active:cursor-grabbing'}`}
                  style={{ padding: '8px 10px' }}
                  onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = '#F8FAFC'}
                  onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'}
                >
                  <div
                    className="rounded-lg flex items-center justify-center shrink-0"
                    style={{ width: 34, height: 34, backgroundColor: `${block.color}14`, color: block.color }}
                  >
                    {block.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium truncate" style={{ color: '#1E293B' }}>{block.label}</p>
                    <p className="text-[12px] truncate mt-0.5" style={{ color: '#94A3B8' }}>{block.desc}</p>
                  </div>
                  {locked ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 shrink-0" style={{ color: '#94A3B8' }}>
                      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 shrink-0 opacity-20">
                      <circle cx="9" cy="5" r="1" fill="currentColor" /><circle cx="9" cy="12" r="1" fill="currentColor" /><circle cx="9" cy="19" r="1" fill="currentColor" />
                      <circle cx="15" cy="5" r="1" fill="currentColor" /><circle cx="15" cy="12" r="1" fill="currentColor" /><circle cx="15" cy="19" r="1" fill="currentColor" />
                    </svg>
                  )}
                </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 px-4 py-3" style={{ borderTop: '1px solid #F1F5F9', backgroundColor: '#FAFAFA' }}>
        <p className="text-[12px] leading-relaxed" style={{ color: '#94A3B8' }}>
          Arraste para o canvas.
        </p>
      </div>
    </aside>
  )
}
