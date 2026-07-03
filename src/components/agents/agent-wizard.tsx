'use client'

import React, { useState, useRef } from 'react'
import type { Agent, AgentInput, AgentMode, AgentObjective, ProductPrice } from '@/app/actions/ai-agents'
import { createAgent, updateAgent } from '@/app/actions/ai-agents'
import AgentTestChat from './agent-test-chat'

interface Props {
  agent?: Agent | null
  funnels: { id: string; name: string }[]
  instances: { id: string; instance_name: string; status: string }[]
  documents?: { id: string; file_name: string; uploaded_at: string }[]
  onClose: () => void
  onSaved: () => void
}

const TONES = [
  'amigável e consultivo',
  'direto e objetivo',
  'divertido e descontraído',
  'formal e profissional',
  'personalizado',
]

const OBJECTIVES: { value: AgentObjective; label: string; desc: string; emoji: string }[] = [
  { value: 'qualify', label: 'Qualificar', desc: 'Coleta informações e qualifica o lead', emoji: '🎯' },
  { value: 'route_to_funnel', label: 'Rotear para funil', desc: 'Encaminha o lead para um funil publicado', emoji: '🔀' },
  { value: 'sell_direct', label: 'Vender direto', desc: 'Conduz o lead até a compra', emoji: '💰' },
]

const STEPS = ['Identidade', 'Produto', 'Personalidade', 'Objetivo', 'Revisão']

