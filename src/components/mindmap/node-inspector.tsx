'use client'

import React, { useState } from 'react'
import { uploadQuizImage } from '@/app/actions/upload'
import { BRANCH_COLORS, MIND_SHAPES, type MindNode, type MindShape } from '@/lib/mindmap/types'

const EMOJIS = ['💡', '🎯', '🚀', '📌', '⭐', '🔥', '✅', '⚠️', '💰', '📈', '🧠', '❤️', '🔑', '📝', '⏰', '🎁']
const TEXT_COLORS = ['#111827', '#ffffff', '#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#3b82f6']

/** Miniatura do estilo pra escolher visualmente */
function ShapePreview({ shape, active }: { shape: MindShape; active: boolean }) {
  const base = 'w-full h-7 flex items-center justify-center text-[10px] font-semibold'
  const c = { solid: '#6366f1', soft: '#eef2ff', border: '#c7d2fe', text: '#3730a3' }
  const map: Record<MindShape, React.CSSProperties> = {
    solid:     { background: c.solid, color: '#fff', borderRadius: 10 },
    outline:   { background: '#fff', color: c.text, border: `2px solid ${c.solid}`, borderRadius: 10 },
    pill:      { background: c.solid, color: '#fff', borderRadius: 999 },
    sharp:     { background: c.solid, color: '#fff', borderRadius: 2 },
    underline: { background: 'transparent', color: c.text, borderBottom: `3px solid ${c.solid}` },
    plain:     { background: 'transparent', color: c.text },
  }
  return (
    <div className={`p-1 rounded-lg border-2 transition-colors ${active ? 'border-indigo-500 bg-indigo-50/50' : 'border-transparent hover:border-gray-200'}`}>
      <div className={base} style={map[shape]}>Abc</div>
    </div>
  )
}

