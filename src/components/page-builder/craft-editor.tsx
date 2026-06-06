'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Editor, Frame, Element, useEditor, useNode } from '@craftjs/core'
import { HeroSimple } from './sections/hero-simple'
import { CaptureForm } from './sections/capture-form'
import { VideoPlayer } from './sections/video-player'
import { VslTimed } from './sections/vsl-timed'
import { BenefitsList } from './sections/benefits-list'
import { Testimonial } from './sections/testimonial'
import { CtaButton } from './sections/cta-button'
import { DeliveryCard } from './sections/delivery-card'
import { CountdownTimer, CountdownTimerSettings } from './sections/countdown-timer'
import { Guarantee, GuaranteeSettings } from './sections/guarantee'
import { FaqAccordion, FaqAccordionSettings } from './sections/faq-accordion'
import { AuthorBio, AuthorBioSettings } from './sections/author-bio'
import { ScarcityBar, ScarcityBarSettings } from './sections/scarcity-bar'
import { BeforeAfter, BeforeAfterSettings } from './sections/before-after'
import { BonusSection, BonusSectionSettings } from './sections/bonus-section'
import { PartnerLogos, PartnerLogosSettings } from './sections/partner-logos'
import { RichText, RichTextSettings } from './sections/rich-text'
import { PriceSection, PriceSectionSettings } from './sections/price-section'
import { FullwidthBanner, FullwidthBannerSettings } from './sections/fullwidth-banner'
import { ThankYouHero, ThankYouHeroSettings } from './sections/thank-you-hero'
import { HeroSimpleSettings } from './sections/hero-simple'
import { CaptureFormSettings } from './sections/capture-form'
import { VideoPlayerSettings } from './sections/video-player'
import { VslTimedSettings } from './sections/vsl-timed'
import { BenefitsListSettings } from './sections/benefits-list'
import { TestimonialSettings } from './sections/testimonial'
import { CtaButtonSettings } from './sections/cta-button'
import { DeliveryCardSettings } from './sections/delivery-card'
import { savePage, publishPage, unpublishPage } from '@/app/actions/pages'
import { savePageVersion, listPageVersions, restorePageVersion } from '@/app/actions/page-versions'

interface PageRootProps { children?: React.ReactNode; backgroundColor?: string }

const PageRootNode = ({ children, backgroundColor = '#ffffff' }: PageRootProps) => {
  const { connectors: { connect } } = useNode()
  return (
    <div ref={(ref) => { if (ref) connect(ref) }} style={{ backgroundColor, minHeight: '100vh' }} className="w-full">
      {children}
    </div>
  )
}

PageRootNode.craft = {
  displayName: 'Página',
  props: { backgroundColor: '#ffffff' },
  isCanvas: true,
  rules: { canMoveIn: () => true, canMoveOut: () => false, canDrag: () => false, canDrop: () => true },
}

const PageRoot = PageRootNode

const ALL_SECTIONS = [
  { label: 'Hero Simples', component: HeroSimple, settings: HeroSimpleSettings, icon: '🦸', description: 'Headline + CTA' },
  { label: 'Formulário de Captura', component: CaptureForm, settings: CaptureFormSettings, icon: '📝', description: 'Nome, e-mail, telefone' },
  { label: 'Player de Vídeo', component: VideoPlayer, settings: VideoPlayerSettings, icon: '▶️', description: 'YouTube ou Vimeo' },
  { label: 'VSL Temporizada', component: VslTimed, settings: VslTimedSettings, icon: '⏱️', description: 'Vídeo + botão cronometrado' },
  { label: 'Lista de Benefícios', component: BenefitsList, settings: BenefitsListSettings, icon: '✅', description: 'Checklist visual' },
  { label: 'Depoimento', component: Testimonial, settings: TestimonialSettings, icon: '💬', description: 'Prova social com estrelas' },
  { label: 'Botão CTA', component: CtaButton, settings: CtaButtonSettings, icon: '🎯', description: 'Botão de ação destacado' },
  { label: 'Card de Entrega', component: DeliveryCard, settings: DeliveryCardSettings, icon: '🎁', description: 'Página de acesso pós-compra' },
  { label: 'Contador Regressivo', component: CountdownTimer, settings: CountdownTimerSettings, icon: '⏳', description: 'Urgência com timer' },
  { label: 'Garantia', component: Guarantee, settings: GuaranteeSettings, icon: '🛡️', description: 'Selo de garantia' },
  { label: 'FAQ', component: FaqAccordion, settings: FaqAccordionSettings, icon: '❓', description: 'Perguntas frequentes' },
  { label: 'Bio do Autor', component: AuthorBio, settings: AuthorBioSettings, icon: '👤', description: 'Foto + bio + redes sociais' },
  { label: 'Barra de Escássez', component: ScarcityBar, settings: ScarcityBarSettings, icon: '🔥', description: 'Vagas restantes' },
  { label: 'Antes e Depois', component: BeforeAfter, settings: BeforeAfterSettings, icon: '↔️', description: 'Comparativo visual' },
  { label: 'Seção de Bônus', component: BonusSection, settings: BonusSectionSettings, icon: '🎁', description: 'Lista de bônus com valor' },
  { label: 'Logos de Parceiros', component: PartnerLogos, settings: PartnerLogosSettings, icon: '🤝', description: 'Grade de logotipos' },
  { label: 'Texto Rico', component: RichText, settings: RichTextSettings, icon: '✏️', description: 'Texto formatado livre' },
  { label: 'Seção de Preço', component: PriceSection, settings: PriceSectionSettings, icon: '💰', description: 'Card de preço com CTA' },
  { label: 'Banner Fullwidth', component: FullwidthBanner, settings: FullwidthBannerSettings, icon: '🖼️', description: 'Imagem com overlay' },
  { label: 'Hero de Obrigado', component: ThankYouHero, settings: ThankYouHeroSettings, icon: '🙏', description: 'Confirmação com check animado' },
]

