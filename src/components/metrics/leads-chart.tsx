'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Props {
  data: Array<{ date: string; leads: number; purchases: number }>
}

function formatDate(dateStr: string) {
  const [, month, day] = dateStr.split('-')
  return `${day}/${month}`
}

export default function LeadsChart({ data }: Props) {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Evolução de leads e conversões</h3>
        <p className="text-xs text-gray-400 mb-4">Leads captados vs compras realizadas no período</p>
        <div className="h-52 flex items-center justify-center text-gray-400 text-sm">
          Sem dados no período selecionado
        </div>
      </div>
    )
  }

  const chartData = data.map(d => ({ ...d, date: formatDate(d.date) }))

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-800 mb-0.5">Evolução de leads e conversões</h3>
      <p className="text-xs text-gray-400 mb-5">Leads captados vs compras realizadas no período</p>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={chartData} margin={{ top: 4, right: 16, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15}/>
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="gradPurchases" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ borderRadius: 10, border: '1px solid #e5e7eb', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
            labelStyle={{ fontWeight: 600, color: '#374151' }}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
          <Area
            type="monotone"
            dataKey="leads"
            name="Leads"
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#gradLeads)"
            dot={false}
            activeDot={{ r: 4, fill: '#6366f1' }}
          />
          <Area
            type="monotone"
            dataKey="purchases"
            name="Compras"
            stroke="#10b981"
            strokeWidth={2}
            fill="url(#gradPurchases)"
            dot={false}
            activeDot={{ r: 4, fill: '#10b981' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
