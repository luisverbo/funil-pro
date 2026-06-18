'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { QuizQuestion, QuizOption } from '@/app/actions/quiz'

interface Props {
  questions: QuizQuestion[]
  pageId: string
  tenantId: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findFirstQuestion(questions: QuizQuestion[]): QuizQuestion | undefined {
  const allTargets = new Set<string>()
  for (const q of questions) {
    for (const opt of q.options ?? []) {
      if (opt.next_question_id) allTargets.add(opt.next_question_id)
    }
    if (q.next_question_id) allTargets.add(q.next_question_id)
  }
  return questions.find(q => !allTargets.has(q.id)) ?? questions[0]
}

function evalFormula(
  formula: string,
  answers: Record<string, unknown>,
  score: number,
  calcVars: Record<string, number>
): number {
  let expr = formula
  expr = expr.replace(/\{\{score\}\}/g, String(score))
  for (const [k, v] of Object.entries(calcVars)) {
    expr = expr.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
  }
  for (const [qId, val] of Object.entries(answers)) {
    const num = typeof val === 'number' ? val : 0
    expr = expr.replace(new RegExp(`\\{\\{${qId}\\}\\}`, 'g'), String(num))
  }
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return 0
  try {
    // eslint-disable-next-line no-new-func
    return (Function(`"use strict"; return (${expr})`)() as number) ?? 0
  } catch { return 0 }
}

function replaceVars(
  text: string,
  score: number,
  calcVars: Record<string, number>,
  leadData: { name?: string; email?: string; phone?: string }
): string {
  const firstName = leadData.name?.split(' ')[0] ?? ''
  let out = text
  out = out.replace(/\{\{score\}\}/g, String(score))
  out = out.replace(/\{\{primeiro_nome\}\}/g, firstName)
  out = out.replace(/\{\{nome\}\}/g, leadData.name ?? '')
  for (const [k, v] of Object.entries(calcVars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v))
  }
  return out
}

function buildPages(questions: QuizQuestion[]): QuizQuestion[][] {
  if (questions.length === 0) return [[]]
  const pages: QuizQuestion[][] = [[]]
  for (const q of questions) {
    if (q.config?.starts_new_page && pages[pages.length - 1].length > 0) {
      pages.push([])
    }
    pages[pages.length - 1].push(q)
  }
  return pages
}

// ─── Main Renderer ────────────────────────────────────────────────────────────

export default function QuizRenderer({ questions, pageId, tenantId }: Props) {
  const hasPageGroups = questions.some(q => q.config?.starts_new_page)

  if (hasPageGroups) {
    return <PageModeRenderer questions={questions} pageId={pageId} tenantId={tenantId} />
  }
  return <StepModeRenderer questions={questions} pageId={pageId} tenantId={tenantId} />
}

// ─── Step Mode (one question at a time) ───────────────────────────────────────

type Phase = 'answering' | 'result' | 'submitting' | 'done'

