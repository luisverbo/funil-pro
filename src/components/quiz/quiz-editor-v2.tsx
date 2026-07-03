'use client'

import React, { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react'
import { useRouter } from 'next/navigation'

const QuizLeadsView = lazy(() => import('@/components/quiz/quiz-leads-view'))
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
  type QuizTheme, type TestimonialItem, type FeatureItem, type FaqItem,
} from '@/app/actions/quiz-v2'
import { THEME_PRESETS } from '@/lib/quiz/theme'
import ImageUploadField from '@/components/quiz/image-upload-field'
import RichTextField from '@/components/quiz/rich-text-field'
import type { PricingItem, ChecklistItem, CarouselItem, MetricItem, ChartDatum, NotificationItem } from '@/app/actions/quiz-v2'

// ─── Metadata ─────────────────────────────────────────────────────────────────

const BLOCK_META: Record<BlockType, { label: string; icon: string; category: string }> = {
  field_text:     { label: 'Campo texto',      icon: '📝', category: 'Formulário' },
  field_email:    { label: 'E-mail',           icon: '✉️',  category: 'Formulário' },
  field_phone:    { label: 'Telefone',         icon: '📱', category: 'Formulário' },
  field_number:   { label: 'Número',           icon: '🔢', category: 'Formulário' },
  field_textarea: { label: 'Textarea',         icon: '📄', category: 'Formulário' },
  field_date:     { label: 'Data',             icon: '📅', category: 'Formulário' },
  field_height:   { label: 'Altura',           icon: '📏', category: 'Formulário' },
  field_weight:   { label: 'Peso',             icon: '⚖️',  category: 'Formulário' },
  single_choice:  { label: 'Escolha única',    icon: '🔘', category: 'Quiz' },
  multi_choice:   { label: 'Múltipla escolha', icon: '☑️',  category: 'Quiz' },
  yes_no:         { label: 'Sim / Não',        icon: '👍', category: 'Quiz' },
  scale:          { label: 'Escala 1-10',      icon: '📊', category: 'Quiz' },
  video_answer:   { label: 'Vídeo resposta',   icon: '🎬', category: 'Quiz' },
  text_block:     { label: 'Texto',            icon: '📰', category: 'Mídia e conteúdo' },
  image:          { label: 'Imagem',           icon: '🖼️', category: 'Mídia e conteúdo' },
  video:          { label: 'Vídeo',            icon: '▶️',  category: 'Mídia e conteúdo' },
  audio:          { label: 'Áudio',            icon: '🔊', category: 'Mídia e conteúdo' },
  button:         { label: 'Botão',            icon: '🔲', category: 'Ação' },
  final_capture:  { label: 'Captura final',    icon: '🏆', category: 'Ação' },
  result:         { label: 'Resultado',        icon: '🎉', category: 'Ação' },
  hero:           { label: 'Hero',             icon: '🚀', category: 'Landing' },
  testimonials:   { label: 'Depoimentos',      icon: '💬', category: 'Landing' },
  features:       { label: 'Benefícios',       icon: '✨', category: 'Landing' },
  faq:            { label: 'FAQ',              icon: '❓', category: 'Landing' },
  countdown:      { label: 'Contagem',         icon: '⏰', category: 'Landing' },
  pricing:        { label: 'Preço',            icon: '💰', category: 'Landing' },
  alert:          { label: 'Alerta',           icon: '⚠️',  category: 'Atenção' },
  notification:   { label: 'Notificação',      icon: '🔔', category: 'Atenção' },
  loading:        { label: 'Loading',          icon: '⏳', category: 'Atenção' },
  level:          { label: 'Nível',            icon: '📶', category: 'Atenção' },
  checklist:      { label: 'Checklist',        icon: '✅', category: 'Estrutura' },
  before_after:   { label: 'Antes / Depois',   icon: '🔀', category: 'Estrutura' },
  carousel:       { label: 'Carrossel',        icon: '🎠', category: 'Estrutura' },
  metrics:        { label: 'Métricas',         icon: '🔢', category: 'Gráficos' },
  chart:          { label: 'Gráficos',         icon: '📈', category: 'Gráficos' },
  spacer:         { label: 'Espaço',           icon: '↕️',  category: 'Personalização' },
  html_embed:     { label: 'HTML / Script',    icon: '</>', category: 'Personalização' },
}

const CATEGORIES = ['Formulário', 'Quiz', 'Mídia e conteúdo', 'Ação', 'Landing', 'Atenção', 'Estrutura', 'Gráficos', 'Personalização']

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
    case 'final_capture': return { show_name: true, show_email: true, show_phone: false, submit_text: 'Ver meu resultado →', pixel_event: 'Lead' }
    case 'result':        return { title: 'Parabéns!', description: '', show_score: false, cta_text: 'Acessar agora', cta_url: '' }
    case 'hero': return {
      hero_headline: 'Sua headline impactante aqui',
      hero_subheadline: 'Explique em uma frase o valor da sua oferta',
      hero_cta_text: 'Quero começar →',
      hero_cta_action: 'next_page',
      hero_align: 'center',
    }
    case 'testimonials': return {
      testimonials_title: 'O que dizem nossos alunos',
      testimonials: [
        { id: newId(), name: 'Maria Silva', text: 'Resultado incrível em poucas semanas. Recomendo demais!', stars: 5 },
        { id: newId(), name: 'João Santos', text: 'Melhor investimento que já fiz. Superou minhas expectativas.', stars: 5 },
      ],
    }
    case 'features': return {
      features_title: 'O que você vai receber',
      features_columns: 3,
      features: [
        { id: newId(), icon: '🎯', title: 'Benefício 1', description: 'Descreva o benefício' },
        { id: newId(), icon: '⚡', title: 'Benefício 2', description: 'Descreva o benefício' },
        { id: newId(), icon: '🏆', title: 'Benefício 3', description: 'Descreva o benefício' },
      ],
    }
    case 'faq': return {
      faq_title: 'Perguntas frequentes',
      faq_items: [
        { id: newId(), question: 'Como funciona?', answer: 'Explique aqui como funciona.' },
        { id: newId(), question: 'Quanto tempo leva?', answer: 'Explique o prazo aqui.' },
      ],
    }
    case 'countdown': return {
      countdown_mode: 'evergreen',
      countdown_minutes: 15,
      countdown_text: '🔥 Oferta expira em:',
      countdown_expired_text: 'Oferta encerrada',
    }
    case 'field_date':   return { label: 'Qual sua data de nascimento?', required: false }
    case 'field_height': return { label: 'Qual sua altura? (cm)', placeholder: '170', required: false }
    case 'field_weight': return { label: 'Qual seu peso? (kg)', placeholder: '70', required: false }
    case 'video_answer': return {
      question: 'Assista e escolha', video_answer_url: '', required: true,
      options: [
        { id: newId(), label: 'Opção A', points: 0 },
        { id: newId(), label: 'Opção B', points: 0 },
      ],
    }
    case 'audio': return { audio_url: '', audio_title: '' }
    case 'alert': return { alert_text: 'Atenção: vagas limitadas!', alert_variant: 'warning' }
    case 'notification': return {
      notification_interval: 5,
      notification_items: [
        { id: newId(), text: 'Maria acabou de se inscrever 🎉' },
        { id: newId(), text: 'João garantiu a vaga há 2 min' },
      ],
    }
    case 'loading': return { loading_text: 'Analisando suas respostas...', loading_seconds: 3, loading_auto_advance: true }
    case 'level': return { level_label: 'Seu nível', level_percent: 70, level_color: '#6366f1' }
    case 'pricing': return {
      pricing_title: 'Plano Completo', pricing_price: 'R$ 197', pricing_period: '/mês',
      pricing_cta_text: 'Quero esse plano', pricing_highlight: true,
      pricing_items: [
        { id: newId(), text: 'Acesso completo', included: true },
        { id: newId(), text: 'Suporte prioritário', included: true },
        { id: newId(), text: 'Atualizações grátis', included: true },
      ],
    }
    case 'checklist': return {
      checklist_title: 'O que você vai conquistar',
      checklist_items: [
        { id: newId(), text: 'Resultado 1' },
        { id: newId(), text: 'Resultado 2' },
        { id: newId(), text: 'Resultado 3' },
      ],
    }
    case 'before_after': return { before_image_url: '', after_image_url: '', before_label: 'Antes', after_label: 'Depois' }
    case 'carousel': return { carousel_items: [] }
    case 'metrics': return {
      metrics_items: [
        { id: newId(), value: '10.000', suffix: '+', label: 'Clientes' },
        { id: newId(), value: '98', suffix: '%', label: 'Satisfação' },
        { id: newId(), value: '4.9', label: 'Nota média' },
      ],
    }
    case 'chart': return {
      chart_title: 'Resultados', chart_type: 'bar',
      chart_data: [
        { id: newId(), label: 'Antes', value: 30, color: '#ef4444' },
        { id: newId(), label: 'Depois', value: 90, color: '#10b981' },
      ],
    }
    case 'spacer': return { spacer_height: 40 }
    case 'html_embed': return { html_content: '<!-- Cole seu código HTML/embed aqui -->' }
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
      blocks: [],
    }],
    settings: { title: pageTitle, primary_color: '#6366f1', show_progress: true },
  }
}

