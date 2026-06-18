'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { QuizQuestion } from '@/app/actions/quiz'

interface Props {
  questions: QuizQuestion[]
  pageId: string
  tenantId: string
}

type Phase = 'answering' | 'result' | 'submitting' | 'done'

function findFirstQuestion(questions: QuizQuestion[]): QuizQuestion | undefined {
  // The first question is the one not pointed to by any option or next_question_id
  const allTargets = new Set<string>()
  for (const q of questions) {
    for (const opt of q.options ?? []) {
      if (opt.next_question_id) allTargets.add(opt.next_question_id)
    }
    if (q.next_question_id) allTargets.add(q.next_question_id)
  }
  return questions.find(q => !allTargets.has(q.id)) ?? questions[0]
}

export default function QuizRenderer({ questions, pageId, tenantId }: Props) {
  const first = findFirstQuestion(questions)
  const [currentId, setCurrentId] = useState<string>(first?.id ?? '')
  const [phase, setPhase] = useState<Phase>('answering')
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
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

  // Count non-result questions for progress
  const nonResultQs = questions.filter(q => q.question_type !== 'result')
  const answeredCount = nonResultQs.filter(q => answers[q.id] !== undefined).length
  const progressPct = nonResultQs.length > 0 ? Math.round((answeredCount / nonResultQs.length) * 100) : 0

  // Reset per-question state when question changes
  useEffect(() => {
    setSelectedOption(null)
    setTextValue('')
    setScaleValue(null)
    setMultiSelected(new Set())
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus()
    }, 400)
  }, [currentId])

  function goTo(nextId: string | null | undefined, dir: 'forward' | 'back' = 'forward') {
    if (!nextId) return
    const next = questions.find(q => q.id === nextId)
    if (!next) return
    if (next.question_type === 'result') {
      setResultQuestion(next)
      setPhase('result')
      return
    }
    setSlideDir(dir === 'forward' ? 'right' : 'left')
    setTransitionKey(k => k + 1)
    setCurrentId(nextId)
  }

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
    // Extract lead data from special question types
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

  // Choice selection
  async function handleOptionClick(opt: { id: string; next_question_id?: string | null; label: string }) {
    if (selectedOption) return // prevent double-click
    setSelectedOption(opt.id)
    recordAnswer(opt.label)
    await new Promise(r => setTimeout(r, 220))
    advance(opt.next_question_id ?? current?.next_question_id)
  }

  // Multi-choice toggle
  function toggleMulti(optId: string) {
    setMultiSelected(prev => {
      const next = new Set(prev)
      next.has(optId) ? next.delete(optId) : next.add(optId)
      return next
    })
  }

  function submitMulti() {
    const labels = current?.options.filter(o => multiSelected.has(o.id)).map(o => o.label) ?? []
    recordAnswer(labels)
    advance(current?.next_question_id)
  }

  // Text/email/phone submit
  function submitText() {
    if (!textValue.trim() && current?.required) return
    recordAnswer(textValue.trim())
    advance(current?.next_question_id)
  }

  // Scale submit
  function submitScale(val: number) {
    setScaleValue(val)
    recordAnswer(val)
    setTimeout(() => advance(current?.next_question_id), 220)
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (phase !== 'answering' || !current) return
      if (e.key === 'Enter' && (current.question_type === 'text_short' || current.question_type === 'email' || current.question_type === 'phone')) {
        submitText()
      }
      if (current.question_type === 'single_choice') {
        const idx = parseInt(e.key) - 1
        if (idx >= 0 && idx < current.options.length) handleOptionClick(current.options[idx])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Submit to API
  async function handleSubmit() {
    setPhase('submitting')
    try {
      await fetch(`/api/quiz/${pageId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          leadData,
          result_profile: resultQuestion?.config?.result_profile ?? null,
          funnel_id: resultQuestion?.config?.funnel_id ?? null,
          tenantId,
        }),
      })
    } catch { /* continue regardless */ }
    setPhase('done')
    const ctaUrl = resultQuestion?.config?.cta_url
    if (ctaUrl) {
      setTimeout(() => { window.location.href = ctaUrl }, 800)
    }
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
      <div className="h-1 bg-black/10 shrink-0">
        <div
          className="h-full bg-indigo-500"
          style={{ width: `${progressPct}%`, transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </div>

      {/* Back button */}
      <div className="px-6 py-4 flex items-center shrink-0" style={{ minHeight: 56 }}>
        {(history.length > 0 || phase === 'result') && (
          <button onClick={goBack} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Voltar
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 flex items-center justify-center px-4 py-6 overflow-hidden">

        {/* Answering phase */}
        {phase === 'answering' && current && (
          <div
            key={transitionKey}
            className="w-full max-w-xl"
            style={{ animation: `${slideDir === 'right' ? 'slideInRight' : 'slideInLeft'} 350ms cubic-bezier(0.4,0,0.2,1) forwards` }}
          >
            {/* Question */}
            <div className="text-center mb-8 md:mb-10">
              <h2 className="text-2xl md:text-4xl font-bold text-gray-900 leading-tight">
                {current.question_text || 'Pergunta'}
              </h2>
              {current.subtitle && (
                <p className="mt-2 text-base md:text-lg text-gray-500">{current.subtitle}</p>
              )}
            </div>

            {/* Single choice */}
            {current.question_type === 'single_choice' && (
              <div className="space-y-3">
                {current.options.map((opt, i) => (
                  <button
                    key={opt.id}
                    onClick={() => handleOptionClick(opt)}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all duration-150 ${
                      selectedOption === opt.id
                        ? 'border-indigo-500 bg-indigo-50 scale-[0.98]'
                        : 'border-gray-200 bg-white hover:border-indigo-300 hover:scale-[1.01] active:scale-[0.99]'
                    } shadow-sm hover:shadow-md`}
                    style={{ transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)' }}
                  >
                    {opt.emoji && <span className="text-3xl shrink-0">{opt.emoji}</span>}
                    <span className="text-base font-medium text-gray-800">{opt.label}</span>
                    <span className="ml-auto text-xs text-gray-400 shrink-0">{i + 1}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Multi choice */}
            {current.question_type === 'multi_choice' && (
              <div className="space-y-3">
                {current.options.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => toggleMulti(opt.id)}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all duration-150 ${
                      multiSelected.has(opt.id)
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:border-indigo-300'
                    } shadow-sm`}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                      multiSelected.has(opt.id) ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300'
                    }`}>
                      {multiSelected.has(opt.id) && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>}
                    </div>
                    {opt.emoji && <span className="text-3xl shrink-0">{opt.emoji}</span>}
                    <span className="text-base font-medium text-gray-800">{opt.label}</span>
                  </button>
                ))}
                <button
                  onClick={submitMulti}
                  disabled={multiSelected.size === 0}
                  className="w-full mt-2 py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40"
                >
                  Próximo →
                </button>
              </div>
            )}

            {/* Scale */}
            {current.question_type === 'scale' && (
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-4">Clique ou pressione Enter para selecionar</p>
                <div className="flex flex-wrap justify-center gap-3">
                  {Array.from({ length: (current.config?.scale_max ?? 10) - (current.config?.scale_min ?? 1) + 1 }, (_, i) => {
                    const v = (current.config?.scale_min ?? 1) + i
                    return (
                      <button key={v} onClick={() => submitScale(v)}
                        className={`w-14 h-14 rounded-xl text-lg font-bold border-2 transition-all duration-150 ${
                          scaleValue === v ? 'bg-indigo-500 border-indigo-500 text-white scale-110' : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300 hover:scale-105'
                        }`}>{v}</button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Text short */}
            {current.question_type === 'text_short' && (
              <div className="space-y-3">
                <input
                  ref={el => { inputRef.current = el }}
                  type="text"
                  value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  placeholder="Digite sua resposta..."
                  className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm"
                />
                <button onClick={submitText} disabled={!textValue.trim() && current.required}
                  className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">Próximo →</button>
              </div>
            )}

            {/* Text long */}
            {current.question_type === 'text_long' && (
              <div className="space-y-3">
                <textarea
                  ref={el => { inputRef.current = el as HTMLTextAreaElement }}
                  value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  rows={4}
                  placeholder="Digite sua resposta..."
                  className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm resize-none"
                />
                <button onClick={submitText} disabled={!textValue.trim() && current.required}
                  className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">Próximo →</button>
              </div>
            )}

            {/* Email */}
            {current.question_type === 'email' && (
              <div className="space-y-3">
                <input
                  ref={el => { inputRef.current = el }}
                  type="email"
                  value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm"
                />
                <button onClick={submitText} disabled={!textValue.trim()}
                  className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">Próximo →</button>
              </div>
            )}

            {/* Phone */}
            {current.question_type === 'phone' && (
              <div className="space-y-3">
                <input
                  ref={el => { inputRef.current = el }}
                  type="tel"
                  value={textValue}
                  onChange={e => setTextValue(e.target.value)}
                  placeholder="(11) 99999-9999"
                  className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-indigo-400 bg-white shadow-sm"
                />
                <button onClick={submitText} disabled={!textValue.trim()}
                  className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40">Próximo →</button>
              </div>
            )}

            {/* Final capture */}
            {current.question_type === 'final_capture' && (
              <FinalCapture leadData={leadData} onSubmit={(data) => { recordAnswer(data); advance(current.next_question_id) }} />
            )}
          </div>
        )}

        {/* Result phase */}
        {(phase === 'result' || phase === 'submitting' || phase === 'done') && resultQuestion && (
          <ResultScreen
            question={resultQuestion}
            phase={phase}
            onSubmit={handleSubmit}
            leadData={leadData}
          />
        )}
      </div>
    </div>
  )
}

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
      <button
        onClick={() => onSubmit({ name, email, phone })}
        disabled={!name && !email && !phone}
        className="w-full py-4 bg-indigo-600 text-white text-base font-semibold rounded-2xl hover:bg-indigo-700 transition disabled:opacity-40"
      >
        Ver meu resultado →
      </button>
    </div>
  )
}

