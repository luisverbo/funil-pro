'use client'

import React from 'react'
import { BRANCH_COLORS, type MindNode } from '@/lib/mindmap/types'

const EMOJIS = ['💡', '🎯', '🚀', '📌', '⭐', '🔥', '✅', '⚠️', '💰', '📈', '🧠', '❤️', '🔑', '📝', '⏰', '🎁']

export function NodeInspector({
  node, childCount, onChange, onDelete, onAddChild, onAddSibling, onClose,
}: {
  node: MindNode
  childCount: number
  onChange: (patch: Partial<MindNode>) => void
  onDelete: () => void
  onAddChild: () => void
  onAddSibling: () => void
  onClose: () => void
}) {
  const label = 'block text-xs font-semibold text-gray-500 mb-1.5'
  const input = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200'

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-sm">Item selecionado</h3>
        <button onClick={onClose} aria-label="Fechar painel" className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>

      <div>
        <label className={label} htmlFor="mm-label">Texto</label>
        <textarea id="mm-label" className={input + ' h-20 resize-none'} value={node.label}
          onChange={e => onChange({ label: e.target.value })} placeholder="Escreva a ideia…" />
      </div>

      <div>
        <label className={label} htmlFor="mm-note">Nota (opcional)</label>
        <textarea id="mm-note" className={input + ' h-16 resize-none'} value={node.note ?? ''}
          onChange={e => onChange({ note: e.target.value || undefined })} placeholder="Detalhe curto…" />
      </div>

      <div>
        <span className={label}>Cor do ramo</span>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onChange({ color: undefined })}
            title="Herdar do ramo" aria-label="Herdar cor do ramo"
            className={`w-7 h-7 rounded-full border-2 bg-white text-gray-400 text-[10px] flex items-center justify-center ${!node.color ? 'border-gray-800' : 'border-gray-200'}`}>
            ⊘
          </button>
          {BRANCH_COLORS.map(c => (
            <button key={c.key} onClick={() => onChange({ color: c.key })}
              title={c.label} aria-label={`Cor ${c.label}`}
              className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${node.color === c.key ? 'border-gray-800' : 'border-transparent'}`}
              style={{ background: c.solid }} />
          ))}
        </div>
      </div>

      <div>
        <span className={label}>Ícone</span>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => onChange({ icon: undefined })}
            aria-label="Sem ícone"
            className={`w-7 h-7 rounded-lg border text-gray-400 text-[10px] ${!node.icon ? 'border-gray-800' : 'border-gray-200'}`}>⊘</button>
          {EMOJIS.map(e => (
            <button key={e} onClick={() => onChange({ icon: e })}
              aria-label={`Ícone ${e}`}
              className={`w-7 h-7 rounded-lg border text-base leading-none transition-transform hover:scale-110 ${node.icon === e ? 'border-gray-800 bg-gray-50' : 'border-gray-200'}`}>{e}</button>
          ))}
        </div>
      </div>

      <div className="border-t border-gray-100 pt-3 flex flex-col gap-2">
        <button onClick={onAddChild}
          className="w-full py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">
          + Item filho <span className="text-[10px] opacity-60">(Tab)</span>
        </button>
        {node.parentId && (
          <button onClick={onAddSibling}
            className="w-full py-2 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
            + Item irmão <span className="text-[10px] opacity-60">(Enter)</span>
          </button>
        )}
        {node.parentId && (
          <button onClick={onDelete}
            className="w-full py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            Excluir{childCount > 0 ? ` (e ${childCount} abaixo)` : ''}
          </button>
        )}
      </div>
    </aside>
  )
}
