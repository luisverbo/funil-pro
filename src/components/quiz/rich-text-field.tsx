'use client'

import React, { useRef, useEffect, useCallback } from 'react'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

const FONT_SIZES = [
  { label: 'Pequeno', size: '2' },
  { label: 'Normal', size: '3' },
  { label: 'Médio', size: '5' },
  { label: 'Grande', size: '6' },
]

const COLORS = ['#111827', '#6b7280', '#ffffff', '#ef4444', '#f97316', '#f59e0b', '#eab308', '#22c55e', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e']
const HIGHLIGHTS = ['#fef08a', '#fde68a', '#bbf7d0', '#a7f3d0', '#bfdbfe', '#bae6fd', '#fbcfe8', '#fecaca', '#fed7aa', '#e9d5ff', '#c7d2fe', '#d9f99d']

export default function RichTextField({ value, onChange, placeholder }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || ''
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = useCallback(() => {
    if (ref.current) onChange(ref.current.innerHTML)
  }, [onChange])

  function exec(cmd: string, arg?: string) {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
  }

  // marca-texto na seleção (precisa de styleWithCSS pra usar hiliteColor)
  function highlight(color: string) {
    ref.current?.focus()
    try { document.execCommand('styleWithCSS', false, 'true') } catch {}
    document.execCommand('hiliteColor', false, color) || document.execCommand('backColor', false, color)
    emit()
  }

  // O seletor de cor nativo rouba o foco e apaga a seleção — salvamos e restauramos
  const savedRange = useRef<Range | null>(null)
  const saveSel = () => {
    const s = window.getSelection()
    if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) savedRange.current = s.getRangeAt(0).cloneRange()
  }
  const applyCustom = (kind: 'text' | 'mark', color: string) => {
    const r = savedRange.current
    ref.current?.focus()
    if (r) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r) }
    if (kind === 'text') exec('foreColor', color)
    else highlight(color)
  }

  // onMouseDown+preventDefault mantém a seleção do texto ao clicar num botão
  const Btn = ({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title: string }) => (
    <button type="button" title={title}
      onMouseDown={e => { e.preventDefault(); onClick() }}
      className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-700 text-sm flex-shrink-0">
      {children}
    </button>
  )

  return (
    <div>
      {/* Barra fixa acima do campo — sempre visível, nunca cobre o conteúdo */}
      <div className="flex flex-wrap items-center gap-0.5 border border-gray-200 rounded-t-lg bg-gray-50 px-1.5 py-1">
        <Btn title="Negrito" onClick={() => exec('bold')}><b>B</b></Btn>
        <Btn title="Itálico" onClick={() => exec('italic')}><i>I</i></Btn>
        <Btn title="Sublinhado" onClick={() => exec('underline')}><u>U</u></Btn>
        <Btn title="Tachado" onClick={() => exec('strikeThrough')}><s>S</s></Btn>
        <div className="w-px h-5 bg-gray-200 mx-0.5 self-center" />
        <Btn title="Alinhar à esquerda" onClick={() => exec('justifyLeft')}>⬅</Btn>
        <Btn title="Centralizar" onClick={() => exec('justifyCenter')}>↔</Btn>
        <Btn title="Alinhar à direita" onClick={() => exec('justifyRight')}>➡</Btn>
        <div className="w-px h-5 bg-gray-200 mx-0.5 self-center" />
        <Btn title="Lista" onClick={() => exec('insertUnorderedList')}>•</Btn>
        <Btn title="Link" onClick={() => {
          const url = prompt('URL do link:')?.trim()
          // só http(s) — bloqueia javascript:/data: (XSS armazenado na página publicada)
          if (url && /^https?:\/\//i.test(url)) exec('createLink', url)
          else if (url) alert('Use um link começando com http:// ou https://')
        }}>🔗</Btn>
        <select
          title="Tamanho"
          onMouseDown={e => e.stopPropagation()}
          onChange={e => { exec('fontSize', e.target.value); e.target.selectedIndex = 0 }}
          className="text-xs border border-gray-200 rounded px-1 h-7 bg-white flex-shrink-0"
          defaultValue=""
        >
          <option value="" disabled>Aa</option>
          {FONT_SIZES.map(f => <option key={f.size} value={f.size}>{f.label}</option>)}
        </select>
        <div className="flex items-center gap-0.5 flex-wrap ml-0.5">
          <span className="text-[11px] text-gray-400 flex-shrink-0" title="Cor do texto">A</span>
          {COLORS.map(c => (
            <button key={c} type="button" title={`Cor do texto ${c}`}
              onMouseDown={e => { e.preventDefault(); exec('foreColor', c) }}
              style={{ background: c }}
              className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0" />
          ))}
          {/* cor livre do texto */}
          <label className="w-4 h-4 rounded-full flex-shrink-0 cursor-pointer relative overflow-hidden border border-gray-300"
            style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }} title="Qualquer cor do texto">
            <input type="color" onMouseDown={saveSel} onChange={e => applyCustom('text', e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer" />
          </label>
        </div>
        <div className="w-px h-5 bg-gray-200 mx-0.5 self-center" />
        <span className="text-[11px] text-gray-400 flex-shrink-0" title="Marca-texto">🖍️</span>
        <div className="flex items-center gap-0.5 flex-wrap">
          {HIGHLIGHTS.map(c => (
            <button key={c} type="button" title="Marca-texto"
              onMouseDown={e => { e.preventDefault(); highlight(c) }}
              style={{ background: c }}
              className="w-4 h-4 rounded border border-gray-300 flex-shrink-0" />
          ))}
          {/* cor livre do marca-texto */}
          <label className="w-4 h-4 rounded flex-shrink-0 cursor-pointer relative overflow-hidden border border-gray-300"
            style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }} title="Qualquer cor de marca-texto">
            <input type="color" onMouseDown={saveSel} onChange={e => applyCustom('mark', e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer" />
          </label>
          <button type="button" title="Remover marca-texto"
            onMouseDown={e => { e.preventDefault(); highlight('transparent') }}
            className="w-4 h-4 rounded border border-gray-300 bg-white text-gray-400 text-[10px] leading-none flex items-center justify-center flex-shrink-0">⊘</button>
        </div>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        data-placeholder={placeholder ?? 'Digite seu texto...'}
        className="min-h-[100px] w-full text-sm border border-t-0 border-gray-200 rounded-b-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white prose prose-sm max-w-none empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400"
      />
      <p className="text-[10px] text-gray-400 mt-1">Selecione o texto e use os botões acima para formatar.</p>
    </div>
  )
}