export function NodeInspector({
  node, childCount, onChange, onDelete, onAddChild, onAddSibling, onClose,
}: {
  node: MindNode
  childCount: number
  onChange: (patch: Partial<MindNode>) => void
  onDelete: () => void
  onAddChild: () => void
  onAddSibling: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'content' | 'style'>('content')
  const [uploading, setUploading] = useState(false)
  const [upErr, setUpErr] = useState<string | null>(null)

  const label = 'block text-xs font-semibold text-gray-500 mb-1.5'
  const input = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-200'

  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setUploading(true); setUpErr(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await uploadQuizImage(fd)
      if (r.error) setUpErr(r.error)
      else if (r.url) onChange({ imageUrl: r.url })
    } catch { setUpErr('Falha ao enviar (até 5MB)') }
    finally { setUploading(false) }
  }

  const fmtBtn = (on: boolean) =>
    `w-8 h-8 rounded-lg border text-sm flex items-center justify-center transition-colors ${on ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`

  return (
    <aside className="w-72 shrink-0 bg-white border-l border-gray-200 overflow-y-auto p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 text-sm">Item selecionado</h3>
        <button onClick={onClose} aria-label="Fechar painel" className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>

      <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs font-medium">
        {(['content', 'style'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1.5 transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            {t === 'content' ? '✍️ Conteúdo' : '🎨 Estilo'}
          </button>
        ))}
      </div>

      {tab === 'content' && (
        <>
          <div>
            <label className={label} htmlFor="mm-label">Texto</label>
            <textarea id="mm-label" className={input + ' h-20 resize-none'} value={node.label}
              onChange={e => onChange({ label: e.target.value })} placeholder="Escreva a ideia…" />
          </div>

          <div>
            <span className={label}>Formatação</span>
            <div className="flex gap-1.5 items-center">
              <button onClick={() => onChange({ bold: !node.bold })} className={fmtBtn(!!node.bold)} title="Negrito" aria-label="Negrito"><b>B</b></button>
              <button onClick={() => onChange({ italic: !node.italic })} className={fmtBtn(!!node.italic)} title="Itálico" aria-label="Itálico"><i>I</i></button>
              <button onClick={() => onChange({ underline: !node.underline })} className={fmtBtn(!!node.underline)} title="Sublinhado" aria-label="Sublinhado"><u>U</u></button>
              <select value={node.fontSize ?? 'md'} onChange={e => onChange({ fontSize: e.target.value as 'sm' | 'md' | 'lg' })}
                aria-label="Tamanho do texto"
                className="flex-1 h-8 text-xs border border-gray-200 rounded-lg px-1.5 bg-white">
                <option value="sm">Pequeno</option>
                <option value="md">Normal</option>
                <option value="lg">Grande</option>
              </select>
            </div>
            <div className="flex gap-1.5 mt-2 items-center flex-wrap">
              <span className="text-[10px] text-gray-400">Cor do texto</span>
              <button onClick={() => onChange({ textColor: undefined })}
                aria-label="Cor automática"
                className={`w-6 h-6 rounded-full border-2 bg-white text-gray-400 text-[9px] flex items-center justify-center ${!node.textColor ? 'border-gray-800' : 'border-gray-200'}`}>⊘</button>
              {TEXT_COLORS.map(c => (
                <button key={c} onClick={() => onChange({ textColor: c })}
                  aria-label={`Cor do texto ${c}`}
                  className={`w-6 h-6 rounded-full border-2 ${node.textColor === c ? 'border-gray-800' : 'border-gray-200'}`}
                  style={{ background: c }} />
              ))}
            </div>
          </div>

          <div>
            <label className={label} htmlFor="mm-note">Nota (opcional)</label>
            <textarea id="mm-note" className={input + ' h-14 resize-none'} value={node.note ?? ''}
              onChange={e => onChange({ note: e.target.value || undefined })} placeholder="Detalhe curto…" />
          </div>

          <div>
            <label className={label} htmlFor="mm-link">🔗 Link (opcional)</label>
            <input id="mm-link" className={input} value={node.linkUrl ?? ''} placeholder="https://…"
              onChange={e => onChange({ linkUrl: e.target.value || undefined })} />
          </div>

          <div>
            <span className={label}>🖼 Imagem</span>
            {node.imageUrl ? (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-2 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={node.imageUrl} alt="" className="w-12 h-12 rounded object-cover" />
                <span className="text-xs text-gray-500 flex-1 truncate">imagem anexada</span>
                <button onClick={() => onChange({ imageUrl: undefined })} className="text-xs text-red-500 hover:underline">remover</button>
              </div>
            ) : (
              <label className={`flex items-center justify-center gap-1.5 border-2 border-dashed border-gray-200 rounded-lg py-2.5 text-xs text-gray-500 cursor-pointer hover:border-indigo-300 ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
                {uploading ? 'Enviando…' : '📷 Anexar imagem'}
                <input type="file" accept="image/*" className="hidden" onChange={pickImage} />
              </label>
            )}
            {upErr && <p className="text-xs text-red-500 mt-1">{upErr}</p>}
          </div>

          <div>
            <span className={label}>Ícone</span>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => onChange({ icon: undefined })} aria-label="Sem ícone"
                className={`w-7 h-7 rounded-lg border text-gray-400 text-[10px] ${!node.icon ? 'border-gray-800' : 'border-gray-200'}`}>⊘</button>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => onChange({ icon: e })} aria-label={`Ícone ${e}`}
                  className={`w-7 h-7 rounded-lg border text-base leading-none transition-transform hover:scale-110 ${node.icon === e ? 'border-gray-800 bg-gray-50' : 'border-gray-200'}`}>{e}</button>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'style' && (
        <>
          <div>
            <span className={label}>Formato da caixa</span>
            <div className="grid grid-cols-3 gap-1.5">
              {MIND_SHAPES.map(s => (
                <button key={s.key} onClick={() => onChange({ shape: s.key })} title={s.label} aria-label={`Formato ${s.label}`}>
                  <ShapePreview shape={s.key} active={(node.shape ?? 'solid') === s.key} />
                  <span className="text-[9px] text-gray-500 block text-center mt-0.5">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={label}>Cor do ramo</span>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onChange({ color: undefined })}
                title="Herdar do ramo" aria-label="Herdar cor do ramo"
                className={`w-7 h-7 rounded-full border-2 bg-white text-gray-400 text-[10px] flex items-center justify-center ${!node.color ? 'border-gray-800' : 'border-gray-200'}`}>⊘</button>
              {BRANCH_COLORS.map(c => (
                <button key={c.key} onClick={() => onChange({ color: c.key })}
                  title={c.label} aria-label={`Cor ${c.label}`}
                  className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${node.color === c.key ? 'border-gray-800' : 'border-transparent'}`}
                  style={{ background: c.solid }} />
              ))}
            </div>
          </div>
        </>
      )}

      <div className="border-t border-gray-100 pt-3 flex flex-col gap-2 mt-auto">
        {node.parentId && (
          <button onClick={() => onChange({ hidden: !node.hidden })}
            className="w-full py-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
            {node.hidden ? '👁 Mostrar este item' : '🙈 Ocultar só este item'}
          </button>
        )}
        <button onClick={onAddChild}
          className="w-full py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">
          + Item filho <span className="text-[10px] opacity-60">(Tab)</span>
        </button>
        {node.parentId && (
          <button onClick={onAddSibling}
            className="w-full py-2 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
            + Item irmão <span className="text-[10px] opacity-60">(Enter)</span>
          </button>
        )}
        {node.parentId && (
          <button onClick={onDelete}
            className="w-full py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors">
            Excluir{childCount > 0 ? ` (e ${childCount} abaixo)` : ''}
          </button>
        )}
      </div>
    </aside>
  )
}