function StepModeRenderer({ questions, pageId, tenantId }: Props) {
  const first = findFirstQuestion(questions)
  const [currentId, setCurrentId] = useState<string>(first?.id ?? '')
  const [phase, setPhase] = useState<Phase>('answering')
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [score, setScore] = useState(0)
  const [calcVars, setCalcVars] = useState<Record<string, number>>({})
  const [history, setHistory] = useState<string[]>([])
  const [leadData, setLeadData] = useState<{ name?: string; email?: string; phone?: string }>({})
  const [resultQuestion, setResultQuestion] = useState<QuizQuestion | null>(null)
  const [transitionKey, setTransitionKey] = useState(0)
  const [slideDir, setSlideDir] = useState<'right' | 'left'>('right')
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [textValue, setTextValue] = useState('')
  const [scaleValue, setScaleValue] = useState<number | null>(null)
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  const current = questions.find(q => q.id === currentId)
  const nonResultQs = questions.filter(q => q.question_type !== 'result' && q.question_type !== 'calc')
  const answeredCount = nonResultQs.filter(q => answers[q.id] !== undefined).length
  const progressPct = nonResultQs.length > 0 ? Math.round((answeredCount / nonResultQs.length) * 100) : 0
  const showProgress = questions.some(q => q.config?.show_progress)

  useEffect(() => {
    setSelectedOption(null)
    setTextValue('')
    setScaleValue(null)
    setMultiSelected(new Set())
    setTimeout(() => { if (inputRef.current) inputRef.current.focus() }, 400)
  }, [currentId])

  const resolveResultNode = useCallback((node: QuizQuestion): QuizQuestion => {
    const ranges = node.config?.score_ranges ?? []
    if (ranges.length > 0) {
      const match = ranges.find(r => score >= r.min && score <= r.max)
      if (match?.result_node_id) {
        const target = questions.find(q => q.id === match.result_node_id)
        if (target) return target
      }
    }
    return node
  }, [score, questions])

  const goTo = useCallback((nextId: string | null | undefined, dir: 'forward' | 'back' = 'forward') => {
    if (!nextId) return
    const next = questions.find(q => q.id === nextId)
    if (!next) return

    if (next.question_type === 'calc') {
      const result = evalFormula(next.config?.formula ?? '', answers, score, calcVars)
      const varName = next.config?.result_var ?? 'calc_resultado'
      setCalcVars(cv => ({ ...cv, [varName]: result }))
      // auto-advance past calc node
      const calcEdge = next.next_question_id
      if (calcEdge) {
        goTo(calcEdge, dir)
      }
      return
    }

    if (next.question_type === 'result') {
      const resolved = resolveResultNode(next)
      setResultQuestion(resolved)
      setPhase('result')
      return
    }

    setSlideDir(dir === 'forward' ? 'right' : 'left')
    setTransitionKey(k => k + 1)
    setCurrentId(nextId)
  }, [questions, answers, score, calcVars, resolveResultNode])

  function goBack() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory(h => h.slice(0, -1))
    setSlideDir('left')
    setTransitionKey(k => k + 1)
    setCurrentId(prev)
    setPhase('answering')
  }

  function recordAnswer(value: unknown) {
    setAnswers(a => ({ ...a, [currentId]: value }))
    if (current?.question_type === 'email') setLeadData(d => ({ ...d, email: String(value) }))
    if (current?.question_type === 'phone') setLeadData(d => ({ ...d, phone: String(value) }))
    if (current?.question_type === 'final_capture') {
      const v = value as Record<string, string>
      setLeadData(d => ({ ...d, ...v }))
    }
  }

  function advance(nextId: string | null | undefined) {
    setHistory(h => [...h, currentId])
    goTo(nextId ?? null, 'forward')
  }

  async function handleOptionClick(opt: QuizOption) {
    if (selectedOption) return
    setSelectedOption(opt.id)
    recordAnswer(opt.label)
    setScore(s => s + (opt.points ?? 0))
    await new Promise(r => setTimeout(r, 220))
    advance(opt.next_question_id ?? current?.next_question_id)
  }

  function toggleMulti(optId: string) {
    setMultiSelected(prev => {
      const next = new Set(prev)
      next.has(optId) ? next.delete(optId) : next.add(optId)
      return next
    })
  }

  function submitMulti() {
    const selected = current?.options.filter(o => multiSelected.has(o.id)) ?? []
    const labels = selected.map(o => o.label)
    const pts = selected.reduce((acc, o) => acc + (o.points ?? 0), 0)
    recordAnswer(labels)
    setScore(s => s + pts)
    advance(current?.next_question_id)
  }

  function submitText() {
    if (!textValue.trim() && current?.required) return
    recordAnswer(textValue.trim())
    advance(current?.next_question_id)
  }

  function submitScale(val: number) {
    setScaleValue(val)
    recordAnswer(val)
    setTimeout(() => advance(current?.next_question_id), 220)
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phase !== 'answering' || !current) return
      if (e.key === 'Enter' && ['text_short', 'email', 'phone'].includes(current.question_type)) submitText()
      if (current.question_type === 'single_choice') {
        const idx = parseInt(e.key) - 1
        if (idx >= 0 && idx < current.options.length) handleOptionClick(current.options[idx])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function handleSubmit() {
    setPhase('submitting')
    try {
      await fetch(`/api/quiz/${pageId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers, leadData,
          result_profile: resultQuestion?.config?.result_profile ?? null,
          funnel_id: resultQuestion?.config?.funnel_id ?? null,
          tenantId,
        }),
      })
    } catch { /* continue */ }
    setPhase('done')
    const ctaUrl = resultQuestion?.config?.cta_url
    if (ctaUrl) setTimeout(() => { window.location.href = ctaUrl }, 800)
  }

  const bgColor = current?.config?.bg_color ?? resultQuestion?.config?.bg_color ?? '#f8f7ff'

  if (!current && phase === 'answering') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Quiz sem perguntas.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: bgColor, transition: 'background 0.5s' }}>
      <style>{`
        @keyframes slideInRight { from { opacity:0; transform:translateX(48px); } to { opacity:1; transform:translateX(0); } }
        @keyframes slideInLeft  { from { opacity:0; transform:translateX(-48px); } to { opacity:1; transform:translateX(0); } }
        @keyframes fadeInUp     { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }
        @keyframes confettiFall { 0%{transform:translateY(-20px) rotate(0deg);opacity:1} 100%{transform:translateY(200px) rotate(720deg);opacity:0} }
      `}</style>

      {/* Progress bar */}
      {(showProgress || true) && (
        <div className="h-1 bg-black/10 shrink-0">
          <div className="h-full bg-indigo-500"
            style={{ width: `${progressPct}%`, transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)' }} />
        </div>
      )}

      {/* Back button */}
      <div className="px-6 py-4 flex items-center shrink-0" style={{ minHeight: 56 }}>
        {(history.length > 0 || phase === 'result') && (
          <button onClick={goBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Voltar
          </button>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-6 overflow-hidden">
        {phase === 'answering' && current && (
          <div key={transitionKey} className="w-full max-w-xl"
            style={{ animation: `${slideDir === 'right' ? 'slideInRight' : 'slideInLeft'} 350ms cubic-bezier(0.4,0,0.2,1) forwards` }}>
            <div className="text-center mb-8 md:mb-10">
              <h2 className="text-2xl md:text-4xl font-bold text-gray-900 leading-tight">
                {current.question_text || 'Pergunta'}
              </h2>
              {current.subtitle && (
                <p className="mt-2 text-base md:text-lg text-gray-500">{current.subtitle}</p>
              )}
            </div>

            {current.question_type === 'single_choice' && (
              <div className="space-y-3">
                {current.options.map((opt, i) => (
                  <button key={opt.id} onClick={() => handleOptionClick(opt)}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all duration-150 shadow-sm hover:shadow-md ${
                      selectedOption === opt.id ? 'border-indigo-500 bg-indigo-50 scale-[0.98]' : 'border-gray-200 bg-white hover:border-indigo-300 hover:scale-[1.01] active:scale-[0.99]'
                    }`}>
                    {opt.emoji && <span className="text-3xl shrink-0">{opt.emoji}</span>}
                    <span className="text-base font-medium text-gray-800 flex-1">{opt.label}</span>
                    <span className="ml-auto text-xs text-gray-400 shrink-0">{i + 1}</span>
                  </button>
                ))}
              </div>
            )}

            {current.question_type === 'multi_choice' && (
              <div className="space-y-3">
                {current.options.map(opt => (
                  <button key={opt.id} onClick={() => toggleMulti(opt.id)}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all duration-150 shadow-sm ${
                      multiSelected.has(opt.id) ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:border-indigo-300'
                    }`}>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                      multiSelected.has(opt.id) ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300'
                    }`}>
                      {multiSelected.has(opt.id) && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    {opt.emoji && <span className="text-3xl shrink-0">{opt.emoji}</span>}
                    <span className="text-base font-medium text-gray-800">{opt.label}</span>
                  </button>
                ))}
                <button onClick={submitMulti} disabled={multiSelected.size === 0}
                  className="w-full mt-2 py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">
                  Próximo →
                </button>
              </div>
            )}

            {current.question_type === 'scale' && (
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-4">Clique para selecionar</p>
                <div className="flex flex-wrap justify-center gap-3">
                  {Array.from({ length: (current.config?.scale_max ?? 10) - (current.config?.scale_min ?? 1) + 1 }, (_, i) => {
                    const v = (current.config?.scale_min ?? 1) + i
                    return (
                      <button key={v} onClick={() => submitScale(v)}
                        className={`w-14 h-14 rounded-xl text-lg font-bold border-2 transition-all duration-150 ${
                          scaleValue === v ? 'bg-indigo-500 border-indigo-500 text-white scale-110' : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300 hover:scale-105'
                        }`}>{v}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {current.question_type === 'text_short' && (
              <div className="space-y-3">
                <input ref={el => { inputRef.current = el }} type="text" value={textValue} onChange={e => setTextValue(e.target.value)}
                  placeholder="Digite sua resposta..."
                  className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm" />
                <button onClick={submitText} disabled={!textValue.trim() && current.required}
                  className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">Próximo →</button>
              </div>
            )}

            {current.question_type === 'text_long' && (
              <div className="space-y-3">
                <textarea ref={el => { inputRef.current = el as HTMLTextAreaElement }} value={textValue} onChange={e => setTextValue(e.target.value)}
                  rows={4} placeholder="Digite sua resposta..."
                  className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm resize-none" />
                <button onClick={submitText} disabled={!textValue.trim() && current.required}
                  className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">Próximo →</button>
              </div>
            )}

            {current.question_type === 'email' && (
              <div className="space-y-3">
                <input ref={el => { inputRef.current = el }} type="email" value={textValue} onChange={e => setTextValue(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm" />
                <button onClick={submitText} disabled={!textValue.trim()}
                  className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">Próximo →</button>
              </div>
            )}

            {current.question_type === 'phone' && (
              <div className="space-y-3">
                <input ref={el => { inputRef.current = el }} type="tel" value={textValue} onChange={e => setTextValue(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm" />
                <button onClick={submitText} disabled={!textValue.trim()}
                  className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">Próximo →</button>
              </div>
            )}

            {current.question_type === 'final_capture' && (
              <FinalCapture leadData={leadData} onSubmit={data => { recordAnswer(data); advance(current.next_question_id) }} />
            )}
          </div>
        )}

        {(phase === 'result' || phase === 'submitting' || phase === 'done') && resultQuestion && (
          <ResultScreen
            question={resultQuestion}
            phase={phase}
            score={score}
            calcVars={calcVars}
            leadData={leadData}
            onSubmit={handleSubmit}
          />
        )}
      </div>
    </div>
  )
}

// ─── Page Mode (all questions per page visible at once) ───────────────────────

type PagePhase = 'answering' | 'result' | 'submitting' | 'done'

function PageModeRenderer({ questions, pageId, tenantId }: Props) {
  // Filter out calc nodes (handled silently)
  const visibleQs = questions.filter(q => q.question_type !== 'calc')
  const pages = buildPages(visibleQs)

  const [pageIdx, setPageIdx] = useState(0)
  const [phase, setPhase] = useState<PagePhase>('answering')
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({})
  const [score, setScore] = useState(0)
  const [calcVars, setCalcVars] = useState<Record<string, number>>({})
  const [leadData, setLeadData] = useState<{ name?: string; email?: string; phone?: string }>({})
  const [resultQuestion, setResultQuestion] = useState<QuizQuestion | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const currentPageQs = pages[pageIdx] ?? []
  const totalVisiblePages = pages.length
  const progressPct = Math.round(((pageIdx) / totalVisiblePages) * 100)

  function setAnswer(qId: string, val: unknown) {
    setAnswers(a => ({ ...a, [qId]: { ...(a[qId] ?? {}), value: val } }))
  }

  function runCalcNodes() {
    const calcQs = questions.filter(q => q.question_type === 'calc')
    const allAnswers: Record<string, unknown> = {}
    for (const [qId, a] of Object.entries(answers)) {
      allAnswers[qId] = (a as Record<string, unknown>).value
    }
    let newCalcVars = { ...calcVars }
    for (const cq of calcQs) {
      const result = evalFormula(cq.config?.formula ?? '', allAnswers, score, newCalcVars)
      const varName = cq.config?.result_var ?? 'calc_resultado'
      newCalcVars = { ...newCalcVars, [varName]: result }
    }
    setCalcVars(newCalcVars)
    return newCalcVars
  }

  function handleNext() {
    // Validate required fields on current page
    const newErrors: Record<string, string> = {}
    for (const q of currentPageQs) {
      if (q.required && q.question_type !== 'result') {
        const ans = answers[q.id]?.value
        if (ans === undefined || ans === null || ans === '' || (Array.isArray(ans) && ans.length === 0)) {
          newErrors[q.id] = 'Resposta obrigatória'
        }
      }
      // Collect lead data
      if (q.question_type === 'email' && answers[q.id]?.value) {
        setLeadData(d => ({ ...d, email: String(answers[q.id].value) }))
      }
      if (q.question_type === 'phone' && answers[q.id]?.value) {
        setLeadData(d => ({ ...d, phone: String(answers[q.id].value) }))
      }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }
    setErrors({})

    // Accumulate score for this page
    let pageScore = 0
    for (const q of currentPageQs) {
      if (q.question_type === 'single_choice') {
        const selectedLabel = answers[q.id]?.value as string
        const opt = q.options.find(o => o.label === selectedLabel)
        pageScore += opt?.points ?? 0
      }
      if (q.question_type === 'multi_choice') {
        const selectedLabels = (answers[q.id]?.value as string[]) ?? []
        for (const lbl of selectedLabels) {
          const opt = q.options.find(o => o.label === lbl)
          pageScore += opt?.points ?? 0
        }
      }
    }
    setScore(s => s + pageScore)

    if (pageIdx + 1 >= pages.length) {
      // Run calc nodes before showing result
      const finalCalcVars = runCalcNodes()
      const resultNode = questions.find(q => q.question_type === 'result')
      if (resultNode) {
        const ranges = resultNode.config?.score_ranges ?? []
        let resolved = resultNode
        if (ranges.length > 0) {
          const totalScore = score + pageScore
          const match = ranges.find(r => totalScore >= r.min && totalScore <= r.max)
          if (match?.result_node_id) {
            const target = questions.find(q => q.id === match.result_node_id)
            if (target) resolved = target
          }
        }
        setResultQuestion(resolved)
        setCalcVars(finalCalcVars)
      }
      setPhase('result')
    } else {
      setPageIdx(i => i + 1)
    }
  }

  async function handleSubmit() {
    setPhase('submitting')
    const allAnswers: Record<string, unknown> = {}
    for (const [qId, a] of Object.entries(answers)) {
      allAnswers[qId] = (a as Record<string, unknown>).value
    }
    try {
      await fetch(`/api/quiz/${pageId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: allAnswers, leadData,
          result_profile: resultQuestion?.config?.result_profile ?? null,
          funnel_id: resultQuestion?.config?.funnel_id ?? null,
          tenantId,
        }),
      })
    } catch { /* continue */ }
    setPhase('done')
    const ctaUrl = resultQuestion?.config?.cta_url
    if (ctaUrl) setTimeout(() => { window.location.href = ctaUrl }, 800)
  }

  const bgColor = currentPageQs[0]?.config?.bg_color ?? resultQuestion?.config?.bg_color ?? '#f8f7ff'

  if (phase === 'result' || phase === 'submitting' || phase === 'done') {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: bgColor, transition: 'background 0.5s' }}>
        <style>{`
          @keyframes fadeInUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } }
          @keyframes confettiFall { 0%{transform:translateY(-20px) rotate(0deg);opacity:1} 100%{transform:translateY(200px) rotate(720deg);opacity:0} }
        `}</style>
        <div className="flex-1 flex items-center justify-center px-4 py-8">
          {resultQuestion && (
            <ResultScreen
              question={resultQuestion}
              phase={phase as 'result' | 'submitting' | 'done'}
              score={score}
              calcVars={calcVars}
              leadData={leadData}
              onSubmit={handleSubmit}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: bgColor, transition: 'background 0.5s' }}>
      <style>{`@keyframes fadeInUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Progress bar */}
      <div className="h-1 bg-black/10 shrink-0">
        <div className="h-full bg-indigo-500" style={{ width: `${progressPct}%`, transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)' }} />
      </div>

      {/* Page indicator */}
      <div className="px-6 pt-4 flex items-center justify-between shrink-0">
        {pageIdx > 0 ? (
          <button onClick={() => setPageIdx(i => i - 1)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Voltar
          </button>
        ) : <span />}
        <span className="text-xs text-gray-400 font-medium">
          Página {pageIdx + 1} de {totalVisiblePages}
        </span>
      </div>

      {/* Questions for this page */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-xl mx-auto space-y-6"
          style={{ animation: 'fadeInUp 350ms cubic-bezier(0.4,0,0.2,1) forwards' }}>
          {currentPageQs.map(q => (
            <PageQuestion
              key={q.id}
              question={q}
              value={answers[q.id]?.value}
              onChange={val => setAnswer(q.id, val)}
              error={errors[q.id]}
            />
          ))}

          <button onClick={handleNext}
            className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition shadow-md hover:shadow-lg">
            {pageIdx + 1 >= totalVisiblePages ? 'Ver resultado →' : 'Próximo →'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PageQuestion({
  question, value, onChange, error,
}: {
  question: QuizQuestion
  value: unknown
  onChange: (v: unknown) => void
  error?: string
}) {
  return (
    <div>
      <h3 className="text-xl font-bold text-gray-900 mb-1">{question.question_text}</h3>
      {question.subtitle && <p className="text-sm text-gray-500 mb-3">{question.subtitle}</p>}

      {question.question_type === 'single_choice' && (
        <div className="space-y-2">
          {question.options.map(opt => (
            <button key={opt.id} onClick={() => onChange(opt.label)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition ${
                value === opt.label ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:border-indigo-300'
              }`}>
              {opt.emoji && <span className="text-2xl shrink-0">{opt.emoji}</span>}
              <span className="text-sm font-medium text-gray-800">{opt.label}</span>
              {value === opt.label && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 ml-auto text-indigo-500 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
              )}
            </button>
          ))}
        </div>
      )}

      {question.question_type === 'multi_choice' && (
        <div className="space-y-2">
          {question.options.map(opt => {
            const selected = Array.isArray(value) && (value as string[]).includes(opt.label)
            return (
              <button key={opt.id}
                onClick={() => {
                  const cur = (value as string[]) ?? []
                  onChange(selected ? cur.filter(l => l !== opt.label) : [...cur, opt.label])
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition ${
                  selected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:border-indigo-300'
                }`}>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${selected ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300'}`}>
                  {selected && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                {opt.emoji && <span className="text-2xl shrink-0">{opt.emoji}</span>}
                <span className="text-sm font-medium text-gray-800">{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {(question.question_type === 'text_short' || question.question_type === 'email' || question.question_type === 'phone') && (
        <input
          type={question.question_type === 'email' ? 'email' : question.question_type === 'phone' ? 'tel' : 'text'}
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={question.question_type === 'email' ? 'seu@email.com' : question.question_type === 'phone' ? '(11) 99999-9999' : 'Digite aqui...'}
          className="w-full px-4 py-3 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 bg-white"
        />
      )}

      {question.question_type === 'text_long' && (
        <textarea value={(value as string) ?? ''} onChange={e => onChange(e.target.value)}
          rows={3} placeholder="Digite aqui..."
          className="w-full px-4 py-3 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 bg-white resize-none" />
      )}

      {question.question_type === 'scale' && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: (question.config?.scale_max ?? 10) - (question.config?.scale_min ?? 1) + 1 }, (_, i) => {
            const v = (question.config?.scale_min ?? 1) + i
            return (
              <button key={v} onClick={() => onChange(v)}
                className={`w-12 h-12 rounded-xl text-base font-bold border-2 transition ${
                  value === v ? 'bg-indigo-500 border-indigo-500 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300'
                }`}>{v}
              </button>
            )
          })}
        </div>
      )}

      {question.question_type === 'final_capture' && (
        <div className="space-y-2">
          <input type="text" placeholder="Seu nome"
            value={((value as Record<string, string>)?.name) ?? ''}
            onChange={e => onChange({ ...((value as Record<string, string>) ?? {}), name: e.target.value })}
            className="w-full px-4 py-3 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 bg-white" />
          <input type="email" placeholder="seu@email.com"
            value={((value as Record<string, string>)?.email) ?? ''}
            onChange={e => onChange({ ...((value as Record<string, string>) ?? {}), email: e.target.value })}
            className="w-full px-4 py-3 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 bg-white" />
          <input type="tel" placeholder="(11) 99999-9999"
            value={((value as Record<string, string>)?.phone) ?? ''}
            onChange={e => onChange({ ...((value as Record<string, string>) ?? {}), phone: e.target.value })}
            className="w-full px-4 py-3 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-indigo-400 bg-white" />
        </div>
      )}

      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// ─── Shared: Final Capture ────────────────────────────────────────────────────

function FinalCapture({
  leadData,
  onSubmit,
}: {
  leadData: { name?: string; email?: string; phone?: string }
  onSubmit: (data: Record<string, string>) => void
}) {
  const [name, setName] = useState(leadData.name ?? '')
  const [email, setEmail] = useState(leadData.email ?? '')
  const [phone, setPhone] = useState(leadData.phone ?? '')

  return (
    <div className="space-y-3">
      {!leadData.name && (
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome"
          className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm" />
      )}
      {!leadData.email && (
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com"
          className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm" />
      )}
      {!leadData.phone && (
        <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(11) 99999-9999"
          className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm" />
      )}
      <button onClick={() => onSubmit({ name, email, phone })} disabled={!name && !email && !phone}
        className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">
        Ver meu resultado →
      </button>
    </div>
  )
}

// ─── Shared: Result Screen ────────────────────────────────────────────────────

function ResultScreen({
  question, phase, score, calcVars, leadData, onSubmit,
}: {
  question: QuizQuestion
  phase: 'result' | 'submitting' | 'done'
  score: number
  calcVars: Record<string, number>
  leadData: { name?: string; email?: string; phone?: string }
  onSubmit: () => void
}) {
  const displayText = replaceVars(question.config?.result_text ?? '', score, calcVars, leadData)
  const scoreText = question.config?.show_score
    ? replaceVars(question.config?.score_display_text ?? 'Você fez {{score}} pontos!', score, calcVars, leadData)
    : null
  const ctaText = question.config?.cta_text || 'Acessar agora'
  const ctaUrl = question.config?.cta_url

  return (
    <div className="w-full max-w-xl text-center" style={{ animation: 'fadeInUp 500ms cubic-bezier(0.4,0,0.2,1) forwards' }}>
      <div className="relative flex justify-center mb-6" aria-hidden>
        {['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#a855f7'].map((c, i) => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: '50%', background: c, margin: '0 4px',
            animation: `confettiFall ${1 + i * 0.15}s ${i * 0.1}s ease-in forwards`,
          }} />
        ))}
      </div>

      <div className="text-6xl mb-4">🎉</div>

      <h2 className="text-2xl md:text-4xl font-bold text-gray-900 mb-4 leading-tight">
        {question.question_text || 'Parabéns!'}
      </h2>

      {scoreText && (
        <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-2xl text-amber-700 font-semibold text-lg">
          🏆 {scoreText}
        </div>
      )}

      {displayText && (
        <p className="text-base md:text-lg text-gray-600 mb-8 leading-relaxed whitespace-pre-line">{displayText}</p>
      )}

      {phase === 'result' && (
        <button onClick={onSubmit}
          className="inline-flex items-center gap-2 px-8 py-4 bg-indigo-600 text-white text-lg font-semibold rounded-2xl hover:bg-indigo-700 transition shadow-lg hover:shadow-xl active:scale-95">
          {ctaText}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      )}

      {phase === 'submitting' && (
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/>
          </svg>
          Processando...
        </div>
      )}

      {phase === 'done' && ctaUrl && <p className="text-sm text-gray-400">Redirecionando...</p>}
      {phase === 'done' && !ctaUrl && (
        <div className="flex items-center justify-center gap-2 text-emerald-600 font-medium">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="20 6 9 17 4 12"/></svg>
          Tudo certo! Aguarde o contato.
        </div>
      )}
    </div>
  )
}
