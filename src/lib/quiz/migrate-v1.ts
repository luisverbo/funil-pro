// ============================================================================
// Migração quiz v1 → v2 — pura, compartilhada
// ----------------------------------------------------------------------------
// Vivia dentro do arquivo de server actions; saiu de lá porque a carga do
// editor virou rota HTTP e a migração passou a rodar também no NAVEGADOR.
// Função pura: mesmos dados, mesmo resultado, nos dois lados.
// ============================================================================

import type { BlockConfig, BlockType, QuizBlock, QuizData, QuizPage } from '@/app/actions/quiz-v2'

export interface V1Question {
  id: string
  question_type: string
  question_text: string
  subtitle?: string
  required?: boolean
  order_index: number
  options?: { id: string; label: string; emoji?: string }[]
  config?: {
    is_result?: boolean; result_text?: string; cta_text?: string; cta_url?: string
    funnel_id?: string; show_score?: boolean; bg_color?: string
    scale_min?: number; scale_max?: number
  }
}

export function migrateV1ToV2(questions: V1Question[]): QuizData {
  const typeMap: Record<string, BlockType> = {
    single_choice: 'single_choice',
    multi_choice: 'multi_choice',
    text_short: 'field_text',
    text_long: 'field_textarea',
    scale: 'scale',
    email: 'field_email',
    phone: 'field_phone',
    final_capture: 'final_capture',
    result: 'result',
    yes_no: 'yes_no',
  }

  const sorted = [...questions].sort((a, b) => a.order_index - b.order_index)

  const pages: QuizPage[] = sorted.map((q, idx) => {
    const blockType: BlockType = typeMap[q.question_type] ?? 'field_text'
    const isResult = q.config?.is_result || q.question_type === 'result' || q.question_type === 'final_capture'

    const config: BlockConfig = isResult
      ? {
          title: q.question_text || 'Resultado',
          description: q.config?.result_text,
          cta_text: q.config?.cta_text,
          cta_url: q.config?.cta_url,
          funnel_id: q.config?.funnel_id,
          show_score: q.config?.show_score,
          bg_color: q.config?.bg_color,
        }
      : {
          question: q.question_text,
          subtitle: q.subtitle,
          required: q.required,
          bg_color: q.config?.bg_color,
          options: q.options?.map(o => ({ id: o.id, label: o.label, emoji: o.emoji })),
          scale_min: q.config?.scale_min,
          scale_max: q.config?.scale_max,
        }

    const block: QuizBlock = {
      id: q.id,
      type: isResult && q.question_type === 'final_capture' ? 'final_capture' : isResult ? 'result' : blockType,
      order: 0,
      config,
    }

    return {
      id: `page-${q.id}`,
      title: `Etapa ${idx + 1}`,
      order: idx,
      blocks: [block],
    }
  })

  return { version: 2, pages, settings: {} }
}
