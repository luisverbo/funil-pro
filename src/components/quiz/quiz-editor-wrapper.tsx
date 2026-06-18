'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'
import { loadQuizV2, type QuizData } from '@/app/actions/quiz-v2'

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

  useEffect(() => {
    loadQuizV2(pageId).then(result => {
      if (result.error === 'page_not_found') {
        setState({ status: 'not_found' })
      } else if (result.error) {
        setState({ status: 'error', message: result.error })
      } else {
        setState({
          status: 'ready',
          page: result.page!,
          data: result.data,
          funnels: result.funnels ?? [],
          tenantId: result.tenantId!,
        })
      }
    })
  }, [pageId])

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
