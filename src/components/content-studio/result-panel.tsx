'use client'

// ============================================================================
// Content Studio — painel de resultado (Fase 2A)
// ----------------------------------------------------------------------------
// Só APRESENTA. Todo o conteúdo vem pronto do servidor, montado em
// `result-view.ts` a partir de `cs_steps.output`.
//
// Nada aqui recombina briefing, deduz slide a partir de evento ou preenche
// lacuna com texto plausível. Um painel que "remonta" o resultado no navegador
// mostraria algo convincente mesmo quando o backend gravou outra coisa — e na
// Fase 2B a pessoa aprovaria um material que não é o que existe.
//
// Sem edição e sem aprovação: os dois são Fase 2B, de propósito.
// ============================================================================

import React from 'react'
import type { ProductionResult } from '@/lib/content-studio/result-view'

const PAPEL_LABEL: Record<string, string> = {
  gancho: 'Gancho',
  problema: 'Problema',
  causa: 'Causa',
  virada: 'Virada',
  como: 'Como funciona',
  oferta: 'Oferta',
  cta: 'Chamada',
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">{titulo}</h3>
      {children}
    </div>
  )
}

export interface ResultPanelProps {
  result: ProductionResult
  /** Estado da produção — só para o selo do topo. */
  aguardandoAprovacao: boolean
}

export default function ResultPanel({ result, aguardandoAprovacao }: ResultPanelProps) {
  if (!result.disponivel) return null

  const { revisao } = result
  const reprovado = revisao.verdict === 'needs_revision'

  return (
    <section className="rounded-3xl border border-gray-100 bg-white shadow-sm p-4 sm:p-5 mb-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-gray-900">Resultado</h2>
        {aguardandoAprovacao && (
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
            aguardando aprovação
          </span>
        )}
        {result.revisionCycle > 0 && (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
            revisado {result.revisionCycle}×
          </span>
        )}
      </div>

      {result.titulo && (
        <Bloco titulo="Título">
          <p className="text-base font-bold text-gray-900">{result.titulo}</p>
        </Bloco>
      )}

      {(result.estrategia.angulo || result.estrategia.promessa) && (
        <Bloco titulo="Estratégia">
          {result.estrategia.angulo && (
            <p className="text-sm text-gray-800">{result.estrategia.angulo}</p>
          )}
          {result.estrategia.promessa && (
            <p className="mt-1 text-sm text-gray-600">{result.estrategia.promessa}</p>
          )}
          {result.estrategia.tom && (
            <p className="mt-1 text-[12px] text-gray-400">Tom: {result.estrategia.tom}</p>
          )}
        </Bloco>
      )}

      {result.slides.length > 0 && (
        <Bloco titulo={`Slides (${result.slides.length})`}>
          <ol className="space-y-2">
            {result.slides.map(slide => (
              <li
                key={slide.numero}
                className="rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-500 text-[11px] font-bold text-white tabular-nums">
                    {slide.numero}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    {PAPEL_LABEL[slide.papel] ?? slide.papel}
                  </span>
                </div>
                <p className="mt-1 text-sm font-semibold text-gray-900">{slide.headline}</p>
                <p className="mt-0.5 text-sm text-gray-600">{slide.texto}</p>
              </li>
            ))}
          </ol>
        </Bloco>
      )}

      {result.legenda && (
        <Bloco titulo="Legenda">
          <p className="whitespace-pre-line text-sm text-gray-800">{result.legenda}</p>
          {result.hashtags.length > 0 && (
            <p className="mt-1.5 text-[12px] text-indigo-500">{result.hashtags.join(' ')}</p>
          )}
        </Bloco>
      )}

      {result.cta && (
        <Bloco titulo="Chamada para ação">
          <p className="text-sm font-semibold text-gray-900">{result.cta}</p>
        </Bloco>
      )}

      {revisao.checklist.length > 0 && (
        <Bloco titulo="Checklist do revisor">
          <ul className="space-y-1">
            {revisao.checklist.map(item => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <span
                  className={item.ok ? 'text-emerald-600' : 'text-amber-600'}
                  aria-label={item.ok ? 'aprovado' : 'atenção'}
                >
                  {item.ok ? '✓' : '!'}
                </span>
                <span className="text-gray-700">
                  {item.label}
                  {item.detalhe && <span className="text-gray-400"> — {item.detalhe}</span>}
                </span>
              </li>
            ))}
          </ul>

          {reprovado && (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              O revisor pediu ajustes. O texto foi reescrito automaticamente uma vez.
            </p>
          )}
        </Bloco>
      )}

      <p className="mt-3 border-t border-gray-100 pt-3 text-[11px] text-gray-400">
        Conteúdo lido de <code>cs_steps</code>. Aprovar e editar chegam na próxima etapa.
      </p>
    </section>
  )
}
