'use client'

import React, { useState, useRef, useEffect } from 'react'

// Seletor de emoji nativo (sem lib externa — CSP-safe). Botão 😊 abre um popover
// com categorias e busca. onPick recebe o emoji escolhido.

const CATEGORIES: { label: string; icon: string; emojis: string[] }[] = [
  { label: 'Populares', icon: '⭐', emojis: ['😀','😂','🥰','😍','😊','👍','🙏','🔥','🚀','✅','❤️','🎉','💰','👇','👉','✨','💪','🤝','😉','👏','🥳','💯','⚡','🎁','📈','🛒','📲','⏰','🤔','😱'] },
  { label: 'Rostos', icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😋','😛','😜','🤪','🤨','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','🤗','🤔','🤭','🤫','😴','🤤','😪'] },
  { label: 'Gestos', icon: '👍', emojis: ['👍','👎','👌','🤌','✌️','🤞','🤟','🤘','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤙','💪','🙏','🤝','👏','🙌','👐','🤲','✍️','💅','👀','🧠','❤️','🔥'] },
  { label: 'Negócios', icon: '💰', emojis: ['💰','💵','💸','🤑','💳','📈','📉','📊','🎯','🏆','🥇','🚀','⚡','💡','🔑','🔒','🔓','📌','📎','✅','❌','⭐','✨','🎁','🛒','🛍️','📲','📱','💻','⏰','⏳','📅','📣','📢','🔔','🔗'] },
  { label: 'Símbolos', icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','❣️','💕','💞','💯','✅','❌','⁉️','❓','❗','⚠️','🚫','✔️','➡️','⬅️','⬆️','⬇️','🔝','🆕','🆓','🔥','🎉','🎊','👑'] },
]

export default function EmojiPicker({ onPick, up = false, align = 'right' }: { onPick: (emoji: string) => void; up?: boolean; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const [cat, setCat] = useState(0)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const all = q.trim()
    ? Array.from(new Set(CATEGORIES.flatMap(c => c.emojis)))
    : CATEGORIES[cat].emojis

  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-lg leading-none"
        title="Inserir emoji" aria-label="Inserir emoji">😊</button>
      {open && (
        <div className={`absolute z-[60] w-64 bg-white rounded-xl shadow-2xl border border-gray-100 p-2 ${up ? 'bottom-full mb-1' : 'mt-1'} ${align === 'left' ? 'left-0' : 'right-0'}`}>
          <div className="flex gap-1 mb-2">
            {CATEGORIES.map((c, i) => (
              <button key={c.label} type="button" onClick={() => { setCat(i); setQ('') }}
                className={`flex-1 py-1 rounded-lg text-base ${cat === i && !q ? 'bg-indigo-100' : 'hover:bg-gray-100'}`}
                title={c.label}>{c.icon}</button>
            ))}
          </div>
          <div className="grid grid-cols-8 gap-0.5 max-h-44 overflow-y-auto">
            {all.map((e, i) => (
              <button key={`${e}-${i}`} type="button"
                onClick={() => { onPick(e) }}
                className="w-7 h-7 rounded-md hover:bg-gray-100 text-lg leading-none flex items-center justify-center">
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
