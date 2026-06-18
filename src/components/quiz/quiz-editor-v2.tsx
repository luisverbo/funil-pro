'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDroppable, useDraggable,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  saveQuizV2, publishQuizV2,
  type QuizData, type QuizPage, type QuizBlock, type BlockType, type BlockConfig, type BlockOption,
} from '@/app/actions/quiz-v2'

// ─── Metadata ─────────────────────────────────────────────────────────────────

const BLOCK_META: Record<BlockType, { label: string; icon: string; category: string }> = {
  field_text:     { label: 'Campo texto',      icon: '📝', category: 'Formulário' },
  field_email:    { label: 'E-mail',           icon: '✉️',  category: 'Formulário' },
  field_phone:    { label: 'Telefone',         icon: '📱', category: 'Formulário' },
  field_number:   { label: 'Número',           icon: '🔢', category: 'Formulário' },
  field_textarea: { label: 'Textarea',         icon: '📄', category: 'Formulário' },
  single_choice:  { label: 'Escolha única',    icon: '🔘', category: 'Quiz' },
  multi_choice:   { label: 'Múltipla escolha', icon: '☑️',  category: 'Quiz' },
  yes_no:         { label: 'Sim / Não',        icon: '👍', category: 'Quiz' },
  scale:          { label: 'Escala 1-10',      icon: '📊', category: 'Quiz' },
  text_block:     { label: 'Texto',            icon: '📰', category: 'Mídia e conteúdo' },
  image:          { label: 'Imagem',           icon: '🖼️', category: 'Mídia e conteúdo' },
  video:          { label: 'Vídeo',            icon: '▶️',  category: 'Mídia e conteúdo' },
  button:         { label: 'Botão',            icon: '🔲', category: 'Ação' },
  final_capture:  { label: 'Captura final',    icon: '🏆', category: 'Ação' },
  result:         { label: 'Resultado',        icon: '🎉', category: 'Ação' },
}

const CATEGORIES = ['Formulário', 'Quiz', 'Mídia e conteúdo', 'Ação']

function newId() { return crypto.randomUUID() }

function defaultConfig(type: BlockType): BlockConfig {
  switch (type) {
    case 'single_choice': return {
      question: '', subtitle: '', required: true,
      options: [
        { id: newId(), label: 'Opção A', emoji: '🎯', points: 0 },
        { id: newId(), label: 'Opção B', emoji: '💪', points: 0 },
      ],
    }
    case 'multi_choice': return {
      question: '', subtitle: '', required: true,
      options: [
        { id: newId(), label: 'Opção A', emoji: '', points: 0 },
        { id: newId(), label: 'Opção B', emoji: '', points: 0 },
      ],
    }
    case 'yes_no': return {
      question: '', subtitle: '', required: true,
      options: [
        { id: newId(), label: 'Sim', emoji: '✅', points: 10 },
        { id: newId(), label: 'Não', emoji: '❌', points: 0 },
      ],
    }
    case 'scale': return { question: '', required: true, scale_min: 1, scale_max: 10 }
    case 'field_text':    return { label: 'Qual é o seu nome?',  placeholder: 'Digite aqui...', required: true }
    case 'field_email':   return { label: 'Seu e-mail',          placeholder: 'email@exemplo.com', required: true }
    case 'field_phone':   return { label: 'Seu telefone',        placeholder: '(11) 99999-9999', required: false }
    case 'field_number':  return { label: 'Número',              placeholder: '0', required: false }
    case 'field_textarea':return { label: 'Sua mensagem',        placeholder: 'Digite aqui...', required: false }
    case 'text_block':    return { content: '<p>Digite seu texto aqui...</p>' }
    case 'image':         return { image_url: '', image_size: 'medium', image_align: 'center' }
    case 'video':         return { video_url: '' }
    case 'button':        return { button_text: 'Próximo →', button_action: 'next_page', button_color: '#6366f1', button_align: 'center' }
    case 'final_capture': return { show_name: true, show_email: true, show_phone: false, submit_text: 'Ver meu resultado →' }
    case 'result':        return { title: 'Parabéns!', description: '', show_score: false, cta_text: 'Acessar agora', cta_url: '' }
    default: return {}
  }
}

function defaultQuiz(pageTitle = 'Quiz'): QuizData {
  const firstPageId = newId()
  return {
    version: 2,
    pages: [{
      id: firstPageId,
      title: 'Página 1',
      order: 0,
      blocks: [{
        id: newId(),
        type: 'single_choice',
        order: 0,
        config: {
          question: 'Qual é o seu principal objetivo?',
          subtitle: 'Escolha uma opção',
          required: true,
          options: [
            { id: newId(), label: 'Opção A', emoji: '🎯', points: 10 },
            { id: newId(), label: 'Opção B', emoji: '💪', points: 5 },
          ],
        },
      }],
    }],
    settings: { title: pageTitle, primary_color: '#6366f1', show_progress: true },
  }
}

// ─── Left Panel ───────────────────────────────────────────────────────────────

