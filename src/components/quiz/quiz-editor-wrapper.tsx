'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect } from 'react'
import { getQuizPageData, type QuizQuestion } from '@/app/actions/quiz'

const QuizEditorClient = dynamic(
  () => import('@/components/quiz/quiz-editor-client'),
  { ssr: false }
)

interface Props {
  pageId: string
}

export default function QuizEditorWrapper({ pageId }: Props) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'not_found' }
    | {
        status: 'ready'
        page: { id: string; title: string; slug: string | null; published: boolean }
        questions: QuizQuestion[]
        funnels: { id: string; name: string }[]
        tenantId: string
      }
  >({ status: 'loading' })

  useEffect(() => {
    getQuizPageData(pageId).then(result => {
      if (result.error === 'page_not_found') {
        setState({ status: 'not_found' })
      } else if (result.error) {
        setState({ status: 'error', message: result.error })
      } else {
        setState({
          status: 'ready',
          page: result.page!,
          questions: result.questions!,
          funnels: result.funnels!,
          tenantId: result.tenantId!,
        })
      }
    })
  }, [pageId])

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Carregando editor...</p>
        </div>
      </div>
    )
  }

  if (state.status === 'not_found') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
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
          <p className="text-sm text-gray-500 mb-4">{state.message}</p>
          <a href="/pages" className="text-sm text-indigo-600 hover:underline">← Voltar para páginas</a>
        </div>
      </div>
    )
  }

  return (
    <QuizEditorClient
      page={state.page}
      initialQuestions={state.questions}
      funnels={state.funnels}
      tenantId={state.tenantId}
    />
  )
}
