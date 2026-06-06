'use client'

import { useNode, useEditor } from '@craftjs/core'
import React, { useState, useEffect, useRef } from 'react'

interface ThankYouHeroProps {
  headline?: string; subheadline?: string; nextStep?: string
  ctaText?: string; ctaLink?: string; showCta?: boolean
  showCountdown?: boolean; countdownSeconds?: number
  bgColor?: string; textColor?: string; accentColor?: string; paddingY?: number
}

export const ThankYouHero = ({
  headline = 'Parabéns, {primeiro_nome}! 🎉',
  subheadline = 'Sua inscrição foi confirmada com sucesso',
  nextStep = 'Verifique seu WhatsApp para os próximos passos',
  ctaText = 'Entrar no Grupo →', ctaLink = '', showCta = true,
  showCountdown = false, countdownSeconds = 5,
  bgColor = '#ffffff', textColor = '#111827', accentColor = '#16a34a', paddingY = 80,
}: ThankYouHeroProps) => {
  const { connectors: { connect, drag } } = useNode()
  const { enabled } = useEditor((state) => ({ enabled: state.options.enabled }))
  const [remaining, setRemaining] = useState(countdownSeconds)
  const [redirected, setRedirected] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (enabled || !showCountdown || !ctaLink || redirected) return
    setRemaining(countdownSeconds)
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) { if (intervalRef.current) clearInterval(intervalRef.current); setRedirected(true); window.location.href = ctaLink; return 0 }
        return prev - 1
      })
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [enabled, showCountdown, ctaLink, countdownSeconds, redirected])

  useEffect(() => { setRemaining(countdownSeconds) }, [countdownSeconds])

  return (
    <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY }} className="w-full px-6 text-center">
      <style>{`@keyframes checkPop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } 80% { transform: scale(0.95); } 100% { transform: scale(1); opacity: 1; } } .check-pop { animation: checkPop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards; }`}</style>
      <div className="max-w-2xl mx-auto">
        <div className="flex justify-center mb-6">
          <div className="check-pop w-20 h-20 rounded-full flex items-center justify-center shadow-lg" style={{ backgroundColor: accentColor }}>
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          </div>
        </div>
        <h1 className="text-3xl md:text-4xl font-extrabold mb-3 leading-tight" style={{ color: textColor }}>{headline}</h1>
        {subheadline && <p className="text-lg md:text-xl mb-6 opacity-70" style={{ color: textColor }}>{subheadline}</p>}
        {nextStep && (
          <div className="flex items-start gap-3 text-left rounded-xl px-5 py-4 mb-8 border" style={{ borderColor: accentColor, backgroundColor: `${accentColor}11` }}>
            <span className="text-xl mt-0.5">👉</span>
            <p className="text-base font-medium" style={{ color: textColor }}>{nextStep}</p>
          </div>
        )}
        {showCta && ctaText && <a href={ctaLink || '#'} style={{ backgroundColor: accentColor }} className="inline-block px-8 py-4 text-white font-bold rounded-xl text-lg shadow-lg hover:opacity-90 transition-opacity mb-4">{ctaText}</a>}
        {showCountdown && ctaLink && <p className="text-sm opacity-60 mt-2" style={{ color: textColor }}>{enabled ? `Redirecionando em ${countdownSeconds}s... (inativo no editor)` : redirected ? 'Redirecionando...' : `Redirecionando em ${remaining}s...`}</p>}
      </div>
    </div>
  )
}

export const ThankYouHeroSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as ThankYouHeroProps }))
  return (
    <div className="space-y-3">
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Headline</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.headline} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.headline = e.target.value })} /><p className="text-xs text-gray-400 mt-0.5">Use {'{primeiro_nome}'} para personalizar</p></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Subtítulo</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.subheadline} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.subheadline = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Próximo passo</label><textarea className="w-full border border-gray-200 rounded-lg p-2 text-sm resize-none" rows={2} value={props.nextStep} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.nextStep = e.target.value })} /></div>
      <div className="flex items-center gap-2"><input type="checkbox" checked={props.showCta} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.showCta = e.target.checked })} /><label className="text-xs font-medium text-gray-500">Exibir botão CTA</label></div>
      {props.showCta && <div><label className="block text-xs font-medium text-gray-500 mb-1">Texto do botão</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.ctaText} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.ctaText = e.target.value })} /></div>}
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Link de destino</label><input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.ctaLink} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.ctaLink = e.target.value })} /></div>
      <div className="flex items-center gap-2"><input type="checkbox" checked={props.showCountdown} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.showCountdown = e.target.checked })} /><label className="text-xs font-medium text-gray-500">Redirecionar automaticamente</label></div>
      {props.showCountdown && <div><label className="block text-xs font-medium text-gray-500 mb-1">Segundos antes do redirecionamento</label><input type="number" min={1} max={60} className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.countdownSeconds} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.countdownSeconds = Number(e.target.value) })} /></div>}
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de destaque</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.accentColor} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.accentColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: ThankYouHeroProps) => { p.bgColor = e.target.value })} /></div>
    </div>
  )
}

ThankYouHero.craft = {
  displayName: 'Hero de Obrigado',
  props: { headline: 'Parabéns, {primeiro_nome}! 🎉', subheadline: 'Sua inscrição foi confirmada com sucesso', nextStep: 'Verifique seu WhatsApp para os próximos passos', ctaText: 'Entrar no Grupo →', ctaLink: '', showCta: true, showCountdown: false, countdownSeconds: 5, bgColor: '#ffffff', textColor: '#111827', accentColor: '#16a34a', paddingY: 80 },
  related: { toolbar: ThankYouHeroSettings },
}