type PreviewMode = 'desktop' | 'mobile'

interface VersionEntry { id: string; version_number: number; label: string | null; created_at: string }

function EditorToolbar({ pageId, published, slug, previewMode, onPreviewToggle, onOpenVersions, lastSaved }: {
  pageId: string; published: boolean; slug?: string | null
  previewMode: PreviewMode; onPreviewToggle: () => void; onOpenVersions: () => void; lastSaved: Date | null
}) {
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
    } catch (err) { console.error('Save failed', err) }
    finally { setSaving(false) }
  }, [query, pageId])

  const handleSaveVersion = useCallback(async () => {
    const label = prompt('Nome da versão (opcional):')
    if (label === null) return
    try {
      const json = JSON.parse(query.serialize())
      await savePage(pageId, json)
      await savePageVersion(pageId, json, label || undefined)
      alert('Versão salva!')
    } catch (err) { console.error('Save version failed', err) }
  }, [query, pageId])

  const handlePublish = useCallback(async () => {
    setPublishing(true)
    try {
      if (isPublished) {
        await unpublishPage(pageId); setIsPublished(false)
      } else {
        const json = JSON.parse(query.serialize())
        await savePage(pageId, json)
        const newSlug = await publishPage(pageId)
        setCurrentSlug(newSlug); setIsPublished(true)
      }
    } catch (err) { console.error('Publish failed', err) }
    finally { setPublishing(false) }
  }, [isPublished, pageId, query])

  const fmt = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="h-14 bg-gray-900 border-b border-gray-700 flex items-center px-4 gap-2 shrink-0">
      <a href="/pages" className="text-gray-400 hover:text-white mr-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M15 18l-6-6 6-6" /></svg>
      </a>
      <span className="text-white font-semibold text-sm mr-auto">Editor de Página</span>

      <div className="flex items-center bg-gray-800 rounded-lg p-0.5 gap-0.5">
        <button onClick={() => previewMode === 'mobile' && onPreviewToggle()} className={`p-1.5 rounded-md transition-colors ${previewMode === 'desktop' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`} title="Desktop">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
        </button>
        <button onClick={() => previewMode === 'desktop' && onPreviewToggle()} className={`p-1.5 rounded-md transition-colors ${previewMode === 'mobile' ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`} title="Mobile">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
        </button>
      </div>

      {isPublished && currentSlug && (
        <a href={`/pg/${currentSlug}`} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-300 hover:text-indigo-100 flex items-center gap-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Ver
        </a>
      )}

      <button onClick={() => actions.history.undo()} className="p-2 text-gray-400 hover:text-white" title="Desfazer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>
      </button>
      <button onClick={() => actions.history.redo()} className="p-2 text-gray-400 hover:text-white" title="Refazer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13"/></svg>
      </button>

      <button onClick={onOpenVersions} className="p-2 text-gray-400 hover:text-white" title="Histórico de versões">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>
      </button>
      <button onClick={handleSaveVersion} className="p-2 text-gray-400 hover:text-white" title="Salvar versão">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      </button>

      <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
        {saved ? '✓ Salvo' : saving ? '...' : 'Salvar'}
      </button>
      {lastSaved && !saved && !saving && <span className="text-xs text-gray-500 hidden sm:inline">às {fmt(lastSaved)}</span>}

      <button onClick={handlePublish} disabled={publishing} className={`px-3 py-1.5 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${isPublished ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
        {publishing ? '...' : isPublished ? 'Despublicar' : 'Publicar'}
      </button>
    </div>
  )
}

function VersionDrawer({ pageId, onRestore, onClose }: { pageId: string; onRestore: (json: object) => void; onClose: () => void }) {
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => {
    listPageVersions(pageId).then((v) => { setVersions(v as VersionEntry[]); setLoading(false) })
  }, [pageId])

  const handleRestore = async (versionId: string) => {
    if (!confirm('Restaurar esta versão? O conteúdo atual será substituído.')) return
    setRestoring(versionId)
    try {
      const json = await restorePageVersion(pageId, versionId)
      onRestore(json); onClose()
    } catch { alert('Erro ao restaurar versão') }
    finally { setRestoring(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/50" onClick={onClose} />
      <div className="w-80 bg-white h-full shadow-2xl flex flex-col">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Histórico de Versões</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && <p className="text-sm text-gray-400 text-center py-8">Carregando...</p>}
          {!loading && versions.length === 0 && <p className="text-sm text-gray-400 text-center py-8">Nenhuma versão salva ainda.</p>}
          {versions.map((v) => (
            <div key={v.id} className="p-3 rounded-xl border border-gray-200 hover:border-indigo-300 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">{v.label || `Versão ${v.version_number}`}</p>
                  <p className="text-xs text-gray-400">{new Date(v.created_at).toLocaleString('pt-BR')}</p>
                </div>
                <button onClick={() => handleRestore(v.id)} disabled={restoring === v.id} className="text-xs px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                  {restoring === v.id ? '...' : 'Restaurar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Sidebar() {
  const { connectors } = useEditor()
  const [search, setSearch] = useState('')
  const sections = ALL_SECTIONS.filter((s) => s.label.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0">
      <div className="p-3 border-b border-gray-100">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Seções</p>
        <input type="text" placeholder="Buscar seção..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" />
      </div>
      <div className="p-3 space-y-2 overflow-y-auto flex-1">
        {sections.map(({ label, component: Comp, icon, description }) => (
          <div
            key={label}
            ref={(ref) => { if (ref) { /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ ;(connectors as any).create(ref, <Comp />) } }}
            className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-grab active:cursor-grabbing transition-colors"
          >
            <span className="text-xl shrink-0">{icon}</span>
            <div><p className="text-sm font-medium text-gray-700">{label}</p><p className="text-xs text-gray-400">{description}</p></div>
          </div>
        ))}
        {sections.length === 0 && <p className="text-xs text-gray-400 text-center py-4">Nenhuma seção encontrada</p>}
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
    return { selected: { id: nodeId, name: node.data.displayName || node.data.name, settings: node.related?.toolbar } }
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

function Canvas({ initialJson, previewMode }: { initialJson?: object; previewMode: PreviewMode }) {
  const isEmpty = !initialJson || Object.keys(initialJson).length === 0
  const canvasWidth = previewMode === 'mobile' ? 'max-w-sm' : 'max-w-3xl'

  return (
    <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
      <div className={`bg-white shadow-xl min-h-screen w-full ${canvasWidth} mx-auto rounded-lg overflow-hidden transition-all duration-300`}>
        {isEmpty ? (
          <div className="relative" style={{ minHeight: '100vh' }}>
            <Frame><Element is={PageRootNode} canvas /></Frame>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none text-gray-400">
              <div className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-2xl flex items-center justify-center mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8"><path d="M12 5v14M5 12h14"/></svg>
              </div>
              <p className="text-sm font-medium">Arraste uma seção da esquerda para começar</p>
            </div>
          </div>
        ) : (
          <Frame data={JSON.stringify(initialJson)}><Element is={PageRootNode} canvas /></Frame>
        )}
      </div>
    </div>
  )
}

function useAutoSave(pageId: string, query: ReturnType<typeof useEditor>['query'], intervalMs = 45000) {
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const json = JSON.parse(query.serialize())
        await savePage(pageId, json)
        setLastSaved(new Date())
      } catch {}
    }, intervalMs)
    return () => clearInterval(timer)
  }, [pageId, query, intervalMs])
  return lastSaved
}

interface CraftEditorProps { pageId: string; published: boolean; slug?: string | null; initialJson?: object }

function EditorInner({ pageId, published, slug, initialJson }: CraftEditorProps) {
  const { query, actions } = useEditor()
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop')
  const [showVersions, setShowVersions] = useState(false)
  const lastSaved = useAutoSave(pageId, query)

  return (
    <div className="h-screen flex flex-col">
      <EditorToolbar
        pageId={pageId} published={published} slug={slug}
        previewMode={previewMode}
        onPreviewToggle={() => setPreviewMode((m) => m === 'desktop' ? 'mobile' : 'desktop')}
        onOpenVersions={() => setShowVersions(true)}
        lastSaved={lastSaved}
      />
      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar />
        <Canvas initialJson={initialJson} previewMode={previewMode} />
        <PropertiesPanel />
      </div>
      {showVersions && (
        <VersionDrawer
          pageId={pageId}
          onRestore={(json) => { actions.deserialize(JSON.stringify(json)) }}
          onClose={() => setShowVersions(false)}
        />
      )}
    </div>
  )
}

export default function CraftEditor({ pageId, published, slug, initialJson }: CraftEditorProps) {
  const resolver = {
    HeroSimple, CaptureForm, VideoPlayer, VslTimed, BenefitsList, Testimonial,
    CtaButton, DeliveryCard, CountdownTimer, Guarantee, FaqAccordion, AuthorBio,
    ScarcityBar, BeforeAfter, BonusSection, PartnerLogos, RichText, PriceSection,
    FullwidthBanner, ThankYouHero, PageRootNode, PageRoot,
  }

  return (
    <Editor resolver={resolver} enabled>
      <EditorInner pageId={pageId} published={published} slug={slug} initialJson={initialJson} />
    </Editor>
  )
}