function PaletteItem({ type }: { type: BlockType }) {
  const meta = BLOCK_META[type]
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${type}` })

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`flex items-center gap-2 px-2 py-2 text-xs font-medium text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 rounded-lg cursor-grab active:cursor-grabbing transition select-none ${isDragging ? 'opacity-40' : ''}`}
    >
      <span className="text-base w-5 text-center shrink-0">{meta.icon}</span>
      <span className="truncate">{meta.label}</span>
    </div>
  )
}

function LeftPanel() {
  return (
    <div className="w-60 bg-white border-r border-gray-200 overflow-y-auto shrink-0 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Blocos</p>
        <p className="text-[10px] text-gray-400 mt-0.5">Arraste para a página</p>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {CATEGORIES.map(cat => {
          const types = (Object.entries(BLOCK_META) as [BlockType, typeof BLOCK_META[BlockType]][])
            .filter(([, m]) => m.category === cat)
            .map(([t]) => t)
          return (
            <div key={cat} className="mb-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 mb-1">{cat}</p>
              <div className="px-2 space-y-0.5">
                {types.map(type => <PaletteItem key={type} type={type} />)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Block Preview ─────────────────────────────────────────────────────────────

function BlockPreview({ block, pages }: { block: QuizBlock; pages: QuizPage[] }) {
  const meta = BLOCK_META[block.type]
  const { config } = block

  let summary: React.ReactNode = null

  if (['single_choice', 'multi_choice', 'yes_no'].includes(block.type)) {
    summary = (
      <div>
        <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2">
          {config.question || <span className="text-gray-400 italic">Pergunta sem texto</span>}
        </p>
        {config.subtitle && <p className="text-xs text-gray-500 mt-0.5">{config.subtitle}</p>}
        {(config.options ?? []).length > 0 && (
          <div className="mt-2 space-y-1">
            {(config.options ?? []).slice(0, 3).map(opt => (
              <div key={opt.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0 flex items-center justify-center text-[10px]">
                  {block.type === 'multi_choice' ? '□' : '○'}
                </span>
                {opt.emoji && <span>{opt.emoji}</span>}
                <span className="truncate">{opt.label || 'Opção'}</span>
                {!!opt.points && <span className={`ml-auto text-[10px] font-medium ${opt.points > 0 ? 'text-emerald-500' : 'text-red-400'}`}>{opt.points > 0 ? '+' : ''}{opt.points}</span>}
              </div>
            ))}
            {(config.options ?? []).length > 3 && (
              <p className="text-[10px] text-gray-400">+{(config.options ?? []).length - 3} opções</p>
            )}
          </div>
        )}
      </div>
    )
  } else if (block.type === 'scale') {
    summary = (
      <div>
        <p className="text-sm font-semibold text-gray-800 line-clamp-1">{config.question || 'Escala'}</p>
        <div className="flex gap-1 mt-2">
          {[1,2,3,4,5].map(n => (
            <div key={n} className="w-6 h-6 rounded border border-gray-200 flex items-center justify-center text-xs text-gray-500">{n}</div>
          ))}
          <span className="text-xs text-gray-400 self-center ml-1">…{config.scale_max}</span>
        </div>
      </div>
    )
  } else if (['field_text','field_email','field_phone','field_number','field_textarea'].includes(block.type)) {
    summary = (
      <div>
        <p className="text-xs text-gray-500 font-medium">{config.label || 'Campo'}</p>
        <div className={`mt-1.5 w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-400 bg-gray-50 ${block.type === 'field_textarea' ? 'h-12' : ''}`}>
          {config.placeholder || 'Digite aqui...'}
        </div>
      </div>
    )
  } else if (block.type === 'text_block') {
    const text = config.content?.replace(/<[^>]+>/g, ' ').trim() || ''
    summary = <p className="text-sm text-gray-700 line-clamp-3">{text || <span className="italic text-gray-400">Texto vazio</span>}</p>
  } else if (block.type === 'image') {
    summary = config.image_url
      ? <img src={config.image_url} alt="" className="w-full max-h-24 object-cover rounded" />
      : <div className="w-full h-16 bg-gray-100 rounded flex items-center justify-center text-gray-400 text-xs">Sem imagem</div>
  } else if (block.type === 'video') {
    summary = (
      <div className="w-full h-12 bg-gray-900 rounded flex items-center justify-center gap-2">
        <span className="text-white text-lg">▶</span>
        <span className="text-gray-400 text-xs truncate">{config.video_url || 'URL do vídeo'}</span>
      </div>
    )
  } else if (block.type === 'button') {
    summary = (
      <div className={`flex ${config.button_align === 'left' ? 'justify-start' : config.button_align === 'right' ? 'justify-end' : 'justify-center'}`}>
        <div
          className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl shadow-sm"
          style={{ background: config.button_color || '#6366f1' }}
        >
          {config.button_text || 'Botão'}
        </div>
      </div>
    )
  } else if (block.type === 'final_capture') {
    summary = (
      <div className="space-y-1.5">
        {config.show_name   && <div className="h-7 bg-gray-50 border border-gray-200 rounded text-xs px-2 flex items-center text-gray-400">Nome</div>}
        {config.show_email  && <div className="h-7 bg-gray-50 border border-gray-200 rounded text-xs px-2 flex items-center text-gray-400">E-mail</div>}
        {config.show_phone  && <div className="h-7 bg-gray-50 border border-gray-200 rounded text-xs px-2 flex items-center text-gray-400">Telefone</div>}
        <div className="h-8 bg-indigo-500 rounded text-xs text-white flex items-center justify-center font-medium">
          {config.submit_text || 'Ver meu resultado →'}
        </div>
      </div>
    )
  } else if (block.type === 'result') {
    summary = (
      <div className="text-center">
        <div className="text-2xl mb-1">🎉</div>
        <p className="text-sm font-bold text-gray-800">{config.title || 'Resultado'}</p>
        {config.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{config.description}</p>}
        {config.cta_text && (
          <div className="mt-2 inline-block px-4 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-xl">{config.cta_text}</div>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2">
      <span className="text-base mt-0.5 shrink-0">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full mb-1.5 inline-block ${
          meta.category === 'Quiz' ? 'bg-indigo-100 text-indigo-600' :
          meta.category === 'Formulário' ? 'bg-blue-100 text-blue-600' :
          meta.category === 'Ação' ? 'bg-green-100 text-green-600' :
          'bg-gray-100 text-gray-600'
        }`}>{meta.label}</span>
        {summary}
      </div>
    </div>
  )
}

