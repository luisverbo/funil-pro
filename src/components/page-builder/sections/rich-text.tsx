'use client'

import { useNode, useEditor } from '@craftjs/core'
import React, { useRef } from 'react'

interface RichTextProps { content?: string; bgColor?: string; paddingY?: number; paddingX?: number }

export const RichText = ({
  content = '<p>Clique aqui para editar o texto. Você pode usar <strong>negrito</strong>, <em>itálico</em> e mais.</p>',
  bgColor = '#ffffff',
  paddingY = 32,
  paddingX = 48,
}: RichTextProps) => {
  const { connectors: { connect, drag }, actions: { setProp } } = useNode()
  const { enabled } = useEditor((state) => ({ enabled: state.options.enabled }))
  const divRef = useRef<HTMLDivElement>(null)

  if (enabled) {
    return (
      <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY, paddingLeft: paddingX, paddingRight: paddingX }} className="w-full">
        <div className="max-w-3xl mx-auto">
          <div ref={divRef} contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: content }}
            onBlur={() => { if (divRef.current) setProp((p: RichTextProps) => { p.content = divRef.current!.innerHTML }) }}
            style={{ outline: 'none', minHeight: '60px', lineHeight: '1.75', fontSize: '16px', color: '#374151' }}
            className="focus:ring-2 focus:ring-indigo-300 focus:ring-offset-2 rounded"
          />
          <p className="text-xs text-gray-400 mt-2 italic">Clique no texto acima para editar. Use Ctrl+B para negrito, Ctrl+I para itálico.</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={(ref) => { connect(drag(ref!)) }} style={{ backgroundColor: bgColor, paddingTop: paddingY, paddingBottom: paddingY, paddingLeft: paddingX, paddingRight: paddingX }} className="w-full">
      <div className="max-w-3xl mx-auto" style={{ lineHeight: '1.75', fontSize: '16px', color: '#374151' }} dangerouslySetInnerHTML={{ __html: content }} />
    </div>
  )
}

export const RichTextSettings = () => {
  const { actions: { setProp }, props } = useNode((n) => ({ props: n.data.props as RichTextProps }))
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 italic">Clique diretamente no texto no canvas para editar.</p>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Cor de fundo</label><input type="color" className="w-full h-9 border border-gray-200 rounded-lg cursor-pointer" value={props.bgColor} onChange={(e) => setProp((p: RichTextProps) => { p.bgColor = e.target.value })} /></div>
      <div><label className="block text-xs font-medium text-gray-500 mb-1">Espaçamento vertical (px)</label><input type="number" className="w-full border border-gray-200 rounded-lg p-2 text-sm" value={props.paddingY} onChange={(e) => setProp((p: RichTextProps) => { p.paddingY = Number(e.target.value) })} /></div>
    </div>
  )
}

RichText.craft = {
  displayName: 'Texto Rico',
  props: { content: '<p>Clique aqui para editar o texto.</p>', bgColor: '#ffffff', paddingY: 32, paddingX: 48 },
  related: { toolbar: RichTextSettings },
}