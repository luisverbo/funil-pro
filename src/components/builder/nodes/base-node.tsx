import { Handle, Position } from '@xyflow/react'
import type { ReactNode } from 'react'

interface Props {
  headerColor: string
  icon: string
  label: string
  id: string
  onDelete: (id: string) => void
  children?: ReactNode
  hiddenBottomHandle?: boolean
  extraHandles?: ReactNode
}

export default function BaseNode({
  headerColor,
  icon,
  label,
  id,
  onDelete,
  children,
  hiddenBottomHandle,
  extraHandles,
}: Props) {
  return (
    <div className="min-w-[200px] rounded-xl border border-gray-200 shadow-sm bg-white overflow-hidden">
      <Handle type="target" position={Position.Top} className="!bg-gray-400" />

      <div className={`${headerColor} px-3 py-2 flex items-center justify-between`}>
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{icon}</span>
          <span className="text-sm font-semibold text-white">{label}</span>
        </div>
        <button
          onClick={() => onDelete(id)}
          className="text-white/70 hover:text-white text-xs leading-none px-1"
          title="Remover"
        >
          ✕
        </button>
      </div>

      {children && (
        <div className="px-3 py-2 text-sm text-gray-700">
          {children}
        </div>
      )}

      {!hiddenBottomHandle && !extraHandles && (
        <Handle type="source" position={Position.Bottom} className="!bg-gray-400" />
      )}
      {extraHandles}
    </div>
  )
}
