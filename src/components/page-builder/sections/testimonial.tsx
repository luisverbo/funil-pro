'use client'

import { useNode } from '@craftjs/core'
import React from 'react'

interface TestimonialProps {
  quote?: string
  name?: string
  role?: string
  avatarInitials?: string
  avatarColor?: string
  bgColor?: string
  paddingY?: number
  stars?: number
}

export const Testimonial = ({
  quote = 'Este produto mudou completamente minha vida. Em apenas 30 dias consegui resultados que nunca imaginei serem possíveis. Recomendo de olhos fechados!',
  name = 'Maria Silva',
  role = 'Empreendedora Digital',
  avatarInitials = 'MS',
  avatarColor = '#6366F1',
  bgColor = '#ffffff',
  paddingY = 60,
  stars = 5,
}: TestimonialProps) => {
  const { connectors: { connect, drag } } = useNode()
  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }}
      className="w-full px-6"
    >
      <div className="max-w-2xl mx-auto">
        <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 shadow-sm">
          <div className="flex mb-4">
            {Array.from({ length: stars }).map((_, i) => (
              <svg key={i} viewBox="0 0 24 24" fill="#FBBF24" className="w-5 h-5">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            ))}
          </div>
          <blockquote className="text-gray-700 text-lg leading-relaxed mb-6 italic">"{quote}"</blockquote>
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: avatarColor }}
            >
              {avatarInitials}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{name}</p>
              {role && <p className="text-sm text-gray-500">{role}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export const TestimonialSettings = () => {
  const { actions: { setProp }, props } = useNode((node) => ({ props: node.data.props as TestimonialProps }))
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Depoimento</label>
        <textarea className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none" rows={4} value={props.quote} onChange={(e) => setProp((p: TestimonialProps) => { p.quote = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Nome</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.name} onChange={(e) => setProp((p: TestimonialProps) => { p.name = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cargo / Descrição</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.role} onChange={(e) => setProp((p: TestimonialProps) => { p.role = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Iniciais do avatar</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" maxLength={2} value={props.avatarInitials} onChange={(e) => setProp((p: TestimonialProps) => { p.avatarInitials = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do avatar</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.avatarColor} onChange={(e) => setProp((p: TestimonialProps) => { p.avatarColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Estrelas (1-5)</label>
        <input type="number" min={1} max={5} className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.stars} onChange={(e) => setProp((p: TestimonialProps) => { p.stars = Number(e.target.value) })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: TestimonialProps) => { p.bgColor = e.target.value })} />
      </div>
    </div>
  )
}

Testimonial.craft = {
  displayName: 'Depoimento',
  props: { quote: 'Este produto mudou completamente minha vida. Em apenas 30 dias consegui resultados que nunca imaginei serem possíveis.', name: 'Maria Silva', role: 'Empreendedora Digital', avatarInitials: 'MS', avatarColor: '#6366F1', bgColor: '#ffffff', paddingY: 60, stars: 5 },
  related: { toolbar: TestimonialSettings },
}