export default function AgentWizard({ agent, funnels, instances, documents, onClose, onSaved }: Props) {
  const isEdit = !!agent
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [agentId, setAgentId] = useState<string | undefined>(agent?.id)
  const [docs, setDocs] = useState(documents ?? [])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showTest, setShowTest] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState<AgentInput>({
    name: agent?.name ?? '',
    mode: agent?.mode ?? 'standalone',
    objective: agent?.objective ?? 'qualify',
    product_name: agent?.product_name ?? '',
    product_description: agent?.product_description ?? '',
    product_price_cents: agent?.product_price_cents ?? null,
    product_prices: (agent as Agent & { product_prices?: ProductPrice[] })?.product_prices ?? [],
    product_page_url: (agent as Agent & { product_page_url?: string })?.product_page_url ?? '',
    tone_of_voice: agent?.tone_of_voice ?? 'amigável e consultivo',
    greeting_message: agent?.greeting_message ?? '',
    qualification_rules: agent?.qualification_rules ?? '',
    objection_handling: agent?.objection_handling ?? '',
    payment_link: agent?.payment_link ?? '',
    target_funnel_id: agent?.target_funnel_id ?? null,
    whatsapp_instance_id: agent?.whatsapp_instance_id ?? null,
    handoff_to_human_keywords: agent?.handoff_to_human_keywords ?? ['falar com humano', 'atendente', 'pessoa real'],
  })

  // kept for summary display of the first/main price
  const [priceInput, setPriceInput] = useState(
    agent?.product_price_cents ? (agent.product_price_cents / 100).toFixed(2) : ''
  )
  // new price being typed in the multi-price adder
  const [newPriceLabel, setNewPriceLabel] = useState('')
  const [newPriceValue, setNewPriceValue] = useState('')
  const [customTone, setCustomTone] = useState(
    agent?.tone_of_voice && !TONES.includes(agent.tone_of_voice) ? agent.tone_of_voice : ''
  )
  const [toneSelect, setToneSelect] = useState(
    agent?.tone_of_voice && !TONES.includes(agent.tone_of_voice) ? 'personalizado' : (agent?.tone_of_voice ?? TONES[0])
  )
  const [keywordInput, setKeywordInput] = useState('')

  function set<K extends keyof AgentInput>(key: K, value: AgentInput[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function addPrice() {
    const val = newPriceValue.trim().replace(',', '.')
    if (!val || isNaN(parseFloat(val))) return
    const entry: ProductPrice = {
      id: crypto.randomUUID(),
      label: newPriceLabel.trim() || 'Preço',
      value_cents: Math.round(parseFloat(val) * 100),
    }
    set('product_prices', [...(form.product_prices ?? []), entry])
    setNewPriceLabel('')
    setNewPriceValue('')
  }

  function removePrice(id: string) {
    set('product_prices', (form.product_prices ?? []).filter(p => p.id !== id))
  }

  function buildPayload(): AgentInput {
    // product_price_cents = first price for backwards compat
    const prices = form.product_prices ?? []
    const firstPrice = prices.length > 0 ? prices[0].value_cents : (priceInput.trim() ? Math.round(parseFloat(priceInput.replace(',', '.')) * 100) : null)
    const tone = toneSelect === 'personalizado' ? (customTone || 'personalizado') : toneSelect
    return { ...form, product_price_cents: firstPrice, tone_of_voice: tone }
  }

  async function ensureAgentCreated(): Promise<string | undefined> {
    if (agentId) {
      await updateAgent(agentId, buildPayload())
      return agentId
    }
    const res = await createAgent(buildPayload())
    if (res.id) { setAgentId(res.id); return res.id }
    alert(res.error ?? 'Erro ao criar agente')
    return undefined
  }

  async function save(activate: boolean) {
    setSaving(true)
    try {
      const id = await ensureAgentCreated()
      if (!id) return
      if (activate) await updateAgent(id, { ...buildPayload() })
      // status handled separately by listing page; set via update for activate
      if (activate) {
        const { activateAgent } = await import('@/app/actions/ai-agents')
        await activateAgent(id)
      }
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    let id = agentId
    if (!id) {
      id = await ensureAgentCreated()
      if (!id) return
    }
    setUploading(true)
    setUploadError(null)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/api/agents/${id}/documents`, { method: 'POST', body: fd })
        const data = await res.json()
        if (data.document) setDocs(d => [data.document, ...d])
        else if (data.message) setUploadError(`${file.name}: ${data.message}`)
        else if (data.error) setUploadError(`${file.name}: falha no envio (${data.error})`)
      }
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeDoc(docId: string) {
    if (!agentId) return
    await fetch(`/api/agents/${agentId}/documents?docId=${docId}`, { method: 'DELETE' })
    setDocs(d => d.filter(x => x.id !== docId))
  }

  const canNext = step !== 0 || !!form.name?.trim()

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header / stepper */}
        <div className="px-6 pt-5 pb-3 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">{isEdit ? 'Editar agente' : 'Criar agente IA'}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
          </div>
          <div className="flex gap-1">
            {STEPS.map((s, i) => (
              <button
                key={s}
                onClick={() => setStep(i)}
                className={`flex-1 text-center text-xs py-1.5 rounded-md transition-colors ${
                  i === step ? 'bg-indigo-600 text-white font-medium'
                  : i < step ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-400'
                }`}
              >
                {i + 1}. {s}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 0 && (
            <div className="flex flex-col gap-4">
              <Field label="Nome do agente">
                <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ex: Vendedor Premium" />
              </Field>
              <Field label="Modo">
                <div className="flex gap-3">
                  {(['standalone', 'funnel_block'] as AgentMode[]).map(m => (
                    <label key={m} className={`flex-1 border rounded-lg p-3 cursor-pointer text-sm ${form.mode === m ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                      <input type="radio" className="mr-2" checked={form.mode === m} onChange={() => set('mode', m)} />
                      {m === 'standalone' ? 'Standalone' : 'Bloco de funil'}
                    </label>
                  ))}
                </div>
              </Field>
              {form.mode === 'standalone' && (
                <Field label="Instância WhatsApp">
                  <select className={inputCls} value={form.whatsapp_instance_id ?? ''} onChange={e => set('whatsapp_instance_id', e.target.value || null)}>
                    <option value="">Nenhuma</option>
                    {instances.map(i => <option key={i.id} value={i.id}>{i.instance_name} ({i.status})</option>)}
                  </select>
                </Field>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-4">
              <Field label="Nome do produto">
                <input className={inputCls} value={form.product_name ?? ''} onChange={e => set('product_name', e.target.value)} />
              </Field>
              <Field label="Descrição">
                <textarea className={inputCls + ' h-28'} value={form.product_description ?? ''} onChange={e => set('product_description', e.target.value)} />
              </Field>
              <Field label="Link da página / checkout">
                <input className={inputCls} value={form.product_page_url ?? ''} onChange={e => set('product_page_url', e.target.value)} placeholder="https://..." />
                <p className="text-xs text-gray-400 mt-1">O agente pode compartilhar este link quando o lead pedir mais informações.</p>
              </Field>
              <Field label="Preços">
                <div className="flex flex-col gap-2 mb-2">
                  {(form.product_prices ?? []).map(p => (
                    <div key={p.id} className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium text-gray-700">{p.label}</span>
                      <span className="text-indigo-600 font-semibold">R$ {(p.value_cents / 100).toFixed(2).replace('.', ',')}</span>
                      <button type="button" onClick={() => removePrice(p.id)} className="text-gray-400 hover:text-red-500 ml-2">×</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <p className="text-xs text-gray-500 mb-1">Nome do preço (ex: Mensal, Anual)</p>
                    <input className={inputCls} value={newPriceLabel} onChange={e => setNewPriceLabel(e.target.value)} placeholder="Ex: Mensal" />
                  </div>
                  <div className="w-32">
                    <p className="text-xs text-gray-500 mb-1">Valor (R$)</p>
                    <input className={inputCls} value={newPriceValue} onChange={e => setNewPriceValue(e.target.value)} placeholder="0,00" onKeyDown={e => e.key === 'Enter' && addPrice()} />
                  </div>
                  <button type="button" onClick={addPrice} className="h-10 px-3 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 whitespace-nowrap flex-shrink-0">+ Adicionar</button>
                </div>
                <p className="text-xs text-gray-400 mt-1">Adicione quantos preços quiser (ex: mensal, anual, plano básico, plano premium…)</p>
              </Field>
              <Field label="Documentos de treinamento">
                {!agentId && !isEdit ? (
                  <p className="text-sm text-gray-500">Você poderá adicionar documentos após criar o agente. Faça upload aqui após salvar.</p>
                ) : null}
                <div className="flex flex-col gap-2">
                  <input ref={fileRef} type="file" multiple accept=".pdf,.txt,.md,.csv" onChange={e => handleUpload(e.target.files)} className="text-sm" />
                  {uploading && <span className="text-xs text-indigo-600">Enviando…</span>}
                  {uploadError && <span className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{uploadError}</span>}
                  {docs.map(d => (
                    <div key={d.id} className="flex items-center justify-between text-sm border rounded-lg px-3 py-2">
                      <span>📄 {d.file_name}</span>
                      <button onClick={() => removeDoc(d.id)} className="text-red-500 text-xs hover:underline">remover</button>
                    </div>
                  ))}
                </div>
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <Field label="Tom de voz">
                <select className={inputCls} value={toneSelect} onChange={e => setToneSelect(e.target.value)}>
                  {TONES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {toneSelect === 'personalizado' && (
                  <input className={inputCls + ' mt-2'} value={customTone} onChange={e => setCustomTone(e.target.value)} placeholder="Descreva o tom de voz" />
                )}
              </Field>
              <Field label="Mensagem de saudação">
                <textarea className={inputCls + ' h-24'} value={form.greeting_message ?? ''} onChange={e => set('greeting_message', e.target.value)} placeholder="Olá! Como posso ajudar você hoje?" />
              </Field>
              <div>
                <span className="text-xs text-gray-500">Pré-visualização</span>
                <div className="mt-1 bg-[#e5ddd5] rounded-lg p-4">
                  <div className="bg-white max-w-[80%] px-3 py-2 rounded-lg rounded-tl-sm shadow text-sm text-gray-800">
                    {form.greeting_message || 'Sua mensagem de saudação aparecerá aqui.'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <Field label="Objetivo do agente">
                <div className="flex flex-col gap-2">
                  {OBJECTIVES.map(o => (
                    <label key={o.value} className={`border rounded-lg p-3 cursor-pointer flex gap-3 items-start ${form.objective === o.value ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                      <input type="radio" className="mt-1" checked={form.objective === o.value} onChange={() => set('objective', o.value)} />
                      <div>
                        <div className="font-medium text-sm">{o.emoji} {o.label}</div>
                        <div className="text-xs text-gray-500">{o.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </Field>

              {form.objective === 'qualify' && (
                <Field label="Regras de qualificação">
                  <textarea className={inputCls + ' h-24'} value={form.qualification_rules ?? ''} onChange={e => set('qualification_rules', e.target.value)} placeholder="Ex: lead deve ter orçamento acima de R$ 500 e prazo de 30 dias" />
                </Field>
              )}
              {form.objective === 'route_to_funnel' && (
                <Field label="Funil de destino">
                  <select className={inputCls} value={form.target_funnel_id ?? ''} onChange={e => set('target_funnel_id', e.target.value || null)}>
                    <option value="">Selecione um funil</option>
                    {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </Field>
              )}
              {form.objective === 'sell_direct' && (
                <>
                  <Field label="Link de pagamento">
                    <input className={inputCls} value={form.payment_link ?? ''} onChange={e => set('payment_link', e.target.value)} placeholder="https://" />
                  </Field>
                  <Field label="Tratamento de objeções">
                    <textarea className={inputCls + ' h-24'} value={form.objection_handling ?? ''} onChange={e => set('objection_handling', e.target.value)} />
                  </Field>
                </>
              )}

              <Field label="Palavras para transferir a humano">
                <div className="flex flex-wrap gap-2 mb-2">
                  {(form.handoff_to_human_keywords ?? []).map(k => (
                    <span key={k} className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                      {k}
                      <button onClick={() => set('handoff_to_human_keywords', (form.handoff_to_human_keywords ?? []).filter(x => x !== k))} className="text-gray-400 hover:text-red-500">×</button>
                    </span>
                  ))}
                </div>
                <input
                  className={inputCls}
                  value={keywordInput}
                  onChange={e => setKeywordInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && keywordInput.trim()) {
                      e.preventDefault()
                      set('handoff_to_human_keywords', [...(form.handoff_to_human_keywords ?? []), keywordInput.trim()])
                      setKeywordInput('')
                    }
                  }}
                  placeholder="Digite e pressione Enter"
                />
              </Field>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-3">
              <SummaryRow label="Nome" value={form.name} />
              <SummaryRow label="Modo" value={form.mode === 'standalone' ? 'Standalone' : 'Bloco de funil'} />
              <SummaryRow label="Produto" value={form.product_name || '—'} />
              <SummaryRow label="Preços" value={(form.product_prices ?? []).length > 0 ? (form.product_prices ?? []).map(p => `${p.label}: R$ ${(p.value_cents/100).toFixed(2).replace('.',',')}`).join(' | ') : '—'} />
              {form.product_page_url && <SummaryRow label="Link do produto" value={form.product_page_url} />}
              <SummaryRow label="Tom de voz" value={toneSelect === 'personalizado' ? customTone : toneSelect} />
              <SummaryRow label="Objetivo" value={OBJECTIVES.find(o => o.value === form.objective)?.label ?? ''} />
              <SummaryRow label="Documentos" value={`${docs.length} arquivo(s)`} />

              {showTest && agentId ? (
                <div className="mt-2">
                  <AgentTestChat agentId={agentId} />
                </div>
              ) : (
                <button
                  onClick={async () => { const id = await ensureAgentCreated(); if (id) setShowTest(true) }}
                  className="mt-2 px-4 py-2 border border-indigo-300 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-50"
                >
                  Testar agente
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between">
          <button
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            className="px-4 py-2 text-sm text-gray-600 disabled:opacity-40"
          >
            Voltar
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => canNext && setStep(s => s + 1)}
              disabled={!canNext}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-indigo-700"
            >
              Próximo
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => save(false)} disabled={saving} className="px-4 py-2 border rounded-lg text-sm font-medium disabled:opacity-50">
                Salvar rascunho
              </button>
              <button onClick={() => save(true)} disabled={saving} className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-indigo-700">
                Ativar agente
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b pb-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-800 text-right">{value}</span>
    </div>
  )
}
