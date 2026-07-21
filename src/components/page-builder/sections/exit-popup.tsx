'use client'

import { useNode, useEditor } from '@craftjs/core'
import React, { useEffect, useRef, useState } from 'react'
import { ImageInput } from '../image-input'

// ─── Pop-up de conversão ──────────────────────────────────────────────────────
// Dispara quando a pessoa vai SAIR da página (exit-intent), após X segundos
// ou ao rolar 50%. No editor aparece como um card discreto; na página publicada
// vira um overlay em tela cheia.

interface ExitPopupProps {
  trigger?: 'exit' | 'delay' | 'scroll'
  delaySeconds?: number
  showOncePerVisitor?: boolean
  title?: string
  text?: string
  imageUrl?: string
  ctaText?: string
  ctaLink?: string
  ctaColor?: string
  dismissText?: string
}

export const ExitPopup = ({
  trigger = 'exit',
  delaySeconds = 15,
  showOncePerVisitor = true,
  title = 'Espera! Não vá embora ainda 👋',
  text = 'Antes de sair, aproveita esta condição especial que preparei pra você.',
  imageUrl = '',
  ctaText = 'QUERO APROVEITAR →',
  ctaLink = '#',
  ctaColor = '#DC2626',
  dismissText = 'Não, obrigado',
}: ExitPopupProps) => {
  const { connectors: { connect, drag } } = useNode()
  const { enabled } = useEditor((state) => ({ enabled: state.options.enabled }))
  const [open, setOpen] = useState(false)
  const fired = useRef(false)

  useEffect(() => {
    if (enabled) return
    const storageKey = `exit_popup_${window.location.pathname}`
    if (showOncePerVisitor && localStorage.getItem(storageKey)) return

    const show = () => {
      if (fired.current) return
      fired.current = true
      setOpen(true)
      if (showOncePerVisitor) { try { localStorage.setItem(storageKey, '1') } catch {} }
    }

    if (trigger === 'delay') {
      const t = setTimeout(show, Math.max(1, delaySeconds) * 1000)
      return () => clearTimeout(t)
    }
    if (trigger === 'scroll') {
      const onScroll = () => {
        const pct = (window.scrollY + window.innerHeight) / document.body.scrollHeight
        if (pct > 0.5) show()
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      return () => window.removeEventListener('scroll', onScroll)
    }
    // exit-intent: mouse sobe rápido em direção à barra do navegador (desktop);
    // no mobile (sem mouse) usa fallback de tempo (25s)
    const onLeave = (e: MouseEvent) => { if (e.clientY <= 0) show() }
    document.addEventListener('mouseleave', onLeave)
    const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
    const fallback = isTouch ? setTimeout(show, 25000) : null
    return () => {
      document.removeEventListener('mouseleave', onLeave)
      if (fallback) clearTimeout(fallback)
    }
  }, [enabled, trigger, delaySeconds, showOncePerVisitor])

  // No EDITOR: card discreto indicando que existe um pop-up configurado
  if (enabled) {
    return (
      <div ref={(ref) => { connect(drag(ref!)) }}
        className="mx-6 my-3 border-2 border-dashed border-rose-300 bg-rose-50 rounded-2xl p-4 flex items-center gap-3 cursor-pointer">
        <span className="text-2xl">🚪</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-rose-700">Pop-up de saída — “{title.slice(0, 40)}{title.length > 40 ? '…' : ''}”</p>
          <p className="text-xs text-rose-500">
            {trigger === 'exit' ? 'Dispara quando a pessoa vai fechar a página' : trigger === 'delay' ? `Dispara após ${delaySeconds}s` : 'Dispara ao rolar 50% da página'} · não aparece na página, só como overlay
          </p>
        </div>
      </div>
    )
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setOpen(false)}>
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden" style={{ animation: 'popIn 250ms ease' }} onClick={e => e.stopPropagation()}>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="w-full h-44 object-cover" />
        )}
        <div className="p-7 text-center">
          <h3 className="text-2xl font-bold text-gray-900 mb-3 leading-tight">{title}</h3>
          <p className="text-gray-600 mb-6">{text}</p>
          <a href={ctaLink} style={{ backgroundColor: ctaColor }}
            className="block w-full py-4 text-white font-bold rounded-xl text-lg shadow-lg hover:opacity-90 transition-opacity">
            {ctaText}
          </a>
          <button onClick={() => setOpen(false)} className="mt-3 text-sm text-gray-400 hover:text-gray-600 underline">
            {dismissText}
          </button>
        </div>
      </div>
      <style>{`@keyframes popIn { from { transform: scale(0.9); opacity: 0 } to { transform: scale(1); opacity: 1 } }`}</style>
    </div>
  )
}