// ─── Sortable Block ───────────────────────────────────────────────────────────

function SortableBlock({
  block, pageId, pages, isSelected, onSelect, onDelete,
}: {
  block: QuizBlock
  pageId: string
  pages: QuizPage[]
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    data: { type: 'block', blockId: block.id, pageId },
  })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative bg-white border-2 rounded-xl transition-all ${
        isSelected ? 'border-indigo-400 shadow-md' : 'border-gray-200 hover:border-indigo-200 hover:shadow-sm'
      } ${isDragging ? 'opacity-40 z-50' : ''}`}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute left-0 top-0 bottom-0 w-7 flex items-center justify-center cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 rounded-l-xl"
        onClick={e => e.stopPropagation()}
      >
        <svg viewBox="0 0 8 16" fill="currentColor" className="w-3 h-3">
          <circle cx="2" cy="2" r="1.5"/><circle cx="6" cy="2" r="1.5"/>
          <circle cx="2" cy="7" r="1.5"/><circle cx="6" cy="7" r="1.5"/>
          <circle cx="2" cy="12" r="1.5"/><circle cx="6" cy="12" r="1.5"/>
        </svg>
      </div>

      {/* Block content */}
      <div className="pl-8 pr-10 py-3">
        <BlockPreview block={block} pages={pages} />
      </div>

      {/* Delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="absolute right-2 top-2 w-6 h-6 rounded-lg bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-base leading-none"
      >×</button>
    </div>
  )
}

// ─── Page Card ────────────────────────────────────────────────────────────────

function PageCard({
  page, pages, selectedId, onSelectBlock, onDeleteBlock, onDeletePage, onRenamePageTitle,
}: {
  page: QuizPage
  pages: QuizPage[]
  selectedId: string | null
  onSelectBlock: (blockId: string) => void
  onDeleteBlock: (blockId: string) => void
  onDeletePage: () => void
  onRenamePageTitle: (title: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `page:${page.id}`, data: { type: 'page', pageId: page.id } })
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(page.title)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTitleDraft(page.title) }, [page.title])
  useEffect(() => { if (editingTitle) titleRef.current?.select() }, [editingTitle])

  return (
    <div className={`bg-white rounded-2xl shadow-sm border-2 transition-colors ${isOver ? 'border-indigo-300 shadow-md' : 'border-transparent'}`}>
      {/* Page header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2">
        <div className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-indigo-600">{page.order + 1}</span>
        </div>
        {editingTitle ? (
          <input
            ref={titleRef}
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onBlur={() => { onRenamePageTitle(titleDraft || page.title); setEditingTitle(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { onRenamePageTitle(titleDraft || page.title); setEditingTitle(false) } }}
            className="flex-1 text-sm font-semibold text-gray-800 bg-transparent border-b border-indigo-300 focus:outline-none"
          />
        ) : (
          <button onClick={() => setEditingTitle(true)} className="flex-1 text-sm font-semibold text-gray-800 text-left hover:text-indigo-600 transition">
            {page.title}
          </button>
        )}
        <button
          onClick={onDeletePage}
          className="w-6 h-6 rounded-lg text-gray-300 hover:text-red-400 hover:bg-red-50 flex items-center justify-center text-lg leading-none transition"
        >×</button>
      </div>

      {/* Blocks sortable area */}
      <div ref={setNodeRef} className="px-4 pb-4">
        <SortableContext items={page.blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          {page.blocks.length > 0 ? (
            <div className="space-y-2">
              {page.blocks.map(block => (
                <SortableBlock
                  key={block.id}
                  block={block}
                  pageId={page.id}
                  pages={pages}
                  isSelected={selectedId === block.id}
                  onSelect={() => onSelectBlock(block.id)}
                  onDelete={() => onDeleteBlock(block.id)}
                />
              ))}
            </div>
          ) : (
            <div className={`h-20 rounded-xl border-2 border-dashed flex items-center justify-center transition-colors ${isOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}>
              <p className={`text-xs ${isOver ? 'text-indigo-500' : 'text-gray-400'}`}>
                {isOver ? 'Solte aqui' : 'Arraste blocos da esquerda'}
              </p>
            </div>
          )}
        </SortableContext>
      </div>
    </div>
  )
}

// ─── Center Panel ─────────────────────────────────────────────────────────────

