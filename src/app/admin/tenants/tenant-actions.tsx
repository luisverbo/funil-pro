'use client'

import { useState, useTransition } from 'react'
import { changeTenantPlan } from '@/app/actions/admin'

const PLANS = ['starter', 'pro', 'scale'] as const

interface Props {
  tenantId: string
  currentPlan: string
}

export default function TenantActions({ tenantId, currentPlan }: Props) {
  const [plan, setPlan] = useState(currentPlan)
  const [isPending, startTransition] = useTransition()

  function handlePlanChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newPlan = e.target.value
    setPlan(newPlan)
    startTransition(async () => {
      await changeTenantPlan(tenantId, newPlan)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={plan}
        onChange={handlePlanChange}
        disabled={isPending}
        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 disabled:opacity-50"
      >
        {PLANS.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <button
        disabled
        className="text-xs border border-red-200 text-red-500 rounded px-2 py-1 opacity-40 cursor-not-allowed"
        title="Em breve"
      >
        Suspender
      </button>
    </div>
  )
}
