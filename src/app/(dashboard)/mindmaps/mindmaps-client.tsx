'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createMindMap, deleteMindMap, duplicateMindMap, renameMindMap } from '@/app/actions/mindmaps'
import { BRANCH_COLORS, type MindMapSummary } from '@/lib/mindmap/types'

function fmt(ts: string) {
  const d = new Date(ts)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'agora'
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

/** Prévia decorativa do mapa (nó central + ramos coloridos) */
function MapPreview({ seed }: { seed: number }) {
  const colors = [0, 1, 2, 3].map(i => BRANCH_COLORS[(seed + i) % BRANCH_COLORS.length])
  return (
    <div className="h-28 rounded-xl bg-[radial-gradient(circle_at_1px_1px,#e2e8f0_1px,transparent_0)] [background-size:12px_12px] bg-gray-50 relative overflow-hidden">
      <svg viewBox="0 0 200 100" className="w-full h-full">
        {colors.map((c, i) => {
          const y = 20 + i * 20
          return <path key={i} d={`M70 50 C 100 50, 110 ${y}, 140 ${y}`} stroke={c.solid} strokeWidth="2" fill="none" opacity="0.85" />
        })}
        <rect x="24" y="40" width="48" height="20" rx="8" fill={colors[0].solid} />
        {colors.map((c, i) => (
          <rect key={i} x="140" y={12 + i * 20} width="42" height="15" rx="6" fill={c.soft} stroke={c.border} />
        ))}
      </svg>
    </div>
  )
}

export default function MindMapsClient({ initialMaps }: { initialMaps: MindMapSummary[] }) {
  const router = useRouter()
  const [maps, setMaps] = useState(initialMaps)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const create = () => startTransition(async () => {
    const r = await createMindMap()
    if (r.id) router.push(`/mindmap/${r.id}`)
  })

  const rename = (m: MindMapSummary) => {
    setMenuId(null)
    const title = prompt('Nome do mapa:', m.title)
    if (title == null) return
    setMaps(list => list.map(x => (x.id === m.id ? { ...x, title } : x)))
    startTransition(async () => { await renameMindMap(m.id, title) })
  }

  const duplicate = (id: string) => {
    setMenuId(null)
    startTransition(async () => {
      const r = await duplicateMindMap(id)
      if (r.id) router.push(`/mindmap/${r.id}`)
    })
  }

  const remove = (m: MindMapSummary) => {
    setMenuId(null)
    if (!confirm(`Excluir "${m.title}"?`)) return
    setMaps(list => list.filter(x => x.id !== m.id))
    startTransition(async () => { await deleteMindMap(m.id) })
  }

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-xl shadow-lg shadow-indigo-200/60">🧠</div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Mapa Mental</h1>
            <p className="text-sm text-gray-500">Organize ideias, estratégias e funis num canvas livre.</p>
          </div>
        </div>
        <button onClick={create} disabled={isPending}
          className="px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-md shadow-indigo-200 transition-all hover:-translate-y-0.5 disabled:opacity-60">
          + Novo mapa
        </button>
      </div>

      {maps.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-3xl p-14 text-center text-gray-500">
          <p className="text-4xl mb-3">🧠</p>
          <p className="font-semibold text-gray-700">Nenhum mapa ainda</p>
          <p className="text-sm mt-1">Comece um mapa pra desenhar sua estratégia antes de montar o funil.</p>
          <button onClick={create} disabled={isPending}
            className="mt-5 px-5 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 shadow-md shadow-indigo-200">
            + Criar primeiro mapa
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {maps.map((m, i) => (
            <div key={m.id}
              className="group relative rounded-3xl bg-white border border-gray-100 shadow-sm hover:shadow-xl hover:shadow-gray-200/60 hover:-translate-y-1 transition-all duration-200 overflow-hidden">
              <button onClick={() => router.push(`/mindmap/${m.id}`)} className="w-full text-left p-4" aria-label={`Abrir ${m.title}`}>
                <MapPreview seed={i} />
                <h3 className="font-bold text-gray-900 truncate mt-3">{m.title}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {m.node_count ?? 0} {m.node_count === 1 ? 'item' : 'itens'} · atualizado {fmt(m.updated_at)}
                </p>
              </button>

              <div className="absolute top-3 right-3">
                <button
                  onClick={e => { e.stopPropagation(); setMenuId(menuId === m.id ? null : m.id) }}
                  aria-label="Ações do mapa"
                  className="w-7 h-7 rounded-lg bg-white/90 border border-gray-200 text-gray-500 hover:text-gray-900 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
                  ⋯
                </button>
                {menuId === m.id && (
                  <div className="absolute right-0 top-9 z-20 bg-white rounded-xl shadow-lg border border-gray-100 py-1 w-40 text-sm">
                    <button onClick={() => rename(m)} className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50">Renomear</button>
                    <button onClick={() => duplicate(m.id)} className="w-full px-4 py-2 text-left text-gray-700 hover:bg-gray-50">Duplicar</button>
                    <div className="border-t border-gray-100 my-1" />
                    <button onClick={() => remove(m)} className="w-full px-4 py-2 text-left text-red-500 hover:bg-red-50">Excluir</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
