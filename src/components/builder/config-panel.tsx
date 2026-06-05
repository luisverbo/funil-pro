'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useReactFlow, type Node } from '@xyflow/react'
import type { FunnelNodeData, WhatsappInstance } from '@/types'

const EMOJI_GROUPS = [
  { label: '😀 Rostos', emojis: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤧','🥵','🥶','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿'] },
  { label: '👍 Gestos', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🫀','🫁','🧠','🦷','🦴','👀','👁️','👅','👄'] },
  { label: '❤️ Corações', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','🕉️','🔯','🪬','✡️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫'] },
  { label: '🎉 Celebração', emojis: ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎟️','🎫','🎪','🤹','🎭','🎨','🎬','🎤','🎧','🎼','🎵','🎶','🎷','🎸','🎹','🎺','🎻','🪕','🥁','🪘','🎯','🎱','🎮','🕹️','🎲','♟️','🧩','🪅','🪆','🃏','🀄','🎴'] },
  { label: '💼 Negócios', emojis: ['💰','💵','💴','💶','💷','💸','💳','🪙','💹','📈','📉','📊','💼','🗂️','📁','📂','🗃️','🗄️','📋','📌','📍','📎','🖇️','📏','📐','✂️','🗑️','🔒','🔓','🔏','🔑','🗝️','🔨','🪓','⛏️','🔧','🔩','🪛','🔫','🪤','🧲','💡','🔦','🕯️','💡','🪔','🧯','🛢️','💊','🩺','📡','🔭','🔬','🧪','🧫','🧬'] },
  { label: '📱 Tecnologia', emojis: ['📱','💻','🖥️','🖨️','⌨️','🖱️','💾','💿','📀','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌚','📡','🔋','🪫','🔌','💡','🔦','🕯️','🧱','🪞','🪟','🛒','🛍️','🎒','🧳','👑','💎','💍','👓','🕶️','🥽','🦺','👔','👕','👖','🧣','🧤','🧥','👗','👘','🥻','🩱','🩲','🩳','👙','👚'] },
  { label: '🌟 Símbolos', emojis: ['⭐','🌟','✨','💫','⚡','🔥','💥','🌈','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄','🌬️','💨','💧','💦','🌊','🫧','🌀','🌁','🌫️','🌂','☂️','☔','⛱️','⚡','🌟','🌠','🌌','🪐','🌍','🌎','🌏','🗺️','🗾','🧭','🏔️','⛰️','🌋','🗻','🏕️','🏖️','🏜️','🏝️','🏞️','🏟️','🏛️','🏗️','🧱','🪨','🪵','🛖','🏘️','🏚️','🏠','🏡','🏢','🏣','🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰'] },
  { label: '✅ Úteis WA', emojis: ['✅','❎','☑️','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔶','🔷','🔸','🔹','🔺','🔻','💠','🔘','🔲','🔳','⬛','⬜','◼️','◻️','◾','◽','▪️','▫️','🔈','🔉','🔊','🔔','🔕','📢','📣','💬','💭','🗯️','📝','✏️','🖊️','📌','📍','🚨','⚠️','🆕','🆓','🆒','🆙','🆗','🆖','🅰️','🅱️','🆎','🆑','🅾️','🆘','🔜','🔛','🔝','🔙','🔚','🈴','🈵','🈸','🈺','🈷️'] },
]

function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const [activeGroup, setActiveGroup] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Inserir emoji"
        className="text-lg px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors leading-none"
      >
        😊
      </button>
      {open && (
        <div className="absolute bottom-full mb-1 left-0 z-50 w-72 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {/* Group tabs */}
          <div className="flex overflow-x-auto border-b border-gray-100 bg-gray-50">
            {EMOJI_GROUPS.map((g, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActiveGroup(i)}
                className={`shrink-0 px-2 py-1.5 text-base hover:bg-gray-100 transition-colors ${activeGroup === i ? 'bg-white border-b-2 border-indigo-500' : ''}`}
                title={g.label}
              >
                {g.emojis[0]}
              </button>
            ))}
          </div>
          {/* Emoji grid */}
          <div className="p-2 grid grid-cols-8 gap-0.5 max-h-48 overflow-y-auto">
            {EMOJI_GROUPS[activeGroup].emojis.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => { onSelect(emoji); setOpen(false) }}
                className="text-xl w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 transition-colors"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  selectedNodeId: string | null
  nodes: Node[]
  onClose: () => void
  funnelId: string
  onOpenCaptureEditor?: () => void
  waInstances?: WhatsappInstance[]
  waInstanceId?: string | null
}

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  entry: {
    label: 'Entrada',
    color: '#6366f1',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    ),
  },
  message: {
    label: 'Mensagem',
    color: '#0ea5e9',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  condition: {
    label: 'Condição',
    color: '#f59e0b',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
        <path d="M13 6h3a2 2 0 0 1 2 2v7" /><path d="M11 6H8a2 2 0 0 0-2 2v7" />
        <circle cx="6" cy="18" r="3" />
      </svg>
    ),
  },
  delay: {
    label: 'Atraso',
    color: '#8b5cf6',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" />
      </svg>
    ),
  },
  tag: {
    label: 'Tag',
    color: '#10b981',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    ),
  },
  sale: {
    label: 'Venda',
    color: '#f97316',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
  cart_abandoned: {
    label: 'Carr. Abandonado',
    color: '#6366f1',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
    ),
  },
  goto: {
    label: 'Ir para etapa',
    color: '#8b5cf6',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <polyline points="9,18 15,12 9,6" />
      </svg>
    ),
  },
  ab_test: {
    label: 'Divisão A/B',
    color: '#a855f7',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <line x1="4" y1="12" x2="20" y2="12" /><line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
  },
  remove_from_funnel: {
    label: 'Remover do funil',
    color: '#ef4444',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
  page: {
    label: 'Página',
    color: '#8b5cf6',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
        <line x1="9" y1="21" x2="9" y2="9" />
      </svg>
    ),
  },
  note: {
    label: 'Nota',
    color: '#ca8a04',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14,2 14,8 20,8" />
      </svg>
    ),
  },
}

