'use client'

import { useNode, useEditor } from '@craftjs/core'
import React, { useState, useEffect, useRef } from 'react'

interface CountdownTimerProps {
  mode?: 'duration' | 'datetime'
  durationMinutes?: number
  targetDate?: string
  title?: string
  subtitle?: string
  onZeroAction?: 'hide' | 'message'
  onZeroMessage?: string
  bgColor?: string
  textColor?: string
  boxBg?: string
  paddingY?: number
}

interface TimeLeft {
  days: number
  hours: number
  minutes: number
  seconds: number
}

function calcTimeLeft(endTs: number): TimeLeft {
  const diff = Math.max(0, endTs - Date.now())
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor((diff % 86400000) / 3600000),
    minutes: Math.floor((diff % 3600000) / 60000),
    seconds: Math.floor((diff % 60000) / 1000),
  }
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export const CountdownTimer = ({
  mode = 'duration',
  durationMinutes = 15,
  targetDate = '',
  title = 'Oferta por tempo limitado!',
  subtitle = 'Garanta agora antes que acabe',
  onZeroAction = 'message',
  onZeroMessage = 'Esta oferta expirou.',
  bgColor = '#1e1b4b',
  textColor = '#ffffff',
  boxBg = '#312e81',
  paddingY = 48,
}: CountdownTimerProps) => {
  const { connectors: { connect, drag } } = useNode()
  const { enabled } = useEditor((state) => ({ enabled: state.options.enabled }))

  const [timeLeft, setTimeLeft] = useState<TimeLeft>({ days: 0, hours: 0, minutes: durationMinutes, seconds: 0 })
  const [done, setDone] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (enabled) return

    let endTs: number

    if (mode === 'datetime' && targetDate) {
      endTs = new Date(targetDate).getTime()
    } else {
      const storageKey = `countdown_end_${durationMinutes}`
      const stored = sessionStorage.getItem(storageKey)
      if (stored) {
        endTs = Number(stored)
      } else {
        endTs = Date.now() + durationMinutes * 60 * 1000
        sessionStorage.setItem(storageKey, String(endTs))
      }
    }

    const tick = () => {
      const tl = calcTimeLeft(endTs)
      setTimeLeft(tl)
      if (tl.days === 0 && tl.hours === 0 && tl.minutes === 0 && tl.seconds === 0) {
        setDone(true)
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }

    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [enabled, mode, durationMinutes, targetDate])

  const displayTime: TimeLeft = enabled
    ? { days: 0, hours: 0, minutes: durationMinutes, seconds: 0 }
    : timeLeft

  if (!enabled && done && onZeroAction === 'hide') return null

  return (
    <div
      ref={(ref) => { connect(drag(ref!)) }}
      style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY, color: textColor }}
      className="w-full px-6 text-center"
    >
      {!enabled && done && onZeroAction === 'message' ? (
        <p className="text-xl font-semibold" style={{ color: textColor }}>{onZeroMessage}</p>
      ) : (
        <div className="max-w-2xl mx-auto">
          {title && <h2 className="text-2xl md:text-3xl font-bold mb-2" style={{ color: textColor }}>{title}</h2>}
          {subtitle && <p className="mb-6 opacity-80" style={{ color: textColor }}>{subtitle}</p>}
          <div className="flex items-center justify-center gap-2 md:gap-4">
            {[
              { value: displayTime.days, label: 'Dias' },
              { value: displayTime.hours, label: 'Horas' },
              { value: displayTime.minutes, label: 'Min' },
              { value: displayTime.seconds, label: 'Seg' },
            ].map((unit, idx) => (
              <React.Fragment key={unit.label}>
                {idx > 0 && (
                  <span className="text-3xl md:text-5xl font-bold opacity-60 mb-5" style={{ color: textColor }}>:</span>
                )}
                <div
                  className="flex flex-col items-center rounded-xl px-4 py-3 md:px-6 md:py-4 min-w-[64px] md:min-w-[80px]"
                  style={{ backgroundColor: boxBg }}
                >
                  <span className="text-3xl md:text-5xl font-bold tabular-nums" style={{ color: textColor }}>
                    {pad(unit.value)}
                  </span>
                  <span className="text-xs mt-1 uppercase tracking-widest opacity-70" style={{ color: textColor }}>
                    {unit.label}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export const CountdownTimerSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as CountdownTimerProps }))
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Modo</label>
        <select
          className="w-full border border-gray-200 rounded-lg p-2 text-sm"
          value={props.mode}
          onChange={(e) => setProp((p: CountdownTimerProps) => { p.mode = e.target.value as 'duration' | 'datetime' })}
        >
          <option value="duration">Duração (minutos)</option>
          <option value="datetime">Data/hora específica</option>
        </select>
      </div>
      {props.mode === 'duration' ? (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Duração (minutos)</label>
          <input type="number" min={1} className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.durationMinutes} onChange={(e) => setProp((p: CountdownTimerProps) => { p.durationMinutes = Number(e.target.value) })} />
        </div>
      ) : (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Data e hora alvo</label>
          <input type="datetime-local" className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.targetDate} onChange={(e) => setProp((p: CountdownTimerProps) => { p.targetDate = e.target.value })} />
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Título</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.title} onChange={(e) => setProp((p: CountdownTimerProps) => { p.title = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Subtítulo</label>
        <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.subtitle} onChange={(e) => setProp((p: CountdownTimerProps) => { p.subtitle = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Ao zerar</label>
        <select className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.onZeroAction} onChange={(e) => setProp((p: CountdownTimerProps) => { p.onZeroAction = e.target.value as 'hide' | 'message' })}>
          <option value="hide">Ocultar seção</option>
          <option value="message">Mostrar mensagem</option>
        </select>
      </div>
      {props.onZeroAction === 'message' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mensagem ao zerar</label>
          <input className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.onZeroMessage} onChange={(e) => setProp((p: CountdownTimerProps) => { p.onZeroMessage = e.target.value })} />
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: CountdownTimerProps) => { p.bgColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor do texto</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.textColor} onChange={(e) => setProp((p: CountdownTimerProps) => { p.textColor = e.target.value })} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Cor das caixas</label>
        <input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.boxBg} onChange={(e) => setProp((p: CountdownTimerProps) => { p.boxBg = e.target.value })} />
      </div>
    </div>
  )
}

CountdownTimer.craft = {
  displayName: 'Contador Regressivo',
  props: { mode: 'duration', durationMinutes: 15, targetDate: '', title: 'Oferta por tempo limitado!', subtitle: 'Garanta agora antes que acabe', onZeroAction: 'message', onZeroMessage: 'Esta oferta expirou.', bgColor: '#1e1b4b', textColor: '#ffffff', boxBg: '#312e81', paddingY: 48 },
  related: { toolbar: CountdownTimerSettings },
}