// ─── Block Palette (left) ─────────────────────────────────────────────────────

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
    <div className="w-48 bg-white border-r border-gray-200 overflow-y-auto shrink-0 flex flex-col">
      <div className="px-3 py-3 border-b border-gray-100">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Blocos</p>
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
              <div className="px-1 space-y-0.5">
                {types.map(type => <PaletteItem key={type} type={type} />)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Pages Panel (second column) ─────────────────────────────────────────────

function SortablePageItem({
  page,
  index,
  isActive,
  onSelect,
  onRename,
  onDuplicate,
  onDelete,
}: {
  page: QuizPage
  index: number
  isActive: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `sortpage:${page.id}`,
    data: { type: 'page-item', pageId: page.id },
  })
  const style = { transform: CSS.Transform.toString(transform), transition }

  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(page.title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(page.title) }, [page.title])
  useEffect(() => { if (renaming) inputRef.current?.select() }, [renaming])

  function commitRename() {
    onRename(draft.trim() || page.title)
    setRenaming(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex items-center gap-1 px-2 py-2 rounded-lg cursor-pointer transition select-none ${isDragging ? 'opacity-40' : ''} ${isActive ? 'bg-indigo-50 border border-indigo-200' : 'hover:bg-gray-50 border border-transparent'}`}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        onClick={e => e.stopPropagation()}
        className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0 p-0.5"
      >
        <svg viewBox="0 0 8 12" fill="currentColor" className="w-2.5 h-3">
          <circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/>
          <circle cx="2" cy="6" r="1.2"/><circle cx="6" cy="6" r="1.2"/>
          <circle cx="2" cy="10" r="1.2"/><circle cx="6" cy="10" r="1.2"/>
        </svg>
      </div>

      {/* Number badge */}
      <div className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${isActive ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
        {index + 1}
      </div>

      {/* Title / rename input */}
      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setDraft(page.title); setRenaming(false) } }}
          onClick={e => e.stopPropagation()}
          className="flex-1 text-xs border border-indigo-300 rounded px-1 py-0.5 focus:outline-none min-w-0"
        />
      ) : (
        <span
          className={`flex-1 text-xs truncate min-w-0 ${isActive ? 'text-indigo-700 font-medium' : 'text-gray-700'}`}
          onDoubleClick={e => { e.stopPropagation(); setRenaming(true) }}
        >
          {page.title}
        </span>
      )}

      {/* Menu button */}
      <div className="relative shrink-0">
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v) }}
          className={`w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition text-xs ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >⋮</button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-6 z-50 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-32">
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(false); setRenaming(true) }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >Renomear</button>
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDuplicate() }}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
              >Duplicar</button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
              >Excluir</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function PagesPanel({
  pages,
  selectedPageId,
  onSelectPage,
  onAddPage,
  onRename,
  onDuplicate,
  onDelete,
}: {
  pages: QuizPage[]
  selectedPageId: string
  onSelectPage: (id: string) => void
  onAddPage: () => void
  onRename: (pageId: string, title: string) => void
  onDuplicate: (pageId: string) => void
  onDelete: (pageId: string) => void
}) {
  return (
    <div className="w-[180px] bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-hidden">
      <div className="px-3 py-3 border-b border-gray-100 shrink-0">
        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Páginas</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{pages.length} {pages.length === 1 ? 'página' : 'páginas'}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        <SortableContext
          items={pages.map(p => `sortpage:${p.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {pages.map((page, i) => (
            <SortablePageItem
              key={page.id}
              page={page}
              index={i}
              isActive={page.id === selectedPageId}
              onSelect={() => onSelectPage(page.id)}
              onRename={title => onRename(page.id, title)}
              onDuplicate={() => onDuplicate(page.id)}
              onDelete={() => onDelete(page.id)}
            />
          ))}
        </SortableContext>
      </div>

      <div className="p-2 border-t border-gray-100 shrink-0">
        <button
          onClick={onAddPage}
          className="w-full py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded-lg transition border border-dashed border-indigo-200 hover:border-indigo-400"
        >
          + Nova página
        </button>
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
    const sizeCls = config.button_size === 'sm'
      ? 'px-3 py-1.5 text-xs'
      : config.button_size === 'lg'
      ? 'px-8 py-3.5 text-base w-full'
      : 'px-5 py-2.5 text-sm'
    summary = (
      <div className={`flex ${config.button_align === 'left' ? 'justify-start' : config.button_align === 'right' ? 'justify-end' : 'justify-center'}`}>
        <div
          className={`font-semibold text-white rounded-xl shadow-sm ${sizeCls}`}
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
  } else if (block.type === 'hero') {
    summary = (
      <div className={config.hero_align === 'left' ? 'text-left' : 'text-center'}>
        {config.hero_image_url && <img src={config.hero_image_url} alt="" className="w-full max-h-20 object-cover rounded mb-2" />}
        <p className="text-sm font-extrabold text-gray-900 line-clamp-2">{config.hero_headline || 'Headline'}</p>
        {config.hero_subheadline && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{config.hero_subheadline}</p>}
        {config.hero_cta_text && (
          <div className="mt-2 inline-block px-4 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-xl">{config.hero_cta_text}</div>
        )}
      </div>
    )
  } else if (block.type === 'testimonials') {
    summary = (
      <div>
        <p className="text-xs font-bold text-gray-700 mb-1.5">{config.testimonials_title || 'Depoimentos'}</p>
        {(config.testimonials ?? []).slice(0, 2).map(t => (
          <div key={t.id} className="flex items-start gap-1.5 text-xs text-gray-600 mb-1">
            {t.photo_url
              ? <img src={t.photo_url} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
              : <div className="w-5 h-5 rounded-full bg-gray-200 shrink-0" />}
            <div className="min-w-0">
              <span className="font-semibold text-gray-700">{t.name}</span>
              <span className="text-amber-400 ml-1">{'★'.repeat(t.stars ?? 5)}</span>
              <p className="line-clamp-1 text-gray-500">{t.text}</p>
            </div>
          </div>
        ))}
      </div>
    )
  } else if (block.type === 'features') {
    summary = (
      <div>
        <p className="text-xs font-bold text-gray-700 mb-1.5">{config.features_title || 'Benefícios'}</p>
        <div className="grid grid-cols-3 gap-1">
          {(config.features ?? []).slice(0, 3).map(f => (
            <div key={f.id} className="border border-gray-100 rounded p-1 text-center">
              <div className="text-sm">{f.icon || '✨'}</div>
              <p className="text-[9px] font-medium text-gray-600 line-clamp-1">{f.title}</p>
            </div>
          ))}
        </div>
      </div>
    )
  } else if (block.type === 'faq') {
    summary = (
      <div>
        <p className="text-xs font-bold text-gray-700 mb-1">{config.faq_title || 'FAQ'}</p>
        {(config.faq_items ?? []).slice(0, 3).map(f => (
          <div key={f.id} className="text-xs text-gray-500 flex items-center gap-1 py-0.5 border-b border-gray-50">
            <span className="text-gray-300">▸</span>
            <span className="line-clamp-1">{f.question}</span>
          </div>
        ))}
      </div>
    )
  } else if (block.type === 'countdown') {
    summary = (
      <div className="text-center">
        <p className="text-xs text-gray-600 mb-1">{config.countdown_text || 'Oferta expira em:'}</p>
        <div className="flex gap-1 justify-center">
          {['00','14','59'].map((v, i) => (
            <div key={i} className="bg-gray-900 text-white text-xs font-mono font-bold rounded px-1.5 py-1">{v}</div>
          ))}
        </div>
      </div>
    )
  } else if (['field_date','field_height','field_weight'].includes(block.type)) {
    summary = (
      <div>
        <p className="text-xs text-gray-500 font-medium">{config.label || meta.label}</p>
        <div className="mt-1.5 w-full border border-gray-200 rounded px-2 py-1.5 text-xs text-gray-400 bg-gray-50">
          {block.type === 'field_date' ? 'dd/mm/aaaa' : config.placeholder || (block.type === 'field_height' ? '170 cm' : '70 kg')}
        </div>
      </div>
    )
  } else if (block.type === 'video_answer') {
    summary = (
      <div>
        <div className="w-full h-12 bg-gray-900 rounded flex items-center justify-center mb-1.5"><span className="text-white">🎬</span></div>
        <p className="text-sm font-semibold text-gray-800 line-clamp-1">{config.question || 'Vídeo + opções'}</p>
      </div>
    )
  } else if (block.type === 'audio') {
    summary = (
      <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
        <span className="text-lg">🔊</span>
        <span className="text-xs text-gray-500 truncate">{config.audio_title || config.audio_url || 'Áudio'}</span>
      </div>
    )
  } else if (block.type === 'alert') {
    const vc = { info: 'bg-blue-50 text-blue-700', success: 'bg-emerald-50 text-emerald-700', warning: 'bg-amber-50 text-amber-700', danger: 'bg-red-50 text-red-700' }[config.alert_variant ?? 'warning']
    summary = <div className={`text-xs rounded-lg px-3 py-2 ${vc}`}>{config.alert_text || 'Mensagem de alerta'}</div>
  } else if (block.type === 'notification') {
    summary = (
      <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-2 py-1.5 shadow-sm">
        <span>🔔</span>
        <span className="text-xs text-gray-600 truncate">{config.notification_items?.[0]?.text || 'Prova social'}</span>
      </div>
    )
  } else if (block.type === 'loading') {
    summary = (
      <div className="text-center">
        <div className="inline-block w-5 h-5 border-2 border-gray-300 border-t-indigo-500 rounded-full animate-spin mb-1" />
        <p className="text-xs text-gray-500">{config.loading_text || 'Carregando...'}</p>
      </div>
    )
  } else if (block.type === 'level') {
    summary = (
      <div>
        <p className="text-xs text-gray-600 mb-1">{config.level_label || 'Nível'} · {config.level_percent ?? 70}%</p>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${config.level_percent ?? 70}%`, background: config.level_color || '#6366f1' }} />
        </div>
      </div>
    )
  } else if (block.type === 'pricing') {
    summary = (
      <div className="border border-gray-200 rounded-lg p-2 text-center">
        <p className="text-xs font-semibold text-gray-700">{config.pricing_title || 'Plano'}</p>
        <p className="text-lg font-extrabold text-gray-900">{config.pricing_price || 'R$ 0'}<span className="text-[10px] text-gray-400">{config.pricing_period}</span></p>
        {config.pricing_cta_text && <div className="mt-1 text-[10px] bg-indigo-600 text-white rounded px-2 py-1 inline-block">{config.pricing_cta_text}</div>}
      </div>
    )
  } else if (block.type === 'checklist') {
    summary = (
      <div>
        {config.checklist_title && <p className="text-xs font-semibold text-gray-700 mb-1">{config.checklist_title}</p>}
        {(config.checklist_items ?? []).slice(0, 3).map(i => (
          <div key={i.id} className="flex items-center gap-1.5 text-xs text-gray-600"><span className="text-emerald-500">✓</span>{i.text}</div>
        ))}
      </div>
    )
  } else if (block.type === 'before_after') {
    summary = (
      <div className="grid grid-cols-2 gap-1">
        {[config.before_image_url, config.after_image_url].map((img, i) => (
          img ? <img key={i} src={img} alt="" className="w-full h-12 object-cover rounded" />
              : <div key={i} className="w-full h-12 bg-gray-100 rounded flex items-center justify-center text-[10px] text-gray-400">{i === 0 ? 'Antes' : 'Depois'}</div>
        ))}
      </div>
    )
  } else if (block.type === 'carousel') {
    summary = (
      <div className="flex gap-1 overflow-hidden">
        {(config.carousel_items ?? []).length > 0
          ? (config.carousel_items ?? []).slice(0, 3).map(c => <img key={c.id} src={c.image_url} alt="" className="w-1/3 h-12 object-cover rounded" />)
          : <div className="w-full h-12 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400">Carrossel vazio</div>}
      </div>
    )
  } else if (block.type === 'metrics') {
    summary = (
      <div className="grid grid-cols-3 gap-1 text-center">
        {(config.metrics_items ?? []).slice(0, 3).map(m => (
          <div key={m.id}><p className="text-sm font-extrabold text-gray-900">{m.value}{m.suffix}</p><p className="text-[9px] text-gray-500 line-clamp-1">{m.label}</p></div>
        ))}
      </div>
    )
  } else if (block.type === 'chart') {
    summary = (
      <div className="flex items-end gap-1 h-12">
        {(config.chart_data ?? []).slice(0, 4).map(d => (
          <div key={d.id} className="flex-1 rounded-t" style={{ height: `${Math.min(100, d.value)}%`, background: d.color || '#6366f1' }} />
        ))}
      </div>
    )
  } else if (block.type === 'spacer') {
    summary = <div className="text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded py-2">Espaço · {config.spacer_height ?? 40}px</div>
  } else if (block.type === 'html_embed') {
    summary = <div className="text-xs text-gray-500 font-mono bg-gray-50 rounded px-2 py-1.5 truncate">{'</> '}{(config.html_content || 'HTML').slice(0, 40)}</div>
  }

  return (
    <div className="flex items-start gap-2">
      <span className="text-base mt-0.5 shrink-0">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full mb-1.5 inline-block ${
          meta.category === 'Quiz' ? 'bg-indigo-100 text-indigo-600' :
          meta.category === 'Formulário' ? 'bg-blue-100 text-blue-600' :
          meta.category === 'Ação' ? 'bg-green-100 text-green-600' :
          meta.category === 'Landing' ? 'bg-purple-100 text-purple-600' :
          meta.category === 'Atenção' ? 'bg-amber-100 text-amber-600' :
          meta.category === 'Gráficos' ? 'bg-cyan-100 text-cyan-600' :
          meta.category === 'Estrutura' ? 'bg-pink-100 text-pink-600' :
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
      <div className="pl-8 pr-10 py-3">
        <BlockPreview block={block} pages={pages} />
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="absolute right-2 top-2 w-6 h-6 rounded-lg bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition text-base leading-none"
      >×</button>
    </div>
  )
}

