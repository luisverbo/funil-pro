'use client'

import { useState, useRef } from 'react'
import type { QuizData, QuizPage, QuizBlock, BlockOption } from '@/app/actions/quiz-v2'

interface Props {
  data: QuizData
  pageId: string
  tenantId: string
}

function getYoutubeEmbed(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([^&?/]+)/)
  if (match) return `https://www.youtube.com/embed/${match[1]}`
  const vimeo = url.match(/vimeo\.com\/(\d+)/)
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`
  return url.includes('embed') ? url : null
}

export default function QuizRendererV2({ data, pageId, tenantId }: Props) {
  const primaryColor = data.settings.primary_color || '#6366f1'
  const showProgress = data.settings.show_progress !== false
  const pages = data.pages

  const [pageIdx, setPageIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [score, setScore] = useState(0)
  const [leadData, setLeadData] = useState<{ name?: string; email?: string; phone?: string }>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<'answering' | 'submitting' | 'done'>('answering')
  const [resultBlock, setResultBlock] = useState<QuizBlock | null>(null)
  const [transitionKey, setTransitionKey] = useState(0)
  const captureRef = useRef<{ name: string; email: string; phone: string }>({ name: '', email: '', phone: '' })

  const currentPage = pages[pageIdx]
  const totalPages = pages.length
  const progressPct = Math.round((pageIdx / totalPages) * 100)

  function setAnswer(blockId: string, value: unknown) {
    setAnswers(a => ({ ...a, [blockId]: value }))
    setErrors(e => { const ne = { ...e }; delete ne[blockId]; return ne })
  }

  function resolveNextPage(currentPageIdx: number, currentAnswers: Record<string, unknown>, currentScore: number): number | 'result' | 'end' {
    const page = pages[currentPageIdx]

    // Check goto_page_id from choice block answers
    for (const block of page.blocks) {
      if (['single_choice', 'multi_choice', 'yes_no'].includes(block.type)) {
        const ans = currentAnswers[block.id]
        const opts = block.config.options ?? []
        if (block.type === 'single_choice' || block.type === 'yes_no') {
          const chosen = opts.find(o => o.label === ans)
          if (chosen?.goto_page_id) {
            const idx = pages.findIndex(p => p.id === chosen.goto_page_id)
            if (idx >= 0) return idx
          }
        }
      }
      // Button with goto
      if (block.type === 'button' && block.config.button_action === 'external_url') {
        // handled elsewhere
      }
    }

    // Check result blocks
    const resultBlk = page.blocks.find(b => b.type === 'result')
    if (resultBlk) return 'result'

    // Check score ranges on result blocks in subsequent pages
    for (let i = currentPageIdx + 1; i < pages.length; i++) {
      const rb = pages[i].blocks.find(b => b.type === 'result')
      if (rb) {
        const ranges = rb.config.score_ranges ?? []
        if (ranges.length > 0) {
          const match = ranges.find(r => currentScore >= r.min && currentScore <= r.max)
          if (match?.goto_page_id) {
            const idx = pages.findIndex(p => p.id === match.goto_page_id)
            if (idx >= 0) {
              const targetResult = pages[idx].blocks.find(b => b.type === 'result')
              if (targetResult) {
                setResultBlock(targetResult)
                return 'result'
              }
            }
          }
          setResultBlock(rb)
          return 'result'
        }
      }
    }

    if (currentPageIdx + 1 >= pages.length) return 'end'
    return currentPageIdx + 1
  }

  function handleNext() {
    const page = pages[pageIdx]

    // Validate required fields
    const newErrors: Record<string, string> = {}
    for (const block of page.blocks) {
      if (block.config.required && !['result','text_block','image','video','button'].includes(block.type)) {
        const val = answers[block.id]
        if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
          newErrors[block.id] = 'Campo obrigatório'
        }
      }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return }
    setErrors({})

    // Accumulate score & lead data
    let pageScore = 0
    for (const block of page.blocks) {
      if (['single_choice', 'yes_no'].includes(block.type)) {
        const chosen = (block.config.options ?? []).find(o => o.label === answers[block.id])
        pageScore += chosen?.points ?? 0
      }
      if (block.type === 'multi_choice') {
        const selected = (answers[block.id] as string[]) ?? []
        for (const lbl of selected) {
          const opt = (block.config.options ?? []).find(o => o.label === lbl)
          pageScore += opt?.points ?? 0
        }
      }
      if (block.type === 'field_email' && answers[block.id]) setLeadData(d => ({ ...d, email: String(answers[block.id]) }))
      if (block.type === 'field_phone' && answers[block.id]) setLeadData(d => ({ ...d, phone: String(answers[block.id]) }))
      if (block.type === 'final_capture') {
        const fc = captureRef.current
        setLeadData(d => ({ ...d, name: fc.name || d.name, email: fc.email || d.email, phone: fc.phone || d.phone }))
      }
    }
    const newScore = score + pageScore
    setScore(newScore)

    // Check for result on current page
    const resultBlk = page.blocks.find(b => b.type === 'result')
    if (resultBlk) {
      setResultBlock(resultBlk)
      submitResult(resultBlk, newScore)
      return
    }

    const next = resolveNextPage(pageIdx, answers, newScore)

    if (next === 'result') {
      const rb = resultBlock ?? pages.flatMap(p => p.blocks).find(b => b.type === 'result')
      if (rb) {
        setResultBlock(rb)
        submitResult(rb, newScore)
      }
      return
    }
    if (next === 'end') {
      setPhase('done')
      return
    }
    setTransitionKey(k => k + 1)
    setPageIdx(next as number)
  }

  async function submitResult(rb: QuizBlock, finalScore: number) {
    setPhase('submitting')

    const ld = { ...leadData }
    if (captureRef.current.name)  ld.name  = captureRef.current.name
    if (captureRef.current.email) ld.email = captureRef.current.email
    if (captureRef.current.phone) ld.phone = captureRef.current.phone

    try {
      await fetch(`/api/quiz/${pageId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers,
          leadData: ld,
          result_profile: rb.config.title ?? null,
          funnel_id: rb.config.funnel_id ?? null,
          tenantId,
        }),
      })
    } catch { /* continue */ }

    setPhase('done')
    const cta = rb.config.cta_url
    if (cta) setTimeout(() => { window.location.href = cta }, 800)
  }

  function renderBlock(block: QuizBlock) {
    const { config } = block
    const val = answers[block.id]
    const err = errors[block.id]

    if (block.type === 'result' || phase !== 'answering') {
      // result handled separately below
      return null
    }

    return (
      <div key={block.id}>
        {/* Choice types */}
        {['single_choice', 'multi_choice', 'yes_no'].includes(block.type) && (
          <div style={{ background: config.bg_color || undefined }}>
            {config.question && (
              <div className="text-center mb-6">
                <h2 className="text-2xl md:text-3xl font-bold text-gray-900">{config.question}</h2>
                {config.subtitle && <p className="text-gray-500 mt-1">{config.subtitle}</p>}
              </div>
            )}
            <div className="space-y-3">
              {(config.options ?? []).map((opt: BlockOption) => {
                const isSelected = block.type === 'multi_choice'
                  ? Array.isArray(val) && (val as string[]).includes(opt.label)
                  : val === opt.label

                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      if (block.type === 'multi_choice') {
                        const cur = (val as string[]) ?? []
                        setAnswer(block.id, isSelected ? cur.filter(l => l !== opt.label) : [...cur, opt.label])
                      } else {
                        setAnswer(block.id, opt.label)
                      }
                    }}
                    className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all duration-150 shadow-sm ${
                      isSelected ? 'scale-[0.99]' : 'border-gray-200 bg-white hover:scale-[1.01]'
                    }`}
                    style={isSelected ? { borderColor: primaryColor, backgroundColor: primaryColor + '10' } : undefined}
                  >
                    {block.type === 'multi_choice' && (
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition ${isSelected ? 'text-white' : 'border-gray-300'}`}
                        style={isSelected ? { background: primaryColor, borderColor: primaryColor } : undefined}>
                        {isSelected && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>}
                      </div>
                    )}
                    {opt.emoji && <span className="text-3xl shrink-0">{opt.emoji}</span>}
                    <span className="text-base font-medium text-gray-800 flex-1">{opt.label}</span>
                  </button>
                )
              })}
            </div>
            {block.type === 'multi_choice' && (
              <button onClick={handleNext} disabled={!Array.isArray(val) || (val as string[]).length === 0}
                style={{ background: primaryColor }}
                className="w-full mt-4 py-4 text-white text-base font-semibold rounded-2xl shadow transition disabled:opacity-40 hover:opacity-90">
                Próximo →
              </button>
            )}
          </div>
        )}

        {/* Scale */}
        {block.type === 'scale' && (
          <div className="text-center">
            {config.question && <h2 className="text-2xl font-bold text-gray-900 mb-6">{config.question}</h2>}
            <div className="flex flex-wrap justify-center gap-3">
              {Array.from({ length: (config.scale_max ?? 10) - (config.scale_min ?? 1) + 1 }, (_, i) => {
                const v = (config.scale_min ?? 1) + i
                return (
                  <button key={v} onClick={() => setAnswer(block.id, v)}
                    className={`w-14 h-14 rounded-xl text-lg font-bold border-2 transition-all ${val === v ? 'text-white scale-110' : 'bg-white border-gray-200 text-gray-700 hover:scale-105'}`}
                    style={val === v ? { background: primaryColor, borderColor: primaryColor } : undefined}>
                    {v}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Form fields */}
        {['field_text','field_email','field_phone','field_number'].includes(block.type) && (
          <div>
            {config.label && <label className="block text-lg font-semibold text-gray-800 mb-3">{config.label}</label>}
            <input
              type={block.type === 'field_email' ? 'email' : block.type === 'field_phone' ? 'tel' : block.type === 'field_number' ? 'number' : 'text'}
              value={(val as string) ?? ''}
              onChange={e => setAnswer(block.id, e.target.value)}
              placeholder={config.placeholder}
              className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none bg-white transition"
              style={{ borderColor: err ? '#ef4444' : undefined }}
              onFocus={e => e.target.style.borderColor = primaryColor}
              onBlur={e => e.target.style.borderColor = err ? '#ef4444' : '#e5e7eb'}
            />
          </div>
        )}

        {block.type === 'field_textarea' && (
          <div>
            {config.label && <label className="block text-lg font-semibold text-gray-800 mb-3">{config.label}</label>}
            <textarea
              value={(val as string) ?? ''}
              onChange={e => setAnswer(block.id, e.target.value)}
              placeholder={config.placeholder}
              rows={4}
              className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none bg-white resize-none"
            />
          </div>
        )}

        {/* Text block */}
        {block.type === 'text_block' && config.content && (
          <div className="prose prose-gray max-w-none text-center"
            dangerouslySetInnerHTML={{ __html: config.content }} />
        )}

        {/* Image */}
        {block.type === 'image' && config.image_url && (
          <div className={`flex ${config.image_align === 'left' ? 'justify-start' : config.image_align === 'right' ? 'justify-end' : 'justify-center'}`}>
            <img
              src={config.image_url}
              alt=""
              className={`rounded-xl object-cover ${
                config.image_size === 'small' ? 'max-w-xs' :
                config.image_size === 'large' ? 'max-w-2xl w-full' :
                config.image_size === 'full' ? 'w-full' : 'max-w-md'
              }`}
            />
          </div>
        )}

        {/* Video */}
        {block.type === 'video' && config.video_url && (() => {
          const embed = getYoutubeEmbed(config.video_url)
          return embed ? (
            <div className="aspect-video rounded-xl overflow-hidden bg-black">
              <iframe src={embed} className="w-full h-full" allowFullScreen />
            </div>
          ) : null
        })()}

        {/* Button (not next_page — those are handled by global Next button) */}
        {block.type === 'button' && config.button_action === 'external_url' && (
          <div className={`flex ${config.button_align === 'left' ? 'justify-start' : config.button_align === 'right' ? 'justify-end' : 'justify-center'}`}>
            <a href={config.button_url || '#'} target="_blank" rel="noopener noreferrer"
              className="px-8 py-4 text-base font-semibold text-white rounded-2xl shadow transition hover:opacity-90"
              style={{ background: config.button_color || primaryColor }}>
              {config.button_text || 'Acessar'}
            </a>
          </div>
        )}

        {/* Final capture */}
        {block.type === 'final_capture' && (
          <div className="space-y-3">
            {config.show_name && (
              <input type="text" placeholder="Seu nome"
                onChange={e => { captureRef.current.name = e.target.value }}
                className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none bg-white" />
            )}
            {config.show_email && (
              <input type="email" placeholder="seu@email.com"
                onChange={e => { captureRef.current.email = e.target.value }}
                className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none bg-white" />
            )}
            {config.show_phone && (
              <input type="tel" placeholder="(11) 99999-9999"
                onChange={e => { captureRef.current.phone = e.target.value }}
                className="w-full px-5 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none bg-white" />
            )}
          </div>
        )}

        {err && <p className="text-sm text-red-500 mt-2">{err}</p>}
      </div>
    )
  }

  const hasChoiceAutoAdvance = currentPage?.blocks.some(b => ['single_choice','yes_no'].includes(b.type))
  const hasFinalCapture = currentPage?.blocks.some(b => b.type === 'final_capture')
  const hasExplicitButton = currentPage?.blocks.some(b => b.type === 'button' && b.config.button_action !== 'external_url')
  const hasResultBlock = currentPage?.blocks.some(b => b.type === 'result')

  // For single choice, auto-advance when an option is selected AND there's no other input block
  const nonChoiceInputs = currentPage?.blocks.filter(b => !['single_choice','yes_no','text_block','image','video','button'].includes(b.type)) ?? []
  const shouldShowNextButton = !hasResultBlock && (!hasChoiceAutoAdvance || nonChoiceInputs.length > 0 || hasFinalCapture)

  if (phase !== 'answering' && resultBlock) {
    const cfg = resultBlock.config
    const scoreText = cfg.show_score
      ? (cfg.score_display_text || 'Você fez {{score}} pontos!').replace(/\{\{score\}\}/g, String(score))
      : null
    const ctaUrl = cfg.cta_url

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8" style={{ background: '#f8f7ff' }}>
        <style>{`@keyframes fadeInUp { from { opacity:0; transform:translateY(24px); } to { opacity:1; transform:translateY(0); } } @keyframes confettiFall { 0%{transform:translateY(-20px) rotate(0deg);opacity:1} 100%{transform:translateY(200px) rotate(720deg);opacity:0} }`}</style>
        <div className="w-full max-w-xl text-center" style={{ animation: 'fadeInUp 500ms cubic-bezier(0.4,0,0.2,1) forwards' }}>
          <div className="relative flex justify-center mb-6" aria-hidden>
            {[primaryColor,'#10b981','#f59e0b','#ef4444','#a855f7'].map((c, i) => (
              <div key={i} style={{ width: 10, height: 10, borderRadius: '50%', background: c, margin: '0 4px', animation: `confettiFall ${1 + i * 0.15}s ${i * 0.1}s ease-in forwards` }} />
            ))}
          </div>
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-2xl md:text-4xl font-bold text-gray-900 mb-4">{cfg.title || 'Parabéns!'}</h2>
          {scoreText && (
            <div className="inline-flex items-center gap-2 mb-4 px-4 py-2 rounded-2xl font-semibold text-lg" style={{ background: primaryColor + '20', color: primaryColor }}>
              🏆 {scoreText}
            </div>
          )}
          {cfg.description && <p className="text-base md:text-lg text-gray-600 mb-8 leading-relaxed whitespace-pre-line">{cfg.description.replace(/\{\{score\}\}/g, String(score))}</p>}
          {phase === 'submitting' && (
            <div className="flex items-center justify-center gap-2 text-gray-500">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="40" strokeDashoffset="10"/></svg>
              Processando...
            </div>
          )}
          {phase === 'done' && cfg.cta_text && (
            <a href={ctaUrl || '#'} target={ctaUrl ? '_blank' : undefined} rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-8 py-4 text-white text-lg font-semibold rounded-2xl shadow-lg hover:opacity-90 transition"
              style={{ background: primaryColor }}>
              {cfg.cta_text}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </a>
          )}
          {phase === 'done' && !cfg.cta_text && (
            <div className="flex items-center justify-center gap-2 font-medium" style={{ color: primaryColor }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><polyline points="20 6 9 17 4 12"/></svg>
              Tudo certo! Aguarde o contato.
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#fafafa' }}>
      <style>{`@keyframes slideIn { from { opacity:0; transform:translateX(32px); } to { opacity:1; transform:translateX(0); } }`}</style>

      {/* Progress bar */}
      {showProgress && (
        <div className="h-1 shrink-0" style={{ background: primaryColor + '30' }}>
          <div className="h-full transition-all duration-500" style={{ width: `${progressPct}%`, background: primaryColor }} />
        </div>
      )}

      {/* Back button */}
      {pageIdx > 0 && (
        <div className="px-6 pt-4 shrink-0">
          <button onClick={() => { setPageIdx(i => i - 1); setTransitionKey(k => k + 1) }}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Voltar
          </button>
        </div>
      )}

      {/* Page content */}
      <div key={transitionKey} className="flex-1 flex items-center justify-center px-4 py-8"
        style={{ animation: 'slideIn 350ms cubic-bezier(0.4,0,0.2,1) forwards' }}>
        <div className="w-full max-w-xl space-y-6">
          {currentPage?.blocks.map(renderBlock)}

          {/* Global "Próximo" button */}
          {shouldShowNextButton && !hasExplicitButton && (
            <button
              onClick={() => {
                // Auto-advance single choice if answered
                if (hasChoiceAutoAdvance) {
                  const choiceBlock = currentPage.blocks.find(b => ['single_choice','yes_no'].includes(b.type))
                  if (choiceBlock && !answers[choiceBlock.id]) {
                    setErrors(e => ({ ...e, [choiceBlock.id]: 'Selecione uma opção' }))
                    return
                  }
                }
                handleNext()
              }}
              style={{ background: primaryColor }}
              className="w-full py-4 text-white text-base font-semibold rounded-2xl shadow transition hover:opacity-90"
            >
              {hasFinalCapture ? (currentPage.blocks.find(b => b.type === 'final_capture')?.config.submit_text || 'Ver meu resultado →') : 'Próximo →'}
            </button>
          )}

          {/* Button block that acts as Next */}
          {hasExplicitButton && currentPage.blocks.filter(b => b.type === 'button' && b.config.button_action !== 'external_url').map(b => (
            <div key={b.id} className={`flex ${b.config.button_align === 'left' ? 'justify-start' : b.config.button_align === 'right' ? 'justify-end' : 'justify-center'}`}>
              <button onClick={handleNext}
                className="px-8 py-4 text-base font-semibold text-white rounded-2xl shadow transition hover:opacity-90"
                style={{ background: b.config.button_color || primaryColor }}>
                {b.config.button_text || 'Próximo →'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
