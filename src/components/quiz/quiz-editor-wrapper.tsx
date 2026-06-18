'use client'

import dynamic from 'next/dynamic'
import type { QuizQuestion } from '@/app/actions/quiz'

const QuizEditorClient = dynamic(
  () => import('@/components/quiz/quiz-editor-client'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Carregando editor...</p>
        </div>
      </div>
    ),
  }
)

interface Props {
  page: { id: string; title: string; slug: string | null; published: boolean }
  initialQuestions: QuizQuestion[]
  funnels: { id: string; name: string }[]
  tenantId: string
}

export default function QuizEditorWrapper(props: Props) {
  return <QuizEditorClient {...props} />
}
