'use client'

import React from 'react'

export function MindToolbar({
  onZoomIn, onZoomOut, onFit, showGrid, onToggleGrid, onOrganize,
  onUndo, onRedo, canUndo, canRedo, onExportPng, onExportJson, exporting,
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  showGrid: boolean
  onToggleGrid: () => void
  onOrganize: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onExportPng: () => void
  onExportJson: () => void
  exporting: boolean
}) {
  const btn = 'w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:hover:bg-transparent'
  const sep = <div className="w-px h-5 bg-gray-200 mx-0.5 self-center" />

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 bg-white/95 backdrop-blur border border-gray-200 rounded-2xl shadow-lg px-1.5 py-1.5">
      <button onClick={onUndo} disabled={!canUndo} className={btn} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>
      </button>
      <button onClick={onRedo} disabled={!canRedo} className={btn} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13"/></svg>
      </button>
      {sep}
      <button onClick={onZoomOut} className={btn} title="Diminuir zoom" aria-label="Diminuir zoom">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M5 12h14"/></svg>
      </button>
      <button onClick={onZoomIn} className={btn} title="Aumentar zoom" aria-label="Aumentar zoom">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <button onClick={onFit} className={btn} title="Ajustar à tela" aria-label="Ajustar à tela">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3"/></svg>
      </button>
      {sep}
      <button onClick={onOrganize} className={btn} title="Organizar mapa (arruma tudo em árvore)" aria-label="Organizar mapa">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
          <rect x="2" y="10" width="5" height="4" rx="1"/><rect x="16" y="3" width="6" height="4" rx="1"/>
          <rect x="16" y="10" width="6" height="4" rx="1"/><rect x="16" y="17" width="6" height="4" rx="1"/>
          <path d="M7 12h4M11 5v14M11 5h5M11 12h5M11 19h5"/>
        </svg>
      </button>
      <button onClick={onToggleGrid} className={`${btn} ${showGrid ? 'text-indigo-600 bg-indigo-50' : ''}`} title="Mostrar/ocultar grade" aria-label="Alternar grade">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
      </button>
      {sep}
      <button onClick={onExportPng} disabled={exporting} className={btn} title="Exportar PNG" aria-label="Exportar como PNG">
        {exporting
          ? <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 11-6.2-8.6"/></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>}
      </button>
      <button onClick={onExportJson} className={btn} title="Exportar JSON (backup)" aria-label="Exportar JSON">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
    </div>
  )
}
