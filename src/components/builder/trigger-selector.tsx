'use client'

import { useState, useTransition } from 'react'
import { saveFunnelProductTriggers } from '@/app/actions/triggers'

interface Trigger {
  id?: string
  platform: string
  product_name: string
  trigger_event: 'purchase' | 'abandoned_cart'
}

interface Props {
  funnelId: string
  initialTriggers: Trigger[]
}

const PLATFORMS = ['Kiwify', 'Hotmart', 'Eduzz', 'Yampi', 'Outro']
const EVENT_LABELS = {
  purchase: '💰 Compra aprovada',
  abandoned_cart: '🛒 Carrinho abandonado',
}

export default function TriggerSelector({ funnelId, initialTriggers }: Props) {
  const [open, setOpen] = useState(false)
  const [triggers, setTriggers] = useState<Trigger[]>(initialTriggers)
  const [platform, setPlatform] = useState('Kiwify')
  const [productName, setProductName] = useState('')
  const [event, setEvent] = useState<'purchase' | 'abandoned_cart'>('purchase')
  const [isPending, startTransition] = useTransition()

  const triggerCount = triggers.length

  function handleAdd() {
    if (!productName.trim()) return
    const next = [...triggers, { platform, product_name: productName.trim(), trigger_event: event }]
    setTriggers(next)
    setProductName('')
    startTransition(() => saveFunnelProductTriggers(funnelId, next))
  }

  function handleRemove(index: number) {
    const next = triggers.filter((_, i) => i !== index)
    setTriggers(next)
    startTransition(() => saveFunnelProductTriggers(funnelId, next))
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 transition-colors font-medium"
      >
        <span>
          {triggerCount === 0
            ? '📝 Sem gatilho'
            : triggerCount === 1
            ? `${triggers[0].platform} · ${triggers[0].product_name}`
            : `${triggerCount} gatilhos ativos`}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 shrink-0">
          <polyline points="6,9 12,15 18,9" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">

            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-800">Gatilhos de entrada</p>
              <p className="text-xs text-gray-400 mt-0.5">O funil é ativado quando uma dessas condições ocorrer</p>
            </div>

            {/* Existing triggers */}
            <div className="max-h-48 overflow-y-auto">
              {triggers.length === 0 && (
                <p className="text-xs text-gray-400 px-4 py-3">Nenhum gatilho. Adicione abaixo.</p>
              )}
              {triggers.map((t, i) => (
                <div key={i} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 group">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{t.product_name}</p>
                    <p className="text-xs text-gray-400">{t.platform} · {EVENT_LABELS[t.trigger_event]}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(i)}
                    disabled={isPending}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Add trigger form */}
            <div className="border-t border-gray-100 p-3 space-y-2">
              <p className="text-xs font-medium text-gray-600">Adicionar gatilho</p>

              <div className="flex gap-2">
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                </select>
                <select
                  value={event}
                  onChange={(e) => setEvent(e.target.value as 'purchase' | 'abandoned_cart')}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 flex-1"
                >
                  <option value="purchase">💰 Compra</option>
                  <option value="abandoned_cart">🛒 Abandono</option>
                </select>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder="Nome do produto"
                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <button
                  onClick={handleAdd}
                  disabled={!productName.trim() || isPending}
                  className="text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg font-medium whitespace-nowrap"
                >
                  + Adicionar
                </button>
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  )
}
