'use client'

interface FunnelStep {
  blockId: string
  label: string
  blockType: string
  count: number
}

interface Props {
  steps: FunnelStep[]
  funnelName?: string
}

export default function FunnelChart({ steps, funnelName }: Props) {
  if (!steps || steps.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Drop-off por Etapa</h3>
        <p className="text-xs text-gray-400 mb-6">Selecione um funil acima para ver onde seus leads estão saindo</p>
        <div className="py-10 flex flex-col items-center justify-center text-center gap-3">
          <svg className="w-10 h-10 text-gray-200" fill="none" viewBox="0 0 48 48"><path d="M8 10h32l-6 12H14L8 10Z" fill="currentColor" opacity=".4"/><path d="M14 22h20l-5 10H19L14 22Z" fill="currentColor" opacity=".6"/><path d="M19 32h10l-4 8h-2l-4-8Z" fill="currentColor"/></svg>
          <p className="text-sm text-gray-400">Selecione um funil acima para ver<br/>onde seus leads estão saindo</p>
        </div>
      </div>
    )
  }

  const maxCount = steps[0]?.count || 1

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
      <h3 className="text-sm font-semibold text-gray-800 mb-0.5">{funnelName ? `Drop-off — ${funnelName}` : 'Drop-off por Etapa'}</h3>
      <p className="text-xs text-gray-400 mb-5">Quantos leads passaram por cada etapa do funil</p>
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