const VARIABLES = [
  { label: '{nome}', desc: 'Nome completo' },
  { label: '{primeiro_nome}', desc: 'Primeiro nome' },
  { label: '{telefone}', desc: 'Telefone' },
  { label: '{email}', desc: 'E-mail' },
  { label: '{data}', desc: 'Data atual' },
  { label: '{hora}', desc: 'Hora atual' },
]

function previewInterpolate(text: string): string {
  const now = new Date()
  return text
    .replace(/{nome}/g, 'João Silva')
    .replace(/{primeiro_nome}/g, 'João')
    .replace(/{telefone}/g, '11999999999')
    .replace(/{email}/g, 'joao@exemplo.com')
    .replace(/{data}/g, now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }))
    .replace(/{hora}/g, now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }))
}

const CONDITIONS = [
  { value: 'replied', label: 'Respondeu (qualquer coisa) ✓' },
  { value: 'replied_with', label: 'Respondeu com palavra específica ✓' },
  { value: 'purchased', label: 'Comprou ✓' },
  { value: 'clicked', label: 'Clicou no link ✓' },
  { value: 'opened', label: 'Abriu mensagem ⚠️ (não funciona no WhatsApp)' },
  { value: 'tag', label: 'Tem tag' },
  { value: 'page_visited', label: 'Visitou a página ✓' },
  { value: 'form_submitted', label: 'Preencheu o formulário ✓' },
  { value: 'button_clicked', label: 'Clicou no botão da página ✓' },
  { value: 'video_watched', label: 'Assistiu o vídeo (50%+) ✓' },
]

const ENTRY_TYPES = [
  { value: 'link_utm', label: 'Link UTM' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'form', label: 'Formulário' },
]

