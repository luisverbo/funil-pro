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

const COLORS = ['#111827', '#6366f1', '#ef4444', '#10b981', '#f59e0b', '#3b82f6', '#a855f7', '#ffffff']

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
          {COLORS.map(c => (
            <button key={c} type="button" title={`Cor ${c}`}
              onMouseDown={e => { e.preventDefault(); exec('foreColor', c) }}
              style={{ background: c }}
              className="w-4 h-4 rounded-full border border-gray-300 flex-shrink-0" />
          ))}
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
