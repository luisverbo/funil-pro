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
  /** Gera/regenera a ARTE de um slide (geração Studio). retry = explícito. */
  onGerarImagem?: (slide: number, retry: boolean) => void
  /** Gera as artes que faltam, uma a uma, com progresso. */
  onGerarTodas?: () => void
  /** true enquanto alguma geração de imagem está em voo. */
  gerandoImagens?: boolean
  /** Progresso do "Gerar todas" — ex.: 2 de 6. */
  progressoImagens?: { done: number; total: number } | null
}

const IMAGEM_STATUS_LABEL: Record<string, { txt: string; cor: string }> = {
  nao_gerado: { txt: 'não gerado', cor: 'bg-gray-100 text-gray-500' },
  gerando: { txt: 'gerando…', cor: 'bg-indigo-50 text-indigo-600' },
  pronto: { txt: 'pronto', cor: 'bg-emerald-50 text-emerald-700' },
  falhou: { txt: 'falhou', cor: 'bg-rose-50 text-rose-700' },
}

export default function ResultPanel({
  result, aguardandoAprovacao,
  onGerarImagem, onGerarTodas, gerandoImagens = false, progressoImagens = null,
}: ResultPanelProps) {
  if (!result.disponivel) return null

  // Imagens só existem na geração Studio (Designer concluído) e quando a tela
  // forneceu os handlers — produções antigas não ganham botões fantasmas.
  const comImagens = result.visual.disponivel && result.imagens.length > 0 && !!onGerarImagem
  const imagemDe = (numero: number) => result.imagens.find(i => i.numero === numero)

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
        {/* Selo de IA real — só aparece quando algum step foi gerado por IA. */}
        {result.ai.usedRealAI && (
          <span
            className="rounded-full bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700"
            title={`${result.ai.totalCalls} chamada(s) de IA`}
          >
            ✦ IA real
          </span>
        )}
        {/* Trabalho de direção de arte — só aparece quando o Designer gravou. */}
        {result.visual.disponivel && (
          <span
            className="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700"
            title={`Direção visual de ${result.visual.slides.length} slide(s) pelo Designer`}
          >
            ✎ copy + direção visual
          </span>
        )}
        {result.revisao.media !== null && (
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-semibold text-gray-600 tabular-nums">
            nota {result.revisao.media.toFixed(1)}
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

                {/* ── Arte final do slide (geração Studio, sob demanda) ── */}
                {comImagens && (() => {
                  const img = imagemDe(slide.numero)
                  if (!img) return null
                  const selo = IMAGEM_STATUS_LABEL[img.status]
                  return (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${selo.cor}`}>
                          🖼 {selo.txt}
                        </span>
                        {img.status === 'nao_gerado' && (
                          <button
                            type="button"
                            disabled={gerandoImagens}
                            onClick={() => onGerarImagem!(slide.numero, false)}
                            className="rounded-lg bg-indigo-500 px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
                          >
                            Gerar imagem
                          </button>
                        )}
                        {img.status === 'pronto' && (
                          <button
                            type="button"
                            disabled={gerandoImagens}
                            onClick={() => onGerarImagem!(slide.numero, true)}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                          >
                            Regenerar
                          </button>
                        )}
                        {img.status === 'falhou' && (
                          <button
                            type="button"
                            disabled={gerandoImagens}
                            onClick={() => onGerarImagem!(slide.numero, true)}
                            className="rounded-lg bg-rose-500 px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-rose-600 disabled:opacity-50"
                          >
                            Tentar novamente
                          </button>
                        )}
                      </div>
                      {img.status === 'pronto' && img.url && (
                        // Preview em proporção de carrossel (quadrado), lazy.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img.url}
                          alt={`Arte do slide ${slide.numero}`}
                          loading="lazy"
                          decoding="async"
                          width={1080}
                          height={1080}
                          className="mt-2 aspect-square w-full max-w-[280px] rounded-xl border border-gray-200 object-cover"
                        />
                      )}
                    </div>
                  )
                })()}
              </li>
            ))}
          </ol>

          {/* ── Gerar todas — com o custo dito ANTES do clique ── */}
          {comImagens && onGerarTodas && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2.5">
              <button
                type="button"
                disabled={gerandoImagens}
                onClick={onGerarTodas}
                className="rounded-xl bg-gradient-to-b from-indigo-500 to-violet-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:brightness-110 disabled:opacity-50"
              >
                {gerandoImagens ? 'Gerando…' : 'Gerar imagens do carrossel'}
              </button>
              <p className="text-[12px] text-indigo-700">
                Custo: uma geração de imagem por slide ({result.imagens.length} no total).
              </p>
              {progressoImagens && (
                <span className="ml-auto rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-indigo-700 tabular-nums">
                  {progressoImagens.done} de {progressoImagens.total} imagens
                </span>
              )}
            </div>
          )}
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

      {/* ── Direção visual (Designer) ───────────────────────────────────── */}
      {result.visual.disponivel && (
        <Bloco titulo="Direção visual (Designer)">
          <div className="mb-2 grid gap-1.5 rounded-xl border border-sky-100 bg-sky-50/50 px-3 py-2.5 sm:grid-cols-2">
            {([
              ['Estilo', result.visual.geral.estilo],
              ['Cores', result.visual.geral.paleta],
              ['Tipografia', result.visual.geral.tipografia],
              ['Clima', result.visual.geral.clima],
            ] as const).map(([rotulo, valor]) => valor && (
              <p key={rotulo} className="text-[12px] text-gray-700">
                <span className="font-semibold text-sky-800">{rotulo}: </span>{valor}
              </p>
            ))}
          </div>

          <ol className="space-y-2">
            {result.visual.slides.map(v => (
              <li key={v.numero} className="rounded-xl border border-gray-100 bg-white px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sky-500 text-[11px] font-bold text-white tabular-nums">
                    {v.numero}
                  </span>
                  {v.estilo && (
                    <span className="text-[11px] font-semibold text-gray-600">{v.estilo}</span>
                  )}
                </div>

                {v.composicao && <p className="mt-1 text-sm text-gray-800">{v.composicao}</p>}

                <dl className="mt-1 space-y-0.5 text-[12px] text-gray-500">
                  {v.layout && (
                    <div><dt className="inline font-semibold">Layout: </dt><dd className="inline">{v.layout}</dd></div>
                  )}
                  {v.cores && (
                    <div><dt className="inline font-semibold">Cores: </dt><dd className="inline">{v.cores}</dd></div>
                  )}
                  {v.elementos.length > 0 && (
                    <div><dt className="inline font-semibold">Elementos: </dt><dd className="inline">{v.elementos.join(' · ')}</dd></div>
                  )}
                </dl>

                {v.promptImagem && (
                  <p className="mt-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-gray-600">
                    <span className="font-sans font-semibold text-gray-400">prompt de imagem · </span>
                    {v.promptImagem}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </Bloco>
      )}

      {Object.keys(revisao.scores).length > 0 && (
        <Bloco titulo="Notas do revisor">
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(revisao.scores).map(([k, v]) => (
              <span
                key={k}
                className={`rounded-lg px-2 py-1 text-[11px] font-semibold tabular-nums ${
                  v >= 7 ? 'bg-emerald-50 text-emerald-700'
                  : v >= 5 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'
                }`}
              >
                {k} {v}
              </span>
            ))}
          </div>
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