function ResultScreen({
  question,
  phase,
  onSubmit,
  leadData,
}: {
  question: QuizQuestion
  phase: 'result' | 'submitting' | 'done'
  onSubmit: () => void
  leadData: { name?: string; email?: string; phone?: string }
}) {
  const firstName = leadData.name?.split(' ')[0] ?? ''
  const resultText = (question.config?.result_text ?? '').replace(/{primeiro_nome}/g, firstName).replace(/{nome}/g, leadData.name ?? '')
  const ctaText = question.config?.cta_text || 'Acessar agora'
  const ctaUrl  = question.config?.cta_url

  return (
    <div className="w-full max-w-xl text-center" style={{ animation: 'fadeInUp 500ms cubic-bezier(0.4,0,0.2,1) forwards' }}>
      {/* Confetti dots */}
      <div className="relative flex justify-center mb-6" aria-hidden>
        {['#6366f1','#10b981','#f59e0b','#ef4444','#a855f7'].map((c, i) => (
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

      {resultText && (
        <p className="text-base md:text-lg text-gray-600 mb-8 leading-relaxed whitespace-pre-line">{resultText}</p>
      )}

      {phase === 'result' && (
        <button
          onClick={onSubmit}
          className="inline-flex items-center gap-2 px-8 py-4 bg-indigo-600 text-white text-lg font-semibold rounded-2xl hover:bg-indigo-700 transition shadow-lg hover:shadow-xl active:scale-95"
        >
          {ctaText}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      )}

      {phase === 'submitting' && (
        <div className="flex items-center justify-center gap-2 text-gray-500">
          <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/></svg>
          Processando...
        </div>
      )}

      {phase === 'done' && ctaUrl && (
        <p className="text-sm text-gray-400">Redirecionando...</p>
      )}

      {phase === 'done' && !ctaUrl && (
        <div className="flex items-center justify-center gap-2 text-emerald-600 font-medium">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="20 6 9 17 4 12"/></svg>
          Tudo certo! Aguarde o contato.
        </div>
      )}
    </div>
  )
}
