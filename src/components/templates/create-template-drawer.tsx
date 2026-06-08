'use client'

import React, { useState, useTransition } from 'react'
import { saveAsTemplate } from '@/app/actions/templates'
import { X } from 'lucide-react'

const CATEGORIES = [
  { value: 'captacao', label: 'Captação' },
  { value: 'lancamento', label: 'Lançamento' },
  { value: 'mentoria', label: 'Mentoria' },
  { value: 'cart_abandoned', label: 'Carrinho Abandonado' },
  { value: 'produto_fisico', label: 'Produto Físico' },
  { value: 'pos_venda', label: 'Pós-venda' },
  { value: 'reengajamento', label: 'Reengajamento' },
]

interface UserFunnel { id: string; name: string; status: string }
interface Props { onClose: () => void; userFunnels: UserFunnel[] }
type Step = 'origin' | 'select-funnel' | 'info' | 'done'

export default function CreateTemplateDrawer({ onClose, userFunnels }: Props) {
  const [step, setStep] = useState<Step>('origin')
  const [selectedFunnelId, setSelectedFunnelId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const [priceCents, setPriceCents] = useState(0)
  const [isPaid, setIsPaid] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const selectedFunnel = userFunnels.find(f => f.id === selectedFunnelId)

  const handleOriginFromFunnel = () => {
    if (userFunnels.length === 0) setStep('info')
    else setStep('select-funnel')
  }

  const handleSelectFunnel = () => {
    if (!selectedFunnelId) return
    setName(selectedFunnel?.name ?? '')
    setStep('info')
  }

  const handleSubmit = () => {
    if (!name.trim() || !description.trim() || !category) {
      setError('Preencha todos os campos obrigatórios.')
      return
    }
    setError('')
    const fd = new FormData()
    fd.set('name', name.trim())
    fd.set('description', description.trim())
    fd.set('category', category)
    fd.set('is_public', String(isPublic))
    fd.set('price_cents', String(isPaid ? Math.round(priceCents * 100) : 0))
    startTransition(async () => {
      if (selectedFunnelId) {
        const res = await saveAsTemplate(selectedFunnelId, fd)
        if (res.success) setStep('done')
        else setError(res.error ?? 'Erro ao criar template')
      } else {
        setStep('done')
      }
    })
  }

  const STEPS_ORDER: Step[] = ['origin', 'select-funnel', 'info']

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative bg-white h-full w-full max-w-lg shadow-2xl flex flex-col overflow-hidden"
        style={{ animation: 'slideInRight 0.25s ease both' }}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <div>
            <h2 className="font-bold text-gray-900">Criar Template</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'origin' && 'Escolha como começar'}
              {step === 'select-funnel' && 'Selecione um funil'}
              {step === 'info' && 'Informações do template'}
              {step === 'done' && 'Template criado!'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {step !== 'done' && (
          <div className="flex items-center gap-1 px-6 pt-4">
            {STEPS_ORDER.map(s => (
              <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${
                STEPS_ORDER.indexOf(step) >= STEPS_ORDER.indexOf(s) ? 'bg-indigo-500' : 'bg-gray-100'
              }`} />
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {step === 'origin' && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-800 mb-4">Criar template a partir de:</h3>
              <button onClick={handleOriginFromFunnel} className="w-full p-4 rounded-2xl border-2 border-gray-200 hover:border-indigo-400 hover:bg-indigo-50/50 text-left transition-colors group">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-xl shrink-0 group-hover:bg-indigo-200 transition-colors">📋</div>
                  <div>
                    <p className="font-semibold text-gray-900">Um funil existente</p>
                    <p className="text-sm text-gray-500 mt-0.5">Transforme um funil que já criou em template para reutilizar</p>
                  </div>
                </div>
              </button>
              <button onClick={() => { setSelectedFunnelId(null); setStep('info') }} className="w-full p-4 rounded-2xl border-2 border-gray-200 hover:border-purple-400 hover:bg-purple-50/50 text-left transition-colors group">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-xl shrink-0 group-hover:bg-purple-200 transition-colors">✨</div>
                  <div>
                    <p className="font-semibold text-gray-900">Do zero</p>
                    <p className="text-sm text-gray-500 mt-0.5">Crie um template em branco e monte no builder</p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {step === 'select-funnel' && (
            <div className="space-y-3">
              <h3 className="font-semibold text-gray-800 mb-4">Selecione o funil base:</h3>
              {userFunnels.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">Você ainda não tem funis criados.</div>
              ) : (
                userFunnels.map(f => (
                  <button key={f.id} onClick={() => setSelectedFunnelId(f.id)}
                    className={`w-full p-3.5 rounded-xl border-2 text-left transition-colors ${
                      selectedFunnelId === f.id ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{f.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{f.status === 'published' ? '🟢 Publicado' : '⚪ Rascunho'}</p>
                      </div>
                      {selectedFunnelId === f.id && (
                        <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center shrink-0">
                          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3"><polyline points="20,6 9,17 4,12"/></svg>
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {step === 'info' && (
            <div className="space-y-4">
              {selectedFunnel && (
                <div className="flex items-center gap-2 p-3 bg-indigo-50 rounded-xl text-sm text-indigo-700 mb-2">
                  <span>📋</span><span>Baseado em: <strong>{selectedFunnel.name}</strong></span>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome do template <span className="text-red-500">*</span></label>
                <input autoFocus type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Ex: Funil de Captação com Isca"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Descrição <span className="text-red-500">*</span></label>
                <textarea rows={3} value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Descreva o que este template faz e para quem é indicado…"
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Categoria <span className="text-red-500">*</span></label>
                <select value={category} onChange={e => setCategory(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">Selecione…</option>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Visibilidade</label>
                <div className="flex gap-3">
                  {[{ v: false, label: '🔒 Privado', desc: 'Só você vê' }, { v: true, label: '🌐 Público', desc: 'No marketplace' }].map(opt => (
                    <button key={String(opt.v)} onClick={() => setIsPublic(opt.v)}
                      className={`flex-1 p-3 rounded-xl border-2 text-left transition-colors ${isPublic === opt.v ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                      <p className="text-sm font-medium text-gray-900">{opt.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Preço</label>
                <div className="flex gap-3 mb-2">
                  {[{ v: false, label: '🆓 Gratuito' }, { v: true, label: '💰 Pago' }].map(opt => (
                    <button key={String(opt.v)} onClick={() => setIsPaid(opt.v)}
                      className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-colors ${isPaid === opt.v ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {isPaid && (
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">R$</span>
                    <input type="number" min="1" step="0.01" value={priceCents} onChange={e => setPriceCents(Number(e.target.value))}
                      className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="0,00" />
                  </div>
                )}
              </div>
              {error && <p className="text-sm text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center justify-center gap-5 py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center text-3xl">🎉</div>
              <div>
                <p className="text-xl font-bold text-gray-900">Template criado!</p>
                <p className="text-sm text-gray-500 mt-1">{isPublic ? 'Seu template já está no marketplace.' : 'Template salvo como privado.'}</p>
              </div>
              <button onClick={onClose} className="px-6 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors">Fechar</button>
            </div>
          )}
        </div>

        {step !== 'done' && step !== 'origin' && (
          <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100">
            <button
              onClick={() => setStep(step === 'info' ? (selectedFunnelId ? 'select-funnel' : 'origin') : 'origin')}
              className="px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors"
            >← Voltar</button>
            {step === 'select-funnel' ? (
              <button onClick={handleSelectFunnel} disabled={!selectedFunnelId}
                className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                Continuar
              </button>
            ) : (
              <button onClick={handleSubmit} disabled={isPending || !name.trim() || !description.trim() || !category}
                className="flex-1 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                {isPending
                  ? <><svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>Salvando…</>
                  : 'Publicar template'}
              </button>
            )}
          </div>
        )}
      </div>
      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
