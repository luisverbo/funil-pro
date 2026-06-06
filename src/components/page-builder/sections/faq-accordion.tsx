'use client'

import { useNode } from '@craftjs/core'
import React, { useState } from 'react'

interface FaqItem { question: string; answer: string }
interface FaqAccordionProps {
  title?: string
  items?: FaqItem[]
  onlyOneOpen?: boolean
  bgColor?: string
  textColor?: string
  paddingY?: number
}

const DEFAULT_ITEMS: FaqItem[] = [
  { question: 'Para quem é este produto?', answer: 'Este produto é ideal para empreendedores digitais, infoprodutores e gestores de tráfego que desejam escalar seus resultados.' },
  { question: 'Como funciona o acesso?', answer: 'Após a confirmação do pagamento, você receberá um e-mail com seus dados de acesso em até 5 minutos.' },
  { question: 'Tem garantia?', answer: 'Sim! Você tem 7 dias de garantia incondicional. Se não ficar satisfeito, devolvemos 100% do seu investimento sem perguntas.' },
]

export const FaqAccordion = ({
  title = 'Perguntas Frequentes',
  items = DEFAULT_ITEMS,
  onlyOneOpen = true,
  bgColor = '#ffffff',
  textColor = '#111827',
  paddingY = 48,
}: FaqAccordionProps) => {
  const { connectors: { connect, drag } } = useNode()
  const [openIndexes, setOpenIndexes] = useState<number[]>([])

  const toggle = (idx: number) => {
    setOpenIndexes((prev) => {
      if (onlyOneOpen) return prev.includes(idx) ? [] : [idx]
      return prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    })
  }

  return (
    <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }} className="w-full px-6">
      <div className="max-w-3xl mx-auto">
        {title && <h2 className="text-2xl md:text-3xl font-bold text-center mb-8" style={{ color: textColor }}>{title}</h2>}
        <div className="space-y-3">
          {items.map((item, idx) => {
            const isOpen = openIndexes.includes(idx)
            return (
              <div key={idx} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm" style={{ borderColor: isOpen ? '#6366f1' : '#e5e7eb' }}>
                <button onClick={() => toggle(idx)} className="w-full flex items-center justify-between px-5 py-4 text-left font-semibold text-sm md:text-base focus:outline-none hover:bg-gray-50 transition-colors" style={{ color: textColor }}>
                  <span className="flex-1 pr-4">{item.question}</span>
                  <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors" style={{ backgroundColor: isOpen ? '#6366f1' : '#f3f4f6', color: isOpen ? '#fff' : '#6b7280' }}>
                    {isOpen ? <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" /></svg>
                      : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>}
                  </span>
                </button>
                <div style={{ maxHeight: isOpen ? '600px' : '0px', overflow: 'hidden', transition: 'max-height 0.3s ease' }}>
                  <p className="px-5 pb-4 pt-1 text-sm md:text-base leading-relaxed opacity-75" style={{ color: textColor }}>{item.answer}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const FaqAccordionSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as FaqAccordionProps }))
  const items = props.items ?? DEFAULT_ITEMS
  const updateItem = (idx: number, field: 'question' | 'answer', value: string) => {
    setProp((p: FaqAccordionProps) => { const arr = [...(p.items ?? DEFAULT_ITEMS)]; arr[idx] = { ...arr[idx], [field]: value }; p.items = arr })
  }
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Título</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.title} onChange={(e) => setProp((p: FaqAccordionProps) => { p.title = e.target.value })} /></div>
      <div className="flex items-center gap-2"><input type="checkbox" checked={props.onlyOneOpen} onChange={(e) => setProp((p: FaqAccordionProps) => { p.onlyOneOpen = e.target.checked })} /><label className="text-xs font-medium text-gray-500">Abrir apenas uma por vez</label></div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-2">Perguntas</label>
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="border border-gray-200 rounded-lg p-2 space-y-1">
              <div className="flex justify-between"><span className="text-xs text-gray-400">#{idx + 1}</span><button onClick={() => setProp((p: FaqAccordionProps) => { p.items = (p.items ?? DEFAULT_ITEMS).filter((_, i) => i !== idx) })} className="text-xs text-red-400">Remover</button></div>
              <input className="w-full border border-gray-200 rounded p-1 text-sm" placeholder="Pergunta" value={item.question} onChange={(e) => updateItem(idx, 'question', e.target.value)} />
              <textarea className="w-full border border-gray-200 rounded p-1 text-sm resize-none" rows={2} placeholder="Resposta" value={item.answer} onChange={(e) => updateItem(idx, 'answer', e.target.value)} />
            </div>
          ))}
        </div>
        <button onClick={() => setProp((p: FaqAccordionProps) => { p.items = [...(p.items ?? DEFAULT_ITEMS), { question: 'Nova pergunta', answer: 'Resposta aqui...' }] })} className="mt-2 w-full text-xs border border-dashed border-gray-300 rounded-lg py-2 text-gray-500">+ Adicionar pergunta</button>
      </div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: FaqAccordionProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

FaqAccordion.craft = {
  displayName: 'FAQ',
  props: { title: 'Perguntas Frequentes', items: DEFAULT_ITEMS, onlyOneOpen: true, bgColor: '#ffffff', textColor: '#111827', paddingY: 48 },
  related: { toolbar: FaqAccordionSettings },
}