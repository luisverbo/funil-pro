'use client'

import React, { useCallback, useState } from 'react'
import { Editor, Frame, Element, useEditor } from '@craftjs/core'
import { HeroSimple } from './sections/hero-simple'
import { CaptureForm } from './sections/capture-form'
import { VideoPlayer } from './sections/video-player'
import { VslTimed } from './sections/vsl-timed'
import { BenefitsList } from './sections/benefits-list'
import { Testimonial } from './sections/testimonial'
import { CtaButton } from './sections/cta-button'
import { DeliveryCard } from './sections/delivery-card'
import { savePage, publishPage, unpublishPage } from '@/app/actions/pages'

interface PageRootProps {
  children?: React.ReactNode
  backgroundColor?: string
}

const PageRoot = ({ children, backgroundColor = '#ffffff' }: PageRootProps) => (
  <div style={{ backgroundColor, minHeight: '100vh' }} className="w-full">{children}</div>
)

const PageRootNode = ({ children, backgroundColor = '#ffffff' }: PageRootProps) => (
  <div style={{ backgroundColor, minHeight: '100vh' }} className="w-full">{children}</div>
)

PageRootNode.craft = {
  displayName: 'Página',
  props: { backgroundColor: '#ffffff' },
  isCanvas: true,
  rules: { canMoveIn: () => true, canMoveOut: () => false, canDrag: () => false, canDrop: () => true },
}

const SECTIONS = [
  { label: 'Hero Simples', component: HeroSimple, icon: '🦸', description: 'Headline + CTA' },
  { label: 'Formulário de Captura', component: CaptureForm, icon: '📝', description: 'Nome, e-mail, telefone' },
  { label: 'Player de Vídeo', component: VideoPlayer, icon: '▶️', description: 'YouTube ou Vimeo' },
  { label: 'VSL Temporizada', component: VslTimed, icon: '⏱️', description: 'Vídeo + botão cronometrado' },
  { label: 'Lista de Benefícios', component: BenefitsList, icon: '✅', description: 'Checklist visual' },
  { label: 'Depoimento', component: Testimonial, icon: '💬', description: 'Prova social com estrelas' },
  { label: 'Botão CTA', component: CtaButton, icon: '🎯', description: 'Botão de ação destacado' },
  { label: 'Card de Entrega', component: DeliveryCard, icon: '🎁', description: 'Página de acesso pós-compra' },
]

