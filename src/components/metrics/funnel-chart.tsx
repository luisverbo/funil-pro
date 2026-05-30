'use client'

interface FunnelStep {
  blockId: string
  label: string
  blockType: string
  count: number
}

interface Props {
  steps: FunnelStep[]
}

export default function FunnelChart({ steps }: Props) {
  if (!steps || steps.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">Drop-off por Etapa</h3>
        <div className="py-10 text-center text-sm text-gray-400">
          Selecione um funil com leads para ver o drop-off
        </div>
      </div>
    )
  }

  const maxCount = steps[0]?.count || 1

  // Find the step with the highest drop-off
  let maxDropIdx = -1
  let maxDrop = 0
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].count
    const curr = steps[i].count
    const drop = prev > 0 ? ((prev - curr) / prev) * 100 : 0
    if (drop > maxDrop) {
      maxDrop = drop
      maxDropIdx = i
    }
  }

  const blockTypeLabel: Record<string, string> = {
    message: 'Mensagem',
    condition: 'Condição',
    delay: 'Aguardar',
    tag: 'Tag',
    sale: 'Venda',
    entry: 'Entrada',
    cart_abandoned: 'Carrinho',
    form: 'Formulário',
    page: 'Página',
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-800 mb-5">Drop-off por Etapa</h3>
      <div className="space-y-3">
        {steps.map((step, i) => {
          const pct = maxCount > 0 ? (step.count / maxCount) * 100 : 0
          const prev = steps[i - 1]?.count ?? step.count
          const dropPct = i > 0 && prev > 0 ? ((prev - step.count) / prev) * 100 : 0
          const isMaxDrop = i === maxDropIdx

          return (
            <div key={step.blockId}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-medium text-gray-500 shrink-0">
                    {blockTypeLabel[step.blockType] ?? step.blockType}
                  </span>
                  <span className="text-sm font-medium text-gray-800 truncate">{step.label}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  {i > 0 && dropPct > 0 && (
                    <span className={`text-xs font-semibold ${isMaxDrop ? 'text-red-600' : 'text-gray-400'}`}>
                      -{dropPct.toFixed(0)}%
                    </span>
                  )}
                  <span className="text-sm font-bold text-gray-700">{step.count.toLocaleString('pt-BR')}</span>
                </div>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isMaxDrop ? 'bg-red-400' : 'bg-indigo-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      {maxDropIdx >= 0 && (
        <p className="mt-4 text-xs text-red-500 font-medium">
          Maior queda: {steps[maxDropIdx].label} ({maxDrop.toFixed(0)}% de drop-off)
        </p>
      )}
    </div>
  )
}
