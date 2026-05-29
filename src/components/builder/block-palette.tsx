'use client'

import type { BlockType } from '@/types'

interface BlockDef {
  type: BlockType
  icon: string
  label: string
  color: string
}

const BLOCKS: BlockDef[] = [
  { type: 'message', icon: '💬', label: 'Mensagem', color: 'bg-green-100 hover:bg-green-200 border-green-300 text-green-800' },
  { type: 'condition', icon: '⚡', label: 'Condição', color: 'bg-yellow-100 hover:bg-yellow-200 border-yellow-300 text-yellow-800' },
  { type: 'delay', icon: '⏰', label: 'Delay', color: 'bg-blue-100 hover:bg-blue-200 border-blue-300 text-blue-800' },
  { type: 'tag', icon: '🏷️', label: 'Tag', color: 'bg-purple-100 hover:bg-purple-200 border-purple-300 text-purple-800' },
  { type: 'sale', icon: '💰', label: 'Venda', color: 'bg-orange-100 hover:bg-orange-200 border-orange-300 text-orange-800' },
]

interface Props {
  onAddNode: (type: BlockType) => void
}

export default function BlockPalette({ onAddNode }: Props) {
  return (
    <div className="w-48 bg-white border-r border-gray-200 flex flex-col p-3 gap-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Blocos</p>
      {BLOCKS.map((block) => (
        <button
          key={block.type}
          onClick={() => onAddNode(block.type)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition ${block.color}`}
        >
          <span>{block.icon}</span>
          <span>{block.label}</span>
        </button>
      ))}
    </div>
  )
}