function EditorToolbar({ pageId, published, slug }: { pageId: string; published: boolean; slug?: string | null }) {
  const { query, actions } = useEditor()
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [isPublished, setIsPublished] = useState(published)
  const [currentSlug, setCurrentSlug] = useState(slug)
  const [saved, setSaved] = useState(false)

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const json = JSON.parse(query.serialize())
      await savePage(pageId, json)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Save failed', err)
    } finally {
      setSaving(false)
    }
  }, [query, pageId])

  const handlePublish = useCallback(async () => {
    setPublishing(true)
    try {
      if (isPublished) {
        await unpublishPage(pageId)
        setIsPublished(false)
      } else {
        const json = JSON.parse(query.serialize())
        await savePage(pageId, json)
        const newSlug = await publishPage(pageId)
        setCurrentSlug(newSlug)
        setIsPublished(true)
      }
    } catch (err) {
      console.error('Publish failed', err)
    } finally {
      setPublishing(false)
    }
  }, [isPublished, pageId, query])

  return (
    <div className="h-14 bg-gray-900 border-b border-gray-700 flex items-center px-4 gap-3 shrink-0">
      <a href="/pages" className="text-gray-400 hover:text-white mr-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M15 18l-6-6 6-6" /></svg>
      </a>
      <span className="text-white font-semibold text-sm mr-auto">Editor de Página</span>
      {isPublished && currentSlug && (
        <a href={`/pg/${currentSlug}`} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-300 hover:text-indigo-100 flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Ver página
        </a>
      )}
      <button onClick={() => actions.history.undo()} className="p-2 text-gray-400 hover:text-white" title="Desfazer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>
      </button>
      <button onClick={() => actions.history.redo()} className="p-2 text-gray-400 hover:text-white" title="Refazer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13"/></svg>
      </button>
      <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
        {saved ? '✓ Salvo' : saving ? 'Salvando...' : 'Salvar'}
      </button>
      <button onClick={handlePublish} disabled={publishing} className={`px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${isPublished ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
        {publishing ? '...' : isPublished ? 'Despublicar' : 'Publicar'}
      </button>
    </div>
  )
}

function Sidebar() {
  const { connectors } = useEditor()
  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col overflow-y-auto shrink-0">
      <div className="p-4 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Seções</p>
        <p className="text-xs text-gray-400 mt-0.5">Arraste para o canvas</p>
      </div>
      <div className="p-3 space-y-2">
        {SECTIONS.map(({ label, component: Comp, icon, description }) => (
          <div
            key={label}
            ref={(ref) => {
              if (ref) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(connectors as any).create(ref, <Comp />)
              }
            }}
            className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-grab active:cursor-grabbing transition-colors"
          >
            <span className="text-xl shrink-0">{icon}</span>
            <div>
              <p className="text-sm font-medium text-gray-700">{label}</p>
              <p className="text-xs text-gray-400">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PropertiesPanel() {
  const { selected, actions } = useEditor((state) => {
    const selectedIds = [...state.events.selected]
    const nodeId = selectedIds[0]
    if (!nodeId) return { selected: null }
    const node = state.nodes[nodeId]
    if (!node) return { selected: null }
    return {
      selected: {
        id: nodeId,
        name: node.data.displayName || node.data.name,
        settings: node.related?.toolbar,
      },
    }
  })

  return (
    <div className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-y-auto shrink-0">
      <div className="p-4 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Propriedades</p>
      </div>
      <div className="p-4 flex-1">
        {selected ? (
          <div>
            <p className="text-sm font-semibold text-gray-800 mb-4">{selected.name}</p>
            {selected.settings ? React.createElement(selected.settings) : <p className="text-xs text-gray-400">Nenhuma propriedade editável</p>}
            <button onClick={() => actions.delete(selected.id)} className="mt-6 w-full py-2 border border-red-200 text-red-500 text-sm rounded-lg hover:bg-red-50 transition-colors">Remover seção</button>
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-gray-400"><path d="M15 15l6 6m-11-4a7 7 0 110-14 7 7 0 010 14z"/></svg>
            </div>
            <p className="text-sm text-gray-500">Clique em uma seção para editar suas propriedades</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Canvas({ initialJson }: { initialJson?: object }) {
  const isEmpty = !initialJson || Object.keys(initialJson).length === 0
  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
      <div className="bg-white shadow-xl min-h-screen w-full max-w-3xl mx-auto rounded-lg overflow-hidden">
        {isEmpty ? (
          <Frame>
            <Element is={PageRootNode} canvas>
              <div className="flex flex-col items-center justify-center py-32 text-gray-400">
                <div className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-2xl flex items-center justify-center mb-4">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8"><path d="M12 5v14M5 12h14"/></svg>
                </div>
                <p className="text-sm font-medium">Arraste uma seção da esquerda para começar</p>
              </div>
            </Element>
          </Frame>
        ) : (
          <Frame data={JSON.stringify(initialJson)}>
            <Element is={PageRootNode} canvas />
          </Frame>
        )}
      </div>
    </div>
  )
}

interface CraftEditorProps {
  pageId: string
  published: boolean
  slug?: string | null
  initialJson?: object
}

export default function CraftEditor({ pageId, published, slug, initialJson }: CraftEditorProps) {
  const resolver = {
    HeroSimple,
    CaptureForm,
    VideoPlayer,
    VslTimed,
    BenefitsList,
    Testimonial,
    CtaButton,
    DeliveryCard,
    PageRootNode,
    PageRoot,
  }

  return (
    <div className="h-screen flex flex-col">
      <Editor resolver={resolver} enabled>
        <EditorToolbar pageId={pageId} published={published} slug={slug} />
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <Canvas initialJson={initialJson} />
          <PropertiesPanel />
        </div>
      </Editor>
    </div>
  )
}
