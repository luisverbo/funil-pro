'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Funnel {
  id: string
  name: string
}

interface Props {
  funnels: Funnel[]
  currentFunnelId: string
}

export default function FunnelFilter({ funnels, currentFunnelId }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString())
    if (e.target.value) {
      params.set('funnel_id', e.target.value)
    } else {
      params.delete('funnel_id')
    }
    router.push(`/metrics?${params.toString()}`)
  }

  return (
    <select
      value={currentFunnelId}
      onChange={handleChange}
      className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
    >
      <option value="">Todos os funis</option>
      {funnels.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  )
}
