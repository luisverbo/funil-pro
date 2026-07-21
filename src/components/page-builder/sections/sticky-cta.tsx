'use client'

import { useNode, useEditor } from '@craftjs/core'
import React, { useEffect, useState } from 'react'

// ─── Barra fixa de CTA ────────────────────────────────────────────────────────
// Barra que gruda no rodapé (ou topo) da tela e segue a rolagem — o botão de
// compra/inscrição fica sempre visível. No editor aparece como card.

interface StickyCtaProps {
  text?: string
  ctaText?: string
  ctaLink?: string
  bgColor?: string
  textColor?: string
  btnColor?: string
  position?: 'bottom' | 'top'
  showAfterSeconds?: number
  dismissible?: boolean
}

export const StickyCta = ({
  text = '🔥 Oferta especial por tempo limitado',
  ctaText = 'GARANTIR AGORA →',
  ctaLink = '#',
  bgColor = '#111827',
  textColor = '#ffffff',
  btnColor = '#DC2626',
  position = 'bottom',
  showAfterSeconds = 3,
  dismissible = true,
}: StickyCtaProps) => {
  const { connectors: { connect, drag } } = useNode()
  const { enabled } = useEditor((state) => ({ enabled: state.options.enabled }))
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (enabled) return
    const t = setTimeout(() => setVisible(true), Math.max(0, showAfterSeconds) * 1000)
    return () => clearTimeout(t)
  }, [enabled, showAfterSeconds])

  // No EDITOR: card discreto
  if (enabled) {
    return (
      <div ref={(ref) => { connect(drag(ref!)) }}
        className="mx-6 my-3 border-2 border-dashed border-indigo-300 bg-indigo-50 rounded-2xl p-4 flex items-center gap-3 cursor-pointer">
        <span className="text-2xl">📌</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-indigo-700">Barra fixa de CTA — “{ctaText}”</p>
          <p className="text-xs text-indigo-500">Gruda no {position === 'bottom' ? 'rodapé' : 'topo'} da tela após {showAfterSeconds}s · não ocupa lugar na página</p>
        </div>
      </div>
    )
  }

  if (!visible || dismissed) return null
  return (
    <div className={`fixed inset-x-0 z-[9997] ${position === 'bottom' ? 'bottom-0' : 'top-0'} shadow-2xl`}
      style={{ backgroundColor: bgColor, animation: `slideIn${position === 'bottom' ? 'Up' : 'Down'} 300ms ease` }}>
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
        <p className="flex-1 text-sm md:text-base font-medium leading-snug" style={{ color: textColor }}>{text}</p>
        <a href={ctaLink} style={{ backgroundColor: btnColor }}
          className="shrink-0 px-4 md:px-6 py-2.5 text-white font-bold rounded-xl text-sm md:text-base hover:opacity-90 transition-opacity whitespace-nowrap">
          {ctaText}
        </a>
        {dismissible && (
          <button onClick={() => setDismissed(true)} className="shrink-0 opacity-50 hover:opacity-100 text-lg leading-none" style={{ color: textColor }}>×</button>
        )}
      </div>
      <style>{`
        @keyframes slideInUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes slideInDown { from { transform: translateY(-100%) } to { transform: translateY(0) } }
      `}</style>
    </div>
  )
}

export const StickyCtaSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as StickyCtaProps }))
  const field = 'w-full border border-gray-200 rounded-lg p-2 text-sm'
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto da barra</label>
        <input className={field} value={props.text} onChange={(e) => setProp((p: StickyCtaProps) => { p.text = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto do botão</label>
        <input className={field} value={props.ctaText} onChange={(e) => setProp((p: StickyCtaProps) => { p.ctaText = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Link do botão</label>
        <input className={field} placeholder="https://… ou #form" value={props.ctaLink} onChange={(e) => setProp((p: StickyCtaProps) => { p.ctaLink = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Posição</label>
        <select className={field} value={props.position ?? 'bottom'} onChange={(e) => setProp((p: StickyCtaProps) => { p.position = e.target.value as 'bottom' | 'top' })}>
          <option value="bottom">Rodapé (recomendado)</option>
          <option value="top">Topo</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Aparecer após (segundos)</label>
        <input type="number" min={0} className={field} value={props.showAfterSeconds ?? 3} onChange={(e) => setProp((p: StickyCtaProps) => { p.showAfterSeconds = Number(e.target.value) })} />
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" checked={props.dismissible ?? true} onChange={(e) => setProp((p: StickyCtaProps) => { p.dismissible = e.target.checked })} className="accent-indigo-600" />
        Permitir fechar (×)
      </label>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: StickyCtaProps) => { p.bgColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do texto</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.textColor} onChange={(e) => setProp((p: StickyCtaProps) => { p.textColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do botão</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.btnColor} onChange={(e) => setProp((p: StickyCtaProps) => { p.btnColor = e.target.value })} />
      </div>
    </div>
  )
}

StickyCta.craft = {
  displayName: 'Barra Fixa de CTA',
  props: {
    text: '🔥 Oferta especial por tempo limitado', ctaText: 'GARANTIR AGORA →', ctaLink: '#',
    bgColor: '#111827', textColor: '#ffffff', btnColor: '#DC2626',
    position: 'bottom', showAfterSeconds: 3, dismissible: true,
  },
  related: { toolbar: StickyCtaSettings },
}