const MEDIA_LABELS = {
  none: 'Sem anexo',
  image: 'Imagem',
  video: 'Vídeo',
  document: 'PDF / Arquivo',
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-medium text-gray-500 block mb-1.5">{children}</label>
}

function FieldWrap({ children }: { children: React.ReactNode }) {
  return <div className="mb-4">{children}</div>
}

const inputClass =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow'

const selectClass =
  'w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-shadow'

export default function ConfigPanel({ selectedNodeId, nodes, onClose, funnelId, onOpenCaptureEditor, waInstances = [], waInstanceId }: Props) {
  const { setNodes } = useReactFlow()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [uploading, setUploading] = useState(false)
  const [pages, setPages] = useState<{ id: string; title: string; slug: string; published?: boolean }[]>([])
  const [pagesLoaded, setPagesLoaded] = useState(false)

  // Load pages list when a 'page' block is selected
  const node = nodes.find((n) => n.id === selectedNodeId)
  const nodeBlockType = node ? (((node.data as unknown as FunnelNodeData).blockType as string) ?? node.type ?? '') : ''

  useEffect(() => {
    if (nodeBlockType !== 'page' || pagesLoaded) return
    fetch('/api/pages/list')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.pages)) setPages(d.pages)
        setPagesLoaded(true)
      })
      .catch(() => setPagesLoaded(true))
  }, [nodeBlockType, pagesLoaded])

  if (!node) return null

  const nodeData = node.data as unknown as FunnelNodeData
  const blockType = (nodeData.blockType as string) ?? node.type ?? 'message'
  const config = (nodeData.config ?? {}) as Record<string, unknown>
  const meta = TYPE_META[blockType] ?? TYPE_META.message

  const update = (patch: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedNodeId) return n
        const current = ((n.data as FunnelNodeData).config ?? {}) as Record<string, unknown>
        return { ...n, data: { ...n.data, config: { ...current, ...patch } } }
      })
    )
  }

  const handleDelete = () => {
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId))
    onClose()
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.url) update({ media_url: json.url })
      else alert(json.error ?? 'Erro ao fazer upload')
    } catch {
      alert('Erro ao fazer upload')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const insertVariable = (variable: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const current = (config.body as string) ?? ''
    const next = current.slice(0, start) + variable + current.slice(end)
    update({ body: next })
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + variable.length, start + variable.length)
    }, 0)
  }

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current
    if (!ta) {
      update({ body: ((config.body as string) ?? '') + emoji })
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const current = (config.body as string) ?? ''
    const next = current.slice(0, start) + emoji + current.slice(end)
    update({ body: next })
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + emoji.length, start + emoji.length)
    }, 0)
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://funil-pro.vercel.app'
  const activateUrl = funnelId
    ? `${appUrl}/api/funnels/${funnelId}/activate`
    : `${appUrl}/api/funnels/{id}/activate`

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-gray-100">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
        >
          {meta.icon}
        </div>
        <span className="flex-1 text-sm font-semibold text-gray-800">{meta.label}</span>
        <button
          onClick={handleDelete}
          className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors font-medium"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
            <polyline points="3,6 5,6 21,6" />
            <path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6" />
            <path d="M10,11v6M14,11v6" />
            <path d="M9,6V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1V6" />
          </svg>
          Deletar
        </button>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {blockType === 'entry' && (
          <>
            <FieldWrap>
              <Label>Tipo de entrada</Label>
              <select
                value={(config.entry_type as string) ?? 'link_utm'}
                onChange={(e) => update({ entry_type: e.target.value })}
                className={selectClass}
              >
                {ENTRY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </FieldWrap>
            <FieldWrap>
              <Label>URL de ativação</Label>
              <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-500 font-mono break-all leading-relaxed select-all">
                  POST {activateUrl}
                </p>
              </div>
            </FieldWrap>
            <FieldWrap>
              <Label>Campos esperados</Label>
              <div className="flex flex-wrap gap-1.5">
                {['nome', 'email', 'telefone', 'utm_source', 'utm_ad_id'].map((f) => (
                  <span key={f} className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-md font-mono">
                    {f}
                  </span>
                ))}
              </div>
            </FieldWrap>
            {(config.entry_type as string) === 'form' && (
              <FieldWrap>
                <Label>Página de captura</Label>
                {(config.page_configured as boolean) ? (
                  <div className="space-y-2">
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-green-500 shrink-0">
                        <polyline points="20,6 9,17 4,12" />
                      </svg>
                      <span className="text-xs text-green-700 font-medium">
                        Página configurada ✓{(config.page_template as string) ? ` — ${config.page_template as string}` : ''}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={onOpenCaptureEditor}
                        className="flex-1 text-xs px-3 py-2 border border-indigo-200 text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors font-medium"
                      >
                        Editar página
                      </button>
                      {funnelId && (
                        <a
                          href={`/p/${funnelId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-3 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                        >
                          Ver
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <p className="text-xs text-gray-500">Nenhuma página configurada.</p>
                    </div>
                    <button
                      onClick={onOpenCaptureEditor}
                      className="w-full text-xs px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                    >
                      Criar página de captura
                    </button>
                  </div>
                )}
              </FieldWrap>
            )}
          </>
        )}

        {blockType === 'message' && (
          <>
            <FieldWrap>
              <Label>Canal</Label>
              <select
                value={(config.channel as string) ?? 'whatsapp'}
                onChange={(e) => update({ channel: e.target.value })}
                className={selectClass}
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">E-mail</option>
              </select>
            </FieldWrap>
            <FieldWrap>
              <div className="flex items-center justify-between mb-1">
                <Label>
                  {(config.media_type ?? 'none') !== 'none' ? 'Legenda / Texto' : 'Mensagem'}
                </Label>
                <EmojiPicker onSelect={insertEmoji} />
              </div>
              <textarea
                ref={textareaRef}
                value={(config.body as string) ?? ''}
                onChange={(e) => update({ body: e.target.value })}
                placeholder="Digite o texto da mensagem..."
                rows={5}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none transition-shadow"
              />
              <div className="flex flex-wrap gap-1 mt-2">
                {VARIABLES.map((v) => (
                  <button
                    key={v.label}
                    type="button"
                    title={v.desc}
                    onClick={() => insertVariable(v.label)}
                    className="text-xs px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100 font-mono transition-colors"
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              {((config.body as string) ?? '').includes('{') && (
                <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-gray-400 mb-1">Preview (dados de exemplo):</p>
                  <p className="text-xs text-gray-700 whitespace-pre-wrap">{previewInterpolate((config.body as string) ?? '')}</p>
                </div>
              )}
            </FieldWrap>
            {((config.channel as string) ?? 'whatsapp') === 'whatsapp' && (
              <>
                <FieldWrap>
                  <Label>Tipo de mídia</Label>
                  <select
                    value={(config.media_type as string) ?? 'none'}
                    onChange={(e) => update({ media_type: e.target.value, media_url: '' })}
                    className={selectClass}
                  >
                    {(Object.entries(MEDIA_LABELS) as [string, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </FieldWrap>
                {(config.media_type as string) && config.media_type !== 'none' && (
                  <FieldWrap>
                    <Label>Arquivo / URL da mídia</Label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={(config.media_url as string) ?? ''}
                        onChange={(e) => update({ media_url: e.target.value })}
                        placeholder="https://..."
                        className={`${inputClass} flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg whitespace-nowrap"
                      >
                        {uploading ? 'Enviando…' : '📎 Upload'}
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      accept="image/*,video/mp4,video/quicktime,application/pdf,.doc,.docx,.zip"
                      onChange={handleFileUpload}
                    />
                    {(config.media_url as string) && (
                      <p className="text-xs text-green-400 mt-1 truncate">✓ {(config.media_url as string)}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">Faça upload ou cole um link público. Máx 50MB.</p>
                  </FieldWrap>
                )}
                <FieldWrap>
                  <Label>Instância WhatsApp</Label>
                  {(() => {
                    const inherited = waInstances.find((i) => i.id === waInstanceId)
                    return (
                      <div className="space-y-2">
                        <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2">
                          {inherited ? (
                            <>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${inherited.status === 'connected' ? 'bg-green-500' : 'bg-red-400'}`} />
                              <span className="text-xs text-gray-600">Herdado do funil: <strong>{inherited.instance_name}</strong></span>
                            </>
                          ) : (
                            <>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-amber-500 shrink-0">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                              </svg>
                              <span className="text-xs text-amber-600">Sem instância selecionada no funil</span>
                            </>
                          )}
                        </div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!(config.override_whatsapp_instance_id)}
                            onChange={(e) => update({ override_whatsapp_instance_id: e.target.checked ? (waInstances[0]?.id ?? '') : null })}
                            className="rounded border-gray-300"
                          />
                          <span className="text-xs text-gray-600">Usar instância específica para esta mensagem</span>
                        </label>
                        {!!config.override_whatsapp_instance_id && (
                          <select
                            value={(config.override_whatsapp_instance_id as string) ?? ''}
                            onChange={(e) => update({ override_whatsapp_instance_id: e.target.value })}
                            className={selectClass}
                          >
                            {waInstances.map((inst) => (
                              <option key={inst.id} value={inst.id}>
                                {inst.instance_name} ({inst.status === 'connected' ? 'Conectado' : 'Desconectado'})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )
                  })()}
                </FieldWrap>
              </>
            )}
          </>
        )}

        {blockType === 'condition' && (
          <>
            <FieldWrap>
              <Label>Verificar se o lead</Label>
              <select
                value={(config.condition as string) ?? 'replied'}
                onChange={(e) => update({ condition: e.target.value, purchased_product: '', replied_with: '' })}
                className={selectClass}
              >
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                Saída <span className="text-emerald-600 font-semibold">Sim</span> = condição verdadeira.{' '}
                Saída <span className="text-red-500 font-semibold">Não</span> = condição falsa.
              </p>
            </FieldWrap>

            {(config.condition as string) === 'replied_with' && (
              <FieldWrap>
                <Label>Palavra-chave na resposta</Label>
                <input
                  type="text"
                  value={(config.replied_with as string) ?? ''}
                  onChange={(e) => update({ replied_with: e.target.value })}
                  placeholder="Ex: SIM"
                  className={inputClass}
                />
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                  Passa para <span className="text-emerald-600 font-semibold">Sim</span> se a resposta do lead <strong>contiver esta palavra</strong> (não diferencia maiúsculas/minúsculas).
                </p>
              </FieldWrap>
            )}

            {(config.condition as string) === 'purchased' && (
              <FieldWrap>
                <Label>Produto específico (opcional)</Label>
                <input
                  type="text"
                  value={(config.purchased_product as string) ?? ''}
                  onChange={(e) => update({ purchased_product: e.target.value })}
                  placeholder="Ex: Produto B — deixe vazio para qualquer compra"
                  className={inputClass}
                />
                <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                  Se preenchido, só passa para <span className="text-emerald-600 font-semibold">Sim</span> se o lead comprou <strong>este produto específico</strong>.
                </p>
              </FieldWrap>
            )}
          </>
        )}

        {blockType === 'delay' && (
          <div className="flex gap-3">
            <FieldWrap>
              <Label>Duração</Label>
              <input
                type="number"
                min={1}
                value={(config.duration as number) ?? 1}
                onChange={(e) => update({ duration: Number(e.target.value) })}
                className={inputClass}
              />
            </FieldWrap>
            <FieldWrap>
              <Label>Unidade</Label>
              <select
                value={(config.unit as string) ?? 'horas'}
                onChange={(e) => update({ unit: e.target.value })}
                className={selectClass}
              >
                <option value="minutos">Minutos</option>
                <option value="horas">Horas</option>
                <option value="dias">Dias</option>
              </select>
            </FieldWrap>
          </div>
        )}

        {blockType === 'tag' && (
          <>
            <FieldWrap>
              <Label>Nome da tag</Label>
              <input
                type="text"
                value={(config.tag_name as string) ?? ''}
                onChange={(e) => update({ tag_name: e.target.value })}
                placeholder="Ex: cliente-quente"
                className={inputClass}
              />
            </FieldWrap>
            <FieldWrap>
              <Label>Ação</Label>
              <div className="flex rounded-lg overflow-hidden border border-gray-200 text-sm">
                {(['add', 'remove'] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => update({ action: a })}
                    className={`flex-1 py-2 transition-colors font-medium ${
                      ((config.action as string) ?? 'add') === a
                        ? 'bg-emerald-500 text-white'
                        : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {a === 'add' ? 'Adicionar' : 'Remover'}
                  </button>
                ))}
              </div>
            </FieldWrap>
          </>
        )}

        {blockType === 'cart_abandoned' && (
          <>
            <FieldWrap>
              <Label>Plataforma de origem</Label>
              <select
                value={(config.platform as string) ?? 'all'}
                onChange={(e) => update({ platform: e.target.value })}
                className={selectClass}
              >
                <option value="all">Todas as plataformas</option>
                <option value="hotmart">Hotmart</option>
                <option value="kiwify">Kiwify</option>
                <option value="eduzz">Eduzz</option>
                <option value="yampi">Yampi</option>
              </select>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                Este bloco é ativado automaticamente quando a plataforma envia um evento de carrinho abandonado.
              </p>
            </FieldWrap>
          </>
        )}

        {blockType === 'goto' && (
          <FieldWrap>
            <Label>Ir para o bloco</Label>
            <select
              value={(config.target_block_id as string) ?? ''}
              onChange={(e) => {
                const target = nodes.find((n) => n.id === e.target.value)
                const targetLabel = target ? ((target.data as FunnelNodeData).label as string) : ''
                update({ target_block_id: e.target.value, target_label: targetLabel })
              }}
              className={selectClass}
            >
              <option value="">Selecione um bloco...</option>
              {nodes
                .filter((n) => n.id !== selectedNodeId && n.type !== 'note')
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {(n.data as FunnelNodeData).label ?? n.type}
                  </option>
                ))}
            </select>
            <p className="text-xs text-amber-600 mt-2 leading-relaxed">
              ⚠️ Cuidado com loops infinitos. O sistema bloqueia após 10 redirecionamentos por hora.
            </p>
          </FieldWrap>
        )}

        {blockType === 'ab_test' && (
          <>
            <FieldWrap>
              <Label>Distribuição A/B</Label>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-semibold text-emerald-700 w-12">A: {(config.percent_a as number) ?? 50}%</span>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={5}
                  value={(config.percent_a as number) ?? 50}
                  onChange={(e) => update({ percent_a: Number(e.target.value) })}
                  className="flex-1"
                />
                <span className="text-xs font-semibold text-blue-700 w-12 text-right">B: {100 - ((config.percent_a as number) ?? 50)}%</span>
              </div>
            </FieldWrap>
            <FieldWrap>
              <Label>Rótulo da Variante A</Label>
              <input
                type="text"
                value={(config.label_a as string) ?? ''}
                onChange={(e) => update({ label_a: e.target.value })}
                placeholder="Variante A"
                className={inputClass}
              />
            </FieldWrap>
            <FieldWrap>
              <Label>Rótulo da Variante B</Label>
              <input
                type="text"
                value={(config.label_b as string) ?? ''}
                onChange={(e) => update({ label_b: e.target.value })}
                placeholder="Variante B"
                className={inputClass}
              />
            </FieldWrap>
          </>
        )}

        {blockType === 'remove_from_funnel' && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-red-500 shrink-0 mt-0.5">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div>
                <p className="text-xs font-semibold text-red-700 mb-1">Encerra a jornada</p>
                <p className="text-xs text-red-600 leading-relaxed">
                  Quando o lead chega neste bloco, ele é marcado como <strong>concluído</strong> e removido do fluxo de execução. Não receberá mais mensagens automáticas.
                </p>
              </div>
            </div>
          </div>
        )}

        {blockType === 'page' && (
          <>
            <FieldWrap>
              <Label>Página a enviar</Label>
              {!pagesLoaded ? (
                <div className="text-xs text-gray-400 py-2">Carregando páginas...</div>
              ) : pages.length === 0 ? (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="text-xs text-amber-700">Nenhuma página encontrada. Crie uma em <strong>Páginas</strong> primeiro.</p>
                </div>
              ) : (
                <select
                  value={(config.page_id as string) ?? ''}
                  onChange={(e) => update({ page_id: e.target.value })}
                  className={selectClass}
                >
                  <option value="">Selecione uma página...</option>
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}{p.published ? '' : ' (rascunho)'}
                    </option>
                  ))}
                </select>
              )}
            </FieldWrap>
            <FieldWrap>
              <Label>Mensagem (antes do link)</Label>
              <textarea
                value={(config.message as string) ?? ''}
                onChange={(e) => update({ message: e.target.value })}
                placeholder="Ex: Olá {primeiro_nome}! Acesse sua página exclusiva: {link}"
                rows={4}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none transition-shadow"
              />
              <div className="flex flex-wrap gap-1 mt-2">
                {['{nome}', '{primeiro_nome}', '{link}'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      const current = (config.message as string) ?? ''
                      update({ message: current + v })
                    }}
                    className="text-xs px-2 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 font-mono transition-colors"
                  >
                    {v}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">
                Use <code className="bg-gray-100 px-1 rounded">{'{link}'}</code> para inserir o link da página. Se omitido, o link é adicionado ao final automaticamente.
              </p>
            </FieldWrap>
            {(config.page_id as string) && (
              <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                <p className="text-xs text-violet-700 leading-relaxed">
                  O lead receberá o link via WhatsApp com <code className="bg-violet-100 px-1 rounded">?lid=ID_DO_LEAD</code> para rastreamento automático.
                </p>
              </div>
            )}
          </>
        )}

        {blockType === 'note' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <p className="text-xs text-yellow-700 leading-relaxed">
              Notas são anotações visuais no canvas. <strong>Não são executadas</strong> e não afetam o fluxo do funil. Edite o texto diretamente no bloco. Você pode redimensioná-lo arrastando as bordas.
            </p>
          </div>
        )}

        {blockType === 'sale' && (
          <>
            <FieldWrap>
              <Label>Nome do produto</Label>
              <input
                type="text"
                value={(config.product_name as string) ?? ''}
                onChange={(e) => update({ product_name: e.target.value })}
                placeholder="Nome do produto"
                className={inputClass}
              />
            </FieldWrap>
            <FieldWrap>
              <Label>URL de pagamento</Label>
              <input
                type="url"
                value={(config.payment_link as string) ?? ''}
                onChange={(e) => update({ payment_link: e.target.value })}
                placeholder="https://..."
                className={inputClass}
              />
            </FieldWrap>
            <FieldWrap>
              <Label>Mensagem de venda</Label>
              <textarea
                value={(config.sale_message as string) ?? ''}
                onChange={(e) => update({ sale_message: e.target.value })}
                placeholder="Ex: Aproveite! Link exclusivo para você..."
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none transition-shadow"
              />
              <p className="text-xs text-gray-400 mt-1">Use <code className="bg-gray-100 px-1 rounded">{'{link}'}</code> para inserir o link na posição desejada. Se omitido, o link é adicionado automaticamente ao final.</p>
            </FieldWrap>
          </>
        )}
      </div>
    </div>
  )
}