// ─── Center Panel (active page blocks) ───────────────────────────────────────

function ActivePageView({
  page, pages, selectedId, onSelectBlock, onDeleteBlock,
}: {
  page: QuizPage
  pages: QuizPage[]
  selectedId: string | null
  onSelectBlock: (blockId: string) => void
  onDeleteBlock: (blockId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `page:${page.id}`, data: { type: 'page', pageId: page.id } })

  return (
    <div ref={setNodeRef} className={`min-h-40 transition-colors rounded-2xl ${isOver ? 'bg-indigo-50 ring-2 ring-indigo-200' : ''}`}>
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
          <div className={`h-32 rounded-xl border-2 border-dashed flex items-center justify-center transition-colors ${isOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-gray-50'}`}>
            <p className={`text-xs ${isOver ? 'text-indigo-500' : 'text-gray-400'}`}>
              {isOver ? 'Solte aqui' : 'Arraste blocos da paleta à esquerda'}
            </p>
          </div>
        )}
      </SortableContext>
    </div>
  )
}

function CenterPanel({
  activePage, pages, selectedId, onSelectBlock, onDeleteBlock,
}: {
  activePage: QuizPage | null
  pages: QuizPage[]
  selectedId: string | null
  onSelectBlock: (blockId: string) => void
  onDeleteBlock: (blockId: string) => void
}) {
  if (!activePage) {
    return (
      <div className="flex-1 bg-gray-100 flex items-center justify-center">
        <p className="text-sm text-gray-400">Selecione uma página na lista</p>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100">
      {/* Page title bar */}
      <div className="sticky top-0 z-10 bg-gray-100 border-b border-gray-200 px-6 py-3 flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
          <span className="text-[10px] font-bold text-indigo-600">{activePage.order + 1}</span>
        </div>
        <p className="text-sm font-semibold text-gray-800 truncate">{activePage.title}</p>
        <span className="text-xs text-gray-400 ml-auto">{activePage.blocks.length} {activePage.blocks.length === 1 ? 'bloco' : 'blocos'}</span>
      </div>

      <div className="max-w-xl mx-auto p-6">
        <ActivePageView
          page={activePage}
          pages={pages}
          selectedId={selectedId}
          onSelectBlock={onSelectBlock}
          onDeleteBlock={onDeleteBlock}
        />
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

const THEME_PRESET_PREVIEWS: Record<string, { bg: string; card: string; dark: boolean }> = {
  clean:    { bg: '#f8fafc', card: '#ffffff', dark: false },
  dark:     { bg: '#0f172a', card: '#1e293b', dark: true },
  gradient: { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', card: 'rgba(255,255,255,0.15)', dark: true },
  minimal:  { bg: '#ffffff', card: '#ffffff', dark: false },
  bold:     { bg: 'linear-gradient(160deg, #111827 0%, #1f2937 60%, #6366f1 140%)', card: '#1f2937', dark: true },
}

function RightPanelEmpty({ settings, onUpdateSettings }: {
  settings: QuizData['settings']
  onUpdateSettings: (s: Partial<QuizData['settings']>) => void
}) {
  const [tab, setTab] = useState<'general' | 'design'>('general')
  const theme = settings.theme ?? {}
  function setTheme(patch: Partial<QuizTheme>) {
    onUpdateSettings({ theme: { ...theme, ...patch } })
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs font-medium">
        {(['general','design'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-1.5 transition ${tab === t ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            {t === 'general' ? '⚙️ Geral' : '🎨 Design'}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
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
          <div className="border-t border-gray-100 pt-3">
            <label className={labelCls}>Pixel Meta deste quiz (opcional)</label>
            <input value={settings.pixel_id ?? ''} onChange={e => onUpdateSettings({ pixel_id: e.target.value || undefined })}
              className={inputCls + ' font-mono text-xs'} placeholder="123456789012345" />
            <p className="text-[10px] text-gray-400 mt-1">Vazio = usa o pixel global das Configurações</p>
          </div>
        </>
      )}

      {tab === 'design' && (
        <>
          <div>
            <label className={labelCls}>Tema</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(THEME_PRESETS).map(([key, preset]) => {
                const pv = THEME_PRESET_PREVIEWS[key]
                const active = theme.preset === key
                return (
                  <button key={key} onClick={() => setTheme({ ...preset, preset: preset.preset })}
                    className={`rounded-lg border-2 p-1.5 transition text-left ${active ? 'border-indigo-500' : 'border-gray-200 hover:border-indigo-300'}`}>
                    <div className="h-12 rounded-md mb-1 flex items-center justify-center" style={{ background: pv.bg }}>
                      <div className="w-3/4 h-6 rounded" style={{ background: pv.card, border: pv.dark ? '1px solid rgba(255,255,255,0.2)' : '1px solid #e5e7eb' }} />
                    </div>
                    <p className="text-[10px] font-semibold text-gray-700">{preset.label}</p>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className={labelCls}>Fonte</label>
            <select value={theme.font ?? 'inter'} onChange={e => setTheme({ font: e.target.value as QuizTheme['font'] })} className={inputCls}>
              <option value="inter">Inter (moderna)</option>
              <option value="poppins">Poppins (arredondada)</option>
              <option value="montserrat">Montserrat (forte)</option>
              <option value="playfair">Playfair (elegante/serif)</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Fundo</label>
            <div className="flex gap-2 mb-2">
              {(['color','gradient','image'] as const).map(t => (
                <button key={t} onClick={() => setTheme({ bg_type: t })}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${(theme.bg_type ?? 'color') === t ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                  {t === 'color' ? 'Cor' : t === 'gradient' ? 'Gradiente' : 'Imagem'}
                </button>
              ))}
            </div>
            {(theme.bg_type ?? 'color') === 'color' && (
              <input type="color" value={theme.bg_value?.startsWith('#') ? theme.bg_value : '#f8fafc'}
                onChange={e => setTheme({ bg_value: e.target.value })}
                className="w-full h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
            )}
            {theme.bg_type === 'gradient' && (
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                  'linear-gradient(160deg, #111827 0%, #6366f1 140%)',
                  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
                ].map(g => (
                  <button key={g} onClick={() => setTheme({ bg_value: g })}
                    style={{ background: g, outlineColor: theme.bg_value === g ? '#6366f1' : 'transparent' }}
                    className="h-10 rounded-lg outline-2 outline transition" />
                ))}
              </div>
            )}
            {theme.bg_type === 'image' && (
              <ImageUploadField value={theme.bg_value ?? ''} onChange={url => setTheme({ bg_value: url })} />
            )}
          </div>

          <div>
            <label className={labelCls}>Estilo dos cards</label>
            <div className="flex gap-2">
              {(['flat','shadow','glass'] as const).map(s => (
                <button key={s} onClick={() => setTheme({ card_style: s })}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${(theme.card_style ?? 'shadow') === s ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                  {s === 'flat' ? 'Flat' : s === 'shadow' ? 'Sombra' : 'Vidro'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls}>Cantos dos botões</label>
            <div className="flex gap-2">
              {(['none','md','full'] as const).map(r => (
                <button key={r} onClick={() => setTheme({ button_radius: r })}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${(theme.button_radius ?? 'md') === r ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                  {r === 'none' ? 'Reto' : r === 'md' ? 'Suave' : 'Redondo'}
                </button>
              ))}
            </div>
          </div>

          <Toggle on={!!theme.dark_mode} onToggle={() => setTheme({ dark_mode: !theme.dark_mode })} label="Modo escuro (texto claro)" />

          <div className="border-t border-gray-100 pt-3">
            <ImageUploadField label="Logo (topo do quiz)" value={settings.logo_url ?? ''} onChange={url => onUpdateSettings({ logo_url: url || undefined })} />
          </div>
        </>
      )}
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
            <ImageUploadField compact value={opt.image_url ?? ''} onChange={url => updateOpt(opt.id, { image_url: url || undefined })} />
          </div>
        ))}
      </div>
    </div>
  )
}

function BlockEditor({
  block, pages, currentPageId, funnels, onChange, onMoveToPage, precedingBlocks,
}: {
  block: QuizBlock
  pages: QuizPage[]
  currentPageId: string
  funnels: { id: string; name: string }[]
  onChange: (config: Partial<BlockConfig>) => void
  onMoveToPage: (targetPageId: string) => void
  precedingBlocks: QuizBlock[]
}) {
  const { config } = block
  const isChoice = ['single_choice', 'multi_choice', 'yes_no'].includes(block.type)

  function setConfig(patch: Partial<BlockConfig>) { onChange(patch) }
  function setConfigKey<K extends keyof BlockConfig>(key: K, val: BlockConfig[K]) { setConfig({ [key]: val }) }

  const sectionCls = 'border-t border-gray-100 pt-3'

  const otherPages = pages.filter(p => p.id !== currentPageId)

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
      {['field_text','field_email','field_phone','field_number','field_textarea','field_date','field_height','field_weight'].includes(block.type) && (
        <>
          <div>
            <label className={labelCls}>Label</label>
            <input value={config.label ?? ''} onChange={e => setConfigKey('label', e.target.value)} className={inputCls} placeholder="Texto da pergunta" />
          </div>
          {block.type !== 'field_date' && (
            <div>
              <label className={labelCls}>Placeholder</label>
              <input value={config.placeholder ?? ''} onChange={e => setConfigKey('placeholder', e.target.value)} className={inputCls} placeholder="Texto de exemplo..." />
            </div>
          )}
          <Toggle on={!!config.required} onToggle={() => setConfigKey('required', !config.required)} label="Obrigatório" />
        </>
      )}

      {/* Text block — editor rico flutuante */}
      {block.type === 'text_block' && (
        <div>
          <label className={labelCls}>Conteúdo</label>
          {/* key={block.id} força remontar ao trocar de bloco — senão o innerHTML (inicializado só no mount) mantém o texto do bloco anterior e o grava no novo */}
          <RichTextField key={block.id} value={config.content ?? ''} onChange={html => setConfigKey('content', html)} placeholder="Digite seu texto..." />
        </div>
      )}

      {/* Audio */}
      {block.type === 'audio' && (
        <>
          <ImageUploadField label="Arquivo de áudio (ou URL)" value={config.audio_url ?? ''} onChange={url => setConfigKey('audio_url', url)} />
          <div>
            <label className={labelCls}>Título (opcional)</label>
            <input value={config.audio_title ?? ''} onChange={e => setConfigKey('audio_title', e.target.value)} className={inputCls} placeholder="Nome do áudio" />
          </div>
          <p className="text-[10px] text-gray-400">Aceita URL .mp3/.ogg/.wav</p>
        </>
      )}

      {/* Video answer */}
      {block.type === 'video_answer' && (
        <>
          <div>
            <label className={labelCls}>Pergunta</label>
            <textarea value={config.question ?? ''} onChange={e => setConfigKey('question', e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Assista e escolha" />
          </div>
          <div>
            <label className={labelCls}>URL do vídeo (YouTube/Vimeo)</label>
            <input value={config.video_answer_url ?? ''} onChange={e => setConfigKey('video_answer_url', e.target.value)} className={inputCls} placeholder="https://youtube.com/..." />
          </div>
          <OptionList options={config.options ?? []} pages={pages} onChange={opts => setConfigKey('options', opts)} />
          <Toggle on={!!config.required} onToggle={() => setConfigKey('required', !config.required)} label="Resposta obrigatória" />
        </>
      )}

      {/* Alert */}
      {block.type === 'alert' && (
        <>
          <div>
            <label className={labelCls}>Mensagem</label>
            <textarea value={config.alert_text ?? ''} onChange={e => setConfigKey('alert_text', e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Texto do alerta" />
          </div>
          <div>
            <label className={labelCls}>Estilo</label>
            <div className="grid grid-cols-2 gap-2">
              {(['info','success','warning','danger'] as const).map(v => (
                <button key={v} onClick={() => setConfigKey('alert_variant', v)}
                  className={`py-1.5 text-xs rounded-lg border transition ${(config.alert_variant ?? 'warning') === v ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-medium' : 'border-gray-200 text-gray-600'}`}>
                  {v === 'info' ? 'Info' : v === 'success' ? 'Sucesso' : v === 'warning' ? 'Aviso' : 'Perigo'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Notification */}
      {block.type === 'notification' && (
        <>
          <div>
            <label className={labelCls}>Intervalo entre notificações (seg)</label>
            <input type="number" min={1} value={config.notification_interval ?? 5} onChange={e => setConfigKey('notification_interval', Number(e.target.value))} className={inputCls} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls.replace('mb-1.5','')}>Mensagens</label>
              <button onClick={() => setConfigKey('notification_items', [...(config.notification_items ?? []), { id: newId(), text: '' }])} className="text-xs text-indigo-600 font-medium">+ Adicionar</button>
            </div>
            {(config.notification_items ?? []).map((n: NotificationItem) => (
              <div key={n.id} className="flex items-center gap-1.5 mb-1.5">
                <input value={n.text} onChange={e => setConfigKey('notification_items', (config.notification_items ?? []).map(x => x.id === n.id ? { ...x, text: e.target.value } : x))}
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Fulano acabou de se inscrever" />
                <button onClick={() => setConfigKey('notification_items', (config.notification_items ?? []).filter(x => x.id !== n.id))} className="text-red-400 hover:text-red-600">×</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Loading */}
      {block.type === 'loading' && (
        <>
          <div>
            <label className={labelCls}>Texto</label>
            <input value={config.loading_text ?? ''} onChange={e => setConfigKey('loading_text', e.target.value)} className={inputCls} placeholder="Analisando suas respostas..." />
          </div>
          <div>
            <label className={labelCls}>Duração (segundos)</label>
            <input type="number" min={1} value={config.loading_seconds ?? 3} onChange={e => setConfigKey('loading_seconds', Number(e.target.value))} className={inputCls} />
          </div>
          <Toggle on={!!config.loading_auto_advance} onToggle={() => setConfigKey('loading_auto_advance', !config.loading_auto_advance)} label="Avançar para próxima página ao terminar" />
        </>
      )}

      {/* Level */}
      {block.type === 'level' && (
        <>
          <div>
            <label className={labelCls}>Rótulo</label>
            <input value={config.level_label ?? ''} onChange={e => setConfigKey('level_label', e.target.value)} className={inputCls} placeholder="Seu nível" />
          </div>
          <div>
            <label className={labelCls}>Percentual: {config.level_percent ?? 70}%</label>
            <input type="range" min={0} max={100} value={config.level_percent ?? 70} onChange={e => setConfigKey('level_percent', Number(e.target.value))} className="w-full" />
          </div>
          <div>
            <label className={labelCls}>Cor</label>
            <input type="color" value={config.level_color || '#6366f1'} onChange={e => setConfigKey('level_color', e.target.value)} className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5" />
          </div>
        </>
      )}

      {/* Pricing */}
      {block.type === 'pricing' && (
        <>
          <div>
            <label className={labelCls}>Título do plano</label>
            <input value={config.pricing_title ?? ''} onChange={e => setConfigKey('pricing_title', e.target.value)} className={inputCls} placeholder="Plano Completo" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Preço</label>
              <input value={config.pricing_price ?? ''} onChange={e => setConfigKey('pricing_price', e.target.value)} className={inputCls} placeholder="R$ 197" />
            </div>
            <div>
              <label className={labelCls}>Período</label>
              <input value={config.pricing_period ?? ''} onChange={e => setConfigKey('pricing_period', e.target.value)} className={inputCls} placeholder="/mês" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls.replace('mb-1.5','')}>Itens inclusos</label>
              <button onClick={() => setConfigKey('pricing_items', [...(config.pricing_items ?? []), { id: newId(), text: '', included: true }])} className="text-xs text-indigo-600 font-medium">+ Adicionar</button>
            </div>
            {(config.pricing_items ?? []).map((it: PricingItem) => (
              <div key={it.id} className="flex items-center gap-1.5 mb-1.5">
                <button onClick={() => setConfigKey('pricing_items', (config.pricing_items ?? []).map(x => x.id === it.id ? { ...x, included: !x.included } : x))}
                  className={`w-6 h-6 rounded shrink-0 text-xs ${it.included !== false ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'}`}>{it.included !== false ? '✓' : '×'}</button>
                <input value={it.text} onChange={e => setConfigKey('pricing_items', (config.pricing_items ?? []).map(x => x.id === it.id ? { ...x, text: e.target.value } : x))}
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Item" />
                <button onClick={() => setConfigKey('pricing_items', (config.pricing_items ?? []).filter(x => x.id !== it.id))} className="text-red-400 hover:text-red-600">×</button>
              </div>
            ))}
          </div>
          <div>
            <label className={labelCls}>Texto do botão</label>
            <input value={config.pricing_cta_text ?? ''} onChange={e => setConfigKey('pricing_cta_text', e.target.value)} className={inputCls} placeholder="Quero esse plano" />
          </div>
          <div>
            <label className={labelCls}>URL do botão</label>
            <input value={config.pricing_cta_url ?? ''} onChange={e => setConfigKey('pricing_cta_url', e.target.value)} className={inputCls} placeholder="https://..." />
          </div>
          <Toggle on={!!config.pricing_highlight} onToggle={() => setConfigKey('pricing_highlight', !config.pricing_highlight)} label="Destacar (borda colorida)" />
        </>
      )}

      {/* Checklist */}
      {block.type === 'checklist' && (
        <>
          <div>
            <label className={labelCls}>Título</label>
            <input value={config.checklist_title ?? ''} onChange={e => setConfigKey('checklist_title', e.target.value)} className={inputCls} placeholder="O que você vai conquistar" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls.replace('mb-1.5','')}>Itens</label>
              <button onClick={() => setConfigKey('checklist_items', [...(config.checklist_items ?? []), { id: newId(), text: '' }])} className="text-xs text-indigo-600 font-medium">+ Adicionar</button>
            </div>
            {(config.checklist_items ?? []).map((it: ChecklistItem) => (
              <div key={it.id} className="flex items-center gap-1.5 mb-1.5">
                <span className="text-emerald-500">✓</span>
                <input value={it.text} onChange={e => setConfigKey('checklist_items', (config.checklist_items ?? []).map(x => x.id === it.id ? { ...x, text: e.target.value } : x))}
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Item" />
                <button onClick={() => setConfigKey('checklist_items', (config.checklist_items ?? []).filter(x => x.id !== it.id))} className="text-red-400 hover:text-red-600">×</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Before/After */}
      {block.type === 'before_after' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Rótulo Antes</label>
              <input value={config.before_label ?? ''} onChange={e => setConfigKey('before_label', e.target.value)} className={inputCls} placeholder="Antes" />
            </div>
            <div>
              <label className={labelCls}>Rótulo Depois</label>
              <input value={config.after_label ?? ''} onChange={e => setConfigKey('after_label', e.target.value)} className={inputCls} placeholder="Depois" />
            </div>
          </div>
          <ImageUploadField label="Imagem Antes" value={config.before_image_url ?? ''} onChange={url => setConfigKey('before_image_url', url)} />
          <ImageUploadField label="Imagem Depois" value={config.after_image_url ?? ''} onChange={url => setConfigKey('after_image_url', url)} />
        </>
      )}

      {/* Carousel */}
      {block.type === 'carousel' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={labelCls.replace('mb-1.5','')}>Imagens do carrossel</label>
            <button onClick={() => setConfigKey('carousel_items', [...(config.carousel_items ?? []), { id: newId(), image_url: '' }])} className="text-xs text-indigo-600 font-medium">+ Adicionar</button>
          </div>
          <div className="space-y-2">
            {(config.carousel_items ?? []).map((c: CarouselItem) => (
              <div key={c.id} className="border border-gray-200 rounded-lg p-2 space-y-1.5 bg-gray-50">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">Slide</span>
                  <button onClick={() => setConfigKey('carousel_items', (config.carousel_items ?? []).filter(x => x.id !== c.id))} className="text-red-400 hover:text-red-600">×</button>
                </div>
                <ImageUploadField value={c.image_url} onChange={url => setConfigKey('carousel_items', (config.carousel_items ?? []).map(x => x.id === c.id ? { ...x, image_url: url } : x))} />
                <input value={c.caption ?? ''} onChange={e => setConfigKey('carousel_items', (config.carousel_items ?? []).map(x => x.id === c.id ? { ...x, caption: e.target.value } : x))}
                  className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Legenda (opcional)" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metrics */}
      {block.type === 'metrics' && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={labelCls.replace('mb-1.5','')}>Métricas</label>
            <button onClick={() => setConfigKey('metrics_items', [...(config.metrics_items ?? []), { id: newId(), value: '', label: '' }])} className="text-xs text-indigo-600 font-medium">+ Adicionar</button>
          </div>
          {(config.metrics_items ?? []).map((m: MetricItem) => (
            <div key={m.id} className="border border-gray-200 rounded-lg p-2 space-y-1.5 bg-gray-50 mb-2">
              <div className="flex items-center gap-1.5">
                <input value={m.value} onChange={e => setConfigKey('metrics_items', (config.metrics_items ?? []).map(x => x.id === m.id ? { ...x, value: e.target.value } : x))}
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="10.000" />
                <input value={m.suffix ?? ''} onChange={e => setConfigKey('metrics_items', (config.metrics_items ?? []).map(x => x.id === m.id ? { ...x, suffix: e.target.value } : x))}
                  className="w-12 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="+" />
                <button onClick={() => setConfigKey('metrics_items', (config.metrics_items ?? []).filter(x => x.id !== m.id))} className="text-red-400 hover:text-red-600">×</button>
              </div>
              <input value={m.label} onChange={e => setConfigKey('metrics_items', (config.metrics_items ?? []).map(x => x.id === m.id ? { ...x, label: e.target.value } : x))}
                className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Rótulo" />
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      {block.type === 'chart' && (
        <>
          <div>
            <label className={labelCls}>Título</label>
            <input value={config.chart_title ?? ''} onChange={e => setConfigKey('chart_title', e.target.value)} className={inputCls} placeholder="Resultados" />
          </div>
          <div>
            <label className={labelCls}>Tipo</label>
            <div className="flex gap-2">
              {(['bar','pie'] as const).map(t => (
                <button key={t} onClick={() => setConfigKey('chart_type', t)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${(config.chart_type ?? 'bar') === t ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                  {t === 'bar' ? 'Barras' : 'Pizza'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls.replace('mb-1.5','')}>Dados</label>
              <button onClick={() => setConfigKey('chart_data', [...(config.chart_data ?? []), { id: newId(), label: '', value: 50, color: '#6366f1' }])} className="text-xs text-indigo-600 font-medium">+ Adicionar</button>
            </div>
            {(config.chart_data ?? []).map((d: ChartDatum) => (
              <div key={d.id} className="flex items-center gap-1.5 mb-1.5">
                <input type="color" value={d.color || '#6366f1'} onChange={e => setConfigKey('chart_data', (config.chart_data ?? []).map(x => x.id === d.id ? { ...x, color: e.target.value } : x))} className="w-7 h-7 rounded border border-gray-200 p-0.5 shrink-0" />
                <input value={d.label} onChange={e => setConfigKey('chart_data', (config.chart_data ?? []).map(x => x.id === d.id ? { ...x, label: e.target.value } : x))}
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Rótulo" />
                <input type="number" value={d.value} onChange={e => setConfigKey('chart_data', (config.chart_data ?? []).map(x => x.id === d.id ? { ...x, value: Number(e.target.value) } : x))}
                  className="w-16 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" />
                <button onClick={() => setConfigKey('chart_data', (config.chart_data ?? []).filter(x => x.id !== d.id))} className="text-red-400 hover:text-red-600">×</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Spacer */}
      {block.type === 'spacer' && (
        <div>
          <label className={labelCls}>Altura: {config.spacer_height ?? 40}px</label>
          <input type="range" min={8} max={200} value={config.spacer_height ?? 40} onChange={e => setConfigKey('spacer_height', Number(e.target.value))} className="w-full" />
        </div>
      )}

      {/* HTML embed */}
      {block.type === 'html_embed' && (
        <div>
          <label className={labelCls}>HTML / Script</label>
          <textarea value={config.html_content ?? ''} onChange={e => setConfigKey('html_content', e.target.value)}
            rows={6} className={inputCls + ' resize-none font-mono text-xs'} placeholder="<div>...</div>" />
          <p className="text-[10px] text-gray-400 mt-1">Cuidado: código inserido é renderizado direto na página.</p>
        </div>
      )}

      {/* Image */}
      {block.type === 'image' && (
        <>
          <ImageUploadField label="Imagem" value={config.image_url ?? ''} onChange={url => setConfigKey('image_url', url)} />
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
            <label className={labelCls}>Tamanho</label>
            <div className="flex gap-2">
              {(['sm','md','lg'] as const).map(s => (
                <button key={s} onClick={() => setConfigKey('button_size', s)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${(config.button_size ?? 'md') === s ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-medium' : 'border-gray-200 text-gray-600 hover:border-indigo-200'}`}>
                  {s === 'sm' ? 'Pequeno' : s === 'md' ? 'Médio' : 'Grande'}
                </button>
              ))}
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

      {/* Hero */}
      {block.type === 'hero' && (
        <>
          <div>
            <label className={labelCls}>Headline</label>
            <textarea value={config.hero_headline ?? ''} onChange={e => setConfigKey('hero_headline', e.target.value)}
              rows={2} className={inputCls + ' resize-none'} placeholder="Sua headline impactante" />
          </div>
          <div>
            <label className={labelCls}>Sub-headline</label>
            <textarea value={config.hero_subheadline ?? ''} onChange={e => setConfigKey('hero_subheadline', e.target.value)}
              rows={2} className={inputCls + ' resize-none'} placeholder="Explique o valor da oferta" />
          </div>
          <ImageUploadField label="Imagem (opcional)" value={config.hero_image_url ?? ''} onChange={url => setConfigKey('hero_image_url', url)} />
          <div>
            <label className={labelCls}>Texto do CTA</label>
            <input value={config.hero_cta_text ?? ''} onChange={e => setConfigKey('hero_cta_text', e.target.value)} className={inputCls} placeholder="Quero começar →" />
          </div>
          <div>
            <label className={labelCls}>Ação do CTA</label>
            <select value={config.hero_cta_action ?? 'next_page'} onChange={e => setConfigKey('hero_cta_action', e.target.value as BlockConfig['hero_cta_action'])} className={inputCls}>
              <option value="next_page">Próxima página</option>
              <option value="external_url">URL externa</option>
            </select>
          </div>
          {config.hero_cta_action === 'external_url' && (
            <div>
              <label className={labelCls}>URL</label>
              <input value={config.hero_cta_url ?? ''} onChange={e => setConfigKey('hero_cta_url', e.target.value)} className={inputCls} placeholder="https://..." />
            </div>
          )}
          <div>
            <label className={labelCls}>Alinhamento</label>
            <div className="flex gap-2">
              {(['left','center'] as const).map(a => (
                <button key={a} onClick={() => setConfigKey('hero_align', a)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${(config.hero_align ?? 'center') === a ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                  {a === 'left' ? '← Esquerda' : '↔ Centro'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Testimonials */}
      {block.type === 'testimonials' && (
        <>
          <div>
            <label className={labelCls}>Título da seção</label>
            <input value={config.testimonials_title ?? ''} onChange={e => setConfigKey('testimonials_title', e.target.value)} className={inputCls} placeholder="O que dizem nossos alunos" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls.replace('mb-1.5', '')}>Depoimentos</label>
              <button onClick={() => setConfigKey('testimonials', [...(config.testimonials ?? []), { id: newId(), name: '', text: '', stars: 5 }])}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">+ Adicionar</button>
            </div>
            <div className="space-y-2">
              {(config.testimonials ?? []).map(t => {
                const update = (patch: Partial<TestimonialItem>) =>
                  setConfigKey('testimonials', (config.testimonials ?? []).map(x => x.id === t.id ? { ...x, ...patch } : x))
                return (
                  <div key={t.id} className="border border-gray-200 rounded-lg p-2 space-y-1.5 bg-gray-50">
                    <div className="flex items-center gap-1.5">
                      <input value={t.name} onChange={e => update({ name: e.target.value })}
                        className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Nome" />
                      <select value={t.stars ?? 5} onChange={e => update({ stars: Number(e.target.value) })}
                        className="text-xs border border-gray-200 rounded px-1 py-1 bg-white">
                        {[5,4,3].map(s => <option key={s} value={s}>{'★'.repeat(s)}</option>)}
                      </select>
                      <button onClick={() => setConfigKey('testimonials', (config.testimonials ?? []).filter(x => x.id !== t.id))}
                        className="text-red-400 hover:text-red-600">×</button>
                    </div>
                    <textarea value={t.text} onChange={e => update({ text: e.target.value })}
                      rows={2} className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white resize-none focus:outline-none" placeholder="Texto do depoimento" />
                    <ImageUploadField compact value={t.photo_url ?? ''} onChange={url => update({ photo_url: url || undefined })} />
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Features */}
      {block.type === 'features' && (
        <>
          <div>
            <label className={labelCls}>Título da seção</label>
            <input value={config.features_title ?? ''} onChange={e => setConfigKey('features_title', e.target.value)} className={inputCls} placeholder="O que você vai receber" />
          </div>
          <div>
            <label className={labelCls}>Colunas</label>
            <div className="flex gap-2">
              {([2,3] as const).map(c => (
                <button key={c} onClick={() => setConfigKey('features_columns', c)}
                  className={`flex-1 py-1.5 text-xs rounded-lg border transition ${(config.features_columns ?? 3) === c ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                  {c} colunas
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls.replace('mb-1.5', '')}>Itens</label>
              <button onClick={() => setConfigKey('features', [...(config.features ?? []), { id: newId(), icon: '✨', title: '', description: '' }])}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">+ Adicionar</button>
            </div>
            <div className="space-y-2">
              {(config.features ?? []).map(f => {
                const update = (patch: Partial<FeatureItem>) =>
                  setConfigKey('features', (config.features ?? []).map(x => x.id === f.id ? { ...x, ...patch } : x))
                return (
                  <div key={f.id} className="border border-gray-200 rounded-lg p-2 space-y-1.5 bg-gray-50">
                    <div className="flex items-center gap-1.5">
                      <input value={f.icon ?? ''} onChange={e => update({ icon: e.target.value })}
                        className="w-9 text-center text-sm border border-gray-200 rounded py-1 bg-white focus:outline-none" placeholder="✨" maxLength={2} />
                      <input value={f.title} onChange={e => update({ title: e.target.value })}
                        className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Título" />
                      <button onClick={() => setConfigKey('features', (config.features ?? []).filter(x => x.id !== f.id))}
                        className="text-red-400 hover:text-red-600">×</button>
                    </div>
                    <input value={f.description ?? ''} onChange={e => update({ description: e.target.value })}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Descrição curta" />
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* FAQ */}
      {block.type === 'faq' && (
        <>
          <div>
            <label className={labelCls}>Título da seção</label>
            <input value={config.faq_title ?? ''} onChange={e => setConfigKey('faq_title', e.target.value)} className={inputCls} placeholder="Perguntas frequentes" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls.replace('mb-1.5', '')}>Perguntas</label>
              <button onClick={() => setConfigKey('faq_items', [...(config.faq_items ?? []), { id: newId(), question: '', answer: '' }])}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">+ Adicionar</button>
            </div>
            <div className="space-y-2">
              {(config.faq_items ?? []).map(f => {
                const update = (patch: Partial<FaqItem>) =>
                  setConfigKey('faq_items', (config.faq_items ?? []).map(x => x.id === f.id ? { ...x, ...patch } : x))
                return (
                  <div key={f.id} className="border border-gray-200 rounded-lg p-2 space-y-1.5 bg-gray-50">
                    <div className="flex items-center gap-1.5">
                      <input value={f.question} onChange={e => update({ question: e.target.value })}
                        className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none" placeholder="Pergunta" />
                      <button onClick={() => setConfigKey('faq_items', (config.faq_items ?? []).filter(x => x.id !== f.id))}
                        className="text-red-400 hover:text-red-600">×</button>
                    </div>
                    <textarea value={f.answer} onChange={e => update({ answer: e.target.value })}
                      rows={2} className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white resize-none focus:outline-none" placeholder="Resposta" />
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Countdown */}
      {block.type === 'countdown' && (
        <>
          <div>
            <label className={labelCls}>Texto de urgência</label>
            <input value={config.countdown_text ?? ''} onChange={e => setConfigKey('countdown_text', e.target.value)} className={inputCls} placeholder="🔥 Oferta expira em:" />
          </div>
          <div>
            <label className={labelCls}>Modo</label>
            <div className="flex gap-2">
              <button onClick={() => setConfigKey('countdown_mode', 'evergreen')}
                className={`flex-1 py-1.5 text-xs rounded-lg border transition ${(config.countdown_mode ?? 'evergreen') === 'evergreen' ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                Evergreen (por visita)
              </button>
              <button onClick={() => setConfigKey('countdown_mode', 'date')}
                className={`flex-1 py-1.5 text-xs rounded-lg border transition ${config.countdown_mode === 'date' ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}>
                Data fixa
              </button>
            </div>
          </div>
          {(config.countdown_mode ?? 'evergreen') === 'evergreen' ? (
            <div>
              <label className={labelCls}>Minutos de contagem</label>
              <input type="number" value={config.countdown_minutes ?? 15} onChange={e => setConfigKey('countdown_minutes', Number(e.target.value))} className={inputCls} min={1} />
            </div>
          ) : (
            <div>
              <label className={labelCls}>Data/hora alvo</label>
              <input type="datetime-local" value={config.countdown_target ?? ''} onChange={e => setConfigKey('countdown_target', e.target.value)} className={inputCls} />
            </div>
          )}
          <div>
            <label className={labelCls}>Texto quando expirar</label>
            <input value={config.countdown_expired_text ?? ''} onChange={e => setConfigKey('countdown_expired_text', e.target.value)} className={inputCls} placeholder="Oferta encerrada" />
          </div>
        </>
      )}

      {/* Integrations: webhook + funnel enroll for button and final_capture */}
      {['button', 'final_capture'].includes(block.type) && (() => {
        const hasPhoneBefore = precedingBlocks.some(b =>
          b.type === 'field_phone' || (b.type === 'final_capture' && b.config.show_phone)
        )
        return (
          <div className={sectionCls + ' space-y-4'}>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Integrações</p>

            {/* Meta Pixel event */}
            <div>
              <label className={labelCls}>Evento do Pixel Meta ao avançar</label>
              <select value={config.pixel_event ?? 'none'} onChange={e => setConfigKey('pixel_event', e.target.value as BlockConfig['pixel_event'])} className={inputCls}>
                <option value="none">Nenhum</option>
                <option value="Lead">Lead</option>
                <option value="CompleteRegistration">CompleteRegistration</option>
                <option value="InitiateCheckout">InitiateCheckout</option>
                <option value="Purchase">Purchase</option>
                <option value="custom">Evento personalizado</option>
              </select>
              {config.pixel_event === 'custom' && (
                <input value={config.pixel_event_custom ?? ''} onChange={e => setConfigKey('pixel_event_custom', e.target.value)}
                  className={inputCls + ' mt-2'} placeholder="NomeDoEvento" />
              )}
            </div>

            {/* Webhook */}
            <div className="space-y-2">
              <Toggle
                on={!!config.webhook_enabled}
                onToggle={() => setConfigKey('webhook_enabled', !config.webhook_enabled)}
                label="Webhook ao avançar"
              />
              {config.webhook_enabled && (
                <div className="space-y-2 pl-1">
                  <div>
                    <label className={labelCls}>URL do webhook</label>
                    <input
                      value={config.webhook_url ?? ''}
                      onChange={e => setConfigKey('webhook_url', e.target.value)}
                      className={inputCls}
                      placeholder="https://..."
                    />
                  </div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase">Campos a enviar</p>
                  <div className="space-y-1.5">
                    <Toggle on={!!config.webhook_send_name}    onToggle={() => setConfigKey('webhook_send_name', !config.webhook_send_name)}    label="Nome" />
                    <Toggle on={!!config.webhook_send_email}   onToggle={() => setConfigKey('webhook_send_email', !config.webhook_send_email)}   label="E-mail" />
                    <Toggle on={!!config.webhook_send_phone}   onToggle={() => setConfigKey('webhook_send_phone', !config.webhook_send_phone)}   label="Telefone" />
                    <Toggle on={!!config.webhook_send_answers} onToggle={() => setConfigKey('webhook_send_answers', !config.webhook_send_answers)} label="Respostas do quiz" />
                    <Toggle on={!!config.webhook_send_score}   onToggle={() => setConfigKey('webhook_send_score', !config.webhook_send_score)}   label="Pontuação" />
                  </div>
                </div>
              )}
            </div>

            {/* Funnel enroll */}
            <div className="space-y-2">
              <Toggle
                on={!!config.funnel_enroll_enabled}
                onToggle={() => setConfigKey('funnel_enroll_enabled', !config.funnel_enroll_enabled)}
                label="Inscrever em funil"
              />
              {config.funnel_enroll_enabled && (
                <div className="pl-1 space-y-2">
                  {!hasPhoneBefore && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                      <span className="text-amber-500 shrink-0 mt-0.5">⚠</span>
                      <p className="text-xs text-amber-700">Capture um telefone antes deste bloco para inscrever o lead em um funil.</p>
                    </div>
                  )}
                  <div>
                    <label className={labelCls}>Funil publicado</label>
                    <select
                      value={config.funnel_enroll_id ?? ''}
                      onChange={e => setConfigKey('funnel_enroll_id', e.target.value || undefined)}
                      disabled={!hasPhoneBefore}
                      className={inputCls + (!hasPhoneBefore ? ' opacity-50 cursor-not-allowed' : '')}
                    >
                      <option value="">Selecionar funil...</option>
                      {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Background color */}
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

      {/* Aparição temporizada (todos os blocos) */}
      <div className="border-t border-gray-100 pt-3">
        <label className={labelCls}>⏱ Aparecer após (segundos)</label>
        <input type="number" min={0} step={1} value={config.appear_delay ?? 0}
          onChange={e => setConfigKey('appear_delay', Number(e.target.value) || undefined)}
          className={inputCls} placeholder="0 = imediato" />
        <p className="text-[10px] text-gray-400 mt-1">0 ou vazio = aparece imediatamente</p>
      </div>

      {/* Move to page */}
      {otherPages.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <label className={labelCls}>Mover para página</label>
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) { onMoveToPage(e.target.value); e.target.value = '' } }}
            className={inputCls}
          >
            <option value="" disabled>Selecionar página...</option>
            {otherPages.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

function RightPanel({
  selectedBlockId, pages, currentPageId, settings, funnels, onUpdateBlock, onUpdateSettings, onMoveBlock,
}: {
  selectedBlockId: string | null
  pages: QuizPage[]
  currentPageId: string
  settings: QuizData['settings']
  funnels: { id: string; name: string }[]
  onUpdateBlock: (blockId: string, config: Partial<BlockConfig>) => void
  onUpdateSettings: (patch: Partial<QuizData['settings']>) => void
  onMoveBlock: (blockId: string, targetPageId: string) => void
}) {
  let selectedBlock: QuizBlock | null = null
  let precedingBlocks: QuizBlock[] = []
  if (selectedBlockId) {
    for (const p of pages) {
      const idx = p.blocks.findIndex(b => b.id === selectedBlockId)
      if (idx >= 0) { selectedBlock = p.blocks[idx]; precedingBlocks = p.blocks.slice(0, idx); break }
    }
  }

  const meta = selectedBlock ? BLOCK_META[selectedBlock.type] : null

  return (
    <div className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-hidden shrink-0">
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
              currentPageId={currentPageId}
              funnels={funnels}
              onChange={config => onUpdateBlock(selectedBlock!.id, config)}
              onMoveToPage={targetPageId => onMoveBlock(selectedBlock!.id, targetPageId)}
              precedingBlocks={precedingBlocks}
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
  const [activeTab, setActiveTab] = useState<'builder' | 'leads'>('builder')
  const [data, setData] = useState<QuizData>(() => initialData ?? defaultQuiz(page.title))
  const [selectedPageId, setSelectedPageId] = useState<string>(() => initialData?.pages[0]?.id ?? '')
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [activeId, setActiveId] = useState<string | null>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep selectedPageId valid when pages change
  useEffect(() => {
    if (!data.pages.find(p => p.id === selectedPageId) && data.pages.length > 0) {
      setSelectedPageId(data.pages[0].id)
    }
  }, [data.pages, selectedPageId])

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

  function updateData(fn: (d: QuizData) => QuizData) { setData(prev => fn(prev)) }
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
    setSelectedPageId(newPage.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pages.length])

  const deletePage = useCallback((pageId: string) => {
    updatePages(pages => {
      const remaining = pages.filter(p => p.id !== pageId).map((p, i) => ({ ...p, order: i }))
      return remaining
    })
    setSelectedBlockId(prev => {
      const inPage = data.pages.find(p => p.id === pageId)
      if (inPage?.blocks.some(b => b.id === prev)) return null
      return prev
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pages])

  const duplicatePage = useCallback((pageId: string) => {
    const source = data.pages.find(p => p.id === pageId)
    if (!source) return
    const newPage: QuizPage = {
      ...source,
      id: newId(),
      title: `${source.title} (cópia)`,
      blocks: source.blocks.map(b => ({ ...b, id: newId() })),
      order: data.pages.length,
    }
    updatePages(pages => [...pages, newPage].map((p, i) => ({ ...p, order: i })))
    setSelectedPageId(newPage.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pages])

  const renamePageTitle = useCallback((pageId: string, title: string) => {
    updatePages(pages => pages.map(p => p.id === pageId ? { ...p, title } : p))
  }, [])

  const addBlock = useCallback((pageId: string, type: BlockType, insertBeforeBlockId?: string | null) => {
    const newBlock: QuizBlock = { id: newId(), type, order: 0, config: defaultConfig(type) }
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

  const moveBlock = useCallback((blockId: string, targetPageId: string) => {
    updatePages(pages => {
      let block: QuizBlock | undefined
      const intermediate = pages.map(p => {
        const found = p.blocks.find(b => b.id === blockId)
        if (found) { block = found; return { ...p, blocks: p.blocks.filter(b => b.id !== blockId) } }
        return p
      })
      if (!block) return pages
      const b = block
      return intermediate.map(p => {
        if (p.id !== targetPageId) return p
        return { ...p, blocks: [...p.blocks, b].map((bl, i) => ({ ...bl, order: i })) }
      })
    })
    setSelectedPageId(targetPageId)
    setSelectedBlockId(blockId)
  }, [])

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id))
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const activeStr = String(active.id)
    const overStr = String(over.id)

    // Page reorder
    if (activeStr.startsWith('sortpage:') && overStr.startsWith('sortpage:')) {
      const fromId = activeStr.slice(9)
      const toId = overStr.slice(9)
      if (fromId !== toId) {
        updatePages(pages => {
          const oldIdx = pages.findIndex(p => p.id === fromId)
          const newIdx = pages.findIndex(p => p.id === toId)
          if (oldIdx < 0 || newIdx < 0) return pages
          return arrayMove(pages, oldIdx, newIdx).map((p, i) => ({ ...p, order: i }))
        })
      }
      return
    }

    // Drop from palette onto the active page
    if (activeStr.startsWith('palette:')) {
      const type = activeStr.slice(8) as BlockType
      let targetPageId = selectedPageId
      let insertBeforeId: string | null = null

      if (overStr.startsWith('page:')) {
        targetPageId = overStr.slice(5)
      } else {
        // Over a block — insert before it
        for (const p of data.pages) {
          const b = p.blocks.find(b => b.id === overStr)
          if (b) { targetPageId = p.id; insertBeforeId = b.id; break }
        }
      }

      if (!targetPageId && data.pages.length > 0) targetPageId = data.pages[0].id
      if (targetPageId) addBlock(targetPageId, type, insertBeforeId)
      return
    }

    // Block reorder within page
    const activeData = active.data.current as { pageId?: string } | undefined
    if (!activeData?.pageId) return

    const sourcePageId = activeData.pageId

    if (overStr.startsWith('sortpage:') || overStr.startsWith('page:')) return

    // Same page reorder
    if (sourcePageId === selectedPageId) {
      updatePages(pages => pages.map(p => {
        if (p.id !== sourcePageId) return p
        const oldIdx = p.blocks.findIndex(b => b.id === activeStr)
        const newIdx = p.blocks.findIndex(b => b.id === overStr)
        if (oldIdx < 0 || newIdx < 0) return p
        return { ...p, blocks: arrayMove(p.blocks, oldIdx, newIdx).map((b, i) => ({ ...b, order: i })) }
      }))
    }
  }

  function getActiveMeta() {
    if (!activeId) return null
    if (activeId.startsWith('palette:')) return BLOCK_META[activeId.slice(8) as BlockType]
    if (activeId.startsWith('sortpage:')) {
      const pageId = activeId.slice(9)
      const p = data.pages.find(pg => pg.id === pageId)
      return p ? { icon: '📄', label: p.title, category: '' } : null
    }
    for (const p of data.pages) {
      const b = p.blocks.find(blk => blk.id === activeId)
      if (b) return BLOCK_META[b.type]
    }
    return null
  }
  const activeMeta = getActiveMeta()

  const activePage = data.pages.find(p => p.id === selectedPageId) ?? null

  const saveLabel = saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'saved' ? '✓ Salvo!' : saveStatus === 'error' ? 'Erro' : 'Salvar'

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div style={{ height: '100vh' }} className="flex flex-col bg-gray-50 overflow-hidden">
        {/* Header */}
        <div className="h-12 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0 z-10">
          <button onClick={() => router.push('/pages')} className="text-gray-500 hover:text-gray-700 shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h1 className="text-sm font-semibold text-gray-900 truncate max-w-[180px]">{page.title}</h1>

          {/* Tabs */}
          <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs font-medium shrink-0">
            {(['builder','leads'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 transition ${activeTab === tab ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                {tab === 'builder' ? 'Construtor' : `Leads`}
              </button>
            ))}
          </div>

          <div className="flex-1" />

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

        {/* Leads tab */}
        {activeTab === 'leads' && (
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400 text-sm">Carregando leads…</div>}>
              <QuizLeadsView quizId={page.id} pages={data.pages} />
            </Suspense>
          </div>
        )}

        {/* 4-column layout (builder tab) */}
        <div className={`flex flex-1 overflow-hidden ${activeTab !== 'builder' ? 'hidden' : ''}`}>
          <LeftPanel />
          <PagesPanel
            pages={data.pages}
            selectedPageId={selectedPageId}
            onSelectPage={id => { setSelectedPageId(id); setSelectedBlockId(null) }}
            onAddPage={addPage}
            onRename={renamePageTitle}
            onDuplicate={duplicatePage}
            onDelete={deletePage}
          />
          <CenterPanel
            activePage={activePage}
            pages={data.pages}
            selectedId={selectedBlockId}
            onSelectBlock={setSelectedBlockId}
            onDeleteBlock={deleteBlock}
          />
          <RightPanel
            selectedBlockId={selectedBlockId}
            pages={data.pages}
            currentPageId={selectedPageId}
            settings={data.settings}
            funnels={funnels}
            onUpdateBlock={updateBlock}
            onUpdateSettings={updateSettings}
            onMoveBlock={moveBlock}
          />
        </div>
      </div>

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
