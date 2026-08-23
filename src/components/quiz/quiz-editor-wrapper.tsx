'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'
import type { QuizData } from '@/app/actions/quiz-v2'
import { migrateV1ToV2, type V1Question } from '@/lib/quiz/migrate-v1'

const QuizEditorV2 = dynamic(
  () => import('@/components/quiz/quiz-editor-v2'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen bg-gray-50">
        <div className="w-60 bg-white border-r border-gray-200 animate-pulse" />
        <div className="flex-1 p-6 space-y-4">
          <div className="bg-white rounded-2xl h-48 animate-pulse" />
          <div className="bg-white rounded-2xl h-64 animate-pulse" />
        </div>
        <div className="w-80 bg-white border-l border-gray-200 animate-pulse" />
      </div>
    ),
  }
)

type State =
  | { status: 'loading' }
  | { status: 'ready'; page: { id: string; title: string; slug: string | null; published: boolean }; data?: QuizData; funnels: { id: string; name: string }[]; tenantId: string }
  | { status: 'error'; message: string }
  | { status: 'not_found' }

export default function QuizEditorWrapper({ pageId }: { pageId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    // Rota HTTP simples no lugar da server action: a action embute um ID do
    // build na página, e uma aba aberta durante um deploy passa a chamar um
    // ID que não existe mais — a resposta vira o erro MASCARADO do Next
    // ("Server Components render...") e não há o que depurar. GET não tem
    // nada disso, e quando falha devolve o motivo real.
    let ativo = true
    const carregar = async () => {
      try {
        const resp = await fetch(`/api/quiz-editor-load/${pageId}`, { cache: 'no-store' })
        const corpo = await resp.json().catch(() => null) as {
          error?: string
          page?: { id: string; title: string; slug: string | null; published: boolean }
          quizData?: QuizData | null
          v1Questions?: V1Question[] | null
          funnels?: { id: string; name: string }[]
          tenantId?: string
        } | null
        if (!ativo) return

        if (!resp.ok || !corpo || corpo.error) {
          if (resp.status === 401) { window.location.href = '/login'; return }
          if (resp.status === 404 || corpo?.error === 'page_not_found') { setState({ status: 'not_found' }); return }
          setState({ status: 'error', message: corpo?.error ?? `HTTP ${resp.status}` })
          return
        }

        // Migração v1 → v2 no navegador — a mesma função pura do servidor.
        let data = corpo.quizData ?? undefined
        if (!data && corpo.v1Questions && corpo.v1Questions.length > 0) {
          data = migrateV1ToV2(corpo.v1Questions)
        }

        setState({
          status: 'ready',
          page: corpo.page!,
          data,
          funnels: corpo.funnels ?? [],
          tenantId: corpo.tenantId!,
        })
      } catch (err) {
        if (!ativo) return
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      }
    }
    void carregar()
    return () => { ativo = false }
  }, [pageId, tentativa])

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen bg-gray-50">
        <div className="w-60 bg-white border-r border-gray-200 animate-pulse" />
        <div className="flex-1 p-6 space-y-4">
          <div className="bg-white rounded-2xl h-48 animate-pulse" />
          <div className="bg-white rounded-2xl h-64 animate-pulse" />
        </div>
        <div className="w-80 bg-white border-l border-gray-200 animate-pulse" />
      </div>
    )
  }

  if (state.status === 'not_found') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <p className="text-4xl mb-3">🔍</p>
          <p className="text-lg font-semibold text-gray-700">Página não encontrada</p>
          <a href="/pages" className="text-sm text-indigo-600 hover:underline mt-2 inline-block">← Voltar para páginas</a>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center max-w-md">
          <p className="text-lg font-semibold text-gray-700 mb-2">Erro ao carregar editor</p>
          <p className="text-sm text-gray-500 mb-4 font-mono">{state.message}</p>
          <button
            onClick={() => { setState({ status: 'loading' }); setTentativa(t => t + 1) }}
            className="mr-4 px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700">
            Tentar novamente
          </button>
          <a href="/pages" className="text-sm text-indigo-600 hover:underline">← Voltar para páginas</a>
        </div>
      </div>
    )
  }

  return (
    <QuizEditorV2
      page={state.page}
      initialData={state.data}
      funnels={state.funnels}
      tenantId={state.tenantId}
    />
  )
}