export const ExitPopupSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as ExitPopupProps }))
  const field = 'w-full border border-gray-200 rounded-lg p-2 text-sm'
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Quando disparar?</label>
        <select className={field} value={props.trigger ?? 'exit'} onChange={(e) => setProp((p: ExitPopupProps) => { p.trigger = e.target.value as ExitPopupProps['trigger'] })}>
          <option value="exit">🚪 Ao tentar sair da página</option>
          <option value="delay">⏱ Após X segundos</option>
          <option value="scroll">📜 Ao rolar 50% da página</option>
        </select>
        {props.trigger === 'exit' && <p className="text-[11px] text-gray-400 mt-1">No celular (sem mouse) dispara após 25s como alternativa.</p>}
      </div>
      {props.trigger === 'delay' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Segundos até disparar</label>
          <input type="number" min={1} className={field} value={props.delaySeconds ?? 15} onChange={(e) => setProp((p: ExitPopupProps) => { p.delaySeconds = Number(e.target.value) })} />
        </div>
      )}
      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
        <input type="checkbox" checked={props.showOncePerVisitor ?? true} onChange={(e) => setProp((p: ExitPopupProps) => { p.showOncePerVisitor = e.target.checked })} className="accent-indigo-600" />
        Mostrar só 1 vez por visitante
      </label>
      <div className="border-t pt-3">
        <label className="block text-xs font-medium text-gray-500 mb-1">Título</label>
        <input className={field} value={props.title} onChange={(e) => setProp((p: ExitPopupProps) => { p.title = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto</label>
        <textarea className={field + ' resize-none'} rows={3} value={props.text} onChange={(e) => setProp((p: ExitPopupProps) => { p.text = e.target.value })} />
      </div>
      <ImageInput label="Imagem (opcional, topo do pop-up)" value={props.imageUrl} onChange={(url) => setProp((p: ExitPopupProps) => { p.imageUrl = url })} />
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto do botão</label>
        <input className={field} value={props.ctaText} onChange={(e) => setProp((p: ExitPopupProps) => { p.ctaText = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Link do botão</label>
        <input className={field} placeholder="https://… ou #form" value={props.ctaLink} onChange={(e) => setProp((p: ExitPopupProps) => { p.ctaLink = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do botão</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.ctaColor} onChange={(e) => setProp((p: ExitPopupProps) => { p.ctaColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Texto do “dispensar”</label>
        <input className={field} value={props.dismissText} onChange={(e) => setProp((p: ExitPopupProps) => { p.dismissText = e.target.value })} />
      </div>
    </div>
  )
}

ExitPopup.craft = {
  displayName: 'Pop-up de Saída',
  props: {
    trigger: 'exit', delaySeconds: 15, showOncePerVisitor: true,
    title: 'Espera! Não vá embora ainda 👋',
    text: 'Antes de sair, aproveita esta condição especial que preparei pra você.',
    imageUrl: '', ctaText: 'QUERO APROVEITAR →', ctaLink: '#', ctaColor: '#DC2626',
    dismissText: 'Não, obrigado',
  },
  related: { toolbar: ExitPopupSettings },
}