function CenterPanel({
  pages, selectedId, onSelectBlock, onDeleteBlock, onDeletePage, onRenamePageTitle, onAddPage,
}: {
  pages: QuizPage[]
  selectedId: string | null
  onSelectBlock: (blockId: string) => void
  onDeleteBlock: (blockId: string) => void
  onDeletePage: (pageId: string) => void
  onRenamePageTitle: (pageId: string, title: string) => void
  onAddPage: () => void
}) {
  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
      <div className="max-w-xl mx-auto space-y-4">
        {pages.map(page => (
          <PageCard
            key={page.id}
            page={page}
            pages={pages}
            selectedId={selectedId}
            onSelectBlock={onSelectBlock}
            onDeleteBlock={id => onDeleteBlock(id)}
            onDeletePage={() => onDeletePage(page.id)}
            onRenamePageTitle={title => onRenamePageTitle(page.id, title)}
          />
        ))}

        <button
          onClick={onAddPage}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-indigo-200 text-indigo-400 text-sm font-medium hover:border-indigo-400 hover:text-indigo-600 hover:bg-white transition"
        >
          + Nova página
        </button>
      </div>
    </div>
  )
}

// ─── Right Panel ──────────────────────────────────────────────────────────────

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div onClick={onToggle} className={`w-9 h-5 rounded-full transition-colors shrink-0 ${on ? 'bg-indigo-500' : 'bg-gray-200'}`}>
        <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-xs text-gray-600">{label}</span>
    </label>
  )
}

const inputCls = 'w-full text-sm border border-gray-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white'
const labelCls = 'block text-xs font-semibold text-gray-500 mb-1.5'

function RightPanelEmpty({ settings, onUpdateSettings }: {
  settings: QuizData['settings']
  onUpdateSettings: (s: Partial<QuizData['settings']>) => void
}) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-gray-100">
        <span className="text-base">⚙️</span>
        <p className="text-sm font-semibold text-gray-800">Configurações do quiz</p>
      </div>
      <div>
        <label className={labelCls}>Cor principal</label>
        <div className="flex items-center gap-2">
          <input type="color" value={settings.primary_color || '#6366f1'}
            onChange={e => onUpdateSettings({ primary_color: e.target.value })}
            className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
          <span className="text-xs text-gray-500 font-mono">{settings.primary_color || '#6366f1'}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#a855f7','#0ea5e9','#000000'].map(c => (
          <button key={c} onClick={() => onUpdateSettings({ primary_color: c })}
            style={{ background: c, borderColor: settings.primary_color === c ? 'white' : c, outlineColor: settings.primary_color === c ? c : 'transparent' }}
            className="w-7 h-7 rounded-full border-2 outline-2 outline transition" />
        ))}
      </div>
      <Toggle on={!!settings.show_progress} onToggle={() => onUpdateSettings({ show_progress: !settings.show_progress })} label="Mostrar barra de progresso" />
    </div>
  )
}

function OptionList({
  options, pages, onChange,
}: {
  options: BlockOption[]
  pages: QuizPage[]
  onChange: (opts: BlockOption[]) => void
}) {
  function updateOpt(id: string, patch: Partial<BlockOption>) {
    onChange(options.map(o => o.id === id ? { ...o, ...patch } : o))
  }
  function addOpt() {
    onChange([...options, { id: newId(), label: '', emoji: '', points: 0, goto_page_id: null }])
  }
  function removeOpt(id: string) { onChange(options.filter(o => o.id !== id)) }
  function moveOpt(idx: number, dir: -1 | 1) {
    const arr = [...options]; const swap = idx + dir
    if (swap < 0 || swap >= arr.length) return
    ;[arr[idx], arr[swap]] = [arr[swap], arr[idx]]
    onChange(arr)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className={labelCls.replace('mb-1.5', '')}>Opções</label>
        <button onClick={addOpt} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">+ Adicionar</button>
      </div>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={opt.id} className="border border-gray-200 rounded-lg p-2 space-y-1.5 bg-gray-50">
            <div className="flex items-center gap-1.5">
              <input value={opt.emoji ?? ''} onChange={e => updateOpt(opt.id, { emoji: e.target.value })}
                className="w-9 text-center text-sm border border-gray-200 rounded py-1 bg-white focus:outline-none" placeholder="😀" maxLength={2} />
              <input value={opt.label} onChange={e => updateOpt(opt.id, { label: e.target.value })}
                className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-300" placeholder="Texto da opção" />
              <div className="flex gap-0.5">
                <button onClick={() => moveOpt(i, -1)} className="p-0.5 text-gray-400 hover:text-gray-600 text-xs">↑</button>
                <button onClick={() => moveOpt(i, 1)}  className="p-0.5 text-gray-400 hover:text-gray-600 text-xs">↓</button>
                <button onClick={() => removeOpt(opt.id)} className="p-0.5 text-red-400 hover:text-red-600">×</button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <label className="text-[10px] text-gray-400">Pts:</label>
                <input type="number" value={opt.points ?? 0} onChange={e => updateOpt(opt.id, { points: Number(e.target.value) })}
                  className="w-16 text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none" />
              </div>
              {pages.length > 0 && (
                <div className="flex items-center gap-1.5 flex-1">
                  <label className="text-[10px] text-gray-400 shrink-0">→ Ir para:</label>
                  <select value={opt.goto_page_id ?? ''} onChange={e => updateOpt(opt.id, { goto_page_id: e.target.value || null })}
                    className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none min-w-0">
                    <option value="">Próxima página</option>
                    {pages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </select>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BlockEditor({
  block, pages, funnels, onChange,
}: {
  block: QuizBlock
  pages: QuizPage[]
  funnels: { id: string; name: string }[]
  onChange: (config: Partial<BlockConfig>) => void
}) {
  const { config } = block
  const isChoice = ['single_choice', 'multi_choice', 'yes_no'].includes(block.type)

  function setConfig(patch: Partial<BlockConfig>) { onChange(patch) }
  function setConfigKey<K extends keyof BlockConfig>(key: K, val: BlockConfig[K]) { setConfig({ [key]: val }) }

  const sectionCls = 'border-t border-gray-100 pt-3'

  return (
    <div className="space-y-4">
      {/* Choice blocks */}
      {isChoice && (
        <>
          <div>
            <label className={labelCls}>Pergunta</label>
            <textarea value={config.question ?? ''} onChange={e => setConfigKey('question', e.target.value)}
              rows={3} className={inputCls + ' resize-none'} placeholder="Digite a pergunta..." />
          </div>
          <div>
            <label className={labelCls}>Subtítulo (opcional)</label>
            <input value={config.subtitle ?? ''} onChange={e => setConfigKey('subtitle', e.target.value)}
              className={inputCls} placeholder="Ex: Escolha uma opção" />
          </div>
          <OptionList options={config.options ?? []} pages={pages} onChange={opts => setConfigKey('options', opts)} />
          <div className={sectionCls}>
            <Toggle on={!!config.required} onToggle={() => setConfigKey('required', !config.required)} label="Resposta obrigatória" />
          </div>
        </>
      )}

      {/* Scale */}
      {block.type === 'scale' && (
        <>
          <div>
            <label className={labelCls}>Pergunta</label>
            <textarea value={config.question ?? ''} onChange={e => setConfigKey('question', e.target.value)}
              rows={2} className={inputCls + ' resize-none'} placeholder="Como você avalia...?" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Mínimo</label>
              <input type="number" value={config.scale_min ?? 1} onChange={e => setConfigKey('scale_min', Number(e.target.value))} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Máximo</label>
              <input type="number" value={config.scale_max ?? 10} onChange={e => setConfigKey('scale_max', Number(e.target.value))} className={inputCls} />
            </div>
          </div>
          <Toggle on={!!config.required} onToggle={() => setConfigKey('required', !config.required)} label="Obrigatório" />
        </>
      )}

      {/* Form fields */}
      {['field_text','field_email','field_phone','field_number','field_textarea'].includes(block.type) && (
        <>
          <div>
            <label className={labelCls}>Label</label>
            <input value={config.label ?? ''} onChange={e => setConfigKey('label', e.target.value)} className={inputCls} placeholder="Texto da pergunta" />
          </div>
          <div>
            <label className={labelCls}>Placeholder</label>
            <input value={config.placeholder ?? ''} onChange={e => setConfigKey('placeholder', e.target.value)} className={inputCls} placeholder="Texto de exemplo..." />
          </div>
          <Toggle on={!!config.required} onToggle={() => setConfigKey('required', !config.required)} label="Obrigatório" />
        </>
      )}

      {/* Text block */}
      {block.type === 'text_block' && (
        <div>
          <label className={labelCls}>Conteúdo (HTML básico aceito)</label>
          <textarea value={config.content ?? ''} onChange={e => setConfigKey('content', e.target.value)}
            rows={6} className={inputCls + ' resize-none font-mono text-xs'} placeholder="<p>Seu texto aqui...</p>" />
          <p className="text-[10px] text-gray-400 mt-1">Tags aceitas: &lt;p&gt; &lt;b&gt; &lt;i&gt; &lt;h2&gt; &lt;h3&gt; &lt;br&gt;</p>
        </div>
      )}

      {/* Image */}
      {block.type === 'image' && (
        <>
          <div>
            <label className={labelCls}>URL da imagem</label>
            <input value={config.image_url ?? ''} onChange={e => setConfigKey('image_url', e.target.value)} className={inputCls} placeholder="https://..." />
          </div>
          <div>
            <label className={labelCls}>Tamanho</label>
            <div className="flex gap-2">
              {(['small','medium','large','full'] as const).map(s => (
                <button key={s} onClick={() => setConfigKey('image_size', s)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${config.image_size === s ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-indigo-200'}`}>
                  {s === 'small' ? 'P' : s === 'medium' ? 'M' : s === 'large' ? 'G' : '100%'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>Alinhamento</label>
            <div className="flex gap-2">
              {(['left','center','right'] as const).map(a => (
                <button key={a} onClick={() => setConfigKey('image_align', a)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${config.image_align === a ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-indigo-200'}`}>
                  {a === 'left' ? '←' : a === 'center' ? '↔' : '→'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Video */}
      {block.type === 'video' && (
        <div>
          <label className={labelCls}>URL do vídeo (YouTube / Vimeo)</label>
          <input value={config.video_url ?? ''} onChange={e => setConfigKey('video_url', e.target.value)} className={inputCls} placeholder="https://youtube.com/watch?v=..." />
          <p className="text-[10px] text-gray-400 mt-1">Cole a URL normal ou embed do YouTube/Vimeo</p>
        </div>
      )}

      {/* Button */}
      {block.type === 'button' && (
        <>
          <div>
            <label className={labelCls}>Texto do botão</label>
            <input value={config.button_text ?? ''} onChange={e => setConfigKey('button_text', e.target.value)} className={inputCls} placeholder="Próximo →" />
          </div>
          <div>
            <label className={labelCls}>Ação</label>
            <select value={config.button_action ?? 'next_page'} onChange={e => setConfigKey('button_action', e.target.value as BlockConfig['button_action'])} className={inputCls}>
              <option value="next_page">Próxima página</option>
              <option value="external_url">URL externa</option>
              <option value="submit">Enviar formulário</option>
            </select>
          </div>
          {config.button_action === 'external_url' && (
            <div>
              <label className={labelCls}>URL</label>
              <input value={config.button_url ?? ''} onChange={e => setConfigKey('button_url', e.target.value)} className={inputCls} placeholder="https://..." />
            </div>
          )}
          <div>
            <label className={labelCls}>Cor do botão</label>
            <div className="flex items-center gap-2">
              <input type="color" value={config.button_color || '#6366f1'} onChange={e => setConfigKey('button_color', e.target.value)}
                className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
              <div className="flex flex-wrap gap-1.5">
                {['#6366f1','#3b82f6','#10b981','#f59e0b','#ef4444','#000000'].map(c => (
                  <button key={c} onClick={() => setConfigKey('button_color', c)}
                    style={{ background: c, outlineColor: config.button_color === c ? c : 'transparent' }}
                    className="w-6 h-6 rounded-full outline-2 outline outline-offset-1 transition" />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className={labelCls}>Alinhamento</label>
            <div className="flex gap-2">
              {(['left','center','right'] as const).map(a => (
                <button key={a} onClick={() => setConfigKey('button_align', a)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${config.button_align === a ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                  {a === 'left' ? '← Esq' : a === 'center' ? '↔ Centro' : 'Dir →'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Final capture */}
      {block.type === 'final_capture' && (
        <>
          <div>
            <label className={labelCls}>Campos visíveis</label>
            <div className="space-y-2">
              <Toggle on={!!config.show_name}  onToggle={() => setConfigKey('show_name', !config.show_name)}   label="Nome" />
              <Toggle on={!!config.show_email} onToggle={() => setConfigKey('show_email', !config.show_email)} label="E-mail" />
              <Toggle on={!!config.show_phone} onToggle={() => setConfigKey('show_phone', !config.show_phone)} label="Telefone" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Texto do botão de envio</label>
            <input value={config.submit_text ?? ''} onChange={e => setConfigKey('submit_text', e.target.value)} className={inputCls} placeholder="Ver meu resultado →" />
          </div>
        </>
      )}

      {/* Result */}
      {block.type === 'result' && (
        <>
          <div>
            <label className={labelCls}>Título</label>
            <input value={config.title ?? ''} onChange={e => setConfigKey('title', e.target.value)} className={inputCls} placeholder="Parabéns!" />
          </div>
          <div>
            <label className={labelCls}>Descrição</label>
            <textarea value={config.description ?? ''} onChange={e => setConfigKey('description', e.target.value)}
              rows={4} className={inputCls + ' resize-none'} placeholder="Baseado nas suas respostas... Use {{score}} para pontuação." />
          </div>
          <div>
            <label className={labelCls}>Texto do botão CTA</label>
            <input value={config.cta_text ?? ''} onChange={e => setConfigKey('cta_text', e.target.value)} className={inputCls} placeholder="Acessar agora" />
          </div>
          <div>
            <label className={labelCls}>URL do CTA</label>
            <input value={config.cta_url ?? ''} onChange={e => setConfigKey('cta_url', e.target.value)} className={inputCls} placeholder="https://..." />
          </div>
          {funnels.length > 0 && (
            <div>
              <label className={labelCls}>Ativar funil (opcional)</label>
              <select value={config.funnel_id ?? ''} onChange={e => setConfigKey('funnel_id', e.target.value || undefined)} className={inputCls}>
                <option value="">Nenhum</option>
                {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          <div className={sectionCls}>
            <Toggle on={!!config.show_score} onToggle={() => setConfigKey('show_score', !config.show_score)} label="Mostrar pontuação total" />
            {config.show_score && (
              <input value={config.score_display_text ?? 'Você fez {{score}} pontos!'} onChange={e => setConfigKey('score_display_text', e.target.value)}
                className={inputCls + ' mt-2'} placeholder="Você fez {{score}} pontos!" />
            )}
          </div>
          <div className={sectionCls}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-500">Roteamento por pontuação</label>
              <button onClick={() => {
                const ranges = config.score_ranges ?? []
                setConfigKey('score_ranges', [...ranges, { min: 0, max: 100, goto_page_id: null }])
              }} className="text-xs text-indigo-600 font-medium">+ Faixa</button>
            </div>
            {(config.score_ranges ?? []).map((range, i) => (
              <div key={i} className="flex items-center gap-1.5 mb-1.5">
                <input type="number" value={range.min}
                  onChange={e => setConfigKey('score_ranges', (config.score_ranges ?? []).map((r, j) => j === i ? { ...r, min: Number(e.target.value) } : r))}
                  className="w-14 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none" />
                <span className="text-xs text-gray-400">–</span>
                <input type="number" value={range.max}
                  onChange={e => setConfigKey('score_ranges', (config.score_ranges ?? []).map((r, j) => j === i ? { ...r, max: Number(e.target.value) } : r))}
                  className="w-14 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none" />
                <span className="text-[10px] text-gray-400 shrink-0">pts → pg:</span>
                <select value={range.goto_page_id ?? ''}
                  onChange={e => setConfigKey('score_ranges', (config.score_ranges ?? []).map((r, j) => j === i ? { ...r, goto_page_id: e.target.value || null } : r))}
                  className="flex-1 text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none min-w-0">
                  <option value="">Próxima</option>
                  {pages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                <button onClick={() => setConfigKey('score_ranges', (config.score_ranges ?? []).filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">×</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Background color for choice blocks */}
      {(isChoice || block.type === 'scale') && (
        <div className={sectionCls}>
          <label className={labelCls}>Cor de fundo</label>
          <div className="flex gap-2 flex-wrap">
            {['#ffffff','#f8f7ff','#f0fdf4','#fffbeb','#fdf2f8','#f0f9ff'].map(c => (
              <button key={c} onClick={() => setConfigKey('bg_color', c)}
                style={{ background: c, borderColor: config.bg_color === c ? '#6366f1' : '#e5e7eb' }}
                className="w-7 h-7 rounded-full border-2 transition" />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RightPanel({
  selectedBlockId, pages, settings, funnels, onUpdateBlock, onUpdateSettings,
}: {
  selectedBlockId: string | null
  pages: QuizPage[]
  settings: QuizData['settings']
  funnels: { id: string; name: string }[]
  onUpdateBlock: (blockId: string, config: Partial<BlockConfig>) => void
  onUpdateSettings: (patch: Partial<QuizData['settings']>) => void
}) {
  let selectedBlock: QuizBlock | null = null
  if (selectedBlockId) {
    for (const p of pages) {
      const b = p.blocks.find(b => b.id === selectedBlockId)
      if (b) { selectedBlock = b; break }
    }
  }

  const meta = selectedBlock ? BLOCK_META[selectedBlock.type] : null

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0">
      {selectedBlock ? (
        <>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <span className="text-base">{meta!.icon}</span>
            <p className="text-sm font-semibold text-gray-800">{meta!.label}</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <BlockEditor
              block={selectedBlock}
              pages={pages}
              funnels={funnels}
              onChange={config => onUpdateBlock(selectedBlock!.id, config)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-800">Configurações</p>
            <p className="text-xs text-gray-400">Selecione um bloco para editá-lo</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <RightPanelEmpty settings={settings} onUpdateSettings={onUpdateSettings} />
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main Editor ──────────────────────────────────────────────────────────────

interface Props {
  page: { id: string; title: string; slug: string | null; published: boolean }
  initialData?: QuizData
  funnels: { id: string; name: string }[]
  tenantId: string
}

export default function QuizEditorV2({ page, initialData, funnels }: Props) {
  const router = useRouter()
  const [data, setData] = useState<QuizData>(() => initialData ?? defaultQuiz(page.title))
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [activeId, setActiveId] = useState<string | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  // Auto-save
  useEffect(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => triggerSave(data), 2000)
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  async function triggerSave(d: QuizData) {
    setSaveStatus('saving')
    const result = await saveQuizV2(page.id, d)
    setSaveStatus(result.success ? 'saved' : 'error')
    setTimeout(() => setSaveStatus('idle'), 2500)
  }

  async function handlePublish() {
    setSaveStatus('saving')
    const saveResult = await saveQuizV2(page.id, data)
    if (!saveResult.success) { setSaveStatus('error'); return }
    const pubResult = await publishQuizV2(page.id)
    setSaveStatus(pubResult.success ? 'saved' : 'error')
    setTimeout(() => { setSaveStatus('idle'); router.refresh() }, 1500)
  }

  // State helpers
  function updateData(fn: (d: QuizData) => QuizData) {
    setData(prev => fn(prev))
  }
  function updatePages(fn: (pages: QuizPage[]) => QuizPage[]) {
    updateData(d => ({ ...d, pages: fn(d.pages) }))
  }
  function updateSettings(patch: Partial<QuizData['settings']>) {
    updateData(d => ({ ...d, settings: { ...d.settings, ...patch } }))
  }

  const addPage = useCallback(() => {
    const newPage: QuizPage = {
      id: newId(),
      title: `Página ${data.pages.length + 1}`,
      order: data.pages.length,
      blocks: [],
    }
    updatePages(pages => [...pages, newPage])
  }, [data.pages.length])

  const deletePage = useCallback((pageId: string) => {
    updatePages(pages => pages.filter(p => p.id !== pageId).map((p, i) => ({ ...p, order: i })))
    setSelectedBlockId(prev => {
      const inPage = data.pages.find(p => p.id === pageId)
      if (inPage?.blocks.some(b => b.id === prev)) return null
      return prev
    })
  }, [data.pages])

  const renamePageTitle = useCallback((pageId: string, title: string) => {
    updatePages(pages => pages.map(p => p.id === pageId ? { ...p, title } : p))
  }, [])

  const addBlock = useCallback((pageId: string, type: BlockType, insertBeforeBlockId?: string | null) => {
    const newBlock: QuizBlock = {
      id: newId(), type, order: 0, config: defaultConfig(type),
    }
    updatePages(pages => pages.map(p => {
      if (p.id !== pageId) return p
      let blocks: QuizBlock[]
      if (insertBeforeBlockId) {
        const idx = p.blocks.findIndex(b => b.id === insertBeforeBlockId)
        blocks = [...p.blocks]
        blocks.splice(idx >= 0 ? idx : p.blocks.length, 0, newBlock)
      } else {
        blocks = [...p.blocks, newBlock]
      }
      return { ...p, blocks: blocks.map((b, i) => ({ ...b, order: i })) }
    }))
    setSelectedBlockId(newBlock.id)
  }, [])

  const deleteBlock = useCallback((blockId: string) => {
    updatePages(pages => pages.map(p => ({
      ...p,
      blocks: p.blocks.filter(b => b.id !== blockId).map((b, i) => ({ ...b, order: i })),
    })))
    setSelectedBlockId(prev => prev === blockId ? null : prev)
  }, [])

  const updateBlock = useCallback((blockId: string, configPatch: Partial<BlockConfig>) => {
    updatePages(pages => pages.map(p => ({
      ...p,
      blocks: p.blocks.map(b => b.id === blockId ? { ...b, config: { ...b.config, ...configPatch } } : b),
    })))
  }, [])

  // DnD handlers
  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const activeStr = String(active.id)
    const overStr = String(over.id)

    // Drop from palette
    if (activeStr.startsWith('palette:')) {
      const type = activeStr.slice(8) as BlockType
      let targetPageId: string | null = null
      let insertBeforeId: string | null = null

      if (overStr.startsWith('page:')) {
        targetPageId = overStr.slice(5)
      } else {
        // Over a block
        for (const page of data.pages) {
          const block = page.blocks.find(b => b.id === overStr)
          if (block) {
            targetPageId = page.id
            insertBeforeId = block.id
            break
          }
        }
        // Over droppable page area
        if (!targetPageId && overStr.startsWith('page:')) {
          targetPageId = overStr.slice(5)
        }
      }

      if (!targetPageId && data.pages.length > 0) targetPageId = data.pages[0].id

      if (targetPageId) addBlock(targetPageId, type, insertBeforeId)
      return
    }

    // Reorder/move block
    const activeData = active.data.current as { pageId?: string } | undefined
    const overData = over.data.current as { pageId?: string; type?: string } | undefined

    if (!activeData?.pageId) return

    const sourcePageId = activeData.pageId
    let targetPageId = overData?.pageId ?? sourcePageId

    // If dropped on page droppable
    if (overStr.startsWith('page:')) targetPageId = overStr.slice(5)

    if (sourcePageId === targetPageId) {
      // Same page — reorder
      updatePages(pages => pages.map(p => {
        if (p.id !== sourcePageId) return p
        const oldIdx = p.blocks.findIndex(b => b.id === activeStr)
        const newIdx = p.blocks.findIndex(b => b.id === overStr)
        if (oldIdx < 0 || newIdx < 0) return p
        return { ...p, blocks: arrayMove(p.blocks, oldIdx, newIdx).map((b, i) => ({ ...b, order: i })) }
      }))
    } else {
      // Different page — move
      updatePages(pages => {
        const block = pages.find(p => p.id === sourcePageId)?.blocks.find(b => b.id === activeStr)
        if (!block) return pages
        return pages.map(p => {
          if (p.id === sourcePageId) return { ...p, blocks: p.blocks.filter(b => b.id !== activeStr) }
          if (p.id === targetPageId) {
            const insertIdx = p.blocks.findIndex(b => b.id === overStr)
            const newBlocks = [...p.blocks]
            newBlocks.splice(insertIdx >= 0 ? insertIdx : newBlocks.length, 0, block)
            return { ...p, blocks: newBlocks.map((b, i) => ({ ...b, order: i })) }
          }
          return p
        })
      })
    }
  }

  // Active drag preview
  function getActiveMeta() {
    if (!activeId) return null
    if (activeId.startsWith('palette:')) return BLOCK_META[activeId.slice(8) as BlockType]
    for (const p of data.pages) {
      const b = p.blocks.find(blk => blk.id === activeId)
      if (b) return BLOCK_META[b.type]
    }
    return null
  }
  const activeMeta = getActiveMeta()

  const saveLabel = saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'saved' ? '✓ Salvo!' : saveStatus === 'error' ? 'Erro' : 'Salvar'

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ height: '100vh' }} className="flex flex-col bg-gray-50 overflow-hidden">
        {/* Header */}
        <div className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0 z-10">
          <button onClick={() => router.push('/pages')} className="text-gray-500 hover:text-gray-700 shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h1 className="text-sm font-semibold text-gray-900 truncate flex-1 min-w-0">{page.title}</h1>
          <span className="text-xs text-gray-400 shrink-0">Editor de Quiz</span>
          <div className="flex items-center gap-2 shrink-0">
            {page.published && page.slug && (
              <a href={`/pg/${page.slug}`} target="_blank" rel="noopener noreferrer"
                className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                Visualizar ↗
              </a>
            )}
            <button onClick={() => triggerSave(data)} disabled={saveStatus === 'saving'}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                saveStatus === 'saved' ? 'bg-emerald-100 text-emerald-700' :
                saveStatus === 'error' ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}>
              {saveLabel}
            </button>
            <button onClick={handlePublish} disabled={saveStatus === 'saving'}
              className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-50">
              {page.published ? 'Republicar' : 'Publicar'}
            </button>
          </div>
        </div>

        {/* 3-column layout */}
        <div className="flex flex-1 overflow-hidden">
          <LeftPanel />
          <CenterPanel
            pages={data.pages}
            selectedId={selectedBlockId}
            onSelectBlock={setSelectedBlockId}
            onDeleteBlock={deleteBlock}
            onDeletePage={deletePage}
            onRenamePageTitle={renamePageTitle}
            onAddPage={addPage}
          />
          <RightPanel
            selectedBlockId={selectedBlockId}
            pages={data.pages}
            settings={data.settings}
            funnels={funnels}
            onUpdateBlock={updateBlock}
            onUpdateSettings={updateSettings}
          />
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay dropAnimation={null}>
        {activeId && activeMeta && (
          <div className="bg-white border-2 border-indigo-400 rounded-xl px-3 py-2 shadow-xl flex items-center gap-2 text-sm font-medium text-gray-700 pointer-events-none">
            <span>{activeMeta.icon}</span>
            <span>{activeMeta.label